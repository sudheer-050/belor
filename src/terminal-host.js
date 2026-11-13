// Owns PTYs independently of every desktop window. Only a tab-close request kills one.
const { app } = require('electron');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pty = require('node-pty');
const { detectShells, ADMIN_KINDS, SHELL_DIR } = require('./shells');
const resumeTools = require('./resume-tools');
const conversations = require('./window-conversation');
const { send, lineReader } = require('./jsonlines');
const profile = process.argv[process.argv.indexOf('--terminal-profile') + 1];
if (!profile || !path.isAbsolute(profile)) { app.exit(2); return; }
app.setPath('userData', path.join(profile, 'terminal-host-profile'));
app.setPath('sessionData', app.getPath('userData'));
app.disableHardwareAcceleration();
if (!app.requestSingleInstanceLock()) { app.exit(0); return; }
const directory = path.join(profile, 'terminals');
fs.mkdirSync(directory, { recursive: true });
const manifest = path.join(directory, 'tabs.json');
const transcript = id => path.join(directory, `${id}.log`);
const records = new Map(), ptys = new Map(), remote = new Map(), clients = new Set();
const dismissed = new Set();
const attachments = new Map();
const titleBuffers = new Map(), lastTitles = new Map();
const shells = detectShells();
let nextId = 1, isAdmin = false;
function saveRecords() {
  const temp = manifest + '.tmp';
  fs.writeFileSync(temp, JSON.stringify([...records.values()]));
  fs.renameSync(temp, manifest);
  fs.copyFileSync(manifest, manifest + '.bak');
}
function broadcast(msg) { for (const socket of clients) send(socket, msg); }
function rememberConversation(record, output, persist = true) {
  if (record.resumeTool !== 'codex' && record.agent !== 'codex') return;
  const title = conversations.outputTitle(output);
  const last = lastTitles.get(record.id);
  if (!title || last?.title === title && (last.matched || Date.now() - last.at < 10000)) return;
  const check = { title, at: Date.now(), matched: false };
  lastTitles.set(record.id, check);
  const session = conversations.resolve(title);
  if (!session) return;
  check.matched = true;
  record.resumeTool = session.toolId; record.resumeSession = session.sessionId;
  if (persist) saveRecords();
}
const sender = {
  isDestroyed: () => false,
  send(type, id, value) {
    const record = records.get(id);
    if (!record) return;
    if (type === 'pty:data') {
      // Store the complete transcript, including output produced with the desktop closed.
      fs.appendFileSync(transcript(id), value);
      const output = ((titleBuffers.get(id) || '') + value).slice(-8192);
      titleBuffers.set(id, output);
      rememberConversation(record, output);
      for (const [socket, sessions] of attachments) {
        const queue = sessions.get(id);
        if (queue) queue.push(value);
        else if (sessions.has(id)) send(socket, { t: 'data', id, data: value });
      }
    } else if (type === 'pty:exit') {
      record.exited = true; record.exitCode = value; saveRecords();
      broadcast({ t: 'exit', id, code: value });
    }
  },
};
const BIN_DIR = process.env.ST_BIN_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Belor', 'bin');
const NOTIFY_SCRIPT = path.join(BIN_DIR, 'st-notify.ps1');
const eventPipe = `\\\\.\\pipe\\belor-events-${crypto.randomBytes(16).toString('hex')}`;
const eventToken = Buffer.from(crypto.randomBytes(32).toString('hex'));
const agentEnv = (id) => ({ BELOR_PIPE: eventPipe, BELOR_TAB: String(id), BELOR_TOKEN: eventToken.toString() });
const AGENT_EVENTS = new Set(['running', 'done', 'attention', 'error']);
let eventBudget = 20, eventBudgetReset = 0;

