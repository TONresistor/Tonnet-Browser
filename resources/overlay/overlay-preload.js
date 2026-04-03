const { contextBridge, ipcRenderer } = require('electron')

if (!process.contextIsolated) throw new Error('contextIsolation must be enabled')

contextBridge.exposeInMainWorld('overlayBridge', {
  onContent: (callback) => {
    ipcRenderer.on('overlay:content', (_event, content) => callback(content))
  },
  onTheme: (callback) => {
    ipcRenderer.on('overlay:theme', (_event, theme) => callback(theme))
  },
  sendAction: (type, data) => {
    // Mirrors IPC_CHANNELS.OVERLAY_ACTION (plain JS, cannot import TS constants)
    ipcRenderer.invoke('overlay:action', type, data)
  },
})
