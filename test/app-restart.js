// Uses a throwaway profile: quit/relaunch must reconnect to the same PowerShell.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const output = fs.mkdtempSync(path.join(root, 'dist/restart-check-'));
const profile = path.join(output, 'profile');
async function launch(stage) {
  const logFile = path.join(output, `${stage}.log`), fd = fs.openSync(logFile, 'w');
  const extra = `(async () => {
    const records = await window.term.sessions();
    if (records.length !== 1) throw Error('Expected one saved terminal');
    const record = records[0];
    window.term.write(record.id, ${JSON.stringify(stage === 'first' ? "$belorRestartProof='BELOR_RESTART_SAME_PROCESS'; Write-Output $belorRestartProof\r" : 'Write-Output $belorRestartProof\r')});
    await new Promise(resolve => setTimeout(resolve, 1800));
    const tab = window.__st.tabs.get(record.id);
    const buffer = tab.term.buffer.active;
    const text = Array.from({length:buffer.length}, (_,i)=>buffer.getLine(i)?.translateToString()).join('\\n');
    if (!text.includes('BELOR_RESTART_SAME_PROCESS')) throw Error('Saved shell state or transcript missing');
    return {proof:'APP_RESTART_PASS', id:record.id, pid:record.pid};
  })()`;
  const env = { ...process.env, ST_USERDATA: profile, ST_BIN_DIR: path.join(output, 'bin'),
    ST_SELFTEST: path.join(output, `${stage}.png`), ST_SELFTEST_WAIT: '8500', ST_SELFTEST_EXTRA: extra };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), ['.'], { cwd: root, env, windowsHide: true, stdio: ['ignore', fd, fd] });
      const timer = setTimeout(() => { child.kill(); reject(Error('Electron restart test timed out')); }, 30000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve(code); });
    });
    const log = fs.readFileSync(logFile, 'utf8');
    assert.equal(code, 0, log);
    const result = log.match(/\[selftest extra\] (\{[^\n]+\})/);
    assert(result, log);
    return JSON.parse(result[1]);
  } finally { fs.closeSync(fd); }
}
(async () => {
  try {
    const before = await launch('first'), after = await launch('second');
    assert.equal(after.id, before.id); assert.equal(after.pid, before.pid);
    console.log('APP_RESTART_PASS: same tab, same PowerShell PID, saved output and shell variable. Evidence:', output);
  } finally {
    const file = path.join(profile, 'terminal-host.json');
    if (fs.existsSync(file)) { try { process.kill(JSON.parse(fs.readFileSync(file)).pid); } catch {} }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
