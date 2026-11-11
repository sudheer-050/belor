// Sanity test: does the PowerShell integration emit OSC 133;D markers with the right exit status?
const pty = require('node-pty');
const path = require('node:path');

const sys = process.env.SystemRoot || 'C:\\Windows';
const p = pty.spawn(
  path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'shell', 'pwsh-init.ps1')],
  { name: 'xterm-256color', cols: 100, rows: 30, useConpty: true },
);
let out = '';
p.onData((d) => { out += d; });
setTimeout(() => p.write('Get-Date\r'), 2500);             // expect 0
setTimeout(() => p.write('nonexistent-cmd-xyz\r'), 4000);   // expect 1
setTimeout(() => p.write('cmd /c exit 3\r'), 5200);         // expect 1
setTimeout(() => p.write('\r'), 6200);                      // empty Enter: no marker
setTimeout(() => {
  const m = [...out.matchAll(/\x1b\]133;D;(\d+)\x07/g)].map((x) => x[1]);
  console.log('MARKERS:', JSON.stringify(m), '(expected ["0","1","1"])');
  p.kill();
  process.exit(0);
}, 7500);
