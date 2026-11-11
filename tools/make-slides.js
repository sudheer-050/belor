// Renders the 16:9 hero image and the screenshot slides used on the website and in the README.
//   npx electron tools/make-slides.js          (needs ffmpeg on PATH for the two frames taken from assets/demo.mp4)
// Writes assets/hero-16x9.png and assets/slides/01..05.png (all 1600x900).
const { app, BrowserWindow } = require('electron');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const out = path.join(root, 'assets');
const slidesDir = path.join(out, 'slides');
fs.mkdirSync(slidesDir, { recursive: true });

// two frames from the demo video: the "waiting for you" moment and the finished build
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'belor-slides-'));
const frame = (sec, name) => {
  const f = path.join(tmp, name);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(sec), '-i', path.join(out, 'demo.mp4'), '-frames:v', '1', f]);
  if (r.status !== 0) throw new Error('ffmpeg could not extract a frame (is ffmpeg on PATH?)');
  return pathToFileURL(f).href;
};
const askFrame = frame(31, 'ask.png');

const shot = (rel) => pathToFileURL(path.join(root, rel)).href;
const slides = [
  { k: 'TAB STATES', t: 'Every tab shows its state', s: 'A spinner while it runs. A tick when it completes. A cross when it fails. A question mark when it needs you.', img: shot('docs/screenshots/hero-dark.png'), side: 'R' },
  { k: 'AI ASSISTANTS', t: 'Follows Claude Code and Codex', s: 'Runs show up like any command: running, done, failed, or waiting for your answer.', img: askFrame, side: 'L' },
  { k: 'ALERTS', t: 'Sounds, popups, taskbar flash', s: 'Know the moment a run finishes, fails or asks a question, even from another app.', img: shot('docs/screenshots/alerts.png'), side: 'R' },
  { k: 'CUSTOMIZE', t: 'Make it yours', s: '11 themes, gradients, images, any font and transparency. Every change is live.', img: shot('docs/screenshots/customize.png'), side: 'L' },
  { k: 'LIGHT OR DARK', t: 'Your colors, your call', s: 'Follow Windows, or pick every color yourself, down to the tab marks.', img: shot('docs/screenshots/hero-light.png'), side: 'R' },
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1600, height: 900, useContentSize: true, enableLargerThanScreen: true, webPreferences: { backgroundThrottling: false, zoomFactor: 1 } });
  win.setContentSize(1600, 900);
  const grab = async (file) => {
    await new Promise((r) => setTimeout(r, 1100));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(file, img.resize({ width: 1600, height: 900, quality: 'best' }).toPNG());
    console.log('wrote', path.relative(root, file));
  };

  // the 16:9 hero: the same artwork as the banner, on a taller canvas
  await win.loadFile(path.join(__dirname, 'banner.html'));
  await win.webContents.insertCSS('html,body{height:900px!important}.copy,.shot,.chip,.foot{margin-top:50px}');
  await grab(path.join(out, 'hero-16x9.png'));

  for (let i = 0; i < slides.length; i++) {
    const hash = encodeURIComponent(JSON.stringify({ ...slides[i], i: i + 1, n: slides.length }));
    await win.loadFile(path.join(__dirname, 'slide.html'), { query: { n: String(i) }, hash });   // a new query forces a real reload
    await grab(path.join(slidesDir, `${String(i + 1).padStart(2, '0')}.png`));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(0);
});
