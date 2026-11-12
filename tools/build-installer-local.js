// Local packaging fallback for Windows environments that restrict Node's named stdio pipes.
// Only build-tool I/O changes; the installed app and its runtime permissions are unchanged.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const util = require('builder-util');

async function run(file, args = [], options = {}, input) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'belor-build-'));
  const out = path.join(dir, 'stdout'), err = path.join(dir, 'stderr'), stdin = path.join(dir, 'stdin');
  const handles = [];
  try {
    const outputFd = fs.openSync(out, 'w'); handles.push(outputFd);
    const errorFd = fs.openSync(err, 'w'); handles.push(errorFd);
    let inputFd = 'ignore';
    if (input !== undefined) { fs.writeFileSync(stdin, input); inputFd = fs.openSync(stdin, 'r'); handles.push(inputFd); }
    const code = await new Promise((resolve, reject) => {
      const child = spawn(file, args, { ...options, windowsHide: true, stdio: [inputFd, outputFd, errorFd] });
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Build tool timed out: ${path.basename(file)}`)); }, options.timeout || 240000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolve(code); });
    });
    const stdout = fs.readFileSync(out, 'utf8'), stderr = fs.readFileSync(err, 'utf8');
    if (code !== 0) throw new util.ExecError(file, code, stdout, stderr);
    return { stdout, stderr };
  } finally {
    for (const fd of handles) fs.closeSync(fd);
    for (const name of [out, err, stdin]) { try { fs.unlinkSync(name); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    fs.rmdirSync(dir);
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    const assert = require('node:assert/strict');
    const result = await run(process.execPath, ['-e', "process.stdout.write(require('fs').readFileSync(0));process.stderr.write('stderr proof')"], {}, 'input proof');
    assert.equal(result.stdout, 'input proof'); assert.equal(result.stderr, 'stderr proof');
    await assert.rejects(run(process.execPath, ['-e', 'process.exit(7)']), error => error.exitCode === 7);
    console.log('Installer build-tool I/O checks passed.');
    return;
  }
  util.exec = async (file, args, options) => (await run(file, args, options)).stdout;
  util.spawn = async (file, args, options) => (await run(file, args, options)).stdout;
  util.spawnAndWrite = async (file, args, data, options) => { await run(file, args, options, data); };
  util.spawnAndWriteWithOutput = (file, args, data, options) => run(file, args, options, data);
  const { build, Platform, Arch } = require('electron-builder');
  await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never', config: {
    electronDist: path.resolve(__dirname, '../node_modules/electron/dist'),
    directories: { output: 'dist/installer-update' },
    win: { signExecutable: false },
    nsis: { artifactName: 'Belor-Setup-${version}.${ext}' },
  } });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
