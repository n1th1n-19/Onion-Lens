// Injected on demand. Shows a magnifier over a screenshot of the visible tab and
// reports the chosen pixel. Uses the screenshot (not the EyeDropper API) so it
// behaves the same in Chrome, Edge, Firefox and Safari.
(() => {
  if (window.__onionPick) return;
  const api = globalThis.browser ?? globalThis.chrome;
  const C = globalThis.Color;
  const SIZE = 150;
  let active = false;

  const STYLE = `
    :host { all: initial; }
    .ov { position: fixed; inset: 0; cursor: crosshair; }
    .loupe { position: fixed; left: 0; top: 0; pointer-events: none; display: grid; gap: 6px; justify-items: center; will-change: transform; }
    canvas { width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%; border: 3px solid #1e1f22;
             box-shadow: 0 0 0 1px #d29bf5, 0 8px 24px rgba(0,0,0,.45); image-rendering: pixelated; }
    .label { display: flex; align-items: center; gap: 6px; background: #1e1f22; color: #dcdde0; border: 1px solid #3d3f45;
             border-radius: 6px; padding: 3px 8px; font: 12px/1.4 OnionMono, ui-monospace, monospace; white-space: nowrap; }
    .label i { width: 12px; height: 12px; border-radius: 3px; border: 1px solid #3d3f45; }
    .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: #1e1f22; color: #8b8e95;
            border: 1px solid #3d3f45; border-radius: 999px; padding: 5px 14px; font: 12px system-ui, sans-serif; pointer-events: none; display: flex; align-items: center; gap: 4px; white-space: pre; }
    .hint img { width: 14px; height: 14px; margin-right: 4px; }
    .hint b { color: #d29bf5; font-weight: 600; }
    .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; align-items: center;
             background: #d29bf5; color: #1e1f22; border-radius: 999px; padding: 7px 16px;
             font: 600 13px/1.3 OnionMono, ui-monospace, monospace; box-shadow: 0 8px 24px rgba(0,0,0,.35); pointer-events: none; }
    .toast i { width: 14px; height: 14px; border-radius: 4px; border: 1px solid rgba(0,0,0,.3); }
  `;

  function loadFont() {
    try {
      if ([...document.fonts].some(f => f.family === 'OnionMono')) return;
      const f = new FontFace('OnionMono', `url(${api.runtime.getURL('fonts/jetbrains-mono.woff2')})`);
      document.fonts.add(f);
      f.load().catch(() => {});
    } catch {}
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.documentElement.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }

  window.__onionPick = async dataUrl => {
    if (active) return;
    active = true;
    loadFont();
    // decode via Blob, not <img src=data:>, so strict page CSPs can't block it
    const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), ch => ch.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const W = bmp.width, H = bmp.height;
    const sc = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d', { willReadFrequently: true });
    sc.drawImage(bmp, 0, 0);
    const data = sc.getImageData(0, 0, W, H).data;
    const scale = W / innerWidth;
    const { settings = {} } = await api.storage.local.get('settings');
    const format = settings.format || 'hex', autoCopy = settings.autoCopy !== false, upper = !!settings.upper;
    const sample = +settings.sample || 1;

    const host = document.createElement('onion-lens-picker');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const mk = (tag, className = '', ...kids) => { const e = document.createElement(tag); e.className = className; e.append(...kids); return e; };
    const b = t => mk('b', '', t);
    const canvas = Object.assign(mk('canvas'), { width: SIZE * 2, height: SIZE * 2 });
    root.append(
      Object.assign(document.createElement('style'), { textContent: STYLE }),
      mk('div', 'ov'),
      mk('div', 'loupe', canvas, mk('div', 'label', mk('i'), mk('span'))),
      mk('div', 'hint', Object.assign(document.createElement('img'), { src: api.runtime.getURL('logo/logo.svg'), alt: '', onerror() { this.remove(); } }), b('Click'), ' pick · ', b('Shift+click'), ' pick more · ', b('Arrows'), ' nudge · ', b('Wheel'), ' zoom · ', b('Esc'), ' exit'));
    document.documentElement.append(host);
    const ov = root.querySelector('.ov'), loupe = root.querySelector('.loupe');
    const lc = root.querySelector('canvas').getContext('2d');
    const swatch = root.querySelector('.label i'), text = root.querySelector('.label span');

    let x = innerWidth / 2, y = innerHeight / 2, cells = 15;

    const at = (px, py) => {
      if (px < 0 || py < 0 || px >= W || py >= H) return null;
      const i = (py * W + px) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // average a sample×sample block around the pointer pixel
    function pixel() {
      const px = Math.floor(x * scale), py = Math.floor(y * scale), h = (sample - 1) / 2;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -h; dy <= h; dy++) for (let dx = -h; dx <= h; dx++) {
        const p = at(px + dx, py + dy);
        if (p) { r += p[0]; g += p[1]; b += p[2]; n++; }
      }
      return n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: 1 } : { r: 0, g: 0, b: 0, a: 1 };
    }

    function draw() {
      const px = Math.floor(x * scale), py = Math.floor(y * scale), half = (cells - 1) / 2, cell = (SIZE * 2) / cells;
      for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
        const p = at(px - half + i, py - half + j);
        lc.fillStyle = p ? `rgb(${p[0]},${p[1]},${p[2]})` : '#1e1f22';
        lc.fillRect(i * cell, j * cell, Math.ceil(cell), Math.ceil(cell));
      }
      if (cell >= 10) {
        lc.strokeStyle = 'rgba(128,128,128,.25)'; lc.lineWidth = 1; lc.beginPath();
        for (let k = 1; k < cells; k++) { lc.moveTo(k * cell, 0); lc.lineTo(k * cell, SIZE * 2); lc.moveTo(0, k * cell); lc.lineTo(SIZE * 2, k * cell); }
        lc.stroke();
      }
      const s0 = (half - (sample - 1) / 2) * cell, sw = cell * sample;
      lc.lineWidth = 3; lc.strokeStyle = '#000'; lc.strokeRect(s0, s0, sw, sw);
      lc.lineWidth = 1.5; lc.strokeStyle = '#fff'; lc.strokeRect(s0, s0, sw, sw);
      const c = pixel(), hex = C.toHex(c);
      swatch.style.background = hex;
      text.textContent = `${upper ? hex.toUpperCase() : hex}  ${Math.round(x)},${Math.round(y)}`;
      const lw = SIZE + 40, lh = SIZE + 40;
      const lx = x + 24 + lw > innerWidth ? x - 24 - lw : x + 24;
      const ly = y + 24 + lh > innerHeight ? y - 24 - lh : y + 24;
      loupe.style.transform = `translate(${lx}px, ${ly}px)`;
    }

    let toastTimer;
    function toast(msg, hex) {
      root.querySelector('.toast')?.remove();
      const t = document.createElement('div');
      t.className = 'toast';
      t.append(Object.assign(document.createElement('i'), { style: `background:${hex}` }), msg);
      root.append(t);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.remove(), 1600);
    }

    async function pick(keep) {
      const c = pixel(), hex = C.toHex(c), value = C.formats(c, upper)[format];
      const copied = autoCopy && await copyText(value); // copy first, while the click still counts as a user gesture
      const { history = [] } = await api.storage.local.get('history');
      await api.storage.local.set({ current: hex, history: [hex, ...history.filter(h => h !== hex)].slice(0, 50) });
      toast(copied ? `Copied ${value}` : `Picked ${value}`, hex);
      if (!keep) stop();
    }

    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    function onKey(e) {
      if (moves[e.key]) {
        const step = (e.shiftKey ? 10 : 1) / scale; // one screenshot pixel per press
        x = Math.min(innerWidth - 1, Math.max(0, x + moves[e.key][0] * step));
        y = Math.min(innerHeight - 1, Math.max(0, y + moves[e.key][1] * step));
        draw();
      } else if (e.key === 'Enter') pick(e.shiftKey);
      else if (e.key === 'Escape') stop();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    const onMove = e => { x = e.clientX; y = e.clientY; draw(); };
    const onClick = e => { e.preventDefault(); e.stopPropagation(); pick(e.shiftKey); };
    const onWheel = e => { e.preventDefault(); cells = Math.min(41, Math.max(5, cells + (e.deltaY > 0 ? 2 : -2))); draw(); };
    const onMenu = e => { e.preventDefault(); stop(); };

    function stop() {
      removeEventListener('keydown', onKey, true);
      removeEventListener('resize', stop);
      ov.remove(); loupe.remove(); root.querySelector('.hint').remove();
      host.style.pointerEvents = 'none';
      setTimeout(() => host.remove(), 1700); // let the toast finish
      active = false;
    }

    ov.addEventListener('mousemove', onMove);
    ov.addEventListener('click', onClick);
    ov.addEventListener('wheel', onWheel, { passive: false });
    ov.addEventListener('contextmenu', onMenu);
    addEventListener('keydown', onKey, true);
    addEventListener('resize', stop); // screenshot no longer matches the layout
    draw();
  };
})();
