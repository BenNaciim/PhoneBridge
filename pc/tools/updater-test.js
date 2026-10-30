// Teste le module de mise à jour sans Electron : node tools/updater-test.js
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkForUpdate, downloadUpdate, compareVersions } = require('../updater');

(async () => {
  assert.strictEqual(compareVersions('v1.0.10', '1.0.9'), 1);
  assert.strictEqual(compareVersions('1.0.0', 'v1.0.0'), 0);
  assert.strictEqual(compareVersions('0.9.9', '1.0.0'), -1);

  const payload = Buffer.from('faux installateur');
  const sha = crypto.createHash('sha256').update(payload).digest('hex');
  const srv = http.createServer((req, res) => {
    if (req.url.endsWith('/releases/latest')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        tag_name: 'v1.2.0', html_url: 'x',
        assets: [{ name: 'PhoneBridge-Setup-1.2.0.exe', size: payload.length, digest: 'sha256:' + sha, browser_download_url: `http://127.0.0.1:${srv.address().port}/dl` }]
      }));
    } else res.end(payload);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const api = `http://127.0.0.1:${srv.address().port}`;

  assert.strictEqual(await checkForUpdate({ current: '1.2.0', api }), null);
  const info = await checkForUpdate({ current: '1.0.0', api });
  assert.strictEqual(info.version, '1.2.0');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbu-'));
  const file = await downloadUpdate(info, dir);
  assert.ok(fs.existsSync(file));
  await assert.rejects(downloadUpdate({ ...info, sha256: '0'.repeat(64) }, dir), /Somme de contrôle incorrecte/);
  assert.ok(!fs.existsSync(file + '.part'));
  await assert.rejects(downloadUpdate({ ...info, sha256: null }, dir), /absente/);
  // Lancement : échec direct « UNKNOWN » puis repli par cmd /c start.
  const { launchInstaller } = require('../updater');
  const calls = [];
  const fakeSpawn = (cmd, a) => {
    calls.push(cmd);
    const ev = new (require('node:events'))();
    ev.unref = () => {};
    setImmediate(() => {
      if (cmd === 'cmd.exe') ev.emit('spawn');
      else ev.emit('error', Object.assign(new Error('spawn UNKNOWN'), { code: 'UNKNOWN' }));
    });
    return ev;
  };
  await launchInstaller('C:\\x\\setup.exe', ['/S'], { spawnImpl: fakeSpawn, retries: 2, delayMs: 1 });
  assert.deepStrictEqual(calls, ['C:\\x\\setup.exe', 'C:\\x\\setup.exe', 'cmd.exe']);
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('updater : OK');
})().catch((e) => { console.error(e); process.exit(1); });
