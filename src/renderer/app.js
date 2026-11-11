(async function () {
  const info = await window.term.info();
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const tabsEl = $('tabs'), termsEl = $('terms'), newMenu = $('new-menu'), ctx = $('ctx'), drawer = $('drawer');
  const { normHex, mix, rgba, isDark, fontInstalled } = window.color;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const presetById = (id) => window.THEME_PRESETS.find((p) => p.id === id);
  const themeOf = (p) => ({ bg: p.bg, fg: p.fg, cursor: p.cursor, selection: p.selection, accent: p.accent, ansi: [...p.ansi] });

  // =================================================================== settings
  function defaults() {
    return {
      v: 2,
      followSystem: true,
      themeId: 'midnight',
      theme: themeOf(presetById('midnight')),
      savedThemes: [],
      background: {
        type: 'theme', color: '#101114',
        gradient: { angle: 135, stops: ['#0f2027', '#203a43', '#2c5364'] },
        image: { file: '', fit: 'cover', blur: 0, dim: 35 },
        termOpacity: 100, sideOpacity: 100,
      },
      recentImages: [],
      font: { family: 'Cascadia Code', size: 14, weight: '400', boldWeight: '700', lineHeight: 1.15, letterSpacing: 0, custom: [] },
      cursor: { style: 'block', blink: true },
      defaultShell: info.shells[0].id,
      collapsed: false,
      bellSound: false,        // ping when a program rings the terminal bell (Codex questions)
      agentIdleDone: true,     // mark a Claude Code / Codex run done when it goes quiet, if no hook reported it
      notify: { enabled: true, onDone: true, onFail: true, onAsk: true, minSeconds: 5 },   // popups while the window is not in front
      term: {
        scrollback: 10000, scrollSpeed: 1, scrollOnInput: true,
        copyOnSelect: false, rightClick: 'smart', confirmPaste: true, wordSep: ` ()[]{}',"\``,
        contrast: 1, boldBright: true, unicode: '11', cursorInactive: 'outline', linkNeedsCtrl: true,
      },
      tabColors: { running: '', ok: '', fail: '', empty: '', ask: '' },   // '' = follow the theme
      win: { alwaysOnTop: false, opacity: 100, confirmClose: true },
      startup: { restore: false, dirMode: 'home', dir: '', session: [], active: 0 },
    };
  }
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  function merge(base, over) {
    for (const k of Object.keys(over || {})) {
      if (isObj(base[k]) && isObj(over[k])) merge(base[k], over[k]);
      else if (k in base && typeof base[k] === typeof over[k]) base[k] = over[k];
    }
    return base;
  }
  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('st-settings') || '{}'); } catch { /* storage unavailable */ }
    const d = defaults();
    if (saved.v !== 2) {                                   // settings from the first version
      if (saved.theme === 'light') { d.followSystem = false; d.themeId = 'daylight'; d.theme = themeOf(presetById('daylight')); }
      else if (saved.theme === 'dark') d.followSystem = false;
      if (typeof saved.fontSize === 'number') d.font.size = saved.fontSize;
      if (typeof saved.cursor === 'string') d.cursor.style = saved.cursor;
      if (typeof saved.defaultShell === 'string') d.defaultShell = saved.defaultShell;
      if (typeof saved.collapsed === 'boolean') d.collapsed = saved.collapsed;
      return d;
    }
    // arrays (ansi, stops, savedThemes, recentImages, custom fonts) are replaced wholesale
    for (const k of ['savedThemes', 'recentImages']) if (Array.isArray(saved[k])) d[k] = saved[k];
    if (isObj(saved.theme) && Array.isArray(saved.theme.ansi) && saved.theme.ansi.length === 16) d.theme.ansi = saved.theme.ansi.map((c, i) => normHex(c) || d.theme.ansi[i]);
    if (isObj(saved.background) && isObj(saved.background.gradient) && Array.isArray(saved.background.gradient.stops) && saved.background.gradient.stops.length >= 2) d.background.gradient.stops = saved.background.gradient.stops.map((c) => normHex(c) || '#000000').slice(0, 6);
    if (isObj(saved.font) && Array.isArray(saved.font.custom)) d.font.custom = saved.font.custom.filter((f) => f && typeof f.name === 'string' && typeof f.file === 'string');
    if (isObj(saved.startup) && Array.isArray(saved.startup.session)) {
      d.startup.session = saved.startup.session.filter((t) => t && typeof t.shellId === 'string' && typeof t.cwd === 'string').slice(0, 20);
    }
    const s = clone(saved); delete s.savedThemes; delete s.recentImages;
    if (isObj(s.startup)) delete s.startup.session;
    if (isObj(s.theme)) delete s.theme.ansi;
    if (isObj(s.background) && isObj(s.background.gradient)) delete s.background.gradient.stops;
    if (isObj(s.font)) delete s.font.custom;
    merge(d, s);
    for (const k of ['bg', 'fg', 'cursor', 'selection', 'accent']) d.theme[k] = normHex(d.theme[k]) || defaults().theme[k];
    return d;
  }
  const settings = loadSettings();
  if (!info.shells.some((s) => s.id === settings.defaultShell)) settings.defaultShell = info.shells[0].id;
  const saveSettings = () => { try { localStorage.setItem('st-settings', JSON.stringify(settings)); } catch { /* ignore */ } };

  // =================================================================== appearance engine
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const effectiveTheme = () => (settings.followSystem ? themeOf(presetById(mq.matches ? 'midnight' : 'daylight')) : settings.theme);
  const assetUrl = (kind, file) => info.assetBase[kind] + encodeURIComponent(file);
  const q = (name) => `"${String(name).replace(/["\\]/g, '')}"`;
  const fontStack = () => `${q(settings.font.family)}, "Cascadia Code", Consolas, "Courier New", monospace`;

  function xtermTheme(th) {
    const a = th.ansi;
    return {
      background: '#00000000', foreground: th.fg, cursor: th.cursor, cursorAccent: th.bg, selectionBackground: th.selection,
      black: a[0], red: a[1], green: a[2], yellow: a[3], blue: a[4], magenta: a[5], cyan: a[6], white: a[7],
      brightBlack: a[8], brightRed: a[9], brightGreen: a[10], brightYellow: a[11], brightBlue: a[12], brightMagenta: a[13], brightCyan: a[14], brightWhite: a[15],
    };
  }
  function termOptions() {
    const f = settings.font;
    return {
      fontFamily: fontStack(), fontSize: f.size, fontWeight: f.weight, fontWeightBold: f.boldWeight,
      lineHeight: f.lineHeight, letterSpacing: f.letterSpacing,
      cursorStyle: settings.cursor.style, cursorBlink: settings.cursor.blink,
      theme: xtermTheme(effectiveTheme()), allowTransparency: true,
      scrollback: settings.term.scrollback, scrollSensitivity: settings.term.scrollSpeed, fastScrollSensitivity: settings.term.scrollSpeed * 5,
      scrollOnUserInput: settings.term.scrollOnInput, wordSeparator: settings.term.wordSep,
      minimumContrastRatio: settings.term.contrast, drawBoldTextInBrightColors: settings.term.boldBright,
      cursorInactiveStyle: settings.term.cursorInactive,
      windowsPty: { backend: 'conpty', buildNumber: info.windowsBuild },   // lets xterm wrap and reflow ConPTY lines correctly
    };
  }
  function applyTermOptions(tab) {
    const o = termOptions();
    for (const k of Object.keys(o)) { if (tab.term.options[k] !== o[k] || k === 'theme') tab.term.options[k] = o[k]; }
    if (tab.term.unicode.activeVersion !== settings.term.unicode) tab.term.unicode.activeVersion = settings.term.unicode;
  }

  // Tab state colors follow the terminal theme unless you pick your own in Settings.
  const TAB_COLOR_KEYS = [['running', '--st-run'], ['ok', '--st-ok'], ['fail', '--st-bad'], ['ask', '--st-ask'], ['empty', '--st-empty']];
  function tabColor(key, th, dark) {
    const custom = normHex(settings.tabColors[key] || '');
    if (custom) return custom;
    return {
      running: dark ? th.ansi[11] : th.ansi[3], ok: dark ? th.ansi[10] : th.ansi[2], fail: dark ? th.ansi[9] : th.ansi[1],
      ask: dark ? th.ansi[13] : th.ansi[5], empty: mix(th.fg, th.bg, 0.5),
    }[key];
  }

  function applyAppearance() {
    const th = effectiveTheme();
    const bgs = settings.background;
    const dark = isDark(th.bg);
    root.dataset.mode = dark ? 'dark' : 'light';
    const set = (k, v) => root.style.setProperty(k, v);
    set('--t-bg', th.bg); set('--t-fg', th.fg); set('--t-accent', th.accent); set('--t-sel', th.selection);
    set('--t-ok', dark ? th.ansi[10] : th.ansi[2]); set('--t-bad', dark ? th.ansi[9] : th.ansi[1]);
    set('--term-op', String(bgs.termOpacity)); set('--side-op', String(bgs.sideOpacity));
    for (const [key, css] of TAB_COLOR_KEYS) set(css, tabColor(key, th, dark));

    const layer = $('bgimg'), dim = $('bgdim');
    layer.style.cssText = ''; dim.style.cssText = '';
    let overlay = mix(th.bg, th.fg, 0.05);
    if (bgs.type === 'solid') { layer.style.background = bgs.color; overlay = bgs.color; }
    else if (bgs.type === 'gradient') {
      layer.style.background = `linear-gradient(${bgs.gradient.angle}deg, ${bgs.gradient.stops.join(', ')})`;
      dim.style.background = rgba(th.bg, bgs.image.dim / 100);
      overlay = bgs.gradient.stops[0];
    } else if (bgs.type === 'image' && bgs.image.file) {
      const im = bgs.image;
      layer.style.backgroundImage = `url("${assetUrl('image', im.file)}")`;
      layer.style.backgroundSize = { cover: 'cover', contain: 'contain', stretch: '100% 100%', tile: 'auto', center: 'auto' }[im.fit] || 'cover';
      layer.style.backgroundRepeat = im.fit === 'tile' ? 'repeat' : 'no-repeat';
      layer.style.filter = im.blur ? `blur(${im.blur}px)` : 'none';
      dim.style.background = rgba(th.bg, im.dim / 100);
    }
    window.term.setTheme({ color: overlay, symbolColor: isDark(overlay) ? '#ffffff' : '#202124' });

    for (const tab of tabs.values()) applyTermOptions(tab);
    fitSoon();
  }
  mq.addEventListener('change', () => { if (settings.followSystem) { applyAppearance(); syncThemeUI(); } });

  let fitTimer = null;
  function fitSoon() { clearTimeout(fitTimer); fitTimer = setTimeout(() => { const t = tabs.get(activeId); if (t) fitTab(t); }, 60); }

  // user-added font files
  const loadedFonts = new Set();
  async function loadCustomFont(entry) {
    if (loadedFonts.has(entry.file)) return true;
    try {
      const face = new FontFace(entry.name, `url("${assetUrl('font', entry.file)}")`);
      await face.load();
      document.fonts.add(face);
      loadedFonts.add(entry.file);
      return true;
    } catch { return false; }
  }

  // =================================================================== tabs
  const tabs = new Map();      // pty id -> tab
  let activeId = null;
  let counter = 0;
  const KIND_LABEL = { powershell: 'PS', cmd: 'CMD', wsl: 'WSL', gitbash: 'GIT' };

  const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]/g;
  const CMD_ERRORS = /is not recognized as an internal or external command|The system cannot find|Access is denied|The syntax of the command is incorrect|The filename, directory name, or volume label syntax is incorrect|is not recognized|cannot be found|Invalid switch|Invalid parameter|Bad command or file name|Failed to|not found/i;
  const CMD_PROMPT = /([A-Za-z]:\\[^>\r\n]*)>\s*$/;

  const baseName = (p) => {
    const s = String(p || '').replace(/[\\/]+$/, '');
    if (!s) return '';
    if (/^[A-Za-z]:$/.test(s)) return s + '\\';
    return s.split(/[\\/]/).pop() || s;
  };
  const isRemoteish = (tab) => tab.shell.kind === 'wsl';

  let toastTimer = null;
  function toast(message) {
    const t = $('toast');
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }
  const cleanErr = (err) => String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
  const adminShells = () => info.shells.filter((s) => s.adminOk);
  function adminShellId() {
    const pref = info.shells.find((s) => s.id === settings.defaultShell);
    return (pref && pref.adminOk ? pref : adminShells()[0]).id;
  }

  function titleOf(tab) { return tab.userTitle || baseName(tab.cwd) || tab.shell.label; }

  function refreshTab(tab) {
    tab.titleEl.textContent = titleOf(tab);
    const where = tab.cwd && !isRemoteish(tab) ? tab.cwd : tab.shell.label;
    tab.subEl.textContent = tab.admin ? `Administrator · ${where}` : where;
    tab.tabEl.title = `${titleOf(tab)}${tab.admin ? ' (Administrator)' : ''}\n${tab.cwd || tab.shell.label}`;
    if (tab.id === activeId) refreshCrumb(tab);
    persistSession();
  }
  function refreshCrumb(tab) {
    $('crumb-title').textContent = titleOf(tab);
    $('crumb-sub').textContent = tab.cwd && !isRemoteish(tab) ? tab.cwd : tab.shell.label;
    $('crumb-admin').hidden = !tab.admin;
    termsEl.classList.toggle('admin-active', !!tab.admin);
    document.title = `${titleOf(tab)}${tab.admin ? ' (Administrator)' : ''} — Belor`;
  }

  // ---- tab state, shown as color on every tab:
  //   new (just opened) -> empty (nothing run yet) -> running -> ok (completed) / fail (failed); ask = waiting for you
  const STATE_LABEL = {
    empty: 'Nothing run yet', running: 'Running…',
    ok: 'Last run completed', fail: 'Last run failed', ask: 'Waiting for you',
  };
  function setState(tab, state) {
    tab.state = state;
    tab.tabEl.dataset.state = state;
    tab.statusEl.title = STATE_LABEL[state];
    // running = spinner, completed = tick, failed = cross, waiting = question mark, empty (including a new tab) = nothing
    tab.statusEl.innerHTML = { empty: '', running: ICONS.spinner, ok: ICONS.check, fail: ICONS.cross, ask: ICONS.ask }[state];
    tab.tabEl.setAttribute('aria-description', STATE_LABEL[state]);
  }
  // The user pressed Enter on something: it is running until the shell (or the tool) says it finished.
  // A 350 ms delay keeps quick commands from flashing "running".
  function startRun(tab) {
    if (!tab.running) tab.runStart = Date.now();      // how long it ran decides whether a popup is worth it
    tab.running = true;
    tab.lastOut = Date.now();            // the "gone quiet" clock for AI tools starts when you submit
    clearTimeout(tab.runTimer);
    tab.runTimer = setTimeout(() => { if (tab.running) setState(tab, 'running'); }, 350);
  }
  function endRun(tab) { tab.running = false; clearTimeout(tab.runTimer); }

  // ---- Claude Code / Codex sessions
  const INPUT_ESC = /\x1b(?:\[[0-9;?]*[ -\/]*[@-~]|O.|.)?/g;     // keyboard escape sequences sent to the program
  const AGENT_CMD = /^(claude|codex)(?:\.(?:cmd|exe|ps1))?(?:\s|$)/i;
  const AGENT_LINE = /[>$#%]\s*(claude|codex)(?:\.(?:cmd|exe|ps1))?(?:\s.*)?$/i;
  const screenLine = (term) => {
    const b = term.buffer.active;
    const l = b.getLine(b.baseY + b.cursorY);
    return l ? l.translateToString(true) : '';
  };
  const hinted = new Set();
  async function hintAgent(tool) {                      // once per session: tell the user if the exact-status hook is not installed
    if (hinted.has(tool)) return;
    hinted.add(tool);
    try {
      const st = await window.term.agentStatus();
      if (st[tool] && !st[tool].on) toast(`${tool === 'claude' ? 'Claude Code' : 'Codex'} found. Turn on its sounds in Settings > Sounds so its tab shows exact completed and failed marks.`);
    } catch { /* not worth bothering the user */ }
  }
  // A shell command (including the tool itself exiting) finished.
  function shellFinished(tab, ok) { tab.agent = null; setStatus(tab, ok); }
  // If no hook reports that a run finished, treat a long quiet spell as "done" so the spinner never sticks.
  const AGENT_QUIET_MS = 4000;
  setInterval(() => {
    if (!settings.agentIdleDone) return;
    const now = Date.now();
    for (const tab of tabs.values()) {
      if (tab.agent && tab.state === 'running' && tab.lastOut && now - tab.lastOut > AGENT_QUIET_MS) setStatus(tab, true);
    }
  }, 1000);

  // Popup notification, shown by the main process only while the window is minimized or behind other apps.
  function notifyTab(tab, kind) {                       // kind: 'ok' | 'fail' | 'ask'
    const n = settings.notify;
    if (!n.enabled || (kind === 'ok' && !n.onDone) || (kind === 'fail' && !n.onFail) || (kind === 'ask' && !n.onAsk)) return;
    const tool = tab.agent === 'claude' ? 'Claude Code' : tab.agent === 'codex' ? 'Codex' : '';
    if (!tool && kind !== 'ask') {                      // shell commands: only the ones that took a while; AI runs always notify
      const secs = tab.runStart ? (Date.now() - tab.runStart) / 1000 : 0;
      if (secs < n.minSeconds) return;
    }
    let title, body;
    if (tool) {
      title = kind === 'ok' ? `${tool} finished` : kind === 'fail' ? `${tool} hit an error` : `${tool} needs you`;
      body = titleOf(tab);
    } else {
      title = kind === 'ok' ? 'Command completed' : kind === 'fail' ? 'Command failed' : 'Waiting for you';
      body = (tab.lastCmd ? tab.lastCmd + '  ·  ' : '') + titleOf(tab);
    }
    if (tab.admin) body = '(Administrator) ' + body;
    window.term.notify({ tab: tab.id, title, body });
  }

  function setStatus(tab, ok) {
    endRun(tab);
    setState(tab, ok ? 'ok' : 'fail');
    notifyTab(tab, ok ? 'ok' : 'fail');
    tab.runStart = 0;
    tab.tabEl.classList.remove('pulse-ok', 'pulse-fail', 'pulse-attn');
    void tab.tabEl.offsetWidth;
    tab.tabEl.classList.add(ok ? 'pulse-ok' : 'pulse-fail');
    if (ok) window.sounds.success(); else window.sounds.fail();
  }

  // A program (Claude Code, Codex) has a question for you or needs permission.
  function attention(tab) {
    const now = Date.now();
    if (now - (tab.lastAttn || 0) < 800) return;           // one ping per burst
    tab.lastAttn = now;
    endRun(tab);
    setState(tab, 'ask');                                    // stays until you answer
    notifyTab(tab, 'ask');
    tab.tabEl.classList.remove('pulse-ok', 'pulse-fail', 'pulse-attn');
    void tab.tabEl.offsetWidth;
    tab.tabEl.classList.add('pulse-attn');
    window.sounds.attention();
  }
  window.term.onNotifyClick((id) => { if (tabs.has(id)) activate(id); });   // clicking a popup jumps to that tab
  // Reports from Claude Code / Codex hooks running inside a tab (see st-notify.ps1).
  window.term.onAgentEvent(({ tab: id, event, tool }) => {
    const tab = tabs.get(id);
    if (!tab) return;
    if (!tab.agent && (tool === 'claude' || tool === 'codex')) tab.agent = tool;   // started some way we did not see
    // Claude Code and Codex runs show in the sidebar exactly like shell commands: running, completed, failed.
    if (event === 'running') { if (!tab.running) tab.runStart = Date.now(); tab.running = true; clearTimeout(tab.runTimer); setState(tab, 'running'); }
    else if (event === 'done') setStatus(tab, true);
    else if (event === 'error') setStatus(tab, false);
    else attention(tab);
  });

  // ---- clipboard
  function copySelection(term) { navigator.clipboard.writeText(term.getSelection()).catch(() => {}); term.clearSelection(); }
  async function pasteInto(term) {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { return; }
    if (!text) return;
    const body = text.replace(/[\r\n]+$/, '');
    if (settings.term.confirmPaste && /[\r\n]/.test(body)) {
      const lines = body.split(/\r\n|\r|\n/).length;
      if (!window.confirm(`Paste ${lines} lines into the terminal?\n\nEach line may run as a command.`)) return;
    }
    term.paste(text);
  }

  // ---- right-click menu inside the terminal (when Settings > Terminal > Right-click is "Show a menu")
  function showTermMenu(tab, x, y) {
    ctx.replaceChildren();
    const item = (label, fn, disabled) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem'); b.textContent = label;
      if (disabled) { b.disabled = true; b.style.opacity = '.45'; b.style.cursor = 'default'; }
      b.addEventListener('click', () => { closePopups(); fn(); });
      ctx.appendChild(b);
    };
    item('Copy', () => copySelection(tab.term), !tab.term.hasSelection());
    item('Paste', () => pasteInto(tab.term));
    item('Select all', () => tab.term.selectAll());
    ctx.appendChild(document.createElement('hr'));
    item('Find…', () => openFind());
    item('Clear', () => tab.term.clear());
    ctx.hidden = false;
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = Math.min(x, innerWidth - w - 8) + 'px';
    ctx.style.top = Math.min(y, innerHeight - h - 8) + 'px';
  }

  // ---- zoom (Ctrl + / Ctrl - / Ctrl 0 / Ctrl + wheel)
  function zoom(dir) {
    setFont({ size: dir === 0 ? 14 : Math.min(36, Math.max(8, settings.font.size + dir)) });
    syncFontUI();
  }

  // ---- find in the tab's history
  const findBar = $('findbar'), findInput = $('find-input');
  const findOpts = { caseSensitive: false, regex: false };
  function findDecorations() {
    const th = effectiveTheme();
    return { matchBackground: mix(th.bg, th.accent, 0.35), matchBorder: th.accent, matchOverviewRuler: th.accent,
      activeMatchBackground: mix(th.bg, th.accent, 0.7), activeMatchBorder: th.fg, activeMatchColorOverviewRuler: th.fg };
  }
  function showFindCount(r) {
    const n = r ? r.resultCount : 0;
    const q = findInput.value;
    findBar.classList.toggle('none', !!q && n === 0);
    $('find-count').textContent = !q ? '' : n === 0 ? 'No results' : r.resultIndex < 0 ? `${n}+ results` : `${r.resultIndex + 1} of ${n}`;
  }
  function doFind(dir) {                        // 1 = next, -1 = previous, 0 = as you type
    const tab = tabs.get(activeId);
    if (!tab) return;
    const q = findInput.value;
    if (!q) { tab.search.clearDecorations(); showFindCount(null); return; }
    const o = { ...findOpts, decorations: findDecorations(), incremental: dir === 0 };
    try { if (dir < 0) tab.search.findPrevious(q, o); else tab.search.findNext(q, o); } catch { showFindCount({ resultCount: 0, resultIndex: -1 }); }
  }
  function openFind() {
    const tab = tabs.get(activeId);
    if (!tab) return;
    findBar.hidden = false;
    if (tab.term.hasSelection()) findInput.value = tab.term.getSelection().split(/\r?\n/)[0].slice(0, 200);
    findInput.focus(); findInput.select();
    doFind(0);
  }
  function closeFind() {
    findBar.hidden = true;
    for (const t of tabs.values()) t.search.clearDecorations();
    tabs.get(activeId)?.term.focus();
  }
  findInput.addEventListener('input', () => doFind(0));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doFind(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
  });
  $('find-next').addEventListener('click', () => doFind(1));
  $('find-prev').addEventListener('click', () => doFind(-1));
  $('find-close').addEventListener('click', closeFind);
  for (const [id, key] of [['find-case', 'caseSensitive'], ['find-regex', 'regex']]) {
    $(id).addEventListener('click', () => {
      findOpts[key] = !findOpts[key];
      $(id).setAttribute('aria-pressed', String(findOpts[key]));
      tabs.get(activeId)?.search.clearDecorations();   // the addon only recounts when the search is cleared first
      doFind(0); findInput.focus();
    });
  }

  // ---- remember the open tabs so they can be reopened next time
  let sessionTimer = null;
  function persistSession(now) {
    clearTimeout(sessionTimer);
    const write = () => {
      const list = orderedIds().map((id) => tabs.get(id)).filter((t) => t && !t.admin);
      settings.startup.session = list.map((t) => ({ shellId: t.shell.id, cwd: isRemoteish(t) ? '' : t.cwd || '' }));
      settings.startup.active = Math.max(0, list.findIndex((t) => t.id === activeId));
      saveSettings();
    };
    if (now) write(); else sessionTimer = setTimeout(write, 400);
  }
  const startDir = () => (settings.startup.dirMode === 'custom' && settings.startup.dir.trim() ? settings.startup.dir.trim() : undefined);

  function orderedIds() { return [...tabsEl.children].map((el) => +el.dataset.id); }

  async function openTab(shellId, opts = {}) {
    const shell = info.shells.find((s) => s.id === shellId) || info.shells[0];
    const admin = !!opts.admin || info.isAdmin;
    const cwd = opts.cwd === undefined ? startDir() : opts.cwd;
    const el = document.createElement('div');
    el.className = 'term';
    termsEl.appendChild(el);

    // Links (plain URLs and OSC 8 hyperlinks) open in the default browser, by default only with Ctrl held.
    const openLink = (e, uri) => { if (!settings.term.linkNeedsCtrl || e.ctrlKey) window.term.openLink(uri); };
    const term = new Terminal({ ...termOptions(), allowProposedApi: true, linkHandler: { activate: openLink } });
    const fit = new FitAddon.FitAddon();
    const search = new SearchAddon.SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon.WebLinksAddon(openLink));
    term.loadAddon(new Unicode11Addon.Unicode11Addon());
    term.unicode.activeVersion = settings.term.unicode;
    term.open(el);
    fit.fit();

    let id;
    try {
      id = await window.term.create({ shellId: shell.id, cols: term.cols, rows: term.rows, cwd, admin: !!opts.admin });
    } catch (err) {
      term.dispose(); el.remove();          // e.g. the Windows administrator prompt was declined
      toast(cleanErr(err));
      tabs.get(activeId)?.term.focus();
      return null;
    }

    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (admin ? ' admin' : '');
    tabEl.dataset.id = String(id);
    tabEl.setAttribute('role', 'tab');
    tabEl.tabIndex = 0;
    tabEl.draggable = true;
    tabEl.innerHTML = `<span class="ticon k-${shell.kind}">${KIND_LABEL[shell.kind] || 'SH'}${admin ? `<span class="abadge" title="Administrator">${ICONS.shield}</span>` : ''}</span>
      <span class="tmeta"><span class="ttitle"></span><span class="tsub"></span></span>
      <span class="tstatus"></span>
      <button class="tclose" title="Close tab" aria-label="Close tab">${ICONS.close}</button>`;
    tabsEl.appendChild(tabEl);

    const tab = {
      id, shell, el, term, fit, search, tabEl, admin, cwd: cwd || '', userTitle: '',
      titleEl: tabEl.querySelector('.ttitle'), subEl: tabEl.querySelector('.tsub'), statusEl: tabEl.querySelector('.tstatus'),
      line: '', dirty: false, pending: false, outBuf: '', tail: '', seenFirstPrompt: false,
      state: 'empty', running: false, runTimer: null, agent: null, lastOut: 0,
    };
    tabs.set(id, tab);
    counter++;
    setState(tab, 'empty');                                 // a new tab is plain: no mark, no animation, until something runs
    refreshTab(tab);

    // OSC 133;D;<code>: a command finished (PowerShell / bash integration).
    term.parser.registerOscHandler(133, (data) => {
      const m = /^D;(\d+)/.exec(data);
      if (!m) return true;
      // bash fires PROMPT_COMMAND once before the first prompt; that isn't a user command.
      if ((shell.kind === 'wsl' || shell.kind === 'gitbash') && !tab.seenFirstPrompt) { tab.seenFirstPrompt = true; return true; }
      shellFinished(tab, m[1] === '0');
      return true;
    });
    // The terminal bell: Codex rings it when it asks a question (if enabled in Settings).
    term.onBell(() => { if (settings.bellSound) attention(tab); });
    search.onDidChangeResults((r) => { if (tab.id === activeId) showFindCount(r); });
    // OSC 9;9;"<path>": current working directory.
    term.parser.registerOscHandler(9, (data) => {
      if (data.startsWith('9;')) { tab.cwd = data.slice(2).replace(/^"|"$/g, ''); refreshTab(tab); }
      return true;
    });

    term.onData((data) => {
      window.term.write(id, data);
      // Track what was typed so "ran something" can be told apart from an empty Enter (also how cmd finishes are detected).
      // Escape sequences are not typed text. Focus reports (ESC[I, ESC[O) and paste markers are ignored; arrow keys, Home/End,
      // Alt+key and a lone Escape mean the line may have been edited or recalled from history, so mark it "dirty".
      const keys = data.replace(INPUT_ESC, (m) => { if (!/^\x1b\[(?:[IO]|20[01]~)$/.test(m)) tab.dirty = true; return ''; });
      for (const ch of keys) {
        if (ch === '\r') {
          const typed = tab.line.trim();
          // In a shell, an Enter on a recalled line counts (history). Inside Claude Code / Codex only text you actually typed
          // counts: a bare Enter there must not start a spinner (answering a pending question still does, below).
          const ran = tab.agent ? !!typed : !!(typed || tab.dirty);
          if (ran && shell.kind === 'cmd') { tab.pending = true; tab.outBuf = ''; }
          // Starting Claude Code or Codex opens a session, not a task: no spinner until you send it a prompt.
          // (The command can be typed or recalled from history, so also read the line off the screen.)
          const launch = !tab.agent && ran && (AGENT_CMD.exec(typed) || AGENT_LINE.exec(screenLine(term)));
          if (launch) { tab.agent = launch[1].toLowerCase(); hintAgent(tab.agent); }
          else if (ran || tab.state === 'ask') {
            if (ran && !tab.agent) tab.lastCmd = (typed || screenLine(term).replace(/^.*?[>$#%]\s+/, '')).trim().slice(0, 90);   // shown in popups
            startRun(tab);                                       // answering a question also means it is working again
          }
          tab.line = ''; tab.dirty = false;
        } else if (ch === '\x7f' || ch === '\b') tab.line = tab.line.slice(0, -1);
        else if (ch >= ' ') tab.line += ch;
      }
    });

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const k = e.key.toLowerCase();
      // App shortcuts are handled once, at the document level.
      if (e.ctrlKey && e.shiftKey && ['t', 'w', 'b', 'a', 'f', 'k'].includes(k)) return false;
      if (e.ctrlKey && (k === 'tab' || k === ',' || k === '=' || k === '+' || k === '-' || k === '0')) return false;
      if (e.key === 'F11') return false;
      if (e.ctrlKey && k === 'c' && (e.shiftKey || term.hasSelection())) { copySelection(term); return false; }
      if (e.ctrlKey && k === 'v') { pasteInto(term); return false; }
      return true;
    });

    term.onSelectionChange(() => { if (settings.term.copyOnSelect && term.hasSelection()) navigator.clipboard.writeText(term.getSelection()).catch(() => {}); });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (settings.term.rightClick === 'menu') showTermMenu(tab, e.clientX, e.clientY);
      else if (term.hasSelection()) copySelection(term);
      else pasteInto(term);
    });
    // Ctrl + mouse wheel zooms the text
    el.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); e.stopPropagation(); zoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false, capture: true });

    wireTabEl(tab);
    activate(id);
    return id;
  }

  function wireTabEl(tab) {
    const { tabEl, id } = tab;
    tabEl.addEventListener('click', (e) => { if (e.target.closest('.tclose')) closeTab(id); else activate(id); });
    tabEl.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(id); } });
    tabEl.addEventListener('keydown', (e) => { if (e.target === tabEl && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate(id); } if (e.key === 'F2') startRename(tab); });
    tabEl.addEventListener('dblclick', (e) => { if (!e.target.closest('.tclose')) startRename(tab); });
    tabEl.addEventListener('contextmenu', (e) => { e.preventDefault(); showTabMenu(tab, e.clientX, e.clientY); });

    // drag to reorder
    tabEl.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(id)); e.dataTransfer.effectAllowed = 'move'; tabEl.classList.add('dragging'); });
    tabEl.addEventListener('dragend', () => { tabEl.classList.remove('dragging'); clearDropMarks(); });
    tabEl.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      const r = tabEl.getBoundingClientRect();
      clearDropMarks();
      tabEl.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    tabEl.addEventListener('drop', (e) => {
      if (e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      const dragged = tabs.get(+e.dataTransfer.getData('text/plain'));
      const before = tabEl.classList.contains('drop-before');
      clearDropMarks();
      if (!dragged || dragged.id === id) return;
      tabsEl.insertBefore(dragged.tabEl, before ? tabEl : tabEl.nextSibling);
      persistSession();
    });
  }
  const clearDropMarks = () => tabsEl.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));

  function startRename(tab) {
    const input = document.createElement('input');
    input.className = 'rename';
    input.value = titleOf(tab);
    input.setAttribute('aria-label', 'Rename tab');
    tab.titleEl.replaceChildren(input);
    tab.tabEl.draggable = false;
    input.focus(); input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      if (commit) tab.userTitle = input.value.trim();
      tab.tabEl.draggable = true;
      refreshTab(tab);
      tab.term.focus();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  function activate(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    activeId = id;
    for (const t of tabs.values()) {
      const on = t.id === id;
      t.el.classList.toggle('active', on);
      t.tabEl.classList.toggle('active', on);
      t.tabEl.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    tab.tabEl.scrollIntoView({ block: 'nearest' });
    refreshCrumb(tab);
    showFindCount(null);
    if (!findBar.hidden) doFind(0);        // keep the find bar working on whichever tab is showing
    persistSession();
    requestAnimationFrame(() => { fitTab(tab); if (drawer.hidden && findBar.hidden) tab.term.focus(); });
  }

  function fitTab(tab) {
    if (!tab.el.classList.contains('active')) return;
    try { tab.fit.fit(); window.term.resize(tab.id, tab.term.cols, tab.term.rows); } catch { /* not visible yet */ }
  }

  function cycle(dir) {
    const ids = orderedIds();
    if (ids.length < 2) return;
    activate(ids[(ids.indexOf(activeId) + dir + ids.length) % ids.length]);
  }

  function closeTab(id) { if (!tabs.has(id)) return; window.term.kill(id); removeTab(id); }

  function removeTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    const idx = orderedIds().indexOf(id);
    tab.term.dispose();
    tab.el.remove();
    tab.tabEl.remove();
    tabs.delete(id);
    if (tabs.size === 0) { settings.startup.session = []; saveSettings(); window.close(); return; }
    if (activeId === id) { const rest = orderedIds(); activate(rest[Math.min(idx, rest.length - 1)]); }
    persistSession();
  }

  window.term.onData((id, data) => {
    const tab = tabs.get(id);
    if (!tab) return;
    tab.lastOut = Date.now();
    tab.term.write(data);
    if (tab.shell.kind === 'cmd') {
      tab.tail = (tab.tail + data).slice(-600);
      const pm = CMD_PROMPT.exec(tab.tail.replace(ANSI, ''));
      if (pm && pm[1] !== tab.cwd) { tab.cwd = pm[1]; refreshTab(tab); }
      if (tab.pending) {
        tab.outBuf = (tab.outBuf + data).slice(-8000);
        const text = tab.outBuf.replace(ANSI, '');
        if (CMD_PROMPT.test(text)) {          // prompt is back: command finished
          tab.pending = false;
          shellFinished(tab, !CMD_ERRORS.test(text));
          tab.outBuf = '';
        }
      }
    }
  });
  window.term.onExit((id) => removeTab(id));
  new ResizeObserver(() => { const t = tabs.get(activeId); if (t) fitTab(t); }).observe(termsEl);

  // =================================================================== menus
  function closePopups() { newMenu.hidden = true; ctx.hidden = true; }
  document.addEventListener('click', (e) => { if (!e.target.closest('.popup') && !e.target.closest('#new-menu-btn')) closePopups(); });
  window.addEventListener('blur', closePopups);

  function buildNewMenu() {
    newMenu.replaceChildren();
    for (const s of info.shells) {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<span class="ticon mini k-${s.kind}">${KIND_LABEL[s.kind] || 'SH'}</span><span>${s.label}</span>${s.id === settings.defaultShell ? `<span class="check">${ICONS.check}</span>` : ''}`;
      b.addEventListener('click', () => { closePopups(); openTab(s.id); });
      newMenu.appendChild(b);
    }
    if (!info.isAdmin) {
      newMenu.appendChild(document.createElement('hr'));
      const head = document.createElement('div');
      head.className = 'menu-head';
      head.textContent = 'Open as administrator';
      newMenu.appendChild(head);
      for (const s of adminShells()) {
        const b = document.createElement('button');
        b.setAttribute('role', 'menuitem');
        b.innerHTML = `<span class="ticon mini k-${s.kind}">${KIND_LABEL[s.kind] || 'SH'}<span class="abadge">${ICONS.shield}</span></span><span>${s.label}</span>`;
        b.addEventListener('click', () => { closePopups(); openTab(s.id, { admin: true }); });
        newMenu.appendChild(b);
      }
    }
    newMenu.appendChild(document.createElement('hr'));
    const hint = document.createElement('button');
    hint.textContent = 'Change default shell…';
    hint.addEventListener('click', () => { closePopups(); openSettings('general'); });
    newMenu.appendChild(hint);
  }

  function showTabMenu(tab, x, y) {
    ctx.replaceChildren();
    const item = (label, fn, danger) => {
      const b = document.createElement('button'); b.setAttribute('role', 'menuitem'); b.textContent = label;
      if (danger) b.style.color = 'var(--bad)';
      b.addEventListener('click', () => { closePopups(); fn(); });
      ctx.appendChild(b);
    };
    item('Rename', () => startRename(tab));
    item('Duplicate', () => openTab(tab.shell.id, { cwd: isRemoteish(tab) ? undefined : tab.cwd, admin: tab.admin }));
    ctx.appendChild(document.createElement('hr'));
    item('Close tab', () => closeTab(tab.id), true);
    item('Close other tabs', () => orderedIds().filter((i) => i !== tab.id).forEach(closeTab), true);
    item('Close tabs below', () => { const ids = orderedIds(); ids.slice(ids.indexOf(tab.id) + 1).forEach(closeTab); }, true);
    ctx.hidden = false;
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = Math.min(x, innerWidth - w - 8) + 'px';
    ctx.style.top = Math.min(y, innerHeight - h - 8) + 'px';
    ctx.querySelector('button')?.focus();
  }

  $('new-btn').addEventListener('click', () => openTab(settings.defaultShell));
  $('new-menu-btn').addEventListener('click', (e) => { e.stopPropagation(); ctx.hidden = true; buildNewMenu(); newMenu.hidden = !newMenu.hidden; });

  // =================================================================== sidebar buttons
  function applyCollapsed() {
    document.body.classList.toggle('collapsed', settings.collapsed);
    $('collapse-btn').title = settings.collapsed ? 'Expand sidebar (Ctrl+Shift+B)' : 'Collapse sidebar (Ctrl+Shift+B)';
    setTimeout(fitSoon, 220);
  }
  function toggleSidebar() { settings.collapsed = !settings.collapsed; saveSettings(); applyCollapsed(); }
  $('collapse-btn').addEventListener('click', toggleSidebar);

  const soundBtn = $('sound-btn');
  function paintSound() {
    const on = window.sounds.enabled;
    soundBtn.querySelector('.ico').innerHTML = on ? ICONS.sound : ICONS.mute;
    soundBtn.querySelector('.lbl').textContent = on ? 'Sounds on' : 'Sounds off';
    soundBtn.setAttribute('aria-pressed', String(on));
  }
  soundBtn.addEventListener('click', () => {
    window.sounds.enabled = !window.sounds.enabled;
    paintSound();
    if (window.sounds.enabled) window.sounds.success();
    $('set-sound').checked = window.sounds.enabled;
    tabs.get(activeId)?.term.focus();
  });

  // If the whole app was started elevated, every tab is already an administrator tab.
  if (info.isAdmin) $('admin-badge').hidden = false;

  // =================================================================== settings drawer
  let panel = 'theme';
  function showPanel(name) {
    panel = name;
    for (const b of $('dnav').children) b.setAttribute('aria-selected', String(b.dataset.panel === name));
    for (const s of drawer.querySelectorAll('.dbody > section')) s.classList.toggle('on', s.dataset.panel === name);
    drawer.querySelector('.dbody').scrollTop = 0;
  }
  function openSettings(name) {
    if (name) showPanel(name); else showPanel(panel);
    syncAll();
    drawer.hidden = false;
    drawer.querySelector(`.dnav [data-panel="${panel}"]`).focus();
  }
  function closeSettings() { drawer.hidden = true; tabs.get(activeId)?.term.focus(); }
  for (const b of $('dnav').children) b.addEventListener('click', () => showPanel(b.dataset.panel));
  $('dlg-close').addEventListener('click', closeSettings);
  $('settings-btn').addEventListener('click', () => (drawer.hidden ? openSettings() : closeSettings()));

  // ---- small UI helpers
  function bindRange(id, get, set, fmt = String) {
    const input = $(id), out = $(id + '-out');
    const paint = () => { input.value = get(); out.textContent = fmt(+input.value); };
    input.addEventListener('input', () => { set(+input.value); out.textContent = fmt(+input.value); });
    return paint;
  }
  function bindSelect(id, get, set) {
    const el = $(id);
    el.addEventListener('change', () => set(el.value));
    return () => { el.value = get(); };
  }
  function bindSwitch(id, get, set) {
    const el = $(id);
    el.addEventListener('change', () => set(el.checked));
    return () => { el.checked = get(); };
  }
  // A color picker + hex box. Returns { el, paint(hex) }.
  function colorField(get, set, label) {
    const wrap = document.createElement('div');
    wrap.className = 'colorfield';
    const pick = document.createElement('input'); pick.type = 'color'; pick.setAttribute('aria-label', label);
    const hex = document.createElement('input'); hex.type = 'text'; hex.maxLength = 7; hex.spellcheck = false; hex.setAttribute('aria-label', `${label} hex value`);
    const paint = () => { pick.value = get(); if (document.activeElement !== hex) hex.value = get(); };
    pick.addEventListener('input', () => { set(pick.value); hex.value = pick.value; });
    hex.addEventListener('input', () => { const h = normHex(hex.value); if (h) { set(h); pick.value = h; } });
    hex.addEventListener('blur', () => { hex.value = get(); });
    wrap.append(pick, hex);
    return { el: wrap, paint };
  }
  const painters = [];

  // ================================================================ THEME panel
  function swatchHtml(th) {
    const dots = [1, 2, 3, 4, 5, 6].map((i) => `<u style="background:${th.ansi[i]}"></u>`).join('');
    return `<span class="swatch" style="background:${th.bg};color:${th.fg}"><b>Aa</b><i>${dots}</i></span>`;
  }
  function themeCard(id, name, th, onPick, onDelete) {
    const card = document.createElement('div');
    card.className = 'card'; card.tabIndex = 0; card.setAttribute('role', 'radio'); card.dataset.themeId = id;
    card.innerHTML = `${swatchHtml(th)}<span class="cname"></span>`;
    card.querySelector('.cname').textContent = name;
    card.addEventListener('click', (e) => { if (!e.target.closest('.del')) onPick(); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } });
    if (onDelete) {
      const del = document.createElement('button');
      del.className = 'del'; del.innerHTML = ICONS.close; del.title = 'Delete theme'; del.setAttribute('aria-label', `Delete ${name}`);
      del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
      card.appendChild(del);
    }
    return card;
  }
  function pickTheme(id, th, name) {
    settings.followSystem = false; settings.themeId = id; settings.theme = clone(th);
    saveSettings(); applyAppearance(); syncThemeUI();
    if (name) { /* keeps the name for the save box */ $('save-name').placeholder = `${name} (edited)`; }
  }
  function buildPresetCards() {
    const grid = $('preset-grid'); grid.replaceChildren();
    for (const p of window.THEME_PRESETS) grid.appendChild(themeCard(p.id, p.name, p, () => pickTheme(p.id, themeOf(p), p.name)));
  }
  function buildSavedCards() {
    const grid = $('saved-grid'); grid.replaceChildren();
    if (!settings.savedThemes.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Nothing saved yet. Edit the colors below, then save them here.'; grid.appendChild(e); return; }
    for (const s of settings.savedThemes) {
      grid.appendChild(themeCard('saved:' + s.id, s.name, s.theme,
        () => pickTheme('saved:' + s.id, s.theme, s.name),
        () => { settings.savedThemes = settings.savedThemes.filter((x) => x.id !== s.id); saveSettings(); buildSavedCards(); syncThemeUI(); }));
    }
  }
  function editTheme(mutator) {
    if (settings.followSystem) { settings.theme = clone(effectiveTheme()); settings.followSystem = false; }
    mutator(settings.theme);
    settings.themeId = 'custom';
    saveSettings(); applyAppearance(); syncThemeUI();
  }
  const COLOR_ROWS = [['bg', 'Background'], ['fg', 'Text'], ['cursor', 'Cursor'], ['selection', 'Selection'], ['accent', 'Accent (buttons, highlights)']];
  function buildColorRows() {
    const rows = $('color-rows'); rows.replaceChildren();
    for (const [key, label] of COLOR_ROWS) {
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = label;
      const f = colorField(() => effectiveTheme()[key], (v) => editTheme((t) => { t[key] = v; }), label);
      row.append(lab, f.el); rows.appendChild(row); painters.push(f.paint);
    }
    const grid = $('ansi-grid'); grid.replaceChildren();
    window.ANSI_NAMES.forEach((name, i) => {
      const lab = document.createElement('label'); lab.title = name;
      const input = document.createElement('input'); input.type = 'color'; input.setAttribute('aria-label', name);
      input.addEventListener('input', () => editTheme((t) => { t.ansi[i] = input.value; }));
      lab.appendChild(input); grid.appendChild(lab);
      painters.push(() => { input.value = effectiveTheme().ansi[i]; });
    });
  }
  const TAB_COLOR_ROWS = [['running', 'Running'], ['ok', 'Completed'], ['fail', 'Failed'], ['ask', 'Waiting for you']];
  function buildTabColorRows() {
    const rows = $('tabcolor-rows'); rows.replaceChildren();
    for (const [key, label] of TAB_COLOR_ROWS) {
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = label;
      const cur = () => tabColor(key, effectiveTheme(), isDark(effectiveTheme().bg));
      const f = colorField(cur, (v) => { settings.tabColors[key] = v; saveSettings(); applyAppearance(); auto.hidden = false; }, `${label} color`);
      const auto = document.createElement('button'); auto.className = 'btn small'; auto.textContent = 'Auto'; auto.title = 'Follow the theme again';
      auto.addEventListener('click', () => { settings.tabColors[key] = ''; saveSettings(); applyAppearance(); painters.forEach((p) => p()); });
      const right = document.createElement('div'); right.className = 'colorfield'; right.append(auto, f.el);
      row.append(lab, right); rows.appendChild(row);
      painters.push(() => { f.paint(); auto.hidden = !settings.tabColors[key]; });
    }
  }
  function syncThemeUI() {
    $('set-follow').checked = settings.followSystem;
    for (const c of drawer.querySelectorAll('.card')) {
      c.setAttribute('aria-checked', String(!settings.followSystem && c.dataset.themeId === settings.themeId));
    }
    painters.forEach((p) => p());
  }
  $('set-follow').addEventListener('change', (e) => {
    if (e.target.checked) { settings.followSystem = true; }
    else { settings.theme = clone(effectiveTheme()); settings.followSystem = false; settings.themeId = isDark(settings.theme.bg) ? 'midnight' : 'daylight'; }
    saveSettings(); applyAppearance(); syncThemeUI();
  });
  $('save-theme').addEventListener('click', () => {
    const name = $('save-name').value.trim();
    if (!name) { $('save-name').focus(); toast('Give your theme a name first.'); return; }
    const entry = { id: Math.random().toString(36).slice(2, 10), name, theme: clone(effectiveTheme()) };
    settings.savedThemes.push(entry);
    settings.followSystem = false; settings.theme = clone(entry.theme); settings.themeId = 'saved:' + entry.id;
    $('save-name').value = '';
    saveSettings(); buildSavedCards(); syncThemeUI();
  });
  function exportLook() {
    return {
      app: 'belor', kind: 'theme', version: 1,
      theme: clone(effectiveTheme()),
      font: { family: settings.font.family, size: settings.font.size, weight: settings.font.weight, boldWeight: settings.font.boldWeight, lineHeight: settings.font.lineHeight, letterSpacing: settings.font.letterSpacing },
      cursor: clone(settings.cursor),
      background: { type: settings.background.type === 'image' ? 'theme' : settings.background.type, color: settings.background.color, gradient: clone(settings.background.gradient), termOpacity: settings.background.termOpacity, sideOpacity: settings.background.sideOpacity },
    };
  }
  $('exp-theme').addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(exportLook(), null, 2)).then(() => toast('Theme copied. Paste it into a file to share it.'), () => toast('Could not copy to the clipboard.'));
  });
  $('imp-theme').addEventListener('click', () => $('imp-file').click());
  $('imp-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const t = data.theme || data;
      const next = { bg: normHex(t.bg), fg: normHex(t.fg), cursor: normHex(t.cursor), selection: normHex(t.selection), accent: normHex(t.accent), ansi: Array.isArray(t.ansi) ? t.ansi.map(normHex) : [] };
      if (!next.bg || !next.fg || next.ansi.length !== 16 || next.ansi.some((c) => !c)) throw new Error('missing colors');
      next.cursor = next.cursor || next.fg; next.selection = next.selection || mix(next.bg, next.fg, 0.25); next.accent = next.accent || next.cursor;
      settings.theme = next; settings.followSystem = false; settings.themeId = 'custom';
      if (isObj(data.font)) { const f = data.font; if (typeof f.family === 'string') settings.font.family = f.family.slice(0, 80); if (f.size >= 8 && f.size <= 36) settings.font.size = f.size | 0; }
      saveSettings(); applyAppearance(); syncAll();
      toast('Theme imported.');
    } catch { toast('That file is not a valid theme.'); }
  });

  // ================================================================ BACKGROUND panel
  const bgs = settings.background;
  function setBgType(type) {
    bgs.type = type;
    if (type !== 'theme' && bgs.termOpacity === 100 && bgs.sideOpacity === 100 && type !== 'solid') { bgs.termOpacity = 82; bgs.sideOpacity = 65; }
    saveSettings(); applyAppearance(); syncBackgroundUI();
  }
  for (const b of $('bg-type').children) b.addEventListener('click', () => setBgType(b.dataset.type));
  const solid = colorField(() => bgs.color, (v) => { bgs.color = v; saveSettings(); applyAppearance(); }, 'Background color');
  $('bg-solid').closest('.colorfield').replaceWith(solid.el);

  function buildGradientPresets() {
    const box = $('grad-presets'); box.replaceChildren();
    for (const g of window.GRADIENTS) {
      const b = document.createElement('button'); b.className = 'chip'; b.title = g.name; b.setAttribute('aria-label', `${g.name} gradient`);
      b.style.background = `linear-gradient(${g.angle}deg, ${g.stops.join(', ')})`;
      b.addEventListener('click', () => { bgs.gradient = { angle: g.angle, stops: [...g.stops] }; saveSettings(); applyAppearance(); syncBackgroundUI(); });
      box.appendChild(b);
    }
  }
  function buildStops() {
    const box = $('grad-stops'); box.replaceChildren();
    bgs.gradient.stops.forEach((c, i) => {
      const row = document.createElement('div'); row.className = 'stop';
      const input = document.createElement('input'); input.type = 'color'; input.value = c; input.setAttribute('aria-label', `Gradient color ${i + 1}`);
      const hex = document.createElement('span'); hex.textContent = c;
      input.addEventListener('input', () => { bgs.gradient.stops[i] = input.value; hex.textContent = input.value; saveSettings(); applyAppearance(); });
      row.append(input, hex);
      if (bgs.gradient.stops.length > 2) {
        const del = document.createElement('button'); del.className = 'icon-btn'; del.innerHTML = ICONS.close; del.title = 'Remove color'; del.setAttribute('aria-label', `Remove color ${i + 1}`);
        del.addEventListener('click', () => { bgs.gradient.stops.splice(i, 1); saveSettings(); applyAppearance(); buildStops(); });
        row.appendChild(del);
      }
      box.appendChild(row);
    });
    $('add-stop').hidden = bgs.gradient.stops.length >= 6;
  }
  $('add-stop').addEventListener('click', () => {
    const s = bgs.gradient.stops; s.push(s[s.length - 1]); saveSettings(); applyAppearance(); buildStops();
  });

  async function importImage(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Please choose an image file.'); return; }
    try {
      const res = await window.term.saveAsset({ kind: 'image', name: file.name, data: await file.arrayBuffer() });
      settings.recentImages.unshift({ file: res.file, name: res.name });
      for (const old of settings.recentImages.splice(12)) window.term.deleteAsset({ kind: 'image', file: old.file });
      bgs.image.file = res.file;
      setBgType('image');
    } catch (err) { toast(cleanErr(err)); }
  }
  function buildThumbs() {
    const box = $('recent-imgs'); box.replaceChildren();
    for (const im of settings.recentImages) {
      const t = document.createElement('div');
      t.className = 'thumb'; t.tabIndex = 0; t.setAttribute('role', 'radio'); t.title = im.name;
      t.style.backgroundImage = `url("${assetUrl('image', im.file)}")`;
      t.setAttribute('aria-checked', String(bgs.image.file === im.file));
      const pick = () => { bgs.image.file = im.file; setBgType('image'); };
      t.addEventListener('click', (e) => { if (!e.target.closest('.del')) pick(); });
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      const del = document.createElement('button'); del.className = 'del'; del.innerHTML = ICONS.close; del.title = 'Remove image'; del.setAttribute('aria-label', `Remove ${im.name}`);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        window.term.deleteAsset({ kind: 'image', file: im.file });
        settings.recentImages = settings.recentImages.filter((x) => x.file !== im.file);
        if (bgs.image.file === im.file) { bgs.image.file = ''; if (bgs.type === 'image') bgs.type = 'theme'; }
        saveSettings(); applyAppearance(); syncBackgroundUI();
      });
      t.appendChild(del); box.appendChild(t);
    }
  }
  $('pick-img').addEventListener('click', () => $('img-file').click());
  $('img-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; importImage(f); });
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); importImage(e.dataTransfer.files[0]); });
  // Dropping an image anywhere on the window sets it as the background.
  document.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) importImage(f); else if (f) toast('Drop an image file to use it as the background.');
  });

  const paintAngle = bindRange('grad-angle', () => bgs.gradient.angle, (v) => { bgs.gradient.angle = v; saveSettings(); applyAppearance(); }, (v) => v + '°');
  const paintFit = bindSelect('img-fit', () => bgs.image.fit, (v) => { bgs.image.fit = v; saveSettings(); applyAppearance(); });
  const paintBlur = bindRange('img-blur', () => bgs.image.blur, (v) => { bgs.image.blur = v; saveSettings(); applyAppearance(); }, (v) => v + ' px');
  const paintDim = bindRange('img-dim', () => bgs.image.dim, (v) => { bgs.image.dim = v; saveSettings(); applyAppearance(); }, (v) => v + '%');
  const paintOpTerm = bindRange('op-term', () => bgs.termOpacity, (v) => { bgs.termOpacity = v; saveSettings(); applyAppearance(); }, (v) => v + '%');
  const paintOpSide = bindRange('op-side', () => bgs.sideOpacity, (v) => { bgs.sideOpacity = v; saveSettings(); applyAppearance(); }, (v) => v + '%');
  function syncBackgroundUI() {
    for (const b of $('bg-type').children) b.setAttribute('aria-checked', String(b.dataset.type === bgs.type));
    for (const s of drawer.querySelectorAll('[data-bgp]')) s.hidden = s.dataset.bgp !== bgs.type;
    solid.paint(); paintAngle(); paintFit(); paintBlur(); paintDim(); paintOpTerm(); paintOpSide();
    buildStops(); buildThumbs();
    // dimming also applies to gradients, so keep its slider reachable there
    const dimRow = $('img-dim').closest('.row');
    const imagePanel = drawer.querySelector('[data-bgp="image"]'), gradPanel = drawer.querySelector('[data-bgp="gradient"]');
    if (bgs.type === 'gradient') gradPanel.appendChild(dimRow); else imagePanel.appendChild(dimRow);
  }

  // ================================================================ FONT panel
  const fontSel = $('font-family');
  function buildFontList() {
    fontSel.replaceChildren();
    const add = (group, name, label) => { const o = document.createElement('option'); o.value = name; o.textContent = label || name; group.appendChild(o); };
    const mk = (label) => { const g = document.createElement('optgroup'); g.label = label; return g; };
    const mine = mk('Your fonts'), inst = mk('Installed on this PC'), other = mk('Not installed');
    for (const f of settings.font.custom) add(mine, f.name);
    const have = new Set(settings.font.custom.map((f) => f.name));
    for (const name of window.FONT_CHOICES) { if (have.has(name)) continue; add(fontInstalled(name) ? inst : other, name); }
    if (!have.has(settings.font.family) && !window.FONT_CHOICES.includes(settings.font.family)) add(inst, settings.font.family, `${settings.font.family} (typed)`);
    for (const g of [mine, inst, other]) if (g.children.length) fontSel.appendChild(g);
    fontSel.value = settings.font.family;
    const missing = !have.has(settings.font.family) && !fontInstalled(settings.font.family);
    $('font-note').textContent = missing ? `"${settings.font.family}" does not look installed, so Windows will use a fallback font. Install it or add the font file.` : '';
  }
  function setFont(patch) { Object.assign(settings.font, patch); saveSettings(); applyAppearance(); }
  fontSel.addEventListener('change', () => { setFont({ family: fontSel.value }); buildFontList(); });
  $('font-custom').addEventListener('change', (e) => {
    const v = e.target.value.trim().replace(/["\\]/g, '').slice(0, 80);
    if (v) { setFont({ family: v }); e.target.value = ''; buildFontList(); }
  });
  $('add-font').addEventListener('click', () => $('font-file').click());
  $('font-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || 'Custom font';
      const res = await window.term.saveAsset({ kind: 'font', name: file.name, data: await file.arrayBuffer() });
      const entry = { name, file: res.file };
      if (!(await loadCustomFont(entry))) { window.term.deleteAsset({ kind: 'font', file: res.file }); toast('That font file could not be loaded.'); return; }
      settings.font.custom = settings.font.custom.filter((f) => f.name !== name).concat(entry);
      setFont({ family: name }); buildFontList();
      toast(`Added "${name}".`);
    } catch (err) { toast(cleanErr(err)); }
  });
  const paintSize = bindRange('font-size', () => settings.font.size, (v) => setFont({ size: v }), (v) => v + ' px');
  const paintWeight = bindSelect('font-weight', () => settings.font.weight, (v) => setFont({ weight: v }));
  const paintBold = bindSelect('font-bold', () => settings.font.boldWeight, (v) => setFont({ boldWeight: v }));
  const paintLh = bindRange('font-lh', () => settings.font.lineHeight, (v) => setFont({ lineHeight: v }), (v) => v.toFixed(2));
  const paintLs = bindRange('font-ls', () => settings.font.letterSpacing, (v) => setFont({ letterSpacing: v }), (v) => v + ' px');
  const paintCurStyle = bindSelect('cur-style', () => settings.cursor.style, (v) => { settings.cursor.style = v; saveSettings(); applyAppearance(); });
  const paintBlink = bindSwitch('cur-blink', () => settings.cursor.blink, (v) => { settings.cursor.blink = v; saveSettings(); applyAppearance(); });
  function syncFontUI() { buildFontList(); paintSize(); paintWeight(); paintBold(); paintLh(); paintLs(); paintCurStyle(); paintBlink(); }

  // ================================================================ SOUNDS + GENERAL
  const paintSoundOn = bindSwitch('set-sound', () => window.sounds.enabled, (v) => { window.sounds.enabled = v; paintSound(); });
  const paintVol = bindRange('set-vol', () => Math.round(window.sounds.volume * 100), (v) => { window.sounds.volume = v / 100; }, (v) => v + '%');
  $('set-vol').addEventListener('change', () => window.sounds.previewSuccess());
  $('test-ok').addEventListener('click', () => window.sounds.previewSuccess());
  $('test-fail').addEventListener('click', () => window.sounds.previewFail());
  $('test-ask').addEventListener('click', () => window.sounds.previewAttention());
  const paintBell = bindSwitch('set-bell', () => settings.bellSound, (v) => { settings.bellSound = v; saveSettings(); });
  const paintIdle = bindSwitch('set-idle', () => settings.agentIdleDone, (v) => { settings.agentIdleDone = v; saveSettings(); });

  // ---- popup notifications
  const N = settings.notify;
  const paintNotify = [
    bindSwitch('set-notify', () => N.enabled, (v) => { N.enabled = v; saveSettings(); }),
    bindSwitch('set-notify-done', () => N.onDone, (v) => { N.onDone = v; saveSettings(); }),
    bindSwitch('set-notify-fail', () => N.onFail, (v) => { N.onFail = v; saveSettings(); }),
    bindSwitch('set-notify-ask', () => N.onAsk, (v) => { N.onAsk = v; saveSettings(); }),
    bindRange('set-notify-min', () => N.minSeconds, (v) => { N.minSeconds = v; saveSettings(); }, (v) => (v === 0 ? 'Any' : v + ' s')),
  ];
  $('test-notify').addEventListener('click', async () => {
    const r = await window.term.notify({ title: 'Test popup', body: 'This is how a Belor notification looks.', force: true });
    $('notify-msg').textContent = r && r.shown ? 'Sent. If you saw nothing, check Windows Settings > System > Notifications.' : `Could not show it (${(r && r.reason) || 'unknown'}).`;
  });

  // Claude Code / Codex: add or remove the small hook that reports "done" and "question" to this app.
  let agentState = null;
  async function refreshAgent() {
    try { agentState = await window.term.agentStatus(); } catch { return; }
    for (const tool of ['claude', 'codex']) {
      const st = agentState[tool];
      const btn = $('agent-' + tool);
      btn.textContent = st.on ? (st.outdated ? 'Update' : 'Turn off') : 'Turn on';
      btn.classList.toggle('on', st.on);
      $(`agent-${tool}-note`).textContent = st.error || (st.on ? (st.outdated ? 'On, but an update adds the running and failed colors' : 'On') : 'Off');
    }
  }
  for (const tool of ['claude', 'codex']) {
    $('agent-' + tool).addEventListener('click', async (e) => {
      const cur = agentState && agentState[tool];
      const btn = e.currentTarget, enable = !(cur && cur.on && !cur.outdated);   // "Update" re-applies, "Turn off" removes
      btn.disabled = true; $('agent-msg').textContent = '';
      try {
        agentState = await window.term.agentSetup({ tool, enable });
        if (tool === 'codex' && enable) { settings.bellSound = true; saveSettings(); paintBell(); }
        $('agent-msg').textContent = enable ? `Done. Restart ${tool === 'claude' ? 'Claude Code' : 'Codex'} to start hearing it.` : 'Removed.';
      } catch (err) { $('agent-msg').textContent = cleanErr(err); }
      btn.disabled = false;
      refreshAgent();
    });
  }
  for (const s of info.shells) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.label; $('set-shell').appendChild(o); }
  const paintShell = bindSelect('set-shell', () => settings.defaultShell, (v) => { settings.defaultShell = v; saveSettings(); });

  // ---- Terminal panel
  const T = settings.term;
  const tApply = () => { saveSettings(); applyAppearance(); };
  const tSave = () => saveSettings();
  const paintTerm = [
    bindRange('set-scrollback', () => T.scrollback, (v) => { T.scrollback = v; tApply(); }, (v) => v.toLocaleString()),
    bindRange('set-scrollspeed', () => T.scrollSpeed, (v) => { T.scrollSpeed = v; tApply(); }, (v) => v + '×'),
    bindSwitch('set-scrollinput', () => T.scrollOnInput, (v) => { T.scrollOnInput = v; tApply(); }),
    bindSwitch('set-copysel', () => T.copyOnSelect, (v) => { T.copyOnSelect = v; tSave(); }),
    bindSelect('set-rclick', () => T.rightClick, (v) => { T.rightClick = v; tSave(); }),
    bindSwitch('set-confirmpaste', () => T.confirmPaste, (v) => { T.confirmPaste = v; tSave(); }),
    bindRange('set-contrast', () => T.contrast, (v) => { T.contrast = v; tApply(); }, (v) => (v <= 1 ? 'Off' : v)),
    bindSwitch('set-boldbright', () => T.boldBright, (v) => { T.boldBright = v; tApply(); }),
    bindSelect('set-unicode', () => T.unicode, (v) => { T.unicode = v; tApply(); }),
    bindSelect('set-cursorinactive', () => T.cursorInactive, (v) => { T.cursorInactive = v; tApply(); }),
    bindSwitch('set-linkctrl', () => T.linkNeedsCtrl, (v) => { T.linkNeedsCtrl = v; tSave(); }),
  ];
  const wordSep = $('set-wordsep');
  wordSep.addEventListener('input', () => { T.wordSep = wordSep.value; tApply(); });
  paintTerm.push(() => { wordSep.value = T.wordSep; });

  // ---- General: new tabs, window, startup
  const W = settings.win, SU = settings.startup;
  const pushPrefs = () => window.term.setPrefs({ confirmClose: W.confirmClose, alwaysOnTop: W.alwaysOnTop, opacity: W.opacity / 100 });
  const startPath = $('set-startpath');
  const paintStartRow = () => { $('row-startpath').hidden = SU.dirMode !== 'custom'; };
  const paintGeneral = [
    bindSelect('set-startdir', () => SU.dirMode, (v) => { SU.dirMode = v; saveSettings(); paintStartRow(); }),
    bindSwitch('set-ontop', () => W.alwaysOnTop, (v) => { W.alwaysOnTop = v; saveSettings(); pushPrefs(); }),
    bindRange('set-winop', () => W.opacity, (v) => { W.opacity = v; saveSettings(); pushPrefs(); }, (v) => v + '%'),
    bindSwitch('set-confirmclose', () => W.confirmClose, (v) => { W.confirmClose = v; saveSettings(); pushPrefs(); }),
    bindSwitch('set-restore', () => SU.restore, (v) => { SU.restore = v; saveSettings(); persistSession(true); }),
    () => { startPath.value = SU.dir; paintStartRow(); },
  ];
  startPath.addEventListener('input', () => { SU.dir = startPath.value; saveSettings(); });
  $('reset-look').addEventListener('click', () => {
    const d = defaults();
    for (const f of settings.font.custom) window.term.deleteAsset({ kind: 'font', file: f.file });
    for (const im of settings.recentImages) window.term.deleteAsset({ kind: 'image', file: im.file });
    Object.assign(settings, { followSystem: d.followSystem, themeId: d.themeId, theme: d.theme, background: d.background, recentImages: [], font: d.font, cursor: d.cursor });
    for (const k of Object.keys(bgs)) delete bgs[k]; Object.assign(bgs, settings.background); settings.background = bgs;
    saveSettings(); applyAppearance(); syncAll(); toast('Look reset to the defaults.');
  });
  $('about').textContent = `Belor ${info.version}${info.isAdmin ? ' · running as administrator' : ''}`;

  function syncAll() {
    syncThemeUI(); syncBackgroundUI(); syncFontUI(); paintSoundOn(); paintVol(); paintShell(); paintBell(); paintIdle(); paintNotify.forEach((p) => p()); refreshAgent();
    paintTerm.forEach((p) => p()); paintGeneral.forEach((p) => p());
  }

  // =================================================================== global shortcuts
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (!drawer.hidden && !e.target.closest('input[type=text]')) { closeSettings(); return; }
      if (!newMenu.hidden || !ctx.hidden) { closePopups(); tabs.get(activeId)?.term.focus(); return; }
    }
    if (e.key === 'F11') { e.preventDefault(); window.term.toggleFullscreen(); return; }
    if (!e.ctrlKey) return;
    if (e.shiftKey && k === 'f') { e.preventDefault(); openFind(); }
    else if (e.shiftKey && k === 'k') { e.preventDefault(); tabs.get(activeId)?.term.clear(); }
    else if (k === '=' || k === '+') { e.preventDefault(); zoom(1); }
    else if (k === '-') { e.preventDefault(); zoom(-1); }
    else if (k === '0') { e.preventDefault(); zoom(0); }
    else if (e.shiftKey && k === 't') { e.preventDefault(); openTab(settings.defaultShell); }
    else if (e.shiftKey && k === 'a') { e.preventDefault(); if (!info.isAdmin) openTab(adminShellId(), { admin: true }); }
    else if (e.shiftKey && k === 'w') { e.preventDefault(); closeTab(activeId); }
    else if (e.shiftKey && k === 'b') { e.preventDefault(); toggleSidebar(); }
    else if (k === 'tab') { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); }
    else if (k === ',') { e.preventDefault(); drawer.hidden ? openSettings() : closeSettings(); }
  }, true);

  // =================================================================== go
  fillIcons();
  buildPresetCards(); buildSavedCards(); buildColorRows(); buildTabColorRows(); buildGradientPresets();
  paintSound();
  applyCollapsed();
  await Promise.all(settings.font.custom.map(loadCustomFont));
  pushPrefs();
  applyAppearance();
  showPanel('theme');

  // reopen last time's tabs if asked to, otherwise start with one tab
  if (settings.startup.restore && settings.startup.session.length) {
    const saved = settings.startup.session.slice(), want = settings.startup.active;
    for (const t of saved) await openTab(info.shells.some((s) => s.id === t.shellId) ? t.shellId : settings.defaultShell, { cwd: t.cwd || undefined });
    const ids = orderedIds();
    if (ids.length) activate(ids[Math.min(want, ids.length - 1)]);
  }
  if (!tabs.size) await openTab(settings.defaultShell);
  window.addEventListener('beforeunload', () => persistSession(true));
  if (location.search.includes('selftest')) window.__st = { tabs, settings, setState };   // test hook, only when the app runs in self-test mode
})();
