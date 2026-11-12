const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setupBackground } = require('../src/background');
const app = new EventEmitter(), win = new EventEmitter();
let visible = true, skipTaskbar = false, canQuit = false, confirmations = 0, saved = 0, tray;
const messages = [];
Object.assign(win, { isDestroyed:()=>false, isMinimized:()=>false, hide:()=>{visible=false;}, show:()=>{visible=true;}, focus:()=>{},
  setSkipTaskbar:value=>{skipTaskbar=value;}, webContents:{send:name=>messages.push(name)} });
class Tray extends EventEmitter {
  constructor(icon) { super(); assert.equal(icon,'icon'); tray=this; }
  setToolTip(value) { this.tooltip=value; }
  setContextMenu(menu) { this.menu=menu; }
  destroy() { this.destroyed=true; }
}
const close = () => {
  const event = { prevented:false, preventDefault(){this.prevented=true;} };
  win.emit('close',event); return event;
};
app.quit=()=>{ app.emit('before-quit'); if (!close().prevented) app.emit('will-quit'); };
setupBackground({app,win,Tray,Menu:{buildFromTemplate:items=>items},icon:'icon',confirmQuit:()=>{confirmations++;return canQuit;},saveBounds:()=>{saved++;}});
assert.equal(close().prevented,true);
assert.equal(visible,false); assert.equal(skipTaskbar,true); assert.equal(confirmations,0);
assert.equal(tray.destroyed,undefined,'closing must preserve the tray and the live window');
tray.emit('click'); assert.equal(visible,true); assert.equal(skipTaskbar,false); assert.deepEqual(messages,['win:shown']);
tray.menu.find(item=>item.label==='Quit Belor').click();
assert.equal(confirmations,1); assert.equal(tray.destroyed,undefined,'cancelled quit must keep the app alive');
assert.equal(messages.length,1,'quitting must not ask the renderer to start a fresh terminal');
assert.equal(close().prevented,true,'cancelled quit restores close-to-tray behavior');
canQuit=true; app.quit(); assert.equal(tray.destroyed,true);
assert(saved>=3);
console.log('Background close, tray restore, cancelled quit, and explicit quit checks passed.');
