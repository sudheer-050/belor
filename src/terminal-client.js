// The desktop is a client of a detached, per-profile terminal host.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { send, lineReader } = require('./jsonlines');

class TerminalClient extends EventEmitter {
  constructor(profile, executable, appPath) {
    super();
    Object.assign(this, { profile, executable, appPath, pending: new Map(), seq: 0 });
  }
  async connect() {
    let launched = false, lastError;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const address = JSON.parse(fs.readFileSync(path.join(this.profile, 'terminal-host.json'), 'utf8'));
        await this.open(address);
        return;
      } catch (error) { lastError = error; }
      if (!launched) {
        launched = true;
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(this.executable, [this.appPath, '--terminal-host', '--terminal-profile', this.profile], {
          detached: true, windowsHide: true, stdio: 'ignore', env,
        });
        child.on('error', error => { lastError = error; });
        child.unref();
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`Could not reconnect to the terminal host: ${lastError?.message}`);
  }
  open(address) {
    return new Promise((resolve, reject) => {
      const socket = net.connect(address.pipe);
      const timer = setTimeout(() => { socket.destroy(); reject(Error('Terminal host handshake timed out.')); }, 2000);
      let ready = false;
      socket.on('connect', () => send(socket, { t: 'hello', token: address.token }));
      lineReader(socket, msg => {
        if (msg.t === 'ready') {
          ready = true; clearTimeout(timer); this.socket = socket; resolve(); return;
        }
        if (msg.request) {
          const pending = this.pending.get(msg.request);
          if (!pending) return;
          this.pending.delete(msg.request);
          clearTimeout(pending.timer);
          if (msg.error) pending.reject(Error(msg.error)); else pending.resolve(msg.result);
        } else this.emit('message', msg);
      });
      socket.on('error', error => { if (!ready) { clearTimeout(timer); reject(error); } });
      socket.on('close', () => {
        clearTimeout(timer);
        if (!ready) reject(Error('Terminal host rejected the connection.'));
        if (this.socket !== socket) return;
        this.socket = null;
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('Terminal host disconnected. Your saved terminal history remains on disk.')); }
        this.pending.clear();
        this.emit('message', { t: 'disconnected' });
      });
    });
  }
  request(t, data = {}) {
    if (!this.socket || this.socket.destroyed) return Promise.reject(Error('Terminal host is disconnected. Reopen Belor to reconnect.'));
    const request = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(request); reject(Error('Terminal host request timed out.')); }, t === 'create' ? 75000 : 120000);
      this.pending.set(request, { resolve, reject, timer });
      send(this.socket, { ...data, t, request });
    });
  }
  send(t, data) { send(this.socket, { ...data, t }); }
  disconnect() { this.socket?.end(); }
}
module.exports = { TerminalClient };
