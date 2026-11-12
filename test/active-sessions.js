const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { select, selectWindows, toolFor, metadata } = require('../src/active-sessions');
const id = '01234567-89ab-4cde-8fab-0123456789ab', second = '11234567-89ab-4cde-8fab-0123456789ab';
const p = (pid, parentPid, name, extra = {}) => ({ pid, parentPid, name, started:'2026-11-11', commandLine:'', ...extra });
const snapshot = { processes:[
  p(1,0,'WindowsTerminal.exe',{visible:true}), p(2,1,'powershell.exe'), p(3,2,'codex.exe'),
  p(4,0,'codex.exe',{commandLine:'codex app-server'}),
  p(5,2,'claude.exe',{commandLine:'claude --output-format stream-json'}),
  p(6,2,'claude.exe'), p(7,0,'codex.exe'),
  p(8,2,'Belor.exe'), p(9,8,'codex.exe'),
  p(10,0,'powershell.exe'), p(11,10,'conhost.exe',{visible:true}), p(12,10,'codex.exe'),
], files:[{pid:3,file:'one'},{pid:4,file:'one'},{pid:5,file:'two'},{pid:6,file:'two'},{pid:7,file:'one'},{pid:9,file:'one'},{pid:12,file:'one'}] };
const meta = file => ({ sessionId: file === 'one' ? id : second, cwd:'C:\\Projects' });
const sessions = select(snapshot, [], meta);
assert.deepEqual(sessions.map(s => s.toolId).sort(), ['claude','codex']);
assert.equal(sessions.find(s => s.toolId === 'codex').pid, 3);
assert.equal(select(snapshot,[2],meta).length,1, 'Belor child processes cannot import themselves');
assert.equal(select({...snapshot,files:[]},[],meta).length,0,'never use old history as a running-session guess');
assert.equal(toolFor(p(1,0,'node.exe',{commandLine:'node some-server.js'})),null);
assert.equal(toolFor(p(1,0,'codex.exe',{commandLine:'codex exec task'})),null);
const ambiguous = {processes:snapshot.processes.slice(0,3), files:[{pid:3,file:'one'},{pid:3,file:'two'}]};
assert.equal(select(ambiguous,[],meta).length,0,'do not choose an arbitrary conversation');
assert.equal(select(snapshot,[],()=>({sessionId:'bad',cwd:'C:\\Projects'})).length,0);
const terminalWindows = { ...snapshot, windows:[
  {pid:1,window:101,started:'2026-11-11',name:'WindowsTerminal.exe',title:'Project terminal'},
  {pid:1,window:102,started:'2026-11-11',name:'WindowsTerminal.exe',title:'Second terminal window'},
  {pid:10,window:103,started:'2026-11-11',name:'powershell.exe',title:'PowerShell'},
  {pid:9,window:104,started:'2026-11-11',name:'cmd.exe',title:'Belor child - exclude'},
  {pid:99,window:105,started:'2026-11-11',name:'node.exe',title:'Background helper - exclude'},
] };
assert.deepEqual(selectWindows(terminalWindows).map(w=>w.window),[101,102,103], 'ordinary terminal windows appear without saved conversation files');
assert.equal(selectWindows(terminalWindows,[10]).length,2);
assert.equal(selectWindows({...terminalWindows,windows:[]}).length,0);
const oldCodexHome = process.env.CODEX_HOME;
const fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), 'belor-active-session-'));
try {
  process.env.CODEX_HOME = fixtureHome;
  const folder = path.join(fixtureHome, 'sessions'); fs.mkdirSync(folder);
  const file = path.join(folder, `rollout-${id}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({type:'session_meta',payload:{id,cwd:'C:\\Projects',source:'cli'}})+'\n');
  assert.deepEqual(metadata(file,'codex'),{sessionId:id,cwd:'C:\\Projects'});
  fs.writeFileSync(file, JSON.stringify({type:'session_meta',payload:{id,cwd:'C:\\Projects',source:{subagent:'parent'}}})+'\n');
  assert.equal(metadata(file,'codex'),null,'subagent rollouts are not independent user terminals');
  assert.equal(metadata(path.join(fixtureHome, `${id}.jsonl`),'codex'),null,'stay inside the configured session store');
} finally {
  if (oldCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldCodexHome;
}
console.log('Automatic running-session selection checks passed.');
