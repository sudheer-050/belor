// Closing the window keeps its renderer and terminal processes alive. Only Quit exits.
function setupBackground({ app, win, Tray, Menu, icon, confirmQuit, saveBounds }) {
  let quitting = false;
  const show = (notify = true) => {
    if (win.isDestroyed()) return;
    win.setSkipTaskbar(false);
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    if (notify !== false) win.webContents.send('win:shown');
  };
  const tray = new Tray(icon);
  tray.setToolTip('Belor — terminals keep running in the background');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Belor', click: show },
    { type: 'separator' },
    { label: 'Quit Belor', click: () => { show(false); app.quit(); } },
  ]));
  tray.on('click', show);
  tray.on('double-click', show);
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { tray.destroy(); });
  win.on('close', event => {
    saveBounds();
    if (!quitting) {
      event.preventDefault();
      win.hide(); win.setSkipTaskbar(true);
    } else if (!confirmQuit()) {
      quitting = false;
      event.preventDefault();
    }
  });
  return { tray, show };
}
module.exports = { setupBackground };
