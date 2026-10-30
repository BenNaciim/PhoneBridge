const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toast', {
  onData: (cb) => ipcRenderer.on('toast:data', (_e, d) => cb(d)),
  size: (h) => ipcRenderer.send('toast:size', h),
  close: () => ipcRenderer.send('toast:close'),
  open: () => ipcRenderer.send('toast:open'),
  reply: (text) => ipcRenderer.send('toast:reply', text)
});
