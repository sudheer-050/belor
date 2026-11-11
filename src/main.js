const { app, BrowserWindow, ipcMain, dialog, Notification, shell: electronShell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

app.setAppUserModelId('com.belor.app');
if (process.env.ST_USERDATA) app.setPath('userData', process.env.ST_USERDATA); // isolated profile for tests

// Elevated helper mode: no window, own throwaway profile folder so an elevated process never
// writes files into the normal app's profile.
if (process.argv.includes('--admin-helper')) {
  const dir = path.join(os.tmpdir(), `belor-admin-${process.pid}`);
  app.setPath('userData', dir);
  app.setPath('sessionData', dir);
  app.disableHardwareAcceleration();
  require('./admin-helper');
  return;
}

const pty = require('node-pty');
const { detectShells, ADMIN_KINDS, SHELL_DIR } = require('./shells');
const { send, lineReader } = require('./jsonlines');
const agentSetup = require('./agent-setup');

// ---- events from Claude Code / Codex running inside a tab ----------------------------------
// Each tab's shell gets BELOR_PIPE / BELOR_TAB / BELOR_TOKEN. A hook in the tool runs st-notify.ps1,
// which reports "done", "attention" or "error" to this pipe, and the app plays the matching sound.
// The script lives at a fixed per-user path so the hook keeps working if the app is moved or updated.
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
  if (win && !win.isDestroyed()) win.webContents.send('agent:event', { tab: msg.tab, event: msg.event, tool });
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

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const THEMES = {
  dark: { color: '#202124', symbolColor: '#e8eaed' },
  light: { color: '#dfe3e8', symbolColor: '#202124' },
};

const shells = detectShells();
const ptys = new Map();            // id -> local pty
const remote = new Map();          // id -> webContents (admin ptys that live in the elevated helper)
let nextId = 1;
let win;
let isAdmin = false;
let closeConfirmed = !!process.env.ST_SELFTEST;   // tests quit without the confirm dialog
const prefs = { confirmClose: true };      // window preferences the page sends us (see app:prefs)

// One-time: bring the saved settings across from when the app was called "Sound Terminal" (before the lock below creates the new folder).
if (!process.env.ST_USERDATA) {
  try {
    const dest = app.getPath('userData');
    if (!fs.existsSync(dest)) {
      for (const old of ['Sound Terminal', 'sound-terminal']) {
        const src = path.join(app.getPath('appData'), old);
        if (fs.existsSync(src)) { fs.cpSync(src, dest, { recursive: true }); break; }
      }
    }
  } catch { /* settings just start fresh */ }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

function checkAdmin() {
  return new Promise((resolve) => {
    execFile('fltmc', [], { windowsHide: true }, (err) => resolve(!err));
  });
}

// ---- elevated admin helper ----------------------------------------------------------------
// The app is the pipe SERVER and the elevated helper is the CLIENT. That direction matters: if
// the elevated side listened, any program running as you could connect and get an admin shell.
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

// ---- window state -------------------------------------------------------------------------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadBounds() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; }
}
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch { /* non-fatal */ }
}

