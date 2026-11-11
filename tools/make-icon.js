// Renders build/icon.png (512x512) from an inline SVG. Run with: npx electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b9dff"/><stop offset="1" stop-color="#7c4dff"/></linearGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#g)"/>
  <rect x="16" y="16" width="480" height="240" rx="112" fill="url(#s)"/>
  <path d="M150 190l92 78-92 78" fill="none" stroke="#fff" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M276 350h96" stroke="#fff" stroke-width="40" stroke-linecap="round"/>
  <path d="M340 170a64 64 0 010 92M386 134a120 120 0 010 164" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="30" stroke-linecap="round"/>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 512, height: 512, useContentSize: true, transparent: true, frame: false,
    webPreferences: { offscreen: false, backgroundThrottling: false } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<style>html,body{margin:0;background:transparent;overflow:hidden}</style>${svg}`));
  await new Promise((r) => setTimeout(r, 400));
  let img = await win.webContents.capturePage();
  const { width } = img.getSize();
  if (width !== 512) img = img.resize({ width: 512, height: 512, quality: 'best' });
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), img.toPNG());
  console.log('icon written', img.getSize());
  app.quit();
});
