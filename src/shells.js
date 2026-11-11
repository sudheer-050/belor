// Shell definitions shared by the app and the elevated admin helper.
const path = require('node:path');
const fs = require('node:fs');

// When packaged, files that external programs must read live in app.asar.unpacked.
const unpacked = (p) => p.replace('app.asar', 'app.asar.unpacked');
const SHELL_DIR = unpacked(path.join(__dirname, '..', 'shell'));

function findOnPath(exe) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Hook that reports each command's exit status (OSC 133;D) and the working directory (OSC 9;9).
const BASH_HOOK = String.raw`printf "\033]133;D;%s\007\033]9;9;\"%s\"\007" $? "$PWD"`;

function detectShells() {
  const sys = process.env.SystemRoot || 'C:\\Windows';
  const initArgs = ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', path.join(SHELL_DIR, 'pwsh-init.ps1')];
  const shells = [
    {
      id: 'powershell', label: 'Windows PowerShell', kind: 'powershell',
      file: path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: initArgs,
    },
  ];
  const pwsh = findOnPath('pwsh.exe');
  if (pwsh) shells.push({ id: 'pwsh', label: 'PowerShell 7', kind: 'powershell', file: pwsh, args: initArgs });
  shells.push({ id: 'cmd', label: 'Command Prompt', kind: 'cmd', file: path.join(sys, 'System32', 'cmd.exe'), args: [] });
  const wsl = path.join(sys, 'System32', 'wsl.exe');
  if (fs.existsSync(wsl)) {
    shells.push({
      id: 'wsl', label: 'WSL (Linux)', kind: 'wsl', file: wsl,
      args: ['-e', 'bash', '-c', `export PROMPT_COMMAND='${BASH_HOOK}'; exec bash -i`],
    });
  }
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  if (fs.existsSync(gitBash)) {
    shells.push({ id: 'gitbash', label: 'Git Bash', kind: 'gitbash', file: gitBash, args: ['--login', '-i'], env: { PROMPT_COMMAND: BASH_HOOK } });
  }
  return shells;
}

// WSL runs inside a Linux VM and has no Windows administrator mode.
const ADMIN_KINDS = new Set(['powershell', 'cmd', 'gitbash']);

module.exports = { detectShells, ADMIN_KINDS, SHELL_DIR };
