const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { metadata } = require('./active-sessions');
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// A window title is not a process-transfer mechanism. Resolve only an exact,
// unique saved conversation name; never choose a session by modification time.
function resolve(title) {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const index = path.join(home, 'session_index.jsonl');
  try {
    if (typeof title !== 'string' || fs.statSync(index).size > 16 * 1024 * 1024) return null;
    const entries = new Map();
    for (const line of fs.readFileSync(index, 'utf8').split('\n')) {
      try {
        const entry = JSON.parse(line);
        if (UUID.test(entry.id) && typeof entry.thread_name === 'string') entries.set(entry.id, entry);
      } catch { /* Ignore a partial append; retry on the next click. */ }
    }
    const matches = [...entries.values()].filter(entry => entry.thread_name &&
      (title === entry.thread_name || title.startsWith(entry.thread_name + ' | ')));
    if (matches.length !== 1) return null;
    const sessionId = matches[0].id;
    const root = path.join(home, 'sessions');
    const files = fs.readdirSync(root, { recursive: true }).filter(file => file.endsWith(sessionId + '.jsonl'));
    if (files.length !== 1) return null;
    const meta = metadata(path.join(root, files[0]), 'codex', true);
    if (!meta || meta.sessionId !== sessionId || typeof meta.cwd !== 'string' || !path.isAbsolute(meta.cwd)) return null;
    return { key: `codex:${sessionId}`, toolId: 'codex', sessionId, cwd: meta.cwd };
  } catch { return null; }
}
module.exports = { resolve };