function installNotifyScript() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.copyFileSync(path.join(SHELL_DIR, 'st-notify.ps1'), NOTIFY_SCRIPT);
  // Hooks written when the app was called "Sound Terminal" still point at the old folder. Keep that copy current so they keep
  // working until you press "Update" in Settings, which moves them to the new location.
  const legacy = path.join(path.dirname(path.dirname(BIN_DIR)), 'SoundTerminal', 'bin', 'st-notify.ps1');
  try { if (!process.env.ST_BIN_DIR && fs.existsSync(path.dirname(legacy))) fs.copyFileSync(path.join(SHELL_DIR, 'st-notify.ps1'), legacy); } catch { /* best effort */ }
}

function handleAgentEvent(msg) {
  if (!msg || typeof msg !== 'object') return;
  const sent = Buffer.from(String(msg.token || ''));
  if (sent.length !== eventToken.length || !crypto.timingSafeEqual(sent, eventToken)) return;   // not from one of our tabs
  if (!AGENT_EVENTS.has(msg.event) || !Number.isInteger(msg.tab) || !(ptys.has(msg.tab) || remote.has(msg.tab))) return;
  const now = Date.now();
  if (now > eventBudgetReset) { eventBudget = 20; eventBudgetReset = now + 1000; }
  if (eventBudget-- <= 0) return;                                  // at most 20 events a second
  const tool = /^[a-z0-9-]{1,20}$/.test(String(msg.tool)) ? msg.tool : 'agent';
  const record = records.get(msg.tab);
  if (record) {
    record.agent = tool;
    if (['codex', 'claude'].includes(tool) && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(msg.sessionId || '')) {
      record.resumeTool = tool; record.resumeSession = msg.sessionId;
    }
    record.state = { running: 'running', done: 'ok', attention: 'ask', error: 'fail' }[msg.event];
    saveRecords();
  }
  broadcast({ t: 'agent', event: { tab: msg.tab, event: msg.event, tool } });
}

function startEventServer() {
  const server = net.createServer((socket) => {
    lineReader(socket, handleAgentEvent, 4096);
    socket.on('error', () => { /* a client that vanished */ });
    setTimeout(() => socket.destroy(), 3000);
  });
  server.on('error', (e) => console.error('[events]', e.message));
  server.listen(eventPipe);
}

let helper = null;                 // { socket, pending: Map<id, {resolve, reject}> }
let helperStarting = null;

function failPending(h, err) {
  for (const p of h.pending.values()) p.reject(err);
  h.pending.clear();
}

function helperClosed(h) {
  if (helper === h) helper = null;
  failPending(h, new Error('The administrator helper stopped.'));
  for (const [id, sender] of remote) {
    if (!sender.isDestroyed()) sender.send('pty:exit', id, -1);
  }
  remote.clear();
}

function onHelperMessage(h, msg) {
  switch (msg.t) {
    case 'spawned': h.pending.get(msg.id)?.resolve(); h.pending.delete(msg.id); break;
    case 'error': h.pending.get(msg.id)?.reject(new Error(msg.message || 'Could not start the admin shell.')); h.pending.delete(msg.id); break;
    case 'data': { const s = remote.get(msg.id); if (s && !s.isDestroyed()) s.send('pty:data', msg.id, msg.data); break; }
    case 'exit': { const s = remote.get(msg.id); remote.delete(msg.id); if (s && !s.isDestroyed()) s.send('pty:exit', msg.id, msg.code); break; }
    default: break;
  }
}

function launchElevated(pipeName, token) {
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), '--admin-helper', '--pipe', pipeName, '--token', token];
  if (process.env.ST_FAKE_DECLINE) return Promise.resolve(1);   // test hook: behave as if UAC was declined
  if (process.env.ST_FAKE_ELEVATE) {            // test hook: run the helper without the UAC prompt
    return new Promise((resolve) => { spawn(process.execPath, args, { stdio: 'ignore', windowsHide: true }).unref(); resolve(0); });
  }
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const cmd = `Start-Process -FilePath ${q(process.execPath)} -ArgumentList ${args.map(q).join(',')} -Verb RunAs`;
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true });
    child.on('exit', (code) => resolve(code));
    child.on('error', () => resolve(1));
  });
}

