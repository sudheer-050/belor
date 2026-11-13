const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolve, outputTitle } = require('../src/window-conversation');
const { metadata } = require('../src/active-sessions');
const savedHome = process.env.CODEX_HOME;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'belor-conversation-'));
const id = '11111111-1111-1111-1111-111111111111';
const secondId = '22222222-2222-2222-2222-222222222222';
const sessions = path.join(root, 'sessions');
const file = path.join(sessions, `rollout-${id}.jsonl`);
const index = path.join(root, 'session_index.jsonl');
try {
 process.env.CODEX_HOME = root;
 fs.mkdirSync(sessions);
 fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id, cwd: root, source: 'vscode' } }) + '\n');
 fs.writeFileSync(index, JSON.stringify({ id, thread_name: 'My conversation' }) + '\n');
 assert.equal(resolve('My conversation | user').sessionId, id);
 assert.equal(resolve('\u280f My conversation | user').sessionId, id);
 assert.equal(outputTitle('\x1b]0;Old title\x07\x1b]2;\u280b My conversation | user\x1b\\'), 'My conversation | user');
 assert.equal(outputTitle('My conversation | user'), null, 'Ordinary printed text is not evidence of terminal title');
 assert.equal(resolve('My conversation').cwd, root);
 assert.equal(metadata(file, 'codex'), null); // Do not broaden automatic process detection.
 assert.equal(resolve('My conversation extra'), null);
 assert.equal(resolve('PowerShell'), null);
 fs.appendFileSync(index, JSON.stringify({ id: secondId, thread_name: 'My conversation' }) + '\n');
 assert.equal(resolve('My conversation'), null); // Ambiguous titles never choose a session.
 fs.appendFileSync(index, JSON.stringify({ id: secondId, thread_name: 'Other conversation' }) + '\n');
 assert.equal(resolve('My conversation').sessionId, id); // Latest title per UUID wins.
 fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id, cwd: root, source: { subagent: 'review' } } }) + '\n');
 assert.equal(resolve('My conversation'), null);
 console.log('Exact title, IDE session, ambiguity, renaming, and subagent checks passed.');
} finally {
 if (savedHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = savedHome;
 for (const f of [file, index]) if (fs.existsSync(f)) fs.unlinkSync(f);
 fs.rmdirSync(sessions); fs.rmdirSync(root);
}
