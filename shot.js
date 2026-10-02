// Injected on demand. Page-side half of screenshots (area/element selection,
// scroll stepping, fixed-element hiding, countdown, clipboard) plus the element
// color inspector and "find color on page".
(() => {
  if (window.__onion) return;
  const api = globalThis.browser ?? globalThis.chrome;
  const C = globalThis.Color;
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const BASE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: #1e1f22; color: #8b8e95;
            border: 1px solid #3d3f45; border-radius: 999px; padding: 5px 14px; font: 12px system-ui, sans-serif;
            pointer-events: none; white-space: nowrap; z-index: 3; }
    .hint b { color: #d29bf5; font-weight: 600; }
    .tag { position: fixed; background: #d29bf5; color: #1e1f22; border-radius: 4px; padding: 2px 7px;
           font: 600 11px/1.4 OnionMono, ui-monospace, monospace; pointer-events: none; white-space: nowrap; }
    .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #d29bf5; color: #1e1f22;
             border-radius: 999px; padding: 7px 16px; font: 600 13px/1.3 system-ui, sans-serif;
             box-shadow: 0 8px 24px rgba(0,0,0,.35); pointer-events: none; }
  `;

  function loadFont() {
    try {
      if ([...document.fonts].some(f => f.family === 'OnionMono')) return;
      const f = new FontFace('OnionMono', `url(${api.runtime.getURL('fonts/jetbrains-mono.woff2')})`);
      document.fonts.add(f);
      f.load().catch(() => {});
    } catch {}
  }

  // DOM helpers (built node by node for AMO review). hint() turns "<b>x</b> y" into nodes.
  const div = (className, props = {}) => Object.assign(document.createElement('div'), { className }, props);
  const hint = text => {
    const d = div('hint');
    text.split(/<b>(.*?)<\/b>/).forEach((part, i) => d.append(i % 2 ? Object.assign(document.createElement('b'), { textContent: part }) : part));
    return d;
  };

  // Full-viewport shadow-DOM layer.
  function layer(css, nodes, interactive) {
    loadFont();
    const host = document.createElement('onion-lens-layer');
    host.style.cssText = `all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:${interactive ? 'auto' : 'none'};`;
    const root = host.attachShadow({ mode: 'closed' });
    root.append(Object.assign(document.createElement('style'), { textContent: BASE + css }), ...nodes);
    document.documentElement.append(host);
    return { host, root, $: s => root.querySelector(s) };
  }

  const describe = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return s;
  };
  const docRect = el => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };

  // ---------- scroll stepping for stitched captures ----------
  let saved = null;
  const hidden = [];

  function metrics() {
    const de = document.documentElement, se = document.scrollingElement || de;
    const cw = Math.min(de.clientWidth || innerWidth, innerWidth), ch = Math.min(de.clientHeight || innerHeight, innerHeight);
    return { sx: scrollX, sy: scrollY, cw, ch, vw: innerWidth, dw: Math.max(se.scrollWidth, cw), dh: Math.max(se.scrollHeight, ch) };
  }

  function hideFixed() {
    for (const el of document.querySelectorAll('body *')) {
      const p = getComputedStyle(el).position;
      if (p === 'fixed' || p === 'sticky') {
        hidden.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  }

  async function scrollTo(x, y, hide) {
    if (!saved) {
      saved = { x: scrollX, y: scrollY, behavior: document.documentElement.style.scrollBehavior };
      document.documentElement.style.scrollBehavior = 'auto';
    }
    if (hide && !hidden.length) hideFixed();
    window.scrollTo(x, y);
    await nextFrame();
    await sleep(120); // let lazy images / scroll-linked effects settle
    return metrics();
  }

  function restore() {
    for (const [el, v, p] of hidden.splice(0)) v ? el.style.setProperty('visibility', v, p) : el.style.removeProperty('visibility');
    if (saved) {
      window.scrollTo(saved.x, saved.y);
      document.documentElement.style.scrollBehavior = saved.behavior;
      saved = null;
    }
  }

  // ---------- selection ----------
  const send = (rect, opts) => api.runtime.sendMessage({ type: 'region', rect, opts });

  function selectArea(opts) {
    const L = layer(`
      .ov { position: fixed; inset: 0; cursor: crosshair; background: rgba(15,15,18,.45); }
      .ov.dragging { background: none; }
      .sel { position: fixed; display: none; box-shadow: 0 0 0 100vmax rgba(15,15,18,.45); outline: 1.5px solid #d29bf5; }
    `, [div('ov'), div('sel'), div('tag', { hidden: true }), hint('<b>Drag</b> to select (scrolls at edges) · <b>Esc</b> cancel')], true);
    const ov = L.$('.ov'), sel = L.$('.sel'), tag = L.$('.tag');
    let start = null, client = null, raf = 0;

    const rect = () => {
      const ex = client.x + scrollX, ey = client.y + scrollY;
      return { x: Math.min(start.x, ex), y: Math.min(start.y, ey), w: Math.abs(ex - start.x), h: Math.abs(ey - start.y) };
    };
    function draw() {
      const r = rect();
      Object.assign(sel.style, { display: 'block', left: r.x - scrollX + 'px', top: r.y - scrollY + 'px', width: r.w + 'px', height: r.h + 'px' });
      tag.hidden = false;
      tag.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
      tag.style.left = Math.max(4, r.x - scrollX) + 'px';
      tag.style.top = Math.max(4, r.y - scrollY - 24) + 'px';
    }
    // auto-scroll while the pointer is near a viewport edge
    function edgeScroll() {
      const E = 40, dx = client.x < E ? -20 : client.x > innerWidth - E ? 20 : 0, dy = client.y < E ? -20 : client.y > innerHeight - E ? 20 : 0;
      if (dx || dy) { window.scrollBy(dx, dy); draw(); }
      raf = requestAnimationFrame(edgeScroll);
    }
    const down = e => {
      if (e.button) return;
      start = { x: e.clientX + scrollX, y: e.clientY + scrollY };
      client = { x: e.clientX, y: e.clientY };
      ov.classList.add('dragging');
      draw();
      raf = requestAnimationFrame(edgeScroll);
    };
    const move = e => { if (start) { client = { x: e.clientX, y: e.clientY }; draw(); } };
    const up = async () => {
      if (!start) return;
      cancelAnimationFrame(raf);
      const r = rect();
      start = null;
      if (r.w < 4 || r.h < 4) { ov.classList.remove('dragging'); sel.style.display = 'none'; tag.hidden = true; return; }
      done();
      await nextFrame();
      send(r, opts);
    };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(); } };
    function done() {
      cancelAnimationFrame(raf);
      removeEventListener('keydown', key, true);
      removeEventListener('mousemove', move, true);
      removeEventListener('mouseup', up, true);
      removeEventListener('scroll', onScroll);
      L.host.remove();
    }
    const onScroll = () => { if (start) draw(); };
    ov.addEventListener('mousedown', down);
    addEventListener('mousemove', move, true);
    addEventListener('mouseup', up, true);
    addEventListener('keydown', key, true);
    addEventListener('scroll', onScroll);
  }

  // Shared hover-highlight loop for element screenshots and the color inspector.
  function hoverElements({ css = '', hint: hintText, onHover, onPick }) {
    const L = layer(`.box { position: fixed; display: none; outline: 2px solid #d29bf5; background: rgba(210,155,245,.14); pointer-events: none; }${css}`,
      [div('box'), div('tag'), hint(hintText), div('panel', { hidden: true })], false);
    const box = L.$('.box'), tag = L.$('.tag');
    let chain = [], idx = 0, last = { x: innerWidth / 2, y: innerHeight / 2 };
    const current = () => chain[idx];

    function draw() {
      const el = current();
      if (!el) return;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      tag.textContent = `${describe(el)}  ${Math.round(r.width)} × ${Math.round(r.height)}`;
      tag.style.left = Math.min(Math.max(4, r.left), innerWidth - 220) + 'px';
      tag.style.top = (r.top > 28 ? r.top - 24 : Math.min(innerHeight - 24, r.bottom + 4)) + 'px';
      onHover?.(el, L, last);
    }
    function locate(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el || el === chain[0]) return;
      chain = [el]; idx = 0;
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) chain.push(p);
      draw();
    }
    const climb = d => { idx = Math.max(0, Math.min(chain.length - 1, idx + d)); draw(); };
    const block = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    const move = e => { last = { x: e.clientX, y: e.clientY }; locate(e.clientX, e.clientY); };
    const wheel = e => { block(e); climb(e.deltaY < 0 ? 1 : -1); };
    const click = e => { block(e); if (e.button === 0 && current()) onPick(current(), stop, e); };
    const key = e => {
      if (e.key === 'Escape') stop();
      else if (e.key === 'ArrowUp') climb(1);
      else if (e.key === 'ArrowDown') climb(-1);
      else if (e.key === 'Enter' && current()) onPick(current(), stop, e);
      else return;
      block(e);
    };
    const swallow = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick', 'contextmenu'];
    function stop() {
      removeEventListener('mousemove', move, true);
      removeEventListener('wheel', wheel, true);
      removeEventListener('click', click, true);
      removeEventListener('keydown', key, true);
      removeEventListener('scroll', draw, true);
      for (const t of swallow) removeEventListener(t, block, true);
      L.host.remove();
    }
    addEventListener('mousemove', move, true);
    addEventListener('wheel', wheel, { capture: true, passive: false });
    addEventListener('click', click, true);
    addEventListener('keydown', key, true);
    addEventListener('scroll', draw, true);
    for (const t of swallow) addEventListener(t, block, true);
    locate(last.x, last.y);
    return L;
  }

  function selectElement(opts) {
    hoverElements({
      hint: '<b>Click</b> capture · <b>Wheel / ↑↓</b> parent·child container · <b>PgUp/PgDn</b> scroll · <b>Esc</b> cancel',
      onPick: async (el, stop) => {
        const r = docRect(el);
        stop();
        await nextFrame();
        send(r, opts);
      },
    });
  }

  // ---------- color inspector ----------
  const visible = c => c && c.a > 0;
  // Composite background layers up the tree until an opaque one (white page base).
  function effectiveBg(el) {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = C.parse(getComputedStyle(n).backgroundColor);
      if (visible(c)) { layers.push(c); if (c.a >= 1) break; }
    }
    return layers.reduceRight((acc, c) => C.mix(acc, { ...c, a: 1 }, c.a), C.WHITE);
  }
  function colorsOf(el) {
    const cs = getComputedStyle(el), bg = effectiveBg(el), fg = C.parse(cs.color) || C.BLACK;
    const solidFg = C.mix(bg, { ...fg, a: 1 }, fg.a);
    const border = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' ? C.parse(cs.borderTopColor) : null;
    return { fg, bg, border: visible(border) ? border : null, ratio: C.contrast(solidFg, bg), font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily.split(',')[0].replace(/["']/g, '')}` };
  }

  function inspect() {
    const row = (label, c) => {
      const d = document.createElement('div');
      d.className = 'row';
      const sw = document.createElement('i');
      sw.style.background = C.toHex(c);
      d.append(sw, Object.assign(document.createElement('span'), { textContent: label }), Object.assign(document.createElement('code'), { textContent: C.toHex(c) }));
      return d;
    };
    hoverElements({
      css: `
        .panel { position: fixed; width: 230px; background: #1e1f22; color: #dcdde0; border: 1px solid #3d3f45; border-radius: 8px;
                 padding: 10px; font: 12px/1.5 system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.4); display: grid; gap: 6px; }
        .row { display: flex; align-items: center; gap: 8px; }
        .row i { width: 16px; height: 16px; border-radius: 4px; border: 1px solid #3d3f45; flex: none; }
        .row span { flex: 1; color: #8b8e95; }
        code { font: 12px OnionMono, ui-monospace, monospace; background: #2a2f24; color: #a9d18e; padding: 0 6px; border-radius: 4px; }
        .ratio { display: flex; justify-content: space-between; border-top: 1px solid #3d3f45; padding-top: 6px; }
        .ratio b { font-family: OnionMono, ui-monospace, monospace; }
        .ok { color: #9ccc65; } .no { color: #f28b82; }
        .font { color: #8b8e95; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
      hint: '<b>Click</b> save colors · <b>Wheel / ↑↓</b> parent·child · <b>Esc</b> exit',
      onHover(el, L, at) {
        const p = L.$('.panel'), k = colorsOf(el);
        const ratio = document.createElement('div');
        ratio.className = 'ratio';
        const grade = k.ratio >= 7 ? 'AAA' : k.ratio >= 4.5 ? 'AA' : k.ratio >= 3 ? 'AA large' : 'Fail';
        ratio.append(Object.assign(document.createElement('span'), { textContent: 'Contrast' }),
          Object.assign(document.createElement('b'), { textContent: `${k.ratio.toFixed(2)}:1 ${grade}`, className: k.ratio >= 4.5 ? 'ok' : 'no' }));
        p.replaceChildren(row('Text', k.fg), row('Background', k.bg), ...(k.border ? [row('Border', k.border)] : []), ratio,
          Object.assign(document.createElement('div'), { className: 'font', textContent: k.font }));
        p.hidden = false;
        p.style.left = (at.x + 250 > innerWidth ? at.x - 246 : at.x + 16) + 'px';
        p.style.top = (at.y + 170 > innerHeight ? at.y - 170 : at.y + 16) + 'px';
      },
      async onPick(el) {
        const k = colorsOf(el), fg = C.toHex(k.fg), bg = C.toHex(k.bg);
        const { history = [] } = await api.storage.local.get('history');
        const add = [fg, bg, ...(k.border ? [C.toHex(k.border)] : [])];
        await api.storage.local.set({ current: fg, bg, history: [...add, ...history.filter(h => !add.includes(h))].slice(0, 50) });
        toast(`Saved text ${fg} · background ${bg}`);
      },
    });
  }

  // ---------- find color on page ----------
  const FIND_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'outlineColor', 'fill', 'stroke'];
  let findStyle;
  function clearFind() {
    for (const el of document.querySelectorAll('[data-onion-find]')) el.removeAttribute('data-onion-find');
    findStyle?.remove();
    findStyle = null;
  }
  function find(hex) {
    clearFind();
    const target = C.toHex(C.parse(hex));
    let n = 0;
    for (const el of [...document.querySelectorAll('body, body *')].slice(0, 8000)) {
      const cs = getComputedStyle(el);
      if (FIND_PROPS.some(p => { const c = C.parse(cs[p]); return visible(c) && C.toHex(c) === target; })) {
        el.setAttribute('data-onion-find', '');
        n++;
      }
    }
    findStyle = document.createElement('style');
    findStyle.textContent = '[data-onion-find]{outline:2px dashed #d29bf5 !important;outline-offset:1px !important;}';
    document.documentElement.append(findStyle);
    document.querySelector('[data-onion-find]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return n;
  }

  // ---------- misc ----------
  async function countdown(seconds) {
    const L = layer(`.n { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 120px; height: 120px;
      border-radius: 50%; background: rgba(30,31,34,.85); border: 3px solid #e8875b; color: #e8875b;
      display: grid; place-items: center; font: 700 56px OnionMono, ui-monospace, monospace; }`, [div('n')], false);
    for (let s = seconds; s > 0; s--) { L.$('.n').textContent = s; await sleep(1000); }
    L.host.remove();
    await nextFrame();
  }

  let toastTimer, toastLayer;
  function toast(msg) {
    toastLayer?.host.remove();
    toastLayer = layer('', [div('toast')], false);
    toastLayer.$('.toast').textContent = msg;
    clearTimeout(toastTimer);
    const mine = toastLayer;
    toastTimer = setTimeout(() => mine.host.remove(), 2000);
  }

  async function copyImage(dataUrl) {
    try {
      const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), ch => ch.charCodeAt(0));
      window.focus();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
      return true;
    } catch { return false; }
  }

  function imageRect(src) {
    const img = [...document.images].find(i => i.currentSrc === src || i.src === src);
    return img ? docRect(img) : null;
  }

  window.__onion = {
    metrics, scrollTo, restore, countdown, toast, copyImage, imageRect, inspect, find, clearFind,
    select: opts => (opts.mode === 'element' ? selectElement : selectArea)(opts),
  };
})();