function createWindow() {
  const saved = loadBounds();
  win = new BrowserWindow({
    width: process.env.ST_WINDOW ? +process.env.ST_WINDOW.split('x')[0] : saved.width || 1200,
    height: process.env.ST_WINDOW ? +process.env.ST_WINDOW.split('x')[1] : saved.height || 760,
    x: saved.x, y: saved.y,
    minWidth: 720, minHeight: 420,
    backgroundColor: THEMES.dark.color,
    title: 'Belor',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...THEMES.dark, height: 40 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (saved.maximized) win.maximize();
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => win.flashFrame(false));
  win.on('close', (e) => {
    const open = ptys.size + remote.size;
    if (prefs.confirmClose && open > 0 && !closeConfirmed) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question', buttons: ['Close', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
        title: 'Close Belor', message: 'Close Belor?',
        detail: `${open} terminal tab${open === 1 ? ' is' : 's are'} still open. Programs running in ${open === 1 ? 'it' : 'them'} will be stopped.`,
      });
      if (choice !== 0) { e.preventDefault(); return; }
      closeConfirmed = true;
    }
    saveBounds();
  });

  win.webContents.on('render-process-gone', (_e, d) => console.error('[renderer gone]', d.reason, d.exitCode));
  win.webContents.on('console-message', (_e, level, message, line, src) => {
    if (level >= 2 || process.env.ST_DEBUG) console.error(`[renderer:${level}] ${message} (${src}:${line})`);
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), process.env.ST_SELFTEST ? { query: { selftest: '1' } } : undefined);
  // Never let the renderer navigate away or open new windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Dev self-test: ST_SELFTEST=<png path> runs ST_SELFTEST_EXTRA in the page, saves a screenshot, then quits.
  if (process.env.ST_SELFTEST) {
    // Demo recording (tools/record-demo): ST_RECORD=<folder> saves frames of the window while the page runs a scripted session.
    if (process.env.ST_RECORD) {
      const dir = process.env.ST_RECORD;
      fs.mkdirSync(dir, { recursive: true });
      const frames = [];
      let recording = false, n = 0;
      const grab = async () => {
        while (recording) {
          const t = Date.now();
          const img = await win.webContents.capturePage();
          const file = `f${String(n++).padStart(5, '0')}.jpg`;
          fs.writeFileSync(path.join(dir, file), img.resize({ width: 1280, quality: 'best' }).toJPEG(92));
          frames.push({ file, t });
          const rest = 100 - (Date.now() - t);
          if (rest > 0) await new Promise((r) => setTimeout(r, rest));
        }
      };
      ipcMain.on('rec:start', () => { recording = true; grab(); });
      ipcMain.on('rec:stop', () => { recording = false; setTimeout(() => { fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(frames)); app.quit(); }, 400); });
    }
    const wait = +process.env.ST_SELFTEST_WAIT || 7000;
    win.webContents.on('did-finish-load', () => {
      setTimeout(() => win.webContents.executeJavaScript(
        'document.querySelectorAll(".tab").length + " tab(s), terminals: " + document.querySelectorAll(".term .xterm").length',
      ).then((r) => console.error('[selftest]', r)), 3000);
      if (process.env.ST_SELFTEST_EXTRA) {
        setTimeout(() => win.webContents.executeJavaScript(process.env.ST_SELFTEST_EXTRA)
          .then((r) => { if (r !== undefined) console.error('[selftest extra]', JSON.stringify(r)); })
          .catch((e) => console.error('[selftest extra] ERROR', e.message)), 3500);
      }
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.ST_SELFTEST, img.toPNG());
        console.error('[selftest] screenshot saved');
        app.quit();
      }, wait);
    });
  }
}

// ---- user assets (background images, fonts) -----------------------------------------------
const ASSET_KINDS = {
  image: { dir: 'backgrounds', exts: new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp']), max: 30 * 1024 * 1024 },
  font: { dir: 'fonts', exts: new Set(['ttf', 'otf', 'woff', 'woff2']), max: 20 * 1024 * 1024 },
};
const assetDir = (kind) => path.join(app.getPath('userData'), ASSET_KINDS[kind].dir);
const SAFE_ASSET_NAME = /^[0-9a-f]{32}\.[a-z0-9]{2,5}$/;

// ---- IPC ----------------------------------------------------------------------------------
ipcMain.handle('app:info', () => {
  for (const k of Object.keys(ASSET_KINDS)) fs.mkdirSync(assetDir(k), { recursive: true });
  return {
    isAdmin,
    version: app.getVersion(),
    shells: shells.map(({ id, label, kind }) => ({ id, label, kind, adminOk: ADMIN_KINDS.has(kind) })),
    home: app.getPath('home'),
    windowsBuild: parseInt(os.release().split('.')[2], 10) || 19045,   // xterm needs it to wrap ConPTY lines correctly
    assetBase: Object.fromEntries(Object.keys(ASSET_KINDS).map((k) => [k, pathToFileURL(assetDir(k)).href + '/'])),
  };
});

// The renderer hands over file bytes; the app picks the name, so a page can never choose a path.
ipcMain.handle('asset:save', (_e, { kind, name, data }) => {
  const spec = ASSET_KINDS[kind];
  if (!spec) throw new Error('Unknown asset type.');
  const ext = path.extname(String(name || '')).slice(1).toLowerCase();
  if (!spec.exts.has(ext)) throw new Error(`Unsupported ${kind} file type: .${ext || '?'}`);
  const buf = Buffer.from(data);
  if (!buf.length || buf.length > spec.max) throw new Error(`That ${kind} file is too large (max ${Math.round(spec.max / 1048576)} MB).`);
  fs.mkdirSync(assetDir(kind), { recursive: true });
  const file = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(assetDir(kind), file), buf);
  return { file, name: path.basename(String(name)) };
});
ipcMain.handle('asset:delete', (_e, { kind, file }) => {
  if (!ASSET_KINDS[kind] || !SAFE_ASSET_NAME.test(String(file))) return false;
  try { fs.unlinkSync(path.join(assetDir(kind), file)); return true; } catch { return false; }
});
if (process.env.ST_SELFTEST) ipcMain.handle('test:readFile', (_e, p) => fs.readFileSync(p));   // test-only

