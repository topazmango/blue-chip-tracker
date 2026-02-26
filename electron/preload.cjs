const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  toggleFullscreen: () => ipcRenderer.send('window:toggleFullscreen'),
  onStateChange: (cb) => {
    ipcRenderer.on('window:stateChange', (_, state) => cb(state));
  },
});
