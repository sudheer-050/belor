// UI-only fallback when Windows blocks Electron/ConPTY in a managed environment.
// Serves the real renderer and xterm with a simulated preload bridge on loopback.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const bridge = `
let nextId = 0, onData = () => {}, onExit = () => {};
const noop = () => {};
const popoutPreview = new URLSearchParams(location.search).has('popout');
window.term = {
  info: async () => ({version:'UI preview',popoutId:popoutPreview?1:null,shells:[{id:'powershell',kind:'powershell',label:'PowerShell',adminOk:true}],resumeTools:[],home:'C:\\Users\\you',windowsBuild:26100,assetBase:{image:'/',font:'/'}}),
  sessions: async () => popoutPreview ? [{id:1,shellId:'powershell',userTitle:'My terminal',cwd:'C:/Users/you',cols:100,rows:30}] : [],
  attach: async id => { if(popoutPreview) onData(id,'Same running terminal session\\r\\nPop-out UI preview - simulated shell output\\r\\nPS C:\\\\Users\\\\you> ',true); return {exited:false}; },
  create: async () => { const id=++nextId; setTimeout(()=>onData(id,'Windows PowerShell\\r\\nUI preview - simulated shell output\\r\\nPS C:\\\\Users\\\\you> '),100); return id; },
  write: (id, data) => { onData(id,data.replace(/\\r/g,'\\r\\n')); if(data.includes('BELOR_PANE_INPUT_OK')) onData(id,'\\r\\nBELOR_PANE_INPUT_OK\\r\\n'); },
  kill: id => onExit(id), resize: noop, setTheme: noop, setPrefs: noop, onShown: noop, onNotifyClick: noop, onAgentEvent: noop,
  onData: cb => { onData=cb; }, onExit: cb => { onExit=cb; },
  activeSessions: async()=>[], terminalWindows: async()=>[], agentStatus: async()=>({}), toggleFullscreen: noop,
};`;
http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/preview-bridge.js') { res.setHeader('Content-Type','text/javascript'); res.end(bridge); return; }
  if (url.pathname === '/preview-tests.js') {
    res.setHeader('Content-Type','text/javascript');
    res.end(fs.readFileSync(path.join(__dirname,'tiled-workspace.page.js'),'utf8') + `.then(result=>{document.body.dataset.testResult='UI_PASS';console.log(result);}).catch(error=>{document.body.dataset.testResult='UI_FAIL: '+error.message;console.error(error);});`); return;
  }
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    let body = fs.readFileSync(file);
    const ext = path.extname(file);
    res.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[ext] || 'application/octet-stream');
    if (url.pathname === '/src/renderer/index.html') {
      body = body.toString().replace('<script src="app.js">','<script src="/preview-bridge.js"></script><script src="app.js">');
      if (url.searchParams.has('runchecks')) body = body.replace('</body>', '<script src="/preview-tests.js"></script></body>');
    }
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(4318,'127.0.0.1',()=>console.log('Belor UI preview: http://127.0.0.1:4318/src/renderer/index.html?selftest=1&runchecks=1'));