function startHelper() {
  return new Promise((resolve, reject) => {
    const pipeName = `\\\\.\\pipe\\belor-${crypto.randomBytes(16).toString('hex')}`;
    const token = Buffer.from(crypto.randomBytes(32).toString('hex'));
    let settled = false;
    const done = (err, h) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      server.close();                              // no further connections are accepted
      if (err) reject(err); else resolve(h);
    };

    const server = net.createServer((socket) => {
      let authed = false;
      const h = { socket, pending: new Map() };
      lineReader(socket, (msg) => {
        if (!authed) {
          const sent = Buffer.from(String(msg.token || ''));
          const ok = msg.t === 'hello' && sent.length === token.length && crypto.timingSafeEqual(sent, token);
          if (!ok) { socket.destroy(); return; }           // wrong token: not our helper
          if (!msg.elevated && !process.env.ST_FAKE_ELEVATE) { socket.destroy(); done(new Error('The helper did not get administrator rights.')); return; }
          authed = true;
          helper = h;
          done(null, h);
          return;
        }
        onHelperMessage(h, msg);
      });
      socket.on('close', () => { if (authed) helperClosed(h); });
      socket.on('error', () => { /* handled by close */ });
    });
    server.on('error', (e) => done(e));
    const timer = setTimeout(() => done(new Error('Timed out waiting for administrator approval.')), 60000);

    server.listen(pipeName, async () => {
      const code = await launchElevated(pipeName, token.toString());
      if (code !== 0) done(new Error('Administrator access was not granted.'));   // UAC declined
    });
  });
}

function ensureHelper() {
  if (helper && !helper.socket.destroyed) return Promise.resolve(helper);
  if (!helperStarting) helperStarting = startHelper().finally(() => { helperStarting = null; });
  return helperStarting;
}


async function create({ shellId, cols, rows, cwd, admin, resumeTool, resumeSession, autoSessionKey }, restored) {
  const resume = resumeTool ? resumeTools.detect().find(tool => tool.id === resumeTool) : null;
  if (resumeTool && !resume) throw new Error('That application is no longer installed. Restart Belor after installing it.');
  if (resume && admin) throw new Error('Resume the application in a regular terminal.');
  const sh = resume ? shells.find(s => s.id === 'powershell') : shells.find((s) => s.id === shellId) || shells[0];
  const id = restored ? restored.id : nextId++;
  const record = { ...restored, id, shellId: sh.id, cwd: cwd || app.getPath('home'), admin: !!admin || isAdmin, resumeTool: resumeTool || '', resumeSession: resumeSession || '', autoSessionKey: autoSessionKey || '', cols, rows, userTitle: restored?.userTitle || '', exited: false };
  records.set(id, record);
  const log = transcript(id);
  fs.closeSync(fs.openSync(log, 'a'));
  saveRecords();
  const c = Math.max(2, cols | 0), r = Math.max(1, rows | 0);
  const startDir = typeof cwd === 'string' && cwd && fs.existsSync(cwd) ? cwd : app.getPath('home');
  try {
  if (admin && !isAdmin) {
    if (!ADMIN_KINDS.has(sh.kind)) throw new Error(`${sh.label} has no administrator mode.`);
    const h = await ensureHelper();                       // one UAC prompt; later admin tabs reuse the helper
    await new Promise((resolve, reject) => {
      h.pending.set(id, { resolve, reject });
      remote.set(id, sender);
      send(h.socket, { t: 'spawn', id, shellId: sh.id, cols: c, rows: r, cwd: startDir, env: agentEnv(id) });
    }).catch((e) => { remote.delete(id); throw e; });
    return id;
  }

  const p = pty.spawn(sh.file, resume ? resumeTools.launch(resume, resumeSession) : sh.args, {
    name: 'xterm-256color', cols: c, rows: r, cwd: startDir,
    env: { ...process.env, ...(sh.env || {}), TERM_PROGRAM: 'belor', ...agentEnv(id) },
    useConpty: true,
  });
  ptys.set(id, p);
  p.onData((data) => { if (!sender.isDestroyed()) sender.send('pty:data', id, data); });
  p.onExit(({ exitCode }) => {
    ptys.delete(id);
    if (!sender.isDestroyed()) sender.send('pty:exit', id, exitCode);
  });
  return id;
  } catch (error) {
    if (restored) { records.set(id, { ...restored, exited: true }); saveRecords(); }
    else closeTab(id, false);
    throw error;
  }
}

