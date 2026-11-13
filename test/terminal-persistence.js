// Exercise the actual host protocol with deterministic PTYs. No existing app is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
fs.mkdirSync(path.join(__dirname, '../dist'), { recursive: true });
const directory = fs.mkdtempSync(path.join(__dirname, '../dist/persistence-check-'));
const source = fs.readFileSync(path.join(__dirname, '../src/terminal-host.js'), 'utf8');
const pause = () => new Promise(resolve => setImmediate(resolve));

async function host(installed = true) {
  const servers = [], ptys = [], app = new EventEmitter();
  const paths = { home: directory };
  Object.assign(app, { setPath: (key, value) => { paths[key] = value; }, getPath: key => paths[key],
    disableHardwareAcceleration() {}, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    exit: code => { throw Error(`Host unexpectedly exited: ${code}`); } });
  const dependencies = {
    electron: { app },
    'node:net': { createServer: callback => { const server = new EventEmitter(); server.callback = callback; server.listen = (_name, ready) => ready?.(); servers.push(server); return server; } },
    'node:child_process': { execFile: (_file, _args, _options, callback) => callback(Error('Not elevated')) },
    './shells': { SHELL_DIR: directory, ADMIN_KINDS: new Set(), detectShells: () => [{ id: 'powershell', file: 'fake-shell', args: [] }] },
    './resume-tools': { detect: () => installed ? [{ id: 'codex' }] : [], launch: (_tool, sessionId) => ['resume', sessionId] },
    './window-conversation': {
      outputTitle: require('../src/window-conversation').outputTitle,
      resolve: title => title === 'Recovered conversation | user' ? { toolId: 'codex', sessionId: '87654321-1234-1234-1234-123456789abc' } : null,
    },
    'node-pty': { spawn: (_file, args, options) => {
      const p = new EventEmitter(); p.pid = ptys.length + 100; p.args = args; p.env = options.env; p.writes = []; p.variables = { memory: 'same process' };
      p.onData = cb => p.on('data', cb); p.onExit = cb => p.on('exit', cb);
      p.write = value => p.writes.push(value); p.resize = () => {};
      p.kill = () => { p.killed = true; p.emit('exit', { exitCode: 0 }); };
      ptys.push(p); return p;
    } },
  };
  const localRequire = name => name in dependencies ? dependencies[name] : name.startsWith('.') ? require('../src/' + name.slice(2)) : require(name);
  const proc = { ...process, argv: ['electron', '.', '--terminal-profile', directory], env: { ...process.env, ST_BIN_DIR: path.join(directory, 'bin') } };
  fs.mkdirSync(proc.env.ST_BIN_DIR, { recursive: true });
  // The host installs this script; stub its source in the isolated shell directory.
  fs.writeFileSync(path.join(directory, 'st-notify.ps1'), '# test');
  vm.runInNewContext(`(function(require, process) { ${source}\n})`, { console, Buffer, setTimeout, clearTimeout })(localRequire, proc);
  for (let n = 0; n < 30 && servers.length < 2; n++) await pause();
  assert.equal(servers.length, 2);
  const address = JSON.parse(fs.readFileSync(path.join(directory, 'terminal-host.json'), 'utf8'));
  assert.match(address.pipe, /^\\\\\.\\pipe\\belor-host-/);
  function client(token = address.token) {
    const socket = new EventEmitter(); socket.writable = true; socket.destroyed = false; socket.messages = [];
    socket.setEncoding = () => {};
    socket.write = text => { for (const line of text.trim().split('\n')) socket.messages.push(JSON.parse(line)); return true; };
    socket.destroy = () => { socket.destroyed = true; socket.emit('close'); };
    socket.receive = msg => socket.emit('data', JSON.stringify(msg) + '\n');
    socket.request = async (t, data = {}) => {
      const request = Math.random(); socket.receive({ ...data, t, request });
      for (let n = 0; n < 500; n++) {
        const reply = socket.messages.find(msg => msg.request === request);
        if (reply) { if (reply.error) throw Error(reply.error); return reply.result; }
        await new Promise(resolve => setTimeout(resolve, 2));
      }
      throw Error('Test request timed out: ' + t);
    };
    servers[1].callback(socket); socket.receive({ t: 'hello', token }); return socket;
  }
  function notify(message) {
    const socket = new EventEmitter(); socket.setEncoding = () => {}; socket.destroy = () => {};
    servers[0].callback(socket);
    socket.emit('data', JSON.stringify(message) + '\n');
  }
  return { client, ptys, app, notify };
}
(async () => {
  const h = await host();
  const intruder = h.client('wrong token'); assert.equal(intruder.destroyed, true);
  const first = h.client();
  const id = await first.request('create', { shellId: 'powershell', cols: 100, rows: 30, cwd: directory, autoSessionKey: 'codex:saved' });
  const secondId = await first.request('create', { shellId: 'powershell', cols: 80, rows: 24 });
  await assert.rejects(first.request('create', { shellId: 'powershell', admin: true }), /administrator mode/);
  assert.equal((await first.request('list')).length, 2, 'Failed create must preserve other sessions');
  const p = h.ptys[0]; p.emit('data', 'before desktop quit\r\n');
  await first.request('metadata', { tabs: [{ id, userTitle: 'My work', active: true, agent: 'codex', order: 0, gridOrder: 1 }] });
  await first.request('attach', { id });
  assert(first.messages.some(msg => msg.data === 'before desktop quit\r\n'));
  first.destroy();
  h.app.emit('window-all-closed');
  assert.equal(p.killed, undefined, 'Desktop exit must not kill its terminal');
  p.emit('data', 'output while closed\r\n');
  const reopened = h.client();
  const list = await reopened.request('list');
  assert.equal(list.length, 2); assert.equal(list[0].userTitle, 'My work'); assert.equal(list[0].agent, 'codex');
  assert.equal(list[0].pid, p.pid); assert.equal(p.variables.memory, 'same process');
  assert.equal(list[0].gridOrder, 1);
  await reopened.request('attach', { id });
  const text = reopened.messages.filter(msg => msg.t === 'data').map(msg => msg.data).join('');
  assert.equal(text, 'before desktop quit\r\noutput while closed\r\n', 'Replay must be complete and unduplicated');
  await reopened.request('write', { id, data: 'continue\r' }); assert.deepEqual(p.writes, ['continue\r']);
  const popout = h.client(); await popout.request('attach', { id });
  await reopened.request('detach', { id });
  const before = reopened.messages.length;
  p.emit('data', 'popout output\r\n');
  assert.equal(reopened.messages.length, before, 'Detached desktop must not receive duplicate output');
  assert.equal(popout.messages.at(-1).data, 'popout output\r\n');
  await popout.request('metadata', { preserveOrder: true, tabs: [{ id, userTitle: 'Popup work', order: 99, gridOrder: 0 }] });
  assert.equal((await popout.request('list'))[0].order, 0);
  assert.equal((await popout.request('list'))[0].gridOrder, 1);
  popout.destroy();
  assert.equal(p.killed, undefined, 'Closing the popout must leave the session running');
  await reopened.request('attach', { id });
  assert(reopened.messages.some(msg => msg.data?.includes('popout output')));
  h.ptys[1].emit('exit', { exitCode: 0 });
  assert.equal((await reopened.request('list')).find(tab => tab.id === secondId).exited, true, 'Natural exit must retain history');
  await reopened.request('close', { id });
  assert.equal(p.killed, true); assert.equal(fs.existsSync(path.join(directory, 'terminals', `${id}.log`)), false);
  assert.equal((await reopened.request('list')).length, 1, 'Closing one tab must preserve siblings');
  assert.deepEqual(await reopened.request('dismissed'), ['codex:saved']);
  reopened.destroy();
  const recovery = await host(); const client = recovery.client();
  const saved = await client.request('list');
  assert.equal(saved.length, 1); assert.equal(saved[0].exited, true); assert.equal(recovery.ptys.length, 0, 'Recovery must not silently rerun commands');
  assert.deepEqual(await client.request('dismissed'), ['codex:saved']);
  await client.request('close', { id: secondId }); assert.deepEqual(await client.request('list'), []);
  const sessionId = '12345678-1234-1234-1234-123456789abc';
  const conversation = await client.request('create', { shellId: 'powershell', cols: 100, rows: 30 });
  recovery.notify({ token: 'invalid', tab: conversation, event: 'done', tool: 'codex', sessionId });
  assert.equal((await client.request('list'))[0].resumeSession, '', 'An unauthenticated hook must not change the saved conversation');
  recovery.notify({ token: recovery.ptys[0].env.BELOR_TOKEN, tab: conversation, event: 'done', tool: 'codex', sessionId });
  await client.request('conversation', { id: conversation, resumeTool: 'codex', resumeSession: 'invalid' });
  assert.equal((await client.request('list'))[0].resumeSession, sessionId, 'Remember only validated conversation identities');
  recovery.ptys[0].emit('data', 'saved conversation before update\r\n');
  await client.request('metadata', { tabs: [{ id: conversation, userTitle: 'My conversation', active: true, order: 0 }] });
  client.destroy();
  fs.writeFileSync(path.join(directory, 'terminals', 'tabs.json'), '{interrupted update');
  const updated = await host(); const afterUpdate = updated.client();
  const resumed = await afterUpdate.request('list');
  assert.equal(resumed.length, 1); assert.equal(resumed[0].id, conversation);
  assert.equal(resumed[0].userTitle, 'My conversation'); assert.equal(resumed[0].exited, false);
  assert.deepEqual(updated.ptys[0].args, ['resume', sessionId], 'An update must resume the exact conversation');
  await afterUpdate.request('attach', { id: conversation });
  assert.equal(afterUpdate.messages.filter(msg => msg.t === 'data').map(msg => msg.data).join(''), 'saved conversation before update\r\n');
  afterUpdate.destroy();
  const missingTool = await host(false); const history = missingTool.client();
  assert.equal((await history.request('list'))[0].exited, true, 'Missing application must retain its tab and history');
  assert.equal(fs.readFileSync(path.join(directory, 'terminals', `${conversation}.log`), 'utf8'), 'saved conversation before update\r\n');
  history.destroy();
  const retry = await host(); const retried = retry.client();
  assert.equal((await retried.request('list'))[0].exited, false, 'Previously ended saved conversations must reopen directly');
  assert.deepEqual(retry.ptys[0].args, ['resume', sessionId], 'Retry must bypass the session picker and resume the exact conversation');
  await retried.request('close', { id: conversation });
  const picker = await retried.request('create', { shellId: 'powershell', resumeTool: 'codex', cols: 100, rows: 30 });
  retry.ptys[1].emit('data', '\x1b]2;\u280f Recovered conversation');
  retry.ptys[1].emit('data', ' | user\x07');
  assert.equal((await retried.request('list'))[0].resumeSession, '87654321-1234-1234-1234-123456789abc', 'A split Codex terminal title must identify the selected conversation without process access');
  retried.destroy();
  // Simulate an older version that saved the title transcript but no session ID.
  const oldTabs = JSON.parse(fs.readFileSync(path.join(directory, 'terminals', 'tabs.json')));
  delete oldTabs[0].resumeSession;
  fs.writeFileSync(path.join(directory, 'terminals', 'tabs.json'), JSON.stringify(oldTabs));
  const legacy = await host(); const legacyClient = legacy.client();
  assert.equal((await legacyClient.request('list'))[0].id, picker);
  assert.deepEqual(legacy.ptys[0].args, ['resume', '87654321-1234-1234-1234-123456789abc'], 'An older Codex tab must resume directly from its uniquely matched saved title');
  legacyClient.destroy();
  console.log('TERMINAL_PERSISTENCE_PASS: authentication, desktop exit, same PID and state, offline output, exact replay, continued input, natural exit, explicit close, siblings, disk recovery, permanent dismissal.');
})().catch(error => { console.error(error); process.exitCode = 1; });
