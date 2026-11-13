const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('term', {
  info: () => ipcRenderer.invoke('app:info'),
  activeSessions: () => ipcRenderer.invoke('resume:active'),
  terminalWindows: () => ipcRenderer.invoke('terminals:windows'),
  resumeTerminalWindow: (key) => ipcRenderer.invoke('terminals:resume-window', key),
  onShown: (cb) => ipcRenderer.on('win:shown', cb),
  create: (opts) => ipcRenderer.invoke('pty:create', opts),
  sessions: () => ipcRenderer.invoke('pty:list'),
  dismissed: () => ipcRenderer.invoke('pty:dismissed'),
  attach: (id) => ipcRenderer.invoke('pty:attach', id),
  popout: (id) => ipcRenderer.invoke('pty:popout', id),
  returnToMain: () => ipcRenderer.send('pty:return'),
  onReturned: (cb) => ipcRenderer.on('pty:returned', (_e, tab) => cb(tab)),
  remember: (tabs) => ipcRenderer.send('pty:metadata', tabs),
  onError: (cb) => ipcRenderer.on('pty:error', (_e, message) => cb(message)),
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
  onData: (cb) => ipcRenderer.on('pty:data', (_e, id, data, replay) => cb(id, data, replay)),
  onExit: (cb) => ipcRenderer.on('pty:exit', (_e, id, code) => cb(id, code)),
  onAgentEvent: (cb) => ipcRenderer.on('agent:event', (_e, evt) => cb(evt)),
});
