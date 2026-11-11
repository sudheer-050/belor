// Elevated helper. Started by the app through a UAC prompt (`--admin-helper`).
// It connects OUT to a pipe the normal app is listening on, proves it knows the token, and then
// hosts administrator shells on request. It never listens for connections itself, so another
// program cannot reach an elevated shell by connecting to it.
const { app } = require('electron');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const pty = require('node-pty');
const { detectShells, ADMIN_KINDS } = require('./shells');
const { send, lineReader } = require('./jsonlines');

function arg(name) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; }
const pipe = arg('--pipe');
const token = arg('--token');

// Only connect to a pipe that looks like ours.
if (!pipe || !pipe.startsWith('\\\\.\\pipe\\belor-') || !token) app.exit(2);

const shells = detectShells().filter((s) => ADMIN_KINDS.has(s.kind));
const ptys = new Map();
let socket = null;

function isElevated() {
  return new Promise((resolve) => execFile('fltmc', [], { windowsHide: true }, (err) => resolve(!err)));
}

function shutdown(code = 0) {
  for (const p of ptys.values()) { try { p.kill(); } catch { /* already gone */ } }
  ptys.clear();
  try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch { /* best effort */ }
  app.exit(code);
}

function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'spawn': {
      const sh = shells.find((s) => s.id === msg.shellId);   // resolved here: the app can't pick an arbitrary program
      if (!sh) { send(socket, { t: 'error', id: msg.id, message: 'That shell has no administrator mode.' }); return; }
      try {
        const cwd = typeof msg.cwd === 'string' && fs.existsSync(msg.cwd) ? msg.cwd : os.homedir();
        // Only the BELOR_* variables (how a tab reports back) are accepted from the app.
        const extra = Object.fromEntries(Object.entries(msg.env || {}).filter(([k, v]) => /^BELOR_[A-Z]+$/.test(k) && typeof v === 'string'));
        const p = pty.spawn(sh.file, sh.args, {
          name: 'xterm-256color',
          cols: Math.max(2, msg.cols | 0), rows: Math.max(1, msg.rows | 0),
          cwd, useConpty: true,
          env: { ...process.env, ...(sh.env || {}), TERM_PROGRAM: 'belor', ...extra },
        });
        ptys.set(msg.id, p);
        p.onData((data) => send(socket, { t: 'data', id: msg.id, data }));
        p.onExit(({ exitCode }) => { ptys.delete(msg.id); send(socket, { t: 'exit', id: msg.id, code: exitCode }); });
        send(socket, { t: 'spawned', id: msg.id });
      } catch (e) {
        send(socket, { t: 'error', id: msg.id, message: String(e && e.message || e) });
      }
      break;
    }
    case 'write': ptys.get(msg.id)?.write(String(msg.data)); break;
    case 'resize': try { ptys.get(msg.id)?.resize(Math.max(2, msg.cols | 0), Math.max(1, msg.rows | 0)); } catch { /* closed */ } break;
    case 'kill': try { ptys.get(msg.id)?.kill(); } catch { /* closed */ } ptys.delete(msg.id); break;
    default: break;
  }
}

app.whenReady().then(async () => {
  const elevated = await isElevated();
  socket = net.connect(pipe);
  lineReader(socket, handle);
  socket.on('connect', () => send(socket, { t: 'hello', token, elevated, pid: process.pid }));
  socket.on('close', () => shutdown(0));      // the app went away: take every admin shell with us
  socket.on('error', () => shutdown(1));
  setTimeout(() => { if (!socket.connecting && socket.destroyed) shutdown(1); }, 15000);
});

app.on('window-all-closed', (e) => e.preventDefault());   // stay alive: this process has no windows
