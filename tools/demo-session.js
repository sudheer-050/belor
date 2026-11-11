// The scripted session that is recorded for the demo video (see tools/record-demo.md).
// It runs inside the app window, in self-test mode, and drives the real UI: it types into real shells,
// switches tabs, and opens Settings. Nothing is faked in the interface itself.
// The "claude" program used here is a stand-in that sends the same events Claude Code's hooks send; no AI is called.
(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const S = window.__st.settings;
  const T = (id) => window.__st.tabs.get(id);
  const events = [];                                              // what to play on the soundtrack, and when
  const seen = new Map();
  setInterval(() => {
    for (const el of document.querySelectorAll('.tab')) {
      const id = el.dataset.id, s = el.dataset.state, prev = seen.get(id);
      if (s === prev) continue;
      seen.set(id, s);
      if (s === 'ok' && prev !== undefined) events.push({ t: Date.now(), kind: 'success' });
      else if (s === 'fail') events.push({ t: Date.now(), kind: 'fail' });
      else if (s === 'ask') events.push({ t: Date.now(), kind: 'attention' });
    }
  }, 30);

  // ---- caption bubble shown in the video
  const cap = document.createElement('div');
  cap.style.cssText = 'position:fixed;left:50%;bottom:30px;transform:translateX(-50%) translateY(8px);z-index:99999;max-width:86%;text-align:center;padding:13px 26px;border-radius:16px;font:600 21px "Segoe UI Variable Display","Segoe UI",sans-serif;color:#fff;background:linear-gradient(135deg,rgba(78,140,255,.96),rgba(124,77,255,.96));box-shadow:0 12px 44px rgba(0,0,0,.5);opacity:0;transition:opacity .3s,transform .3s;pointer-events:none';
  document.body.appendChild(cap);
  const say = (text) => { cap.textContent = text; cap.style.opacity = 1; cap.style.transform = 'translateX(-50%)'; };
  const hush = () => { cap.style.opacity = 0; cap.style.transform = 'translateX(-50%) translateY(8px)'; };

  const type = async (id, text, d = 36) => {                    // the same input path as real typing
    for (const ch of text) { T(id).term.input(ch, true); await w(d + Math.random() * 26); }
  };
  const run = async (id, text) => { await type(id, text); await w(260); T(id).term.input('\r', true); };
  const waitFor = async (id, state, max = 20000) => { const t0 = Date.now(); while (T(id).tabEl.dataset.state !== state && Date.now() - t0 < max) await w(50); };
  const open = async (dir) => { S.startup.dir = dir; $('#new-btn').click(); await w(1900); return +[...document.querySelectorAll('.tab')].pop().dataset.id; };
  const focusTab = async (id) => { document.querySelector('.tab[data-id="' + id + '"]').click(); await w(500); };

  // ---- setup (not recorded): theme, four tabs in neutral demo folders, stand-in programs on the PATH
  $('#settings-btn').click(); await w(300);
  $('[data-theme-id=midnight]').click(); await w(300);
  $('#dlg-close').click(); await w(300);
  S.startup.dirMode = 'custom';
  const web = await open('C:\\belor-demo\\web-app');
  const api = await open('C:\\belor-demo\\api-server');
  const docs = await open('C:\\belor-demo\\docs-site');
  const infra = await open('C:\\belor-demo\\infra');
  $('.tab').querySelector('.tclose').click(); await w(500);       // close the home-folder tab that opened first
  const hook = '__HOOK__';
  for (const id of [web, api, docs, infra]) {
    T(id).term.input("$env:Path='C:\\belor-demo\\bin;'+$env:Path; $env:DEMO_NOTIFY='" + hook + "'; Clear-Host\r", true);
  }
  await w(2500);
  for (const id of [web, api, docs, infra]) window.__st.setState(T(id), 'empty');   // start from a clean slate
  await focusTab(web);
  await w(800);

  // ---- the recorded story
  window.term.recStart();
  const t0 = Date.now();
  say('One window for every shell and AI assistant'); await w(2600); hush(); await w(400);

  say('Run a build. A spinner shows while it runs');
  await run(web, 'npm run build');
  await waitFor(web, 'running', 4000); await w(2500); hush();
  await waitFor(web, 'ok', 12000);
  say('A green tick when it completes'); await w(2300); hush(); await w(300);

  await focusTab(api);
  say('A red cross when it fails'); await w(300);
  await run(api, 'pytest -q');
  await waitFor(api, 'fail', 12000); await w(2600); hush(); await w(300);

  await focusTab(docs);
  say('Long-running jobs stay visible at a glance');
  await run(docs, 'mkdocs serve');
  await waitFor(docs, 'running', 4000); await w(2800); hush(); await w(300);

  await focusTab(infra);
  say('Run Claude Code or Codex in any tab'); await w(400);
  await run(infra, 'claude');
  await w(1800); hush(); await w(300);
  say('It follows the AI run like any command'); await w(300);
  await type(infra, 'add rate limiting to the API'); await w(500);
  T(infra).term.input('\r', true);
  await waitFor(infra, 'running', 4000); await w(1800); hush();
  await waitFor(infra, 'ask', 25000);
  say('And tells you when it needs you'); await w(3200); hush(); await w(200);
  T(infra).term.input('\r', true);                               // approve
  await waitFor(infra, 'running', 4000); await w(1200);
  await waitFor(infra, 'ok', 25000);
  say('Done. A tick, a sound, and a popup if you are in another app'); await w(3400); hush(); await w(300);

  await focusTab(web);
  say('Make it yours'); await w(400);
  $('#settings-btn').click(); await w(700);
  $('[data-theme-id=dracula]').click(); await w(1100);
  $('[data-theme-id=tokyo]').click(); await w(900);
  $('[data-panel=background]').click(); await w(500);
  $('[data-type=gradient]').click(); await w(500);
  document.querySelectorAll('#grad-presets .chip')[3].click(); await w(900);
  hush(); await w(400);
  $('#dlg-close').click(); await w(1400);
  say('Belor: free and open source for Windows'); await w(3200); hush(); await w(500);
  window.term.recStop();
  return { events, t0, tEnd: Date.now() };
})()
