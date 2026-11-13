const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const source = fs.readFileSync(require.resolve('../src/main'), 'utf8');
const handlers = new Map(), events = new Map(), calls = [], windows = [];
const records = [{ id: 7, shellId: 'powershell', userTitle: 'Same terminal', pid: 1234 }];
class Client extends EventEmitter {
  async connect() { this.connected = true; }
  async request(type) { assert.equal(type, 'list'); return records; }
  send(type, data) { calls.push({ type, data }); }
  disconnect() { this.disconnected = true; }
}
class Window extends EventEmitter {
  constructor(options) {
    super(); this.options = options; this.messages = []; windows.push(this);
    this.webContents = new EventEmitter();
    this.webContents.send = (...msg) => this.messages.push(msg);
    this.webContents.setWindowOpenHandler = () => {};
  }
  isDestroyed() { return false; }
  setMenuBarVisibility() {}
  async loadFile() { this.loaded = true; }
  show() { this.shown = true; }
  focus() { this.focused = true; }
  close() { this.emit('closed'); }
}
const app = new EventEmitter();
Object.assign(app, { getPath: () => 'C:\\test', getAppPath: () => 'C:\\app' });
const main = new Window({}); windows.length = 0;
const context = { app, win: main, terminals: new Client(), TerminalClient: Client, BrowserWindow: Window,
  ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => events.set(name, fn) },
  path, __dirname: path.resolve(__dirname, '../src'), ICON: 'icon', THEMES: { dark: { color: '#000000' } },
  process, console, background: { show: value => calls.push({ show: value }) } };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const popouts ='), source.indexOf('// One-time:')), context);
vm.runInContext(source.slice(source.indexOf("ipcMain.handle('pty:list'"), source.indexOf('// Links in the terminal')), context);
const pause = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  await handlers.get('pty:popout')({ sender: main.webContents }, 7);
  assert.equal(windows.length, 1); const popup = windows[0];
  assert.equal(popup.loaded, true); assert.equal(popup.options.webPreferences.sandbox, true);
  assert.equal((await handlers.get('pty:list')({ sender: main.webContents })).length, 0);
  assert.equal((await handlers.get('pty:list')({ sender: popup.webContents }))[0].pid, 1234);
  assert(calls.some(call => call.type === 'detach' && call.data.id === 7));
  await handlers.get('pty:popout')({ sender: main.webContents }, 7);
  assert.equal(windows.length, 1, 'Repeated popout must reuse its window'); assert(popup.focused);
  events.get('pty:return')({ sender: popup.webContents }); await pause();
  assert.equal(main.messages.at(-1)[0], 'pty:returned'); assert.equal(main.messages.at(-1)[1].pid, 1234);
  assert.equal(calls.at(-1).show, false, 'Return must not trigger default-shell creation');
  assert.equal((await handlers.get('pty:list')({ sender: main.webContents })).length, 1);
  await assert.rejects(handlers.get('pty:popout')({ sender: main.webContents }, 999), /already closed/);
  await handlers.get('pty:popout')({ sender: main.webContents }, 7);
  const count = main.messages.length;
  app.emit('before-quit'); windows[1].close(); await pause();
  assert.equal(main.messages.length, count, 'Application quit must not reopen windows');
  assert(!calls.some(call => call.type === 'close' || call.type === 'create'), 'Popout/return must never kill or duplicate a terminal');
  console.log('POPOUT_PASS: isolated connection, same session, duplicate prevention, secure window, return, primary visibility, missing tab, application quit.');
})().catch(error => { console.error(error); process.exitCode = 1; });