ipcMain.handle('pty:create', async (event, { shellId, cols, rows, cwd, admin }) => {
  const sh = shells.find((s) => s.id === shellId) || shells[0];
  const id = nextId++;
  const c = Math.max(2, cols | 0), r = Math.max(1, rows | 0);
  const startDir = typeof cwd === 'string' && cwd && fs.existsSync(cwd) ? cwd : app.getPath('home');

  if (admin && !isAdmin) {
    if (!ADMIN_KINDS.has(sh.kind)) throw new Error(`${sh.label} has no administrator mode.`);
    const h = await ensureHelper();                       // one UAC prompt; later admin tabs reuse the helper
    await new Promise((resolve, reject) => {
      h.pending.set(id, { resolve, reject });
      remote.set(id, event.sender);
      send(h.socket, { t: 'spawn', id, shellId: sh.id, cols: c, rows: r, cwd: startDir, env: agentEnv(id) });
    }).catch((e) => { remote.delete(id); throw e; });
    return id;
  }

  const p = pty.spawn(sh.file, sh.args, {
    name: 'xterm-256color', cols: c, rows: r, cwd: startDir,
    env: { ...process.env, ...(sh.env || {}), TERM_PROGRAM: 'belor', ...agentEnv(id) },
    useConpty: true,
  });
  ptys.set(id, p);
  p.onData((data) => { if (!event.sender.isDestroyed()) event.sender.send('pty:data', id, data); });
  p.onExit(({ exitCode }) => {
    ptys.delete(id);
    if (!event.sender.isDestroyed()) event.sender.send('pty:exit', id, exitCode);
  });
  return id;
});

// Links in the terminal open in the default browser. Only web and mail links are allowed.
ipcMain.handle('shell:open', (_e, url) => {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return false;
  electronShell.openExternal(u.href);
  return true;
});

ipcMain.on('app:prefs', (_e, p) => {
  if (!p || typeof p !== 'object') return;
  if (typeof p.confirmClose === 'boolean') prefs.confirmClose = p.confirmClose;
  if (!win || win.isDestroyed()) return;
  if (typeof p.alwaysOnTop === 'boolean') win.setAlwaysOnTop(p.alwaysOnTop);
  if (typeof p.opacity === 'number') win.setOpacity(Math.min(1, Math.max(0.3, p.opacity)));
});
ipcMain.on('win:fullscreen', () => { if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen()); });

