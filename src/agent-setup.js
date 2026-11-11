// Adds / removes the Belor hooks in Claude Code's and Codex's config files.
// Only ever touches entries that carry our marker, keeps a one-time backup, and refuses to
// overwrite a file it can't parse or a setting it doesn't own.
// (Belor was first called "Sound Terminal": entries written under that name are still recognized, updated and removed.)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARK = 'st-notify.ps1';
const TAG = '# belor';                           // trailing comment on every TOML line we add
const LEGACY_TAG = '# soundterminal';
const COMMENT = '# Belor: play a sound when a Codex run finishes';
const COMMENT_RE = /^#\s*(Belor|Sound Terminal): play a sound when a Codex run finishes$/;
const isTagged = (l) => l.includes(TAG) || l.includes(LEGACY_TAG);
// [hook event, what to report, optional tool-name matcher]
const CLAUDE_HOOKS = [
  ['UserPromptSubmit', 'running', null],         // you sent a prompt (also turns Claude starts on its own): the tab shows "running"
  ['Stop', 'done', null],                        // a run finished: "completed"
  ['StopFailure', 'error', null],                // the run ended on an API error: "failed"
  ['PermissionRequest', 'attention', null],      // it needs permission: "waiting for you"
  ['Notification', 'attention', null],           // other notifications, such as waiting on you
  ['PreToolUse', 'attention', 'AskUserQuestion'], // Claude asks you a question
];
// Codex: finished runs come through `notify`; questions and approval requests come through the
// built-in TUI notification, which rings the terminal bell (the app listens for it).
const CODEX_TUI = [['notifications', '["approval-requested"]'], ['notification_method', '"bel"'], ['notification_condition', '"always"']];

