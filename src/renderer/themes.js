// Built-in themes, gradients, fonts and small color helpers.
(function () {
  // ansi order: black red green yellow blue magenta cyan white, then the 8 bright versions.
  const P = (id, name, bg, fg, cursor, selection, accent, ansi) => ({ id, name, bg, fg, cursor, selection, accent, ansi });

  const THEME_PRESETS = [
    P('midnight', 'Midnight', '#0f1115', '#e8eaed', '#8ab4f8', '#2d4263', '#8ab4f8',
      ['#1e2127', '#f28b82', '#81c995', '#fdd663', '#8ab4f8', '#c58af9', '#78d9ec', '#e8eaed', '#5f6368', '#f6aea9', '#a8dab5', '#fde293', '#aecbfa', '#d7aefb', '#a1e8f5', '#ffffff']),
    P('daylight', 'Daylight', '#ffffff', '#202124', '#1a73e8', '#c6dafc', '#1a73e8',
      ['#202124', '#c5221f', '#188038', '#a56300', '#1a73e8', '#9334e6', '#0b7a85', '#80868b', '#5f6368', '#d93025', '#1e8e3e', '#b06000', '#1967d2', '#a142f4', '#098591', '#3c4043']),
    P('dracula', 'Dracula', '#282a36', '#f8f8f2', '#f8f8f2', '#44475a', '#bd93f9',
      ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2', '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']),
    P('nord', 'Nord', '#2e3440', '#d8dee9', '#d8dee9', '#434c5e', '#88c0d0',
      ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0', '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']),
    P('solarized', 'Solarized Dark', '#002b36', '#93a1a1', '#93a1a1', '#073642', '#268bd2',
      ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5', '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']),
    P('gruvbox', 'Gruvbox', '#282828', '#ebdbb2', '#ebdbb2', '#504945', '#fabd2f',
      ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984', '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2']),
    P('onedark', 'One Dark', '#282c34', '#abb2bf', '#528bff', '#3e4451', '#61afef',
      ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf', '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff']),
    P('tokyo', 'Tokyo Night', '#1a1b26', '#c0caf5', '#c0caf5', '#33467c', '#7aa2f7',
      ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6', '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5']),
    P('monokai', 'Monokai', '#272822', '#f8f8f2', '#f8f8f0', '#49483e', '#a6e22e',
      ['#272822', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2', '#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5']),
    P('matrix', 'Matrix', '#000000', '#00ff66', '#00ff66', '#004d1f', '#00ff66',
      ['#001a0a', '#ff3b3b', '#00ff66', '#d7ff3b', '#2bd9ff', '#c45bff', '#00ffc8', '#b6ffcf', '#0a5c2a', '#ff6b6b', '#5bff94', '#eaff7a', '#7be8ff', '#da8bff', '#5bffe0', '#eafff2']),
    P('synthwave', 'Synthwave', '#241b2f', '#f0e7ff', '#ff7edb', '#463465', '#ff7edb',
      ['#2a2139', '#fe4450', '#72f1b8', '#fede5d', '#36f9f6', '#ff7edb', '#03edf9', '#f0e7ff', '#495495', '#fe4450', '#72f1b8', '#f97e72', '#36f9f6', '#ff7edb', '#03edf9', '#ffffff']),
  ];

  const GRADIENTS = [
    { name: 'Aurora', angle: 135, stops: ['#0f2027', '#203a43', '#2c5364'] },
    { name: 'Deep space', angle: 160, stops: ['#0f0c29', '#302b63', '#24243e'] },
    { name: 'Sunset', angle: 135, stops: ['#ff7e5f', '#feb47b'] },
    { name: 'Ember', angle: 135, stops: ['#42275a', '#734b6d'] },
    { name: 'Forest', angle: 150, stops: ['#0b3d2e', '#1a5d46', '#0b1f17'] },
    { name: 'Candy', angle: 135, stops: ['#a18cd1', '#fbc2eb'] },
    { name: 'Slate', angle: 180, stops: ['#232526', '#414345'] },
    { name: 'Ocean', angle: 135, stops: ['#2193b0', '#6dd5ed'] },
  ];

  const FONT_CHOICES = [
    'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Courier New', 'Lucida Console',
    'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Hack', 'IBM Plex Mono', 'Roboto Mono',
    'Ubuntu Mono', 'Inconsolata', 'SF Mono', 'Menlo', 'Monaco', 'Iosevka', 'Victor Mono', 'Space Mono',
  ];

  const ANSI_NAMES = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White',
    'Bright black', 'Bright red', 'Bright green', 'Bright yellow', 'Bright blue', 'Bright magenta', 'Bright cyan', 'Bright white'];

  const toRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const luminance = (hex) => {
    const [r, g, b] = toRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const isDark = (hex) => luminance(hex) < 0.4;
  const mix = (a, b, t) => { const x = toRgb(a), y = toRgb(b); return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); };
  const rgba = (hex, alpha) => { const [r, g, b] = toRgb(hex); return `rgba(${r},${g},${b},${alpha})`; };
  const normHex = (v) => {
    v = String(v).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(v)) v = [...v].map((c) => c + c).join('');
    return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : null;
  };

  // True when a font is installed: compare text width against fallbacks (document.fonts.check lies for unknown fonts).
  const fontInstalled = (() => {
    const c = document.createElement('canvas').getContext('2d');
    const sample = 'mmmmmmmmmmlliWW@#0Oo';
    const width = (font) => { c.font = `72px ${font}`; return c.measureText(sample).width; };
    const base = { mono: width('monospace'), serif: width('serif'), sans: width('sans-serif') };
    return (name) => {
      const n = `"${String(name).replace(/"/g, '')}"`;
      return width(`${n}, monospace`) !== base.mono || width(`${n}, serif`) !== base.serif || width(`${n}, sans-serif`) !== base.sans;
    };
  })();

  window.THEME_PRESETS = THEME_PRESETS;
  window.GRADIENTS = GRADIENTS;
  window.FONT_CHOICES = FONT_CHOICES;
  window.ANSI_NAMES = ANSI_NAMES;
  window.color = { toRgb, toHex, luminance, isDark, mix, rgba, normHex, fontInstalled };
})();
