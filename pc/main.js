const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const selfsigned = require('selfsigned');
const { Bonjour } = require('bonjour-service');
const { spawn } = require('child_process');
const updater = require('./updater');

const PORT = 8787;
const hiddenStart = process.argv.includes('--hidden');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let win = null;
let tray = null;
let phone = null;
let quitting = false;
let token = '';
let certFp = '';
let toasts = [];
let icons = {};
let settings = { theme: 'auto', glass: 0.14, blur: 22, toasts: true, autostart: true, autoUpdate: true, muted: {}, apps: {} };

const userFile = (name) => path.join(app.getPath('userData'), name);
const iconPath = path.join(__dirname, 'renderer', 'icon.png');

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(userFile(name), 'utf8')); } catch (_) { return fallback; }
}
function writeJson(name, data) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(userFile(name), JSON.stringify(data));
}

function loadSettings() {
  settings = { ...settings, ...readJson('settings.json', {}) };
  settings.glass = Math.min(0.4, Math.max(0.04, Number(settings.glass) || 0.14));
  settings.blur = Math.min(40, Math.max(8, Number(settings.blur) || 22));
}
function saveSettings() {
  writeJson('settings.json', settings);
  if (win && !win.isDestroyed()) win.webContents.send('settings:changed', settings);
}
function applyAutostart() {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!settings.autostart, args: ['--hidden'] });
}

function loadToken() {
  token = (readJson('pairing.json', {}) || {}).token || '';
  if (!token) {
    token = crypto.randomBytes(4).toString('hex').toUpperCase();
    writeJson('pairing.json', { token });
  }
}

async function loadCert() {
  let key, cert;
  try {
    key = fs.readFileSync(userFile('key.pem'), 'utf8');
    cert = fs.readFileSync(userFile('cert.pem'), 'utf8');
  } catch (_) {
    const notAfterDate = new Date();
    notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'PhoneBridge' }], {
      keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notAfterDate
    });
    key = pems.private;
    cert = pems.cert;
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(userFile('key.pem'), key, { mode: 0o600 });
    fs.writeFileSync(userFile('cert.pem'), cert);
  }
  certFp = new crypto.X509Certificate(cert).fingerprint256.replace(/:/g, '').toLowerCase();
  return { key, cert };
}

const pairingCode = () => `${token}-${certFp.slice(0, 20).toUpperCase()}`;

