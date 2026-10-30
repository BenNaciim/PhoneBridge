const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  pairingInfo: () => ipcRenderer.invoke('pairing:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getIcons: () => ipcRenderer.invoke('icons:get'),
  onIcon: (cb) => ipcRenderer.on('icons:changed', (_e, o) => cb(o)),
  setSettings: (p) => ipcRenderer.send('settings:set', p),
  send: (msg) => ipcRenderer.send('phone:send', msg),
  onStatus: (cb) => ipcRenderer.on('phone:status', (_e, s) => cb(s)),
  onMessage: (cb) => ipcRenderer.on('phone:msg', (_e, m) => cb(m)),
  onSettings: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  onOpen: (cb) => ipcRenderer.on('ui:open', (_e, o) => cb(o)),
  onLocalSent: (cb) => ipcRenderer.on('local:sent', (_e, o) => cb(o))
});
