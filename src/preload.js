const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('term', {
  info: () => ipcRenderer.invoke('app:info'),
  create: (opts) => ipcRenderer.invoke('pty:create', opts),
  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: (id) => ipcRenderer.send('pty:kill', id),
  setTheme: (t) => ipcRenderer.send('win:theme', t),
  saveAsset: (opts) => ipcRenderer.invoke('asset:save', opts),
  deleteAsset: (opts) => ipcRenderer.invoke('asset:delete', opts),
  openLink: (url) => ipcRenderer.invoke('shell:open', url),
  notify: (o) => ipcRenderer.invoke('notify:show', o),
  onNotifyClick: (cb) => ipcRenderer.on('notify:click', (_e, tabId) => cb(tabId)),
  testMinimize: () => ipcRenderer.invoke('test:minimize'),        // only answers in self-test mode
  recStart: () => ipcRenderer.send('rec:start'),                  // demo recording, only acts in self-test mode
  recStop: () => ipcRenderer.send('rec:stop'),
  setPrefs: (p) => ipcRenderer.send('app:prefs', p),
  toggleFullscreen: () => ipcRenderer.send('win:fullscreen'),
  agentStatus: () => ipcRenderer.invoke('agent:status'),
  agentSetup: (opts) => ipcRenderer.invoke('agent:setup', opts),
  readTestFile: (p) => ipcRenderer.invoke('test:readFile', p),   // only answers when the app runs in self-test mode
  onData: (cb) => ipcRenderer.on('pty:data', (_e, id, data) => cb(id, data)),
  onExit: (cb) => ipcRenderer.on('pty:exit', (_e, id, code) => cb(id, code)),
  onAgentEvent: (cb) => ipcRenderer.on('agent:event', (_e, evt) => cb(evt)),
});