// ---- popup notifications, only while the window is not in front -----------------------------
const shownNotes = new Map();                                       // tab id -> its last notification, replaced by the next one
const windowAway = () => !win || win.isDestroyed() || win.isMinimized() || !win.isVisible() || !win.isFocused();
function bringToFront(tabId) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  win.flashFrame(false);
  if (Number.isInteger(tabId)) win.webContents.send('notify:click', tabId);
}
ipcMain.handle('notify:show', (_e, o) => {
  if (!o || typeof o !== 'object') return { shown: false, reason: 'bad request' };
  const title = String(o.title || '').slice(0, 80), body = String(o.body || '').slice(0, 160);
  if (!title) return { shown: false, reason: 'no title' };
  if (!o.force && !windowAway()) return { shown: false, reason: 'window is in front' };
  if (win && !win.isDestroyed()) win.flashFrame(true);              // the taskbar button flashes too, in case toasts are turned off
  if (!Notification.isSupported()) return { shown: false, reason: 'notifications not supported' };
  const tabId = Number.isInteger(o.tab) ? o.tab : null;
  if (tabId !== null) { try { shownNotes.get(tabId)?.close(); } catch { /* already gone */ } }
  const n = new Notification({ title, body, silent: true, icon: fs.existsSync(ICON) ? ICON : undefined });   // silent: the app plays its own sounds
  n.on('click', () => bringToFront(tabId));
  if (process.env.ST_SELFTEST) {
    n.on('show', () => console.error('[notify] shown:', title, '|', body));
    n.on('failed', (_ev, err) => console.error('[notify] failed:', err));
  }
  if (tabId !== null) shownNotes.set(tabId, n);
  n.show();
  return { shown: true };
});
if (process.env.ST_SELFTEST) ipcMain.handle('test:minimize', () => { win.minimize(); return true; });

ipcMain.handle('agent:status', () => agentSetup.status(NOTIFY_SCRIPT));
ipcMain.handle('agent:setup', (_e, { tool, enable }) => {
  installNotifyScript();                                   // make sure the hook has a script to call
  return agentSetup.setup(tool, !!enable, NOTIFY_SCRIPT);
});

ipcMain.on('pty:write', (_e, id, data) => {
  if (ptys.has(id)) ptys.get(id).write(String(data));
  else if (remote.has(id) && helper) send(helper.socket, { t: 'write', id, data: String(data) });
});
ipcMain.on('pty:resize', (_e, id, cols, rows) => {
  if (ptys.has(id)) { try { ptys.get(id).resize(Math.max(2, cols | 0), Math.max(1, rows | 0)); } catch { /* pty already closed */ } }
  else if (remote.has(id) && helper) send(helper.socket, { t: 'resize', id, cols, rows });
});
ipcMain.on('pty:kill', (_e, id) => {
  if (ptys.has(id)) { try { ptys.get(id).kill(); } catch { /* already gone */ } ptys.delete(id); }
  else if (remote.has(id)) { if (helper) send(helper.socket, { t: 'kill', id }); remote.delete(id); }
});

ipcMain.on('win:theme', (_e, t) => {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!win || win.isDestroyed() || !t || !hex.test(t.color) || !hex.test(t.symbolColor)) return;
  win.setBackgroundColor(t.color);
  try { win.setTitleBarOverlay({ color: t.color, symbolColor: t.symbolColor, height: 40 }); } catch { /* not supported on this platform */ }
});

app.on('window-all-closed', () => {
  for (const p of ptys.values()) { try { p.kill(); } catch { /* ignore */ } }
  if (helper) helper.socket.destroy();       // the helper exits when this connection closes
  app.quit();
});

// The elevated helper can't always delete its own profile folder while it exits (Chromium still has
// files open), so remove folders left by helpers that are no longer running.
function cleanStaleHelperDirs() {
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      const m = /^(?:belor|sound-terminal)-admin-(\d+)$/.exec(name);
      if (!m) continue;
      let alive = true;
      try { process.kill(+m[1], 0); } catch (e) { alive = e.code === 'EPERM'; }   // EPERM: elevated process we can't signal
      if (!alive) fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    }
  } catch { /* best effort */ }
}

app.whenReady().then(async () => {
  cleanStaleHelperDirs();
  startEventServer();
  try { installNotifyScript(); } catch (e) { console.error('[notify script]', e.message); }
  isAdmin = await checkAdmin();
  createWindow();
});
