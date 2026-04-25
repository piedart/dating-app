const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('bridge', {
  platform: process.platform,
  pkg() {
    return ipcRenderer.sendSync('pkg')
  },
  applyUpdate: () => ipcRenderer.invoke('pear:applyUpdate'),
  appAfterUpdate: () => ipcRenderer.invoke('app:afterUpdate'),
  onPearEvent: (name, listener) => {
    const wrap = (evt, eventName) => listener(eventName)
    ipcRenderer.on('pear:event:' + name, wrap)
    return () => ipcRenderer.removeListener('pear:event:' + name, wrap)
  },
  startWorker: (specifier) => ipcRenderer.invoke('pear:startWorker', specifier),
  onWorkerStdout: (specifier, listener) => {
    const wrap = (evt, data) => listener(Buffer.from(data))
    ipcRenderer.on('pear:worker:stdout:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:stdout:' + specifier, wrap)
  },
  onWorkerStderr: (specifier, listener) => {
    const wrap = (evt, data) => listener(Buffer.from(data))
    ipcRenderer.on('pear:worker:stderr:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:stderr:' + specifier, wrap)
  },
  onWorkerIPC: (specifier, listener) => {
    const wrap = (evt, data) => listener(Buffer.from(data))
    ipcRenderer.on('pear:worker:ipc:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:ipc:' + specifier, wrap)
  },
  onWorkerExit: (specifier, listener) => {
    const wrap = (evt, data) => listener(Buffer.from(data))
    ipcRenderer.on('pear:worker:exit:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:exit:' + specifier, wrap)
  },
  writeWorkerIPC: (specifier, data) => {
    return ipcRenderer.invoke('pear:worker:writeIPC:' + specifier, data)
  },
  requestMicrophone: () => ipcRenderer.invoke('media:requestMicrophone'),
  openMicrophonePrivacy: () => ipcRenderer.invoke('media:openMicrophonePrivacy'),
  promptMicrophonePrivacy: () => ipcRenderer.invoke('media:promptMicrophonePrivacy'),
  accountGet: () => ipcRenderer.invoke('account:get'),
  accountSave: (profile) => ipcRenderer.invoke('account:save', profile),
  accountClear: () => ipcRenderer.invoke('account:clear'),
  matchmakingStart: () => ipcRenderer.invoke('matchmaking:start'),
  matchmakingStop: () => ipcRenderer.invoke('matchmaking:stop'),
  onMatchmakingPeers: (listener) => {
    const wrap = (_evt, data) => listener(data)
    ipcRenderer.on('matchmaking:peers', wrap)
    return () => ipcRenderer.removeListener('matchmaking:peers', wrap)
  },
  dmOpen: (remotePublicId) => ipcRenderer.invoke('dm:open', remotePublicId),
  dmSend: (text) => ipcRenderer.invoke('dm:send', text),
  dmClose: () => ipcRenderer.invoke('dm:close'),
  dmSetUiState: (openWithPublicId) => ipcRenderer.invoke('dm:uiState', openWithPublicId),
  blocklistGet: () => ipcRenderer.invoke('blocklist:get'),
  blocklistAdd: (publicId) => ipcRenderer.invoke('blocklist:add', publicId),
  blocklistRemove: (publicId) => ipcRenderer.invoke('blocklist:remove', publicId),
  onDmMessage: (listener) => {
    const wrap = (_evt, msg) => listener(msg)
    ipcRenderer.on('dm:message', wrap)
    return () => ipcRenderer.removeListener('dm:message', wrap)
  },
  onDmClosed: (listener) => {
    const wrap = () => listener()
    ipcRenderer.on('dm:closed', wrap)
    return () => ipcRenderer.removeListener('dm:closed', wrap)
  }
})
