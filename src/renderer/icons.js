// Inline SVG icons (16px grid, currentColor) so the app has no external assets.
(function () {
  const p = (d, extra = '') => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
  const ICONS = {
    logo: `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b9dff"/><stop offset="1" stop-color="#7c4dff"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#lg)"/><path d="M9 11l5 5-5 5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 22h6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`,
    plus: p('<path d="M8 3v10M3 8h10"/>'),
    chevron: p('<path d="M4 6l4 4 4-4"/>'),
    up: p('<path d="M4 10l4-4 4 4"/>'),
    close: p('<path d="M4 4l8 8M12 4l-8 8"/>'),
    sidebar: p('<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6 3v10"/>'),
    expand: p('<path d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4"/>'),
    grid: p('<rect x="2" y="2" width="4.5" height="4.5" rx="1"/><rect x="9.5" y="2" width="4.5" height="4.5" rx="1"/><rect x="2" y="9.5" width="4.5" height="4.5" rx="1"/><rect x="9.5" y="9.5" width="4.5" height="4.5" rx="1"/>'),
    popout: p('<path d="M9 2h5v5M14 2L7 9M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3"/>'),
    sound: p('<path d="M3 6.5v3h2.5L9 12V4L5.5 6.5H3z"/><path d="M11.2 6a3 3 0 010 4M12.8 4.4a5.3 5.3 0 010 7.2"/>'),
    mute: p('<path d="M3 6.5v3h2.5L9 12V4L5.5 6.5H3z"/><path d="M11.5 6.5l3 3M14.5 6.5l-3 3"/>'),
    shield: p('<path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4l5-2z"/>'),
    gear: p('<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1"/>'),
    check: p('<path d="M3.5 8.5l3 3 6-7"/>'),
    spinner: p('<circle cx="8" cy="8" r="6" opacity=".25"/><path d="M8 2a6 6 0 016 6"/>'),
    ask: p('<path d="M6 6.2a2.1 2.1 0 013.9.9c0 1.4-1.9 1.6-1.9 3"/><path d="M8 12.6h.01"/>'),
    cross: p('<path d="M4 4l8 8M12 4l-8 8"/>'),
  };
  window.ICONS = ICONS;
  window.fillIcons = (root = document) => {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      const name = el.getAttribute('data-icon');
      if (ICONS[name]) el.innerHTML = ICONS[name];
    });
  };
})();
