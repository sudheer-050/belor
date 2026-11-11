// Sanity test for WSL / Git Bash integration: do they emit OSC 133;D markers?
const pty = require('node-pty');
const path = require('node:path');

const sys = process.env.SystemRoot || 'C:\\Windows';
const which = process.argv[2] || 'wsl';
const spec = which === 'wsl'
  ? { file: path.join(sys, 'System32', 'wsl.exe'), args: ['-e', 'bash', '-c', 'export PROMPT_COMMAND=\'printf "\\033]133;D;%s\\007" $?\'; exec bash -i'], env: {} }
  : { file: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'], env: { PROMPT_COMMAND: 'printf "\\033]133;D;%s\\007" $?' } };

const p = pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols: 100, rows: 30, useConpty: true, env: { ...process.env, ...spec.env } });
let out = '';
p.onData((d) => { out += d; });
setTimeout(() => p.write('true\r'), 4000);       // expect 0
setTimeout(() => p.write('false\r'), 5000);      // expect 1
setTimeout(() => p.write('nonexistent_cmd_xyz\r'), 6000); // expect 127
setTimeout(() => {
  const m = [...out.matchAll(/\x1b\]133;D;(\d+)\x07/g)].map((x) => x[1]);
  console.log(which, 'MARKERS:', JSON.stringify(m), '(expected to contain "0","1","127")');
  p.kill();
  process.exit(0);
}, 8000);
