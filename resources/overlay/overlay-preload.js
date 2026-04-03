const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlayBridge', {
  onContent: (callback) => {
    ipcRenderer.on('overlay:content', (_event, content) => callback(content))
  },
  onTheme: (callback) => {
    ipcRenderer.on('overlay:theme', (_event, theme) => callback(theme))
  },
  sendAction: (type, data) => {
    ipcRenderer.invoke('overlay:action', type, data)
  },
})