function lanIps() {
  const virtual = /vethernet|wsl|vpn|virtualbox|vmware|hyper-v|docker|tap|tailscale|zerotier/i;
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (virtual.test(name)) continue;
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(i.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const fails = new Map();
const isBlocked = (ip) => (fails.get(ip) || { until: 0 }).until > Date.now();
function noteFail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  if (++f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; }
  fails.set(ip, f);
}

function toRenderer(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function sendPhone(msg) {
  if (phone && phone.readyState === 1) phone.send(JSON.stringify(msg));
}

function windowIsActive() {
  return !!(win && !win.isDestroyed() && win.isVisible() && win.isFocused());
}

function onPhoneMessage(m) {
  if (m.t === 'notif') {
    const { icon, ...note } = m;
    if (note.pkg && settings.apps[note.pkg] !== note.app) {
      settings.apps[note.pkg] = note.app;
      saveSettings();
    }
    if (note.pkg && icon && icons[note.pkg] !== icon) {
      icons[note.pkg] = icon;
      writeJson('icons.json', icons);
      toRenderer('icons:changed', { pkg: note.pkg, icon });
    }
    if (note.pkg && settings.muted[note.pkg]) return;
    toRenderer('phone:msg', note);
    if (settings.toasts && !windowIsActive()) {
      const conv = note.conv;
      showToast({
        title: conv ? conv.name : note.app, subtitle: conv ? note.app : note.title, body: note.text,
        icon: icons[note.pkg], threadId: conv ? conv.id : undefined,
        reply: note.canReply ? { kind: 'notif', key: note.key, convId: conv ? conv.id : undefined } : null
      });
    }
    return;
  }
  toRenderer('phone:msg', m);
  if (!settings.toasts || windowIsActive()) return;
  if (m.t === 'sms_new') {
    showToast({
      title: m.name || m.address, body: m.body || (m.images && m.images.length ? 'Photo' : ''),
      image: m.images && m.images[0], reply: { kind: 'sms', to: m.address, threadId: m.threadId }, threadId: m.threadId
    });
  } else if (m.t === 'call_missed') {
    showToast({ title: 'Appel en absence', body: m.name || m.number, reply: null });
  }
}

function startServer(tls) {
  const server = https.createServer(tls);
  const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 * 1024 });
  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress || '';
    if (isBlocked(ip)) { ws.close(); return; }
    let authed = false;
    const timer = setTimeout(() => { if (!authed) ws.close(); }, 5000);

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      if (!authed) {
        if (m.t === 'hello' && sameToken(m.token, token)) {
          authed = true;
          clearTimeout(timer);
          if (phone && phone !== ws) phone.close();
          phone = ws;
          ws.send(JSON.stringify({ t: 'welcome' }));
          toRenderer('phone:status', { connected: true, device: m.device || 'Android' });
        } else {
          noteFail(ip);
          ws.close();
        }
        return;
      }
      onPhoneMessage(m);
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (phone === ws) {
        phone = null;
        toRenderer('phone:status', { connected: false });
      }
    });
    ws.on('error', () => {});
  });
  server.on('error', (e) => toRenderer('phone:status', { connected: false, error: e.message }));
  server.listen(PORT);

  try {
    new Bonjour().publish({ name: 'PhoneBridge-' + os.hostname(), type: 'phonebridge', port: PORT });
  } catch (_) {}
}

async function pairingInfo() {
  const ips = lanIps();
  const ip = ips[0] || '127.0.0.1';
  const code = pairingCode();
  return { ips, port: PORT, code, qr: await QRCode.toDataURL(`phonebridge://${ip}:${PORT}/${code}`, { margin: 1, width: 220 }) };
}

