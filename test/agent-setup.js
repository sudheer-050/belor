// Tests the Claude Code / Codex config editing against temporary folders (never touches real config).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-agent-test-'));
process.env.ST_CLAUDE_DIR = path.join(root, 'claude');
process.env.ST_CODEX_DIR = path.join(root, 'codex');
const { setup, status, claudeFile, codexFile } = require('../src/agent-setup');
const SCRIPT = 'C:\\Users\\me\\AppData\\Local\\SoundTerminal\\bin\\st-notify.ps1';
const read = (f) => fs.readFileSync(f, 'utf8');
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
let n = 0;
const ok = (name) => console.log(`  ok ${++n} - ${name}`);

// ---- Claude: no file yet
assert.equal(status().claude.on, false);
setup('claude', true, SCRIPT);
let s = JSON.parse(read(claudeFile()));
assert.equal(s.hooks.Stop.length, 1);
assert.equal(s.hooks.Notification.length, 1);
assert.equal(s.hooks.PreToolUse[0].matcher, 'AskUserQuestion');
assert.match(s.hooks.UserPromptSubmit[0].hooks[0].command, / running claude$/);   // prompt sent -> running
assert.match(s.hooks.StopFailure[0].hooks[0].command, / error claude$/);          // API error -> failed
assert.match(s.hooks.PermissionRequest[0].hooks[0].command, / attention claude$/);
assert.match(s.hooks.Stop[0].hooks[0].command, /C:\/Users\/me\/AppData\/Local\/SoundTerminal\/bin\/st-notify\.ps1" done claude$/);
assert.equal(status().claude.on, true);
ok('claude: enable on a missing file');

// ---- Claude: an older install (fewer hooks) is reported as outdated and fixed by re-enabling
{
  const old = JSON.parse(read(claudeFile()));
  delete old.hooks.UserPromptSubmit; delete old.hooks.StopFailure; delete old.hooks.PermissionRequest;
  write(claudeFile(), JSON.stringify(old));
  assert.deepEqual([status().claude.on, status().claude.outdated], [true, true]);
  setup('claude', true, SCRIPT);
  assert.deepEqual([status().claude.on, status().claude.outdated], [true, false]);
  ok('claude: older installs show as outdated and update in place');
}

// ---- Claude: idempotent, keeps the user's own hooks and settings
write(claudeFile(), JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo guard' }] }] } }));
fs.rmSync(claudeFile() + '.belor.bak', { force: true });
setup('claude', true, SCRIPT); setup('claude', true, SCRIPT);
s = JSON.parse(read(claudeFile()));
assert.equal(s.model, 'x');
assert.equal(s.hooks.Stop.length, 2);                       // theirs + ours, not duplicated
assert.equal(s.hooks.PreToolUse.length, 2);
assert.ok(fs.existsSync(claudeFile() + '.belor.bak'));
ok('claude: enabling twice adds no duplicates and keeps existing hooks');

// ---- Claude: disable removes only ours
setup('claude', false, SCRIPT);
s = JSON.parse(read(claudeFile()));
assert.deepEqual(s, { model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo guard' }] }] } });
assert.equal(status().claude.on, false);
ok('claude: disable restores the original settings');

// ---- Claude: invalid JSON is left alone
write(claudeFile(), '{ not json');
assert.throws(() => setup('claude', true, SCRIPT), /not valid JSON/);
assert.equal(read(claudeFile()), '{ not json');
ok('claude: refuses to overwrite invalid JSON');

// ---- Codex: no file yet
setup('codex', true, SCRIPT);
let t = read(codexFile());
assert.match(t, /^# Belor: play a sound when a Codex run finishes\nnotify = \["powershell"/);
assert.match(t, /\n\[tui\] # belor\nnotifications = \["approval-requested"\] # belor\nnotification_method = "bel" # belor\nnotification_condition = "always" # belor\n$/);
assert.equal(status().codex.on, true);
ok('codex: enable on a missing file');

// ---- Codex: disable returns to empty
setup('codex', false, SCRIPT);
assert.equal(read(codexFile()).trim(), '');
assert.equal(status().codex.on, false);
ok('codex: disable removes everything it added');

// ---- Codex: existing content, with and without a [tui] table; exact round trip
const original = 'model = "gpt-x"\n\n[tui]\ntheme = "dark"\n\n[projects.a]\ntrust = true\n';
write(codexFile(), original);
fs.rmSync(codexFile() + '.belor.bak', { force: true });
setup('codex', true, SCRIPT); setup('codex', true, SCRIPT);
t = read(codexFile());
assert.equal(t.match(/^\[tui\]/gm).length, 1);               // reused their table, no duplicate header
assert.ok(t.indexOf('notify =') < t.indexOf('[tui]'));       // notify stays top-level
assert.match(t, /\[tui\]\nnotifications = .*# belor\nnotification_method = .*\nnotification_condition = .*\ntheme = "dark"/);
setup('codex', false, SCRIPT);
assert.equal(read(codexFile()).trim(), original.trim());
ok('codex: reuses an existing [tui] table and disable restores the original exactly');

// ---- Codex: an existing notify (like the Codex app's own) is chained, kept, and restored exactly
const theirs = 'notify = [ "C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\OpenAI\\\\Codex\\\\bin\\\\codex-computer-use.exe", "turn-ended" ]';
const withNotify = `model = "gpt-x"\n\n\n${theirs}\n\n[marketplaces.a]\nsource = '\\\\?\\C:\\x'\n`;
write(codexFile(), withNotify);
setup('codex', true, SCRIPT); setup('codex', true, SCRIPT);       // twice: must not nest the chain
t = read(codexFile());
assert.equal(t.match(/^notify\s*=/gm).length, 1);                  // still exactly one notify
const mine = t.split('\n').find((l) => /^notify\s*=/.test(l));
assert.match(mine, /"done", "codex", "__then__", "C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\OpenAI\\\\Codex\\\\bin\\\\codex-computer-use\.exe", "turn-ended"\]$/);
assert.equal((mine.match(/__then__/g) || []).length, 1);
assert.ok(t.includes('# belor-original: ' + theirs));
assert.equal(status().codex.on, true);
setup('codex', false, SCRIPT);
t = read(codexFile());
assert.ok(t.split('\n').includes(theirs));                         // their line is back
assert.ok(!t.includes('st-notify') && !t.includes('belor') && !t.includes('__then__'));
assert.equal(t.match(/^notify\s*=/gm).length, 1);
assert.ok(t.includes("source = '\\\\?\\C:\\x'"));                   // untouched content stays byte for byte
ok('codex: chains an existing notify program, never nests, and restores it');

// ---- Codex: a notify we can't read safely is reported, never overwritten
write(codexFile(), 'notify = [\n  "a",\n  "b"\n]\n');
assert.throws(() => setup('codex', true, SCRIPT), /could not read/);
assert.equal(read(codexFile()), 'notify = [\n  "a",\n  "b"\n]\n');
write(codexFile(), '[tui]\nnotification_method = "osc9"\n');
assert.throws(() => setup('codex', true, SCRIPT), /already sets notification_method/);
assert.equal(read(codexFile()), '[tui]\nnotification_method = "osc9"\n');
ok('codex: leaves a different notify / existing [tui] keys alone and says why');

// ---- Codex: Windows line endings survive
write(codexFile(), 'model = "x"\r\n');
setup('codex', true, SCRIPT);
assert.ok(!/[^\r]\n/.test(read(codexFile())));
setup('codex', false, SCRIPT);
assert.equal(read(codexFile()), 'model = "x"\r\n');
ok('codex: keeps CRLF line endings');

// ---- Upgrading from the app's earlier name ("Sound Terminal"): old entries are recognized, moved to the new script, and removed cleanly
{
  const OLD_SCRIPT = 'C:\\Users\\me\\AppData\\Local\\SoundTerminal\\bin\\st-notify.ps1';
  const NEW_SCRIPT = 'C:\\Users\\me\\AppData\\Local\\Belor\\bin\\st-notify.ps1';
  // Claude: hooks written by the old version point at the old folder
  write(claudeFile(), JSON.stringify({ model: 'x' }));
  setup('claude', true, OLD_SCRIPT);
  assert.deepEqual([status(NEW_SCRIPT).claude.on, status(NEW_SCRIPT).claude.outdated], [true, true]);    // shown as "Update"
  assert.deepEqual([status(OLD_SCRIPT).claude.on, status(OLD_SCRIPT).claude.outdated], [true, false]);
  setup('claude', true, NEW_SCRIPT);
  s = JSON.parse(read(claudeFile()));
  assert.equal(s.hooks.Stop.length, 1);                                                                   // replaced, not duplicated
  assert.ok(s.hooks.Stop[0].hooks[0].command.includes('/Belor/bin/st-notify.ps1'));
  assert.deepEqual([status(NEW_SCRIPT).claude.on, status(NEW_SCRIPT).claude.outdated], [true, false]);
  setup('claude', false, NEW_SCRIPT);
  assert.deepEqual(JSON.parse(read(claudeFile())), { model: 'x' });
  // Codex: a config left by the old version (old comment, old tags, saved original notify)
  const mine = 'notify = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:/Users/me/AppData/Local/SoundTerminal/bin/st-notify.ps1", "done", "codex", "__then__", "other.exe", "turn-ended"]';
  const legacy = ['# Sound Terminal: play a sound when a Codex run finishes', '# soundterminal-original: notify = ["other.exe", "turn-ended"]', mine,
    'model = "gpt-x"', '', '[tui] # soundterminal', 'notifications = ["approval-requested"] # soundterminal', 'notification_method = "bel" # soundterminal', 'notification_condition = "always" # soundterminal', ''].join('\n');
  write(codexFile(), legacy);
  assert.equal(status(NEW_SCRIPT).codex.on, true);
  setup('codex', true, NEW_SCRIPT);                                                                       // refresh under the new name
  t = read(codexFile());
  assert.ok(!t.includes('soundterminal') && !t.includes('Sound Terminal'));
  assert.equal(t.match(/^notify\s*=/gm).length, 1);
  assert.ok(t.includes('# belor-original: notify = ["other.exe", "turn-ended"]'));
  assert.ok(t.includes('/Belor/bin/st-notify.ps1'));
  setup('codex', false, NEW_SCRIPT);                                                                      // and off: their own notify comes back
  t = read(codexFile());
  assert.ok(t.split('\n').includes('notify = ["other.exe", "turn-ended"]'));
  assert.ok(!/belor|soundterminal|st-notify|Sound Terminal/i.test(t));
  ok('upgrade: entries written under the old name are recognized, updated and removed cleanly');
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`all ${n} passed`);
