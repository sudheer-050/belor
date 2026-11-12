const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/renderer/app.js'), 'utf8');
const start = source.indexOf('  function syncWindowEntries(windows) {');
const end = source.indexOf('  let syncingSessions', start);
const calls = [], errors = [], rows = [];
const context = {
 window: { term: { resumeTerminalWindow: async key => { calls.push(key); return { key: 'codex:conversation', toolId: 'codex', cwd: 'C:\\project' }; } } },
 tabs: new Map(), importedSessions: new Set(),
 openTab: async (shell, options) => { context.tabs.set(1, { id: 1, autoSessionKey: options.autoSessionKey }); return 1; },
 activate: id => { assert.equal(id, 1); },
 windowEntries: new Map(), dismissedWindows: new Set(), ICONS: { close: '' },
 toast: error => errors.push(error), cleanErr: error => error.message,
 tabsEl: { appendChild: row => { if (!rows.includes(row)) rows.push(row); } },
 document: { createElement: () => ({
   handlers: {}, titleNode: {}, setAttribute() {}, remove() {},
   addEventListener(type, handler) { this.handlers[type] = handler; },
   querySelector() { return this.titleNode; },
 }) },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
(async () => {
 context.syncWindowEntries([{ key: 'terminal-1', title: 'PowerShell' }]);
 const row = rows[0];
 row.handlers.click({ target: { closest: () => null } });
 await new Promise(resolve => setImmediate(resolve));
 for (const key of ['Enter', ' ']) {
   row.handlers.keydown({ target: row, key, preventDefault() {} });
   await new Promise(resolve => setImmediate(resolve));
 }
 assert.deepEqual(errors, []);
 assert.equal(context.tabs.size, 1);
 assert.equal(context.importedSessions.has('codex:conversation'), true);
 assert.deepEqual(calls, ['terminal-1', 'terminal-1', 'terminal-1']);
 row.handlers.click({ target: { closest: () => true } });
 assert.equal(context.dismissedWindows.has('terminal-1'), true);
 assert.equal(calls.length, 3);
 context.window.term.resumeTerminalWindow = async () => { throw Error('No unique saved conversation'); };
 context.dismissedWindows.clear();
 context.syncWindowEntries([{ key: 'unknown', title: 'PowerShell' }]);
 rows[1].handlers.click({ target: { closest: () => null } });
 await new Promise(resolve => setImmediate(resolve));
 assert.deepEqual(errors, ['No unique saved conversation']);
 assert.equal(context.tabs.size, 1);
 const resumedTab = context.tabs.get(1);
 context.syncWindowEntries([]); // The original terminal window has closed.
 assert.equal(context.windowEntries.size, 0);
 assert.equal(context.tabs.get(1), resumedTab);
 assert.equal(context.importedSessions.has('codex:conversation'), true);
 console.log('In-app conversation activation and survival after external window closure checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