function showMain(threadId) {
  if (!win || win.isDestroyed()) return;
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
  if (threadId != null) toRenderer('ui:open', { threadId });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 700, minWidth: 860, minHeight: 560,
    title: 'PhoneBridge', backgroundColor: '#0C447C', show: !hiddenStart, icon: iconPath,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip('PhoneBridge');
  tray.on('click', () => showMain());
  const menu = () => Menu.buildFromTemplate([
    { label: 'Ouvrir PhoneBridge', click: () => showMain() },
    { label: 'Alertes sur le bureau', type: 'checkbox', checked: settings.toasts, click: (i) => { settings.toasts = i.checked; saveSettings(); } },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu());
  tray.on('right-click', () => tray.setContextMenu(menu()));
}

/* Alertes sur le bureau, avec champ de réponse */
function layoutToasts() {
  const wa = screen.getPrimaryDisplay().workArea;
  let y = wa.y + wa.height - 12;
  for (const w of [...toasts].reverse()) {
    if (w.isDestroyed()) continue;
    const [bw, bh] = w.getSize();
    y -= bh;
    w.setPosition(wa.x + wa.width - bw - 12, y);
    y -= 10;
  }
}

function showToast(data) {
  if (toasts.length >= 4) toasts[0].close();
  const w = new BrowserWindow({
    width: 380, height: 120, frame: false, transparent: true, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, show: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'toast-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  w.__data = data;
  w.setAlwaysOnTop(true, 'screen-saver');
  w.loadFile(path.join(__dirname, 'renderer', 'toast.html'));
  w.webContents.once('did-finish-load', () => {
    if (w.isDestroyed()) return;
    w.webContents.send('toast:data', data);
    w.showInactive();
  });
  w.on('closed', () => {
    toasts = toasts.filter((x) => x !== w);
    layoutToasts();
  });
  toasts.push(w);
  layoutToasts();
}

const toastOf = (e) => BrowserWindow.fromWebContents(e.sender);

ipcMain.on('toast:size', (e, h) => {
  const w = toastOf(e);
  if (!w) return;
  w.setSize(380, Math.min(300, Math.max(60, Math.ceil(h))));
  layoutToasts();
});
ipcMain.on('toast:close', (e) => { const w = toastOf(e); if (w) w.close(); });
ipcMain.on('toast:open', (e) => {
  const w = toastOf(e);
  const threadId = w && w.__data ? w.__data.threadId : null;
  if (w) w.close();
  showMain(threadId);
});
ipcMain.on('toast:reply', (e, text) => {
  const w = toastOf(e);
  const r = w && w.__data && w.__data.reply;
  const body = String(text || '').trim();
  if (!r || !body) return;
  if (r.kind === 'sms') {
    sendPhone({ t: 'send_sms', to: r.to, threadId: r.threadId, body });
    toRenderer('local:sent', { threadId: r.threadId, body });
  } else if (r.kind === 'notif') {
    sendPhone({ t: 'reply_notif', key: r.key, text: body });
    if (r.convId) toRenderer('local:sent', { threadId: r.convId, body });
  }
  w.close();
});

/* Renderer */
ipcMain.handle('pairing:info', pairingInfo);
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('icons:get', () => icons);
ipcMain.on('phone:send', (_e, msg) => sendPhone(msg));
ipcMain.on('settings:set', (_e, p) => {
  if (['dark', 'light', 'auto'].includes(p.theme)) settings.theme = p.theme;
  if (typeof p.glass === 'number') settings.glass = Math.min(0.4, Math.max(0.04, p.glass));
  if (typeof p.blur === 'number') settings.blur = Math.min(40, Math.max(8, p.blur));
  if (typeof p.toasts === 'boolean') settings.toasts = p.toasts;
  if (typeof p.autostart === 'boolean') { settings.autostart = p.autostart; applyAutostart(); }
  if (typeof p.autoUpdate === 'boolean') settings.autoUpdate = p.autoUpdate;
  if (typeof p.mutePkg === 'string') settings.muted[p.mutePkg] = !!p.muted;
  saveSettings();
});

/* Mises à jour : releases GitHub, installateur vérifié par sa somme SHA-256 */
let pendingUpdate = null;
const updateSummary = (i) => ({ version: i.version, page: i.page, canInstall: Boolean(i.sha256) });
const toRendererSafe = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

async function lookForUpdate() {
  const info = await updater.checkForUpdate({ current: app.getVersion() });
  pendingUpdate = info;
  toRendererSafe('update:avail', info && updateSummary(info));
  return info;
}

ipcMain.handle('update:check', async () => {
  const info = await lookForUpdate();
  return { current: app.getVersion(), update: info && updateSummary(info) };
});
ipcMain.handle('update:state', () => ({ current: app.getVersion(), update: pendingUpdate && updateSummary(pendingUpdate) }));
ipcMain.handle('update:install', async () => {
  if (!pendingUpdate) throw new Error('Aucune mise à jour à installer');
  if (!pendingUpdate.sha256) return shell.openExternal(pendingUpdate.page);
  const file = await updater.downloadUpdate(pendingUpdate, path.join(app.getPath('temp'), 'phonebridge-update'), {
    onProgress: (got, total) => toRendererSafe('update:progress', { got, total })
  });
  // L'installateur remplace l'application : la nôtre doit être fermée, il la relance ensuite.
  spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  quitting = true;
  app.quit();
  return undefined;
});

app.on('second-instance', () => showMain());
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(async () => {
  loadSettings();
  icons = readJson('icons.json', {});
  loadToken();
  const tls = await loadCert();
  startServer(tls);
  createWindow();
  createTray();
  applyAutostart();
  if (app.isPackaged) {
    const auto = () => { if (settings.autoUpdate) lookForUpdate().catch(() => {}); };
    setTimeout(auto, 15000);
    setInterval(auto, 6 * 3600 * 1000);
  }
});
app.on('window-all-closed', () => {});
