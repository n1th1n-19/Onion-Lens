// Screenshot editor: annotations are kept as a list of ops replayed over the
// original image, so undo/redo never stores full-size bitmaps.
const api = globalThis.browser ?? globalThis.chrome;
const C = globalThis.Color;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

const view = $('#view'), vctx = view.getContext('2d');
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
let base = null, meta = {}, settings = {};
let ops = [], undone = [], tool = null, drag = null, zoom = 'fit';

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

// ---------- rendering ----------
const fullRect = () => ({ x: 0, y: 0, w: base.width, h: base.height });
const viewRect = () => ops.reduce((v, o) => (o.type === 'crop' ? o.rect : v), fullRect());
const norm = d => ({ x: Math.min(d.x1, d.x2), y: Math.min(d.y1, d.y2), w: Math.abs(d.x2 - d.x1), h: Math.abs(d.y2 - d.y1) });

function drawOp(ctx, o, preview) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = o.color;
  ctx.lineWidth = o.size;
  ctx.lineCap = ctx.lineJoin = 'round';
  const r = o.rect;
  switch (o.type) {
    case 'rect':
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      break;
    case 'arrow': {
      const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), head = Math.max(14, o.size * 3.5);
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1);
      ctx.lineTo(o.x2 - Math.cos(ang) * head * 0.6, o.y2 - Math.sin(ang) * head * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(o.x2, o.y2);
      ctx.lineTo(o.x2 - head * Math.cos(ang - 0.45), o.y2 - head * Math.sin(ang - 0.45));
      ctx.lineTo(o.x2 - head * Math.cos(ang + 0.45), o.y2 - head * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'pen':
    case 'mark':
      if (o.type === 'mark') { ctx.globalAlpha = 0.35; ctx.lineWidth = o.size * 3; ctx.lineCap = 'square'; }
      ctx.beginPath();
      o.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      break;
    case 'text':
      ctx.font = `600 ${o.size * 3 + 12}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, o.size / 2);
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.strokeText(o.text, o.x, o.y);
      ctx.fillText(o.text, o.x, o.y);
      break;
    case 'blur':
    case 'crop':
      if (preview) {
        ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.strokeStyle = '#d29bf5';
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        if (o.type === 'crop') { ctx.fillStyle = '#d29bf5'; ctx.font = '600 14px "JetBrains Mono", monospace'; ctx.fillText(`${Math.round(r.w)} × ${Math.round(r.h)}`, r.x + 6, r.y + 18); }
      } else if (o.type === 'blur' && r.w >= 1 && r.h >= 1) {
        // pixelate: shrink the region then scale it back up without smoothing
        const block = Math.max(8, o.size * 2), sw = Math.max(1, Math.round(r.w / block)), sh = Math.max(1, Math.round(r.h / block));
        const tmp = Object.assign(document.createElement('canvas'), { width: sw, height: sh });
        tmp.getContext('2d').drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
      }
      break;
  }
  ctx.restore();
}

function commit() {
  wctx.drawImage(base, 0, 0);
  for (const o of ops) drawOp(wctx, o, false);
  present();
  $('#undo').disabled = !ops.length;
  $('#redo').disabled = !undone.length;
}

function present(draft) {
  const v = viewRect();
  if (view.width !== v.w || view.height !== v.h) { view.width = v.w; view.height = v.h; applyZoom(); }
  vctx.drawImage(work, v.x, v.y, v.w, v.h, 0, 0, v.w, v.h);
  if (draft) { vctx.save(); vctx.translate(-v.x, -v.y); drawOp(vctx, draft, true); vctx.restore(); }
}

function applyZoom() {
  if (!base) return;
  const native = view.width / devicePixelRatio; // 100% = one screenshot pixel per device pixel
  const avail = $('#stage').clientWidth - 48;
  const w = zoom === 'fit' ? Math.min(native, avail) : view.width * +zoom / devicePixelRatio;
  view.style.width = Math.max(1, w) + 'px';
}

// ---------- loading ----------
function load(img, info = {}) {
  base = img;
  meta = info;
  work.width = img.width;
  work.height = img.height;
  ops = []; undone = [];
  view.width = 0; // force resize + zoom in present()
  $('#empty').hidden = true;
  $('#wrap').hidden = false;
  commit();
  renderInfo();
  renderPalette();
  if (!tool) setTool('crop');
}

async function loadFile(file) {
  if (!file?.type.startsWith('image/')) return toast('Not an image');
  load(await createImageBitmap(file), { title: file.name, time: Date.now() });
}

function renderInfo() {
  const v = viewRect(), rows = [['Size', `${Math.round(v.w)} × ${Math.round(v.h)} px`]];
  if (meta.title) rows.push(['Page', meta.title]);
  if (meta.url) rows.push(['URL', meta.url]);
  if (meta.time) rows.push(['Taken', new Date(meta.time).toLocaleString()]);
  $('#info').replaceChildren(...rows.flatMap(([k, val]) => [el('dt', { textContent: k }), el('dd', { textContent: val, title: val })]));
  if (meta.clipped) $('#info').append(el('dt', { textContent: 'Note' }), el('dd', { className: 'warn', textContent: 'Page was taller than the browser canvas limit — bottom is clipped.' }));
}

// ---------- palette ----------
let palette = [];
function renderPalette() {
  const v = viewRect(), scale = Math.min(1, 240 / Math.max(v.w, v.h));
  const small = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(v.w * scale)), height: Math.max(1, Math.round(v.h * scale)) });
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(view, 0, 0, small.width, small.height);
  palette = C.extractPalette(sctx.getImageData(0, 0, small.width, small.height).data, +$('#paletteSize').value);
  $('#palette').replaceChildren(...palette.map(c => {
    const h = C.toHex(c), b = el('button', { title: 'Use as ink + copy' }, el('i', { style: `background:${h}` }), el('code', { textContent: h }),
      el('span', { className: 'muted small', textContent: C.nearestName(c).name }));
    b.onclick = () => { $('#ink').value = h; copyText(h); };
    return b;
  }));
}

// ---------- tools ----------
function setTool(t) {
  tool = tool === t ? null : t;
  $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  $('#chip').hidden = true;
}

function toImage(e) {
  const r = view.getBoundingClientRect(), v = viewRect(), k = view.width / r.width;
  return [v.x + (e.clientX - r.left) * k, v.y + (e.clientY - r.top) * k];
}
const pixelAt = (x, y) => { const d = wctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: 1 }; };

function push(op) {
  ops.push(op);
  undone = [];
  commit();
  if (op.type === 'crop' || op.type === 'blur') { renderInfo(); renderPalette(); }
}

function placeText(e, x, y) {
  const r = $('#wrap').getBoundingClientRect();
  const input = el('input', { className: 'text-input', placeholder: 'Type, Enter to place' });
  Object.assign(input.style, { left: e.clientX - r.left + 'px', top: e.clientY - r.top + 'px', color: $('#ink').value });
  $('#wrap').append(input);
  setTimeout(() => input.focus());
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    if (ok && input.value.trim()) push({ type: 'text', text: input.value, x, y, color: $('#ink').value, size: +$('#size').value });
    input.remove();
  };
  input.addEventListener('keydown', ev => { if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); ev.stopPropagation(); });
  input.addEventListener('blur', () => finish(true));
}

async function savePicked(c) {
  const h = C.toHex(c);
  $('#ink').value = h;
  const { history = [] } = await api.storage.local.get('history');
  await api.storage.local.set({ current: h, history: [h, ...history.filter(x => x !== h)].slice(0, 50) });
  copyText(C.formats(c, !!settings.upper)[settings.format || 'hex']);
}

view.addEventListener('pointerdown', e => {
  if (!base || !tool || e.button) return;
  const [x, y] = toImage(e);
  if (tool === 'drop') return savePicked(pixelAt(x, y));
  if (tool === 'text') { e.preventDefault(); return placeText(e, x, y); }
  view.setPointerCapture(e.pointerId);
  drag = { type: tool, color: $('#ink').value, size: +$('#size').value, x1: x, y1: y, x2: x, y2: y, points: [[x, y]] };
});
view.addEventListener('pointermove', e => {
  if (!base) return;
  const [x, y] = toImage(e);
  if (tool === 'drop') {
    const h = C.toHex(pixelAt(x, y)), chip = $('#chip'), r = $('#wrap').getBoundingClientRect();
    chip.hidden = false;
    chip.replaceChildren(el('i', { style: `background:${h}` }), h);
    chip.style.left = e.clientX - r.left + 16 + 'px';
    chip.style.top = e.clientY - r.top + 16 + 'px';
  }
  if (!drag) return;
  Object.assign(drag, { x2: x, y2: y });
  if (drag.type === 'pen' || drag.type === 'mark') drag.points.push([x, y]);
  present({ ...drag, rect: norm(drag) });
});
view.addEventListener('pointerleave', () => { $('#chip').hidden = true; });
view.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag, r = norm(d);
  drag = null;
  if (d.type === 'pen' || d.type === 'mark') return push({ type: d.type, color: d.color, size: d.size, points: d.points });
  if (d.type === 'arrow') return Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 4 ? push({ ...d, points: undefined }) : present();
  if (r.w < 3 || r.h < 3) return present();
  if (d.type === 'crop') {
    const v = viewRect(); // keep the crop inside the current view
    const x = Math.max(v.x, r.x), y = Math.max(v.y, r.y);
    const rect = { x: Math.round(x), y: Math.round(y), w: Math.round(Math.min(v.x + v.w, r.x + r.w) - x), h: Math.round(Math.min(v.y + v.h, r.y + r.h) - y) };
    return rect.w > 2 && rect.h > 2 ? push({ type: 'crop', rect }) : present();
  }
  push({ type: d.type, color: d.color, size: d.size, rect: r });
});

function undo() { if (ops.length) { undone.push(ops.pop()); commit(); renderInfo(); renderPalette(); } }
function redo() { if (undone.length) { ops.push(undone.pop()); commit(); renderInfo(); renderPalette(); } }

// ---------- export ----------
function exportBlob(type = 'image/png', quality) {
  if (type === 'image/jpeg') {
    const c = Object.assign(document.createElement('canvas'), { width: view.width, height: view.height }), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(view, 0, 0);
    return new Promise(r => c.toBlob(r, type, quality));
  }
  return new Promise(r => view.toBlob(r, type));
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(`Copied ${text}`); } catch { toast('Clipboard blocked'); }
}

async function copyImage(quiet) {
  if (!base) return false;
  try {
    // pass the promise straight in: keeps the click's user activation in Safari
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportBlob() })]);
    toast('Screenshot copied to clipboard');
    $('#banner').hidden = true;
    return true;
  } catch (e) {
    if (!quiet) toast('Clipboard blocked — try again');
    return false;
  }
}

function fileName(ext) {
  let host = 'image';
  try { host = new URL(meta.url).hostname.replace(/^www\./, '') || host; } catch {}
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `Onion Lens/${host.replace(/[^\w.-]/g, '_')}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
}

async function save(kind) {
  if (!base) return;
  const jpeg = kind === 'jpeg';
  const blob = await exportBlob(jpeg ? 'image/jpeg' : 'image/png', (settings.jpegQuality ?? 92) / 100);
  const url = URL.createObjectURL(blob);
  try {
    await api.downloads.download({ url, filename: fileName(jpeg ? 'jpg' : 'png'), saveAs: !!settings.saveAs });
    toast('Saved to Downloads/Onion Lens');
  } catch (e) {
    // e.g. user cancelled the Save As dialog
    if (!/cancel/i.test(String(e?.message))) toast('Save failed: ' + (e?.message || e));
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

// ---------- wiring ----------
$$('[data-tool]').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#zoom').onchange = e => { zoom = e.target.value; applyZoom(); };
addEventListener('resize', applyZoom);
$('#copy').onclick = () => copyImage();
$('#savePng').onclick = () => save('png');
$('#saveJpg').onclick = () => save('jpeg');
$('#open').onclick = () => $('#file').click();
$('#file').onchange = e => loadFile(e.target.files[0]);
$('#paletteSize').onchange = () => base && renderPalette();
$('#savePalette').onclick = async () => {
  if (!palette.length) return;
  let name = 'Image palette';
  try { name = new URL(meta.url).hostname.replace(/^www\./, '') + ' image'; } catch { if (meta.title) name = meta.title; }
  const { palettes = [{ name: 'Favorites', colors: [] }] } = await api.storage.local.get('palettes');
  palettes.push({ name, colors: palette.map(C.toHex) });
  await api.storage.local.set({ palettes });
  toast(`Saved “${name}” palette`);
};

addEventListener('paste', e => {
  const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
  if (file) { e.preventDefault(); loadFile(file); }
});
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });

const KEYS = { c: 'crop', r: 'rect', a: 'arrow', p: 'pen', h: 'mark', t: 'text', b: 'blur', i: 'drop' };
addEventListener('keydown', e => {
  if (e.target.matches('input:not([type=range]):not([type=color]), select, textarea')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 's') { e.preventDefault(); save('png'); }
  else if (mod && k === 'c' && !String(getSelection())) { e.preventDefault(); copyImage(); }
  else if (!mod && KEYS[k]) setTool(KEYS[k]);
  else if (e.key === 'Escape') { if (drag) { drag = null; present(); } else setTool(tool); }
});

(async () => {
  ({ settings = {} } = await api.storage.local.get('settings'));
  document.documentElement.dataset.theme = settings.theme || 'dark';
  const { current } = await api.storage.local.get('current');
  $('#ink').value = (current || '#e8875b').slice(0, 7);
  $('#wrap').hidden = true;
  const rec = await OnionDB.get('shot').catch(() => null);
  if (!rec?.blob) return;
  load(await createImageBitmap(rec.blob), rec);
  if (rec.palette) { setTool('drop'); $('#palette').scrollIntoView(); }
  if (rec.copy) {
    await OnionDB.put('shot', { ...rec, copy: false });
    if (!(await copyImage(true))) {
      const b = $('#banner');
      b.replaceChildren('The browser blocked automatic copying.', el('button', { textContent: 'Copy screenshot now', onclick: () => copyImage() }));
      b.hidden = false;
    }
  }
})();