const claudeFile = () => path.join(process.env.ST_CLAUDE_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
const codexFile = () => path.join(process.env.ST_CODEX_DIR || path.join(os.homedir(), '.codex'), 'config.toml');
const fwd = (p) => String(p).replace(/\\/g, '/');
const isOurs = (h) => h && typeof h.command === 'string' && h.command.includes(MARK);

const hookCommand = (script, event, tool) => `powershell -NoProfile -ExecutionPolicy Bypass -File "${fwd(script)}" ${event} ${tool}`;
const ORIG = '# belor-original: ';              // keeps the user's own notify line so it can be chained and later restored
const LEGACY_ORIG = '# soundterminal-original: ';
const codexLine = (script, chain = []) => {
  const args = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fwd(script), 'done', 'codex', ...(chain.length ? ['__then__', ...chain] : [])];
  return `notify = [${args.map((s) => JSON.stringify(s)).join(', ')}]`;
};

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function writeSafe(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // one backup, made the first time we touch the file (an older "soundterminal" backup counts too)
  if (fs.existsSync(file) && !fs.existsSync(file + '.belor.bak') && !fs.existsSync(file + '.soundterminal.bak')) fs.copyFileSync(file, file + '.belor.bak');
  const tmp = file + '.belor.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ---- Claude Code: hooks in settings.json ---------------------------------------------------
function readClaude() {
  const text = readText(claudeFile());
  if (text === null || !text.trim()) return {};
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error(`${claudeFile()} is not valid JSON, so I left it alone. Fix it, then try again.`); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${claudeFile()} does not contain a JSON object.`);
  return obj;
}
function stripOurs(obj) {
  if (!obj.hooks || typeof obj.hooks !== 'object') return;
  for (const ev of Object.keys(obj.hooks)) {
    if (!Array.isArray(obj.hooks[ev])) continue;
    obj.hooks[ev] = obj.hooks[ev]
      .map((g) => (g && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
      .filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0));
    if (obj.hooks[ev].length === 0) delete obj.hooks[ev];
  }
  if (Object.keys(obj.hooks).length === 0) delete obj.hooks;
}
function claudeSet(enable, script) {
  const obj = readClaude();
  stripOurs(obj);
  if (enable) {
    obj.hooks = obj.hooks || {};
    for (const [ev, kind, matcher] of CLAUDE_HOOKS) {
      obj.hooks[ev] = Array.isArray(obj.hooks[ev]) ? obj.hooks[ev] : [];
      const group = { hooks: [{ type: 'command', command: hookCommand(script, kind, 'claude') }] };
      if (matcher) group.matcher = matcher;
      obj.hooks[ev].push(group);
    }
  }
  writeSafe(claudeFile(), JSON.stringify(obj, null, 2) + '\n');
}
function claudeOn(script) {
  const obj = readClaude();
  const has = (ev) => Array.isArray(obj.hooks && obj.hooks[ev]) && obj.hooks[ev].some((g) => g && Array.isArray(g.hooks) && g.hooks.some(isOurs));
  const ours = Object.values(obj.hooks || {}).flat().flatMap((g) => (g && Array.isArray(g.hooks) ? g.hooks : [])).filter(isOurs);
  const on = has('Stop');
  // "outdated": turned on with an older version that lacked some of today's events, or that still points at an older script location
  const wrongPlace = !!script && ours.some((h) => !h.command.includes(`"${fwd(script)}"`));
  return { on, outdated: on && (wrongPlace || !CLAUDE_HOOKS.every(([ev]) => has(ev))) };
}

// ---- Codex: `notify` plus a [tui] table in config.toml -------------------------------------
const NOTIFY_RE = /^[ \t]*notify[ \t]*=/;
const TUI_HEADER = /^[ \t]*\[tui\][ \t]*(#.*)?$/;
const ANY_HEADER = /^[ \t]*\[/;

function codexStrip(lines) {
  const out = [];
  for (const l of lines) {
    if (COMMENT_RE.test(l.trim())) continue;
    if (NOTIFY_RE.test(l) && l.includes(MARK)) continue;
    if (isTagged(l)) continue;                     // a [tui] header or key we added, or the saved original notify line
    out.push(l);
  }
  // drop blank lines we may have left at the very end after removing a section we appended
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}
// Reads `notify = ["a", 'b']` (one line) into its strings; null when it is not a simple one-line array.
function parseNotify(line) {
  const m = /^[ \t]*notify[ \t]*=[ \t]*\[(.*)\][ \t]*(#.*)?$/.exec(line);
  if (!m) return null;
  const body = m[1], out = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === ' ' || c === '\t' || c === ',') { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < body.length && body[j] !== '"') j += body[j] === '\\' ? 2 : 1;
      if (j >= body.length) return null;
      try { out.push(JSON.parse(body.slice(i, j + 1))); } catch { return null; }
      i = j + 1;
    } else if (c === "'") {
      const j = body.indexOf("'", i + 1);
      if (j === -1) return null;
      out.push(body.slice(i + 1, j));
      i = j + 1;
    } else return null;
  }
  return out;
}

function codexSet(enable, script) {
  const existing = readText(codexFile());
  if (existing === null && !enable) return;
  const eol = existing && existing.includes('\r\n') ? '\r\n' : '\n';
  let lines = (existing || '').split(/\r?\n/);
  const savedLine = lines.find((l) => l.startsWith(ORIG) || l.startsWith(LEGACY_ORIG));
  const saved = savedLine ? savedLine.slice(savedLine.startsWith(ORIG) ? ORIG.length : LEGACY_ORIG.length) : null;   // the user's own notify line we replaced earlier
  lines = codexStrip(lines);
  if (saved) lines.unshift(saved);                                  // give it back before doing anything else

  let keep = null, chain = [];
  if (enable) {
    // Codex runs a single notify program. If you already have one, keep it by chaining it after ours.
    const at = lines.findIndex((l) => NOTIFY_RE.test(l));
    if (at !== -1) {
      const parsed = parseNotify(lines[at]);
      if (!parsed || !parsed.length) throw new Error('Codex already has a "notify" setting that I could not read (it may span several lines). Put it on one line like notify = ["program", "arg"], then try again.');
      keep = lines[at]; chain = parsed; lines.splice(at, 1);
    }

    // [tui] keys: insert inside an existing [tui] table, or append a new one
    const hdr = lines.findIndex((l) => TUI_HEADER.test(l));
    if (hdr === -1) {
      if (lines.length) lines.push('');
      lines.push(`[tui] ${TAG}`);
      for (const [k, v] of CODEX_TUI) lines.push(`${k} = ${v} ${TAG}`);
    } else {
      let end = lines.findIndex((l, i) => i > hdr && ANY_HEADER.test(l));
      if (end === -1) end = lines.length;
      const region = lines.slice(hdr + 1, end);
      const clash = CODEX_TUI.map(([k]) => k).filter((k) => region.some((l) => new RegExp(`^[ \\t]*${k}[ \\t]*=`).test(l)));
      if (clash.length) throw new Error(`Codex already sets ${clash.join(', ')} in its [tui] section. Set notification_method = "bel" and notifications = ["approval-requested"] yourself, then try again.`);
      lines.splice(hdr + 1, 0, ...CODEX_TUI.map(([k, v]) => `${k} = ${v} ${TAG}`));
    }
    // top of file = top level, before any [table]
    lines = [COMMENT, ...(keep ? [ORIG + keep] : []), codexLine(script, chain), ...lines];
  }
  const text = lines.join(eol);
  writeSafe(codexFile(), text === '' ? '' : text + eol);
}
function codexOn() {
  const text = readText(codexFile());
  return !!text && text.split(/\r?\n/).some((l) => NOTIFY_RE.test(l) && l.includes(MARK));
}

function status(script) {
  const out = { claude: { file: claudeFile(), on: false, outdated: false, error: '' }, codex: { file: codexFile(), on: false, outdated: false, error: '' } };
  try { Object.assign(out.claude, claudeOn(script)); } catch (e) { out.claude.error = e.message; }
  try { out.codex.on = codexOn(); } catch (e) { out.codex.error = e.message; }
  return out;
}
function setup(tool, enable, script) {
  if (tool === 'claude') claudeSet(enable, script);
  else if (tool === 'codex') codexSet(enable, script);
  else throw new Error('Unknown tool.');
  return status(script);
}

module.exports = { setup, status, hookCommand, codexLine, claudeFile, codexFile };
