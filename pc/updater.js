'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REPO = 'BenNaciim/PhoneBridge';
const API = 'https://api.github.com';
const INSTALLER = /^PhoneBridge-Setup-.+\.exe$/i;

/** 1 when a is newer than b, -1 when older, 0 when equal ("v1.2.3" and "1.2.3" are the same). */
function compareVersions(a, b) {
  const parts = (v) => String(v).replace(/^v/i, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Looks for a newer release. Resolves to null when there is none, when the repository has no public
 * release (a private repository answers 404), or when the release carries no installer.
 */
async function checkForUpdate({ current, repo = REPO, api = API, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${api}/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PhoneBridge-Updater' },
    signal: AbortSignal.timeout(15_000)
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  const rel = await res.json();
  if (!rel || rel.draft || rel.prerelease || !rel.tag_name) return null;
  if (compareVersions(rel.tag_name, current) <= 0) return null;
  const asset = (rel.assets ?? []).find((a) => INSTALLER.test(a.name ?? ''));
  if (!asset?.browser_download_url) return null;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? '');
  return {
    version: String(rel.tag_name).replace(/^v/i, ''),
    url: asset.browser_download_url,
    size: Number(asset.size) || 0,
    sha256: digest ? digest[1].toLowerCase() : null,
    page: rel.html_url || `https://github.com/${repo}/releases`
  };
}

/**
 * Downloads the installer and checks its SHA-256 against the one GitHub published for that file.
 * Without that checksum nothing is run: the caller can still send the user to the release page.
 */
async function downloadUpdate(info, dir, { onProgress, log = () => {}, fetchImpl = fetch, allowHost = /(^|\.)(github\.com|githubusercontent\.com)$/i } = {}) {
  const u = new URL(info.url);
  if (u.protocol !== 'https:' && u.hostname !== '127.0.0.1') throw new Error('Adresse de mise à jour refusée');
  if (u.hostname !== '127.0.0.1' && !allowHost.test(u.hostname)) throw new Error('Adresse de mise à jour refusée');
  if (!info.sha256) throw new Error('Somme de contrôle absente : installation automatique refusée');

  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `PhoneBridge-Setup-${info.version.replace(/[^\w.-]/g, '')}.exe`);
  const part = `${file}.part`;
  const res = await fetchImpl(info.url, { headers: { 'User-Agent': 'PhoneBridge-Updater' }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status})`);
  const total = Number(res.headers.get('content-length')) || info.size || 0;
  const hash = crypto.createHash('sha256');
  let got = 0;
  // Un seul consommateur : le flux passe par un Transform qui copie chaque bloc avant de le hacher et de
  // l'écrire. (Avec un écouteur « data » en plus du pipe, le fichier écrit différait du flux haché dans
  // l'application Electron dès que le rappel de progression était un peu lent.)
  let lastReport = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      const copy = Buffer.from(chunk);
      hash.update(copy);
      got += copy.length;
      const now = Date.now();
      if (onProgress && (now - lastReport > 200 || got === total)) { lastReport = now; onProgress(got, total); }
      cb(null, copy);
    }
  });
  log(`téléchargement ${info.version} : ${total} octets attendus`);
  try {
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part));
    const streamHash = hash.digest('hex');
    log(`reçu ${got} octets, écrit ${fs.statSync(part).size} octets, sha256 du flux ${streamHash}`);
    if (streamHash !== info.sha256) throw new Error('Somme de contrôle incorrecte : fichier rejeté');
    const moved = await moveInto(part, file);
    log(`déplacé vers ${moved}`);
    await verifyFile(moved, info.sha256, log);
    log('fichier vérifié sur le disque');
    return moved;
  } catch (err) {
    log(`échec : ${err.message}`);
    fs.rmSync(part, { force: true });
    throw err;
  }
}

/** Relit le fichier sur le disque et compare sa somme SHA-256 : ce qu'on lance doit être ce que GitHub a publié. */
async function verifyFile(file, sha256, log = () => {}) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), async function* (source) {
    for await (const chunk of source) hash.update(chunk);
  });
  const actual = hash.digest('hex');
  log(`sha256 sur le disque ${actual} (${fs.statSync(file).size} octets)`);
  if (actual !== sha256) {
    fs.rmSync(file, { force: true });
    throw new Error('Le fichier téléchargé a été modifié sur le disque (antivirus ?) : il est supprimé, réessayez.');
  }
}

/**
 * Renomme le fichier téléchargé. Windows répond EPERM/EBUSY tant qu'un antivirus analyse le fichier
 * ou qu'un ancien installateur du même nom est encore ouvert : on réessaie, puis on change de nom.
 */
async function moveInto(part, file, { tries = 20, delayMs = 500 } = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < tries; i++) {
    try {
      fs.rmSync(file, { force: true });
      fs.renameSync(part, file);
      return file;
    } catch (err) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await sleep(delayMs);
    }
  }
  const alt = file.replace(/\.exe$/i, `-${Date.now()}.exe`);
  fs.copyFileSync(part, alt);
  fs.rmSync(part, { force: true });
  return alt;
}

/**
 * Lance l'installateur. Un lancement direct échoue avec « spawn UNKNOWN » quand Windows exige une
 * élévation ou qu'un antivirus tient encore le fichier : on réessaie, puis on passe par « start »
 * (ShellExecute), qui sait demander l'élévation.
 */
function launchInstaller(file, args, { spawnImpl = require('node:child_process').spawn, retries = 3, delayMs = 1000, watchMs = 2500 } = {}) {
  const attempt = (cmd, cmdArgs) => new Promise((resolve, reject) => {
    const child = spawnImpl(cmd, cmdArgs, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    // Un installateur sain tourne plusieurs secondes : une sortie immédiate en erreur est un échec.
    child.once('spawn', () => {
      const early = (code) => reject(Object.assign(new Error(`L'installateur s'est arrêté (code ${code})`), { code: 'EARLYEXIT' }));
      child.once('exit', (code) => { if (code) early(code); });
      setTimeout(() => { child.removeAllListeners('exit'); child.unref(); resolve(); }, watchMs);
    });
  });
  return (async () => {
    let last;
    for (let i = 0; i < retries; i++) {
      try { return await attempt(file, args); } catch (err) {
        last = err;
        if (err.code !== 'UNKNOWN' && err.code !== 'EBUSY' && err.code !== 'EPERM') break;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    if (last && last.code === 'EARLYEXIT') throw last;
    try { return await attempt('cmd.exe', ['/c', 'start', '""', file, ...args]); } catch (err) {
      throw new Error(`Impossible de lancer l'installateur (${last ? last.code || last.message : err.message}). Fichier : ${file}`);
    }
  })();
}

module.exports = { checkForUpdate, downloadUpdate, launchInstaller, moveInto, verifyFile, compareVersions, REPO };
