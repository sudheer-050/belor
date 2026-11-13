const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/renderer/app.js'), 'utf8');
function load(saved) {
  const context = {
    info: { shells: [{ id: 'powershell' }] },
    themeOf: () => ({ bg: '#000000', fg: '#ffffff', cursor: '#ffffff', selection: '#ffffff', accent: '#ffffff' }),
    presetById: () => ({}), normHex: value => value,
    clone: value => JSON.parse(JSON.stringify(value)),
    localStorage: { getItem: () => JSON.stringify(saved) },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function defaults()'), source.indexOf('  const settings = loadSettings();')), context);
  return context.loadSettings();
}
assert.equal(load({}).startup.restore, true);
const tabs = Array.from({ length: 3 }, () => ({ shellId: 'powershell', cwd: 'C:/Users/test' }));
const migrated = load({ v: 2, startup: { restore: false, session: tabs, active: 2 } });
assert.equal(migrated.startup.restore, true, 'Upgrade must enable the previously disabled default');
assert.equal(migrated.startup.session.length, 3);
assert.equal(migrated.startup.active, 2);
assert.equal(migrated.startup.persistenceVersion, 1);
assert.equal(load({ v: 2, startup: { restore: false, persistenceVersion: 1 } }).startup.restore, false, 'A later deliberate opt-out must be respected');
console.log('STARTUP_RESTORE_PASS: new profile, upgrade migration, all saved tabs and selection, subsequent opt-out.');
