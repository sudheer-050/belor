// Synthesized sounds (no audio files). Success = rising two-note chime, failure = low double buzz.
(function () {
  let ctx = null;
  const state = { enabled: true, volume: 0.35 };
  try {
    const saved = JSON.parse(localStorage.getItem('st-sound') || '{}');
    if (typeof saved.enabled === 'boolean') state.enabled = saved.enabled;
    if (typeof saved.volume === 'number') state.volume = Math.min(1, Math.max(0, saved.volume));
  } catch { /* storage unavailable */ }

  function save() { try { localStorage.setItem('st-sound', JSON.stringify(state)); } catch { /* ignore */ } }
  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, type, gainMul) {
    const c = audio();
    const t0 = c.currentTime + start;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, state.volume * gainMul), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const play = {
    success() { tone(784, 0, 0.14, 'sine', 1); tone(1175, 0.09, 0.22, 'sine', 0.9); },
    fail() { tone(196, 0, 0.16, 'square', 0.45); tone(147, 0.13, 0.26, 'square', 0.45); },
    // "I have a question for you": two soft identical pings, clearly different from success and failure
    attention() { tone(659, 0, 0.18, 'triangle', 0.9); tone(659, 0.24, 0.26, 'triangle', 0.75); },
  };

  window.sounds = {
    get enabled() { return state.enabled; },
    set enabled(v) { state.enabled = !!v; save(); },
    get volume() { return state.volume; },
    set volume(v) { state.volume = Math.min(1, Math.max(0, +v || 0)); save(); },
    success() { if (state.enabled && state.volume > 0) play.success(); },
    fail() { if (state.enabled && state.volume > 0) play.fail(); },
    attention() { if (state.enabled && state.volume > 0) play.attention(); },
    previewAttention() { if (state.volume > 0) play.attention(); },
    // Previews ignore the on/off switch so the volume can be checked.
    previewSuccess() { if (state.volume > 0) play.success(); },
    previewFail() { if (state.volume > 0) play.fail(); },
  };
})();
