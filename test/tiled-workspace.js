// Runs the real Electron renderer and PowerShell PTYs with a throwaway profile.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'workspace-check');
fs.mkdirSync(output, { recursive: true });
const logPath = path.join(output, 'electron.log');
const log = fs.openSync(logPath, 'w');
const env = { ...process.env,
  ST_USERDATA: fs.mkdtempSync(path.join(output, 'profile-')),
  ST_BIN_DIR: path.join(output, 'bin'),
  ST_SELFTEST: path.join(output, 'six-panes.png'),
  ST_SELFTEST_WAIT: '24000', ST_WINDOW: process.env.ST_WINDOW || '1440x900',
  ST_SELFTEST_EXTRA: fs.readFileSync(path.join(__dirname, 'tiled-workspace.page.js'), 'utf8'),
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), ['.'], {
  cwd: root, env, windowsHide: true, stdio: ['ignore', log, log],
});
const timeout = setTimeout(() => { child.kill(); process.exitCode = 1; }, 45000);
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('close', code => {
  clearTimeout(timeout); fs.closeSync(log);
  const report = fs.readFileSync(logPath, 'utf8');
  console.log(report);
  assert.equal(code, 0, 'Electron failed');
  assert.match(report, /TILED_WORKSPACE_PASS/);
  assert.doesNotMatch(report, /\[selftest extra\] ERROR/);
  console.log('Screenshot:', env.ST_SELFTEST);
});
