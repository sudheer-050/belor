// Turns a demo recording (frames + sound events) into assets/demo.mp4 (with sound) and assets/demo.gif. Needs ffmpeg on PATH.
//   node tools/make-demo-assets.js <frames folder> <events.json> <output folder>
// events.json is {"events":[{"t":ms,"kind":"success|fail|attention"}], "t0":ms} as printed by tools/demo-session.js.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [framesDir, eventsFile, outDir] = process.argv.slice(2);
if (!framesDir || !eventsFile || !outDir) { console.error('usage: node tools/make-demo-assets.js <frames> <events.json> <out>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const frames = JSON.parse(fs.readFileSync(path.join(framesDir, 'frames.json'), 'utf8'));
const { events, t0 } = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));
const origin = Math.max(frames[0].t, 0);

// 1. frame list with real durations, so the video plays at the speed it was recorded
let list = '';
frames.forEach((f, i) => {
  const dur = i + 1 < frames.length ? (frames[i + 1].t - f.t) / 1000 : 0.12;
  list += `file '${path.join(framesDir, f.file).replace(/\\/g, '/')}'\nduration ${Math.max(0.02, dur).toFixed(3)}\n`;
});
list += `file '${path.join(framesDir, frames[frames.length - 1].file).replace(/\\/g, '/')}'\n`;
fs.writeFileSync(path.join(outDir, 'frames.txt'), list);
const total = (frames[frames.length - 1].t - origin) / 1000 + 0.3;

// 2. the soundtrack: the same tones the app plays (src/renderer/sounds.js), placed where the events happened
const RATE = 44100, VOL = 0.5;
const pcm = new Float32Array(Math.ceil(total * RATE) + RATE);
const osc = (type, f, p) => (type === 'sine' ? Math.sin(2 * Math.PI * f * p) : type === 'square' ? (Math.sin(2 * Math.PI * f * p) >= 0 ? 1 : -1) : (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * p)));
function tone(at, freq, start, dur, type, gain) {
  const s0 = Math.floor((at + start) * RATE), n = Math.floor((dur + 0.02) * RATE);
  for (let i = 0; i < n && s0 + i < pcm.length; i++) {
    const t = i / RATE;
    const env = t < 0.012 ? Math.pow(0.0001 / (VOL * gain), 1 - t / 0.012) * 0 + (t / 0.012) : Math.pow(0.0001 / 1, (t - 0.012) / Math.max(0.001, dur - 0.012)); // fast attack, exponential decay
    pcm[s0 + i] += osc(type, freq, t) * VOL * gain * 0.6 * Math.min(1, env);
  }
}
const sounds = {
  success: (a) => { tone(a, 784, 0, 0.14, 'sine', 1); tone(a, 1175, 0.09, 0.22, 'sine', 0.9); },
  fail: (a) => { tone(a, 196, 0, 0.16, 'square', 0.45); tone(a, 147, 0.13, 0.26, 'square', 0.45); },
  attention: (a) => { tone(a, 659, 0, 0.18, 'triangle', 0.9); tone(a, 659, 0.24, 0.26, 'triangle', 0.75); },
};
let used = 0;
for (const e of events) {
  const at = (e.t - origin) / 1000;
  if (at < 0.3 || at > total || !sounds[e.kind]) continue;     // ignore the setup noise before the recording started
  sounds[e.kind](at); used++;
}
const wav = Buffer.alloc(44 + pcm.length * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
pcm.forEach((v, i) => wav.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767, 44 + i * 2));
fs.writeFileSync(path.join(outDir, 'soundtrack.wav'), wav);

// 3. encode
const ff = (args) => { const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' }); if (r.status !== 0) throw new Error('ffmpeg failed'); };
const mp4 = path.join(outDir, 'demo.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', path.join(outDir, 'frames.txt'), '-i', path.join(outDir, 'soundtrack.wav'),
  '-vf', 'fps=12,scale=1280:720:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '21',
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-t', total.toFixed(2), mp4]);
const gif = path.join(outDir, 'demo.gif');
ff(['-i', mp4, '-an', '-vf', 'fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', '-loop', '0', gif]);
fs.rmSync(path.join(outDir, 'frames.txt')); fs.rmSync(path.join(outDir, 'soundtrack.wav'));
const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(2) + ' MB';
console.log(`demo.mp4 ${mb(mp4)}  demo.gif ${mb(gif)}  length ${total.toFixed(1)} s  sounds placed: ${used}`);
