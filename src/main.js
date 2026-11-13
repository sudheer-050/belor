const { app, BrowserWindow, ipcMain, dialog, Notification, Tray, Menu, nativeImage, shell: electronShell } = require('electron');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

if (process.argv.includes('--terminal-host')) { require('./terminal-host'); return; }

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

const { TerminalClient } = require('./terminal-client');
const { detectShells, ADMIN_KINDS, SHELL_DIR } = require('./shells');
const agentSetup = require('./agent-setup');
const resumeTools = require('./resume-tools');
const activeSessions = require('./active-sessions');
const { setupBackground } = require('./background');
const NOTIFY_SCRIPT = path.join(process.env.ST_BIN_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Belor', 'bin'), 'st-notify.ps1');
function installNotifyScript() { fs.mkdirSync(path.dirname(NOTIFY_SCRIPT), { recursive: true }); fs.copyFileSync(path.join(SHELL_DIR, 'st-notify.ps1'), NOTIFY_SCRIPT); }

// ---- events from Claude Code / Codex running inside a tab ----------------------------------
// Each tab's shell gets BELOR_PIPE / BELOR_TAB / BELOR_TOKEN. A hook in the tool runs st-notify.ps1,
// which reports "done", "attention" or "error" to this pipe, and the app plays the matching sound.
// The script lives at a fixed per-user path so the hook keeps working if the app is moved or updated.
const ICON_ICO = path.join(__dirname, '..', 'build', 'icon.ico').replace('app.asar', 'app.asar.unpacked');
const ICON = fs.existsSync(ICON_ICO) ? ICON_ICO : path.join(__dirname, '..', 'build', 'icon.png');
const THEMES = {
  dark: { color: '#202124', symbolColor: '#e8eaed' },
  light: { color: '#dfe3e8', symbolColor: '#202124' },
};

const shells = detectShells();
let terminals;
let win;
let background;
let isAdmin = false;
const popouts = new Map();
let quitting = false;
app.on('before-quit', () => { quitting = true; });
const connectionFor = sender => [...popouts.values()].find(p => p.window.webContents === sender)?.client || terminals;
const popoutFor = sender => [...popouts.entries()].find(([, p]) => p.window.webContents === sender)?.[0];
function forwardTerminalMessage(window, msg) {
  if (!window || window.isDestroyed()) return;
  if (msg.t === 'data') window.webContents.send('pty:data', msg.id, msg.data, !!msg.replay);
  else if (msg.t === 'exit') window.webContents.send('pty:exit', msg.id, msg.code);
  else if (msg.t === 'agent') window.webContents.send('agent:event', msg.event);
  else if (msg.t === 'error' || msg.t === 'disconnected') window.webContents.send('pty:error', msg.message || 'Terminal host disconnected. Reopen Belor to reconnect to saved history.');
}

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
    if (background) background.show();
    else if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
}

