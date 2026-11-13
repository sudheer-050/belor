const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { SHELL_DIR } = require('./shells');
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TERMINAL = /^(WindowsTerminal|powershell|pwsh|cmd|conhost|OpenConsole|mintty|wezterm-gui|alacritty)\.exe$/i;

function toolFor(process) {
  const command = process.commandLine || '';
  if (/(?:^|\s)(?:app-server|exec-server|sandbox|mcp-server|exec)(?:\s|$)|--(?:output-format|input-format|chrome-native-host|chrome-mcp|print)\b/.test(command)) return null;
  if (/^codex\.exe$/i.test(process.name) || /^node\.exe$/i.test(process.name) && /[\\/]@openai[\\/]codex[\\/]/i.test(command)) return 'codex';
  if (/^claude\.exe$/i.test(process.name) || /^node\.exe$/i.test(process.name) && /[\\/]@anthropic-ai[\\/]claude-code[\\/]/i.test(command)) return 'claude';
  return null;
}

function metadata(file, tool, allowIde = false) {
  if (tool === 'claude' && file.endsWith('.json')) {
    const registryRoot = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'sessions');
    const relative = path.relative(registryRoot, file);
    if (path.isAbsolute(relative) || relative.startsWith('..') || !/^\d+\.json$/.test(relative)) return null;
    try {
      if (fs.statSync(file).size > 16384) return null;
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (record.pid !== Number(path.basename(file, '.json')) || !record.startedAt) return null;
      return { sessionId: record.sessionId, cwd: record.cwd, registeredAt: record.startedAt };
    } catch { return null; }
  }
  const root = tool === 'codex' ? path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions')
    : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !file.endsWith('.jsonl')) return null;
  const match = path.basename(file).match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i);
  if (!match) return null;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(256 * 1024);
    const text = buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).toString('utf8');
    for (const line of text.split('\n').slice(0, 50)) {
      let record;
      try { record = JSON.parse(line); } catch {
        // Codex session metadata can contain long instructions. Extract only fields before them.
        if (tool !== 'codex' || !/^\{"timestamp"[^\n]*"type"\s*:\s*"session_meta"/.test(line)) continue;
        const id = line.match(/"id"\s*:\s*"([0-9a-f-]+)"/i)?.[1];
        const cwd = line.match(/"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/)?.[1];
        if (id === match[1] && cwd && /"source"\s*:\s*"cli"/.test(line)) return { sessionId: id, cwd: JSON.parse(cwd) };
        continue;
      }
      if (tool === 'codex' && record.type === 'session_meta') {
        const value = record.payload;
        if (value?.id !== match[1] || value.source && value.source !== 'cli' && !(allowIde && value.source === 'vscode')) return null;
        return { sessionId: value.id, cwd: value.cwd };
      }
      if (tool === 'claude' && record.sessionId === match[1] && typeof record.cwd === 'string') return { sessionId: record.sessionId, cwd: record.cwd };
    }
  } catch { /* Process exited, file rotated, or not readable. Never guess another session. */ }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  return null;
}

function select(snapshot, excluded = [], readMetadata = metadata, ownedRoots = null) {
  const processes = snapshot.processes || [], byId = new Map(processes.map(p => [p.pid, p])), ignore = new Set(excluded);
  function family(p) {
    const result = [p], seen = new Set([p.pid]);
    while (p) {
      const parent = byId.get(p.parentPid);
      if (!parent || seen.has(parent.pid) || parent.started > p.started) break;
      seen.add(parent.pid); result.push(parent); p = parent;
    }
    return result;
  }
  const windows = processes.filter(p => p.visible && TERMINAL.test(p.name));
  const result = new Map();
  for (const process of processes) {
    const toolId = toolFor(process);
    if (!toolId) continue;
    const chain = family(process);
    const owner = ownedRoots && chain.find(p => ownedRoots.includes(p.pid));
    if (ownedRoots) { if (!owner) continue; }
    else {
      if (chain.some(p => ignore.has(p.pid) || /^belor\.exe$/i.test(p.name))) continue;
      if (!chain.some(p => windows.includes(p)) && !windows.some(w => /^(conhost|OpenConsole)\.exe$/i.test(w.name) && chain.some(p => p.pid === w.parentPid))) continue;
    }
    const owned = (snapshot.files || []).filter(file => file.pid === process.pid).map(file => readMetadata(file.file, toolId))
      .filter(meta => meta && UUID.test(meta.sessionId) && typeof meta.cwd === 'string' && path.isAbsolute(meta.cwd)
        && (!meta.registeredAt || Math.abs(new Date(meta.registeredAt).getTime() - new Date(process.started).getTime()) < 30000));
    const unique = new Map(owned.map(meta => [meta.sessionId, meta]));
    // An open rollout owned by this exact interactive process is evidence. File dates are not.
    if (unique.size !== 1) continue;
    const meta = [...unique.values()][0], key = `${toolId}:${meta.sessionId}`;
    if (!result.has(key)) result.set(key, { key, toolId, sessionId: meta.sessionId, cwd: meta.cwd, pid: process.pid, started: process.started, ...(owner ? { ownerPid: owner.pid } : {}) });
  }
  return [...result.values()];
}

function selectWindows(snapshot, excluded = []) {
  const byId = new Map((snapshot.processes || []).map(p => [p.pid, p])), ignore = new Set(excluded), windows = new Map();
  for (const window of snapshot.windows || []) {
    if (!TERMINAL.test(window.name) || !Number.isSafeInteger(window.window) || window.window <= 0 || !window.title) continue;
    let process = byId.get(window.pid), blocked = ignore.has(window.pid);
    const seen = new Set();
    while (process && !seen.has(process.pid)) {
      seen.add(process.pid);
      if (ignore.has(process.pid) || /^belor\.exe$/i.test(process.name)) { blocked = true; break; }
      const parent = byId.get(process.parentPid);
      if (!parent || parent.started > process.started) break;
      process = parent;
    }
    if (!blocked) windows.set(window.window, { ...window, key: `window:${window.pid}:${window.started}:${window.window}` });
  }
  return [...windows.values()];
}

function readSnapshot(args = []) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(SHELL_DIR, 'active-sessions.ps1'), ...args],
      { windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, output) => {
        if (error) return reject(new Error(args.length ? 'Could not switch to that terminal window. Use Alt+Tab to open it.' : 'Could not detect running sessions. Automatic reopening will retry.'));
        try {
          const snapshot = JSON.parse(output.replace(/^\uFEFF/, ''));
          if (args.length) { resolve(snapshot); return; }
          const registry = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'sessions');
          for (const process of snapshot.processes || []) {
            if (toolFor(process) === 'claude') snapshot.files.push({ pid: process.pid, file: path.join(registry, `${process.pid}.json`) });
          }
          resolve(snapshot);
        } catch { reject(new Error('Windows returned an unreadable running-session list.')); }
      });
  });
}
async function focusWindow(window) {
  const success = await readSnapshot(['-FocusWindow', String(window.window), '-WindowPid', String(window.pid), '-WindowStarted', window.started]);
  if (!success) throw new Error('Windows could not switch to that terminal. Use Alt+Tab to open it.');
  return true;
}
module.exports = { scan: async excluded => select(await readSnapshot(), excluded), readSnapshot, select, selectWindows, focusWindow, metadata, toolFor };
