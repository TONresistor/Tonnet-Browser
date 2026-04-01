const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tonBridge', {
  send: function (data) {
    if (typeof data !== 'string' || data.length > 65536) return
    ipcRenderer.invoke('bridge:send', data)
  },
  onMessage: function (callback) {
    var listener = function (_event, data) { callback(data) }
    ipcRenderer.on('bridge:message', listener)
    return function () { ipcRenderer.removeListener('bridge:message', listener) }
  },
})