function checkAdmin() {
  return new Promise((resolve) => {
    execFile('fltmc', [], { windowsHide: true }, (err) => resolve(!err));
  });
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
      backgroundThrottling: false,
    },
  });
  if (saved.maximized) win.maximize();
  const appIcon = nativeImage.createFromPath(ICON);
  if (!appIcon.isEmpty()) win.setIcon(appIcon);
  if (process.platform === 'win32') win.setAppDetails({ appId: 'com.belor.app', appIconPath: ICON, appIconIndex: 0, relaunchDisplayName: 'Belor' });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => win.flashFrame(false));
  const confirmQuit = () => true; // Terminal host survives desktop Quit.

  background = setupBackground({ app, win, Tray, Menu, icon: appIcon, confirmQuit, saveBounds });

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
let activeSessionScan = null;
const automaticSessions = new Map();
const runningWindows = new Map();
const windowConversations = new Map();
function discoverRunningTerminals() {
  if (!activeSessionScan) {
    activeSessionScan = activeSessions.readSnapshot().then(async snapshot => {
        const hosted = await terminals.request('list');
        // Link manually started/picker-selected conversations to their exact PTY.
        const ownedSessions = activeSessions.select(snapshot, [], undefined, hosted.map(tab => tab.pid).filter(Boolean));
        for (const tab of hosted) {
          const matches = ownedSessions.filter(session => session.ownerPid === tab.pid);
          if (matches.length === 1) terminals.send('conversation', { id: tab.id, resumeTool: matches[0].toolId, resumeSession: matches[0].sessionId });
        }
        const excluded = [process.pid, ...hosted.map(p => p.pid).filter(Boolean)];
        const sessions = activeSessions.select(snapshot, excluded);
        const installed = new Set(resumeTools.detect().map(tool => tool.id));
        automaticSessions.clear();
        for (const session of sessions) {
          if (installed.has(session.toolId) && fs.existsSync(session.cwd)) automaticSessions.set(session.key, session);
        }
        runningWindows.clear();
        for (const window of activeSessions.selectWindows(snapshot, excluded)) runningWindows.set(window.key, window);
        return { sessions: [...automaticSessions.values()], windows: [...runningWindows.values()] };
      }).finally(() => { activeSessionScan = null; });
  }
  return activeSessionScan;
}
ipcMain.handle('resume:active', async () => (await discoverRunningTerminals()).sessions);
ipcMain.handle('terminals:windows', async () => (await discoverRunningTerminals()).windows);
ipcMain.handle('terminals:resume-window', async (_event, key) => {
  const terminalWindow = runningWindows.get(key);
  if (!terminalWindow) throw new Error('That terminal window has closed. The sidebar will refresh automatically.');
  const session = require('./window-conversation').resolve(terminalWindow.title);
  if (!session) throw new Error('No unique saved Codex conversation matches this window. Use New tab > Resume Codex session to select your conversation.');
  if (!resumeTools.detect().some(tool => tool.id === session.toolId)) throw new Error('Install the Codex command-line application to continue this conversation in Belor.');
  if (!fs.existsSync(session.cwd)) throw new Error('The saved project folder is no longer available.');
  windowConversations.set(session.key, session);
  return session;
});
ipcMain.handle('app:info', (event) => {
  for (const k of Object.keys(ASSET_KINDS)) fs.mkdirSync(assetDir(k), { recursive: true });
  return {
    isAdmin,
    popoutId: popoutFor(event.sender) || null,
    version: app.getVersion(),
    shells: shells.map(({ id, label, kind }) => ({ id, label, kind, adminOk: ADMIN_KINDS.has(kind) })),
    resumeTools: resumeTools.detect().map(({ id, label }) => ({ id, label })),
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

ipcMain.handle('pty:create', async (event, { shellId, cols, rows, cwd, admin, resumeTool, autoSessionKey }) => {
  let resumeSession;
  if (autoSessionKey) {
    const session = automaticSessions.get(autoSessionKey) || windowConversations.get(autoSessionKey);
    if (!session) throw new Error('That running session is no longer available.');
    resumeTool = session.toolId; resumeSession = session.sessionId; cwd = session.cwd;
  }
  return terminals.request('create', { shellId, cols, rows, cwd, admin, resumeTool, resumeSession, autoSessionKey });
});
ipcMain.handle('pty:list', async (event) => {
  const id = popoutFor(event.sender);
  return (await terminals.request('list')).filter(tab => id ? tab.id === id : !popouts.has(tab.id));
});
ipcMain.handle('pty:dismissed', () => terminals.request('dismissed'));
ipcMain.handle('pty:attach', (event, id) => connectionFor(event.sender).request('attach', { id }));
ipcMain.on('pty:metadata', (event, tabs) => terminals.send('metadata', { tabs, preserveOrder: !!popoutFor(event.sender) }));
ipcMain.handle('pty:popout', async (_event, id) => {
  if (popouts.has(id)) { popouts.get(id).window.show(); popouts.get(id).window.focus(); return true; }
  if (!(await terminals.request('list')).some(tab => tab.id === id)) throw Error('That terminal has already closed.');
  const client = new TerminalClient(app.getPath('userData'), process.execPath, app.getAppPath());
  await client.connect();
  const window = new BrowserWindow({ width: 900, height: 620, minWidth: 480, minHeight: 320,
    title: 'Belor terminal', icon: ICON, backgroundColor: THEMES.dark.color,
    titleBarStyle: 'hidden', titleBarOverlay: { ...THEMES.dark, height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  popouts.set(id, { window, client });
  client.on('message', msg => forwardTerminalMessage(window, msg));
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', async () => {
    popouts.delete(id); client.disconnect();
    if (quitting || !win || win.isDestroyed()) return;
    try {
      const record = (await terminals.request('list')).find(tab => tab.id === id);
      if (record) {
        win.webContents.send('pty:returned', record);
        background.show(false);
      }
    } catch (error) { console.error('[return terminal]', error.message); }
  });
  try { await window.loadFile(path.join(__dirname, 'renderer', 'index.html')); }
  catch (error) { window.close(); throw error; }
  terminals.send('detach', { id });
  return true;
});
ipcMain.on('pty:return', (event) => {
  const id = popoutFor(event.sender);
  if (id) popouts.get(id).window.close();
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
  const target = BrowserWindow.fromWebContents(_e.sender);
  if (!target || target.isDestroyed()) return;
  if (typeof p.alwaysOnTop === 'boolean') target.setAlwaysOnTop(p.alwaysOnTop);
  if (typeof p.opacity === 'number') target.setOpacity(Math.min(1, Math.max(0.3, p.opacity)));
});
ipcMain.on('win:fullscreen', () => { if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen()); });

// ---- popup notifications, only while the window is not in front -----------------------------
const shownNotes = new Map();                                       // tab id -> its last notification, replaced by the next one
const windowAway = () => !win || win.isDestroyed() || win.isMinimized() || !win.isVisible() || !win.isFocused();
function bringToFront(tabId) {
  if (!win || win.isDestroyed()) return;
  if (background) background.show();
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
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

ipcMain.on('pty:write', (_e, id, data) => terminals.send('write', { id, data }));
ipcMain.on('pty:resize', (_e, id, cols, rows) => terminals.send('resize', { id, cols, rows }));
ipcMain.on('pty:kill', (_e, id) => terminals.send('close', { id }));

ipcMain.on('win:theme', (_e, t) => {
  const hex = /^#[0-9a-f]{6}$/i;
  const target = BrowserWindow.fromWebContents(_e.sender);
  if (!target || target.isDestroyed() || !t || !hex.test(t.color) || !hex.test(t.symbolColor)) return;
  target.setBackgroundColor(t.color);
  try { target.setTitleBarOverlay({ color: t.color, symbolColor: t.symbolColor, height: 40 }); } catch { /* not supported on this platform */ }
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { terminals?.disconnect(); for (const p of popouts.values()) p.client.disconnect(); });

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
  terminals = new TerminalClient(app.getPath('userData'), process.execPath, app.getAppPath());
  terminals.on('message', msg => forwardTerminalMessage(win, msg));
  await terminals.connect();
  isAdmin = await checkAdmin();
  createWindow();
}).catch(error => { dialog.showErrorBox('Belor could not reconnect', error.message); app.quit(); });