function closeTab(id, remember = true) {
  // Forget first so an asynchronous PTY exit cannot resurrect a closed tab.
  const key = records.get(id)?.autoSessionKey;
  if (key && remember) {
    dismissed.add(key);
    fs.writeFileSync(path.join(directory, 'dismissed.json'), JSON.stringify([...dismissed]));
  }
  records.delete(id); saveRecords();
  titleBuffers.delete(id); lastTitles.delete(id);
  if (ptys.has(id)) { try { ptys.get(id).kill(); } catch {} ptys.delete(id); }
  if (remote.has(id)) { if (helper) send(helper.socket, { t: 'kill', id }); remote.delete(id); }
  for (const sessions of attachments.values()) sessions.delete(id);
  try { fs.unlinkSync(transcript(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function attach(socket, id) {
  const record = records.get(id);
  if (!record) throw Error('That terminal tab has been closed.');
  const sessions = attachments.get(socket);
  const queue = [];
  sessions.set(id, queue);
  // Read a fixed prefix; output arriving during replay is queued exactly once.
  const length = fs.statSync(transcript(id)).size;
  try {
    if (length) {
      const stream = fs.createReadStream(transcript(id), { encoding: 'utf8', end: length - 1, highWaterMark: 32768 });
      for await (const data of stream) {
        if (socket.destroyed) return;
        if (!socket.write(JSON.stringify({ t: 'data', id, data, replay: true }) + '\n')) {
          await new Promise(resolve => { socket.once('drain', done); socket.once('close', done); function done() { socket.off('drain', done); socket.off('close', done); resolve(); } });
        }
      }
    }
    for (const data of queue) send(socket, { t: 'data', id, data, replay: true });
    sessions.set(id, null);
    return { exited: record.exited, exitCode: record.exitCode };
  } catch (error) { sessions.delete(id); throw error; }
}
async function handle(socket, msg) {
  try {
    let result;
    switch (msg.t) {
      case 'list': result = [...records.values()].map(record => ({ ...record, pid: ptys.get(record.id)?.pid })); break;
      case 'dismissed': result = [...dismissed]; break;
      case 'conversation': {
        const record = records.get(msg.id);
        if (record && ['codex', 'claude'].includes(msg.resumeTool) && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(msg.resumeSession || '')
          && (record.resumeSession !== msg.resumeSession || record.resumeTool !== msg.resumeTool)) {
          record.resumeTool = msg.resumeTool; record.resumeSession = msg.resumeSession; saveRecords();
        }
        break;
      }
      case 'create':
        result = await create(msg);
        break;
      case 'attach': result = await attach(socket, msg.id); break;
      case 'detach': attachments.get(socket)?.delete(msg.id); break;
      case 'write':
        if (ptys.has(msg.id)) ptys.get(msg.id).write(String(msg.data));
        else if (remote.has(msg.id) && helper) send(helper.socket, { t: 'write', id: msg.id, data: String(msg.data) });
        break;
      case 'resize': {
        const record = records.get(msg.id);
        if (record) {
          record.cols = Math.max(2, msg.cols | 0); record.rows = Math.max(1, msg.rows | 0);
          if (ptys.has(msg.id)) ptys.get(msg.id).resize(record.cols, record.rows);
          else if (remote.has(msg.id) && helper) send(helper.socket, { t: 'resize', id: msg.id, cols: record.cols, rows: record.rows });
        }
        break;
      }
      case 'metadata':
        for (const tab of msg.tabs || []) {
          const record = records.get(tab.id);
          if (!record) continue;
          for (const key of ['cwd', 'userTitle', 'agent', 'state']) if (typeof tab[key] === 'string') record[key] = tab[key].slice(0, key === 'cwd' ? 32768 : 160);
          if (!msg.preserveOrder) {
            record.active = !!tab.active;
            record.order = Number.isInteger(tab.order) ? tab.order : record.id;
            record.gridOrder = Number.isInteger(tab.gridOrder) ? tab.gridOrder : -1;
          }
        }
        saveRecords(); break;
      case 'close': closeTab(msg.id); break;
      default: throw Error('Unknown terminal host request.');
    }
    if (msg.request) send(socket, { request: msg.request, result });
  } catch (error) {
    if (msg.request) send(socket, { request: msg.request, error: error.message });
    else send(socket, { t: 'error', message: error.message });
  }
}
app.whenReady().then(async () => {
  isAdmin = await new Promise(resolve => execFile('fltmc', [], { windowsHide: true }, error => resolve(!error)));
  try { for (const key of JSON.parse(fs.readFileSync(path.join(directory, 'dismissed.json'), 'utf8'))) dismissed.add(key); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Updates can stop the host. Preserve every transcript and resume only an
  // explicitly identified conversation; arbitrary shell commands are never rerun.
  let saved = [], readError;
  for (const file of [manifest, manifest + '.bak', manifest + '.tmp']) {
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(saved)) throw Error('Invalid saved tab list.');
      readError = null; break;
    } catch (error) { if (error.code !== 'ENOENT') readError = error; }
  }
  if (readError) throw readError; // Never replace unreadable history with a fresh empty list.
  for (const record of saved) {
    if (!Number.isSafeInteger(record.id) || record.id < 1) continue;
    nextId = Math.max(nextId, record.id + 1);
    records.set(record.id, { ...record, exited: true });
    fs.closeSync(fs.openSync(transcript(record.id), 'a'));
    if (!record.resumeSession && (record.resumeTool === 'codex' || record.agent === 'codex')) {
      const fd = fs.openSync(transcript(record.id), 'r');
      try {
        const size = fs.fstatSync(fd).size, tail = Buffer.alloc(Math.min(size, 256 * 1024));
        fs.readSync(fd, tail, 0, tail.length, size - tail.length);
        rememberConversation(records.get(record.id), tail.toString('utf8'), false);
      } finally { fs.closeSync(fd); }
    }
  }
  saveRecords();
  for (const record of [...records.values()]) {
    const sessionId = record.resumeSession || record.autoSessionKey?.split(':')[1];
    if (!record.admin && record.resumeTool && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId || '')) {
      try { await create({ ...record, resumeSession: sessionId }, record); }
      catch (error) { console.error('[resume saved conversation]', error.message); }
    }
  }
  startEventServer();
  try { installNotifyScript(); } catch (error) { console.error(error); }
  const pipe = `\\\\.\\pipe\\belor-host-${crypto.randomBytes(16).toString('hex')}`;
  const token = crypto.randomBytes(32).toString('hex');
  const server = net.createServer(socket => {
    let authed = false;
    const deadline = setTimeout(() => { if (!authed) socket.destroy(); }, 3000);
    lineReader(socket, msg => {
      if (!authed) {
        const sent = Buffer.from(String(msg.token || ''));
        if (msg.t !== 'hello' || sent.length !== token.length || !crypto.timingSafeEqual(sent, Buffer.from(token))) { socket.destroy(); return; }
        authed = true; clearTimeout(deadline); clients.add(socket); attachments.set(socket, new Map());
        send(socket, { t: 'ready' }); return;
      }
      handle(socket, msg);
    });
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(deadline); clients.delete(socket); attachments.delete(socket); });
  });
  server.listen(pipe, () => {
    const address = path.join(profile, 'terminal-host.json');
    fs.writeFileSync(address + '.tmp', JSON.stringify({ pipe, token, pid: process.pid }), { mode: 0o600 });
    fs.renameSync(address + '.tmp', address);
  });
  server.on('error', error => { console.error(error); app.exit(1); });
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => {});
