const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SHELL_DIR } = require('./shells');

const TOOLS = {
  codex: { id: 'codex', label: 'Codex', args: ['resume', '--all'] },
  claude: { id: 'claude', label: 'Claude Code', args: ['--resume'] },
};

function detect() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const folders = [...(process.env.PATH || '').split(path.delimiter), path.join(home, '.local', 'bin'),
    path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin'), path.join(roaming, 'npm')];
  return Object.values(TOOLS).flatMap(tool => {
    for (const folder of folders.filter(Boolean)) {
      for (const ext of ['.exe', '.cmd', '.ps1']) {
        const file = path.join(folder.replace(/^"|"$/g, ''), tool.id + ext);
        try { if (fs.statSync(file).isFile()) return [{ ...tool, file }]; } catch { /* not installed here */ }
      }
    }
    return [];
  });
}

function launch(tool, sessionId) {
  if (!tool || !Object.hasOwn(TOOLS, tool.id) || typeof tool.file !== 'string') throw new Error('Choose an installed application to resume.');
  if (sessionId !== undefined && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('Invalid saved session ID.');
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  const args = sessionId ? (tool.id === 'codex' ? ['resume', sessionId] : ['--resume', sessionId]) : TOOLS[tool.id].args;
  // Fixed arguments only. The renderer chooses a tool ID, never a command or executable path.
  const command = `. ${quote(path.join(SHELL_DIR, 'pwsh-init.ps1'))}; & ${quote(tool.file)} ${args.map(quote).join(' ')}; `
    + `$__belorResumeStatus = if ($?) { 0 } else { 1 }; [Console]::Write(([string][char]27) + ']133;D;' + $__belorResumeStatus + [char]7)`;
  return ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')];
}

module.exports = { detect, launch };
