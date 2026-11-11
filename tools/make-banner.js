// Renders assets/banner.png (1600x800) and assets/social-preview.png (1280x640) from tools/banner.html.
// Run with: npx electron tools/make-banner.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1600, height: 800, useContentSize: true, enableLargerThanScreen: true, webPreferences: { backgroundThrottling: false, zoomFactor: 1 } });
  win.setContentSize(1600, 800);
  await win.loadFile(path.join(__dirname, 'banner.html'));
  await new Promise((r) => setTimeout(r, 900));                 // let fonts and images settle
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'banner.png'), img.resize({ width: 1600, height: 800, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(out, 'social-preview.png'), img.resize({ width: 1280, height: 640, quality: 'best' }).toPNG());
  console.log('banner written');
  app.quit();
});
