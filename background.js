// Onion Lens background: captures the tab, injects the picker / screenshot
// overlays, stitches multi-tile screenshots and delivers them.
const api = globalThis.browser ?? globalThis.chrome;
// Chrome runs this as a service worker; Firefox loads db.js via manifest "scripts".
if (typeof importScripts === 'function') importScripts('db.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const inject = (tabId, files) => api.scripting.executeScript({ target: { tabId }, files });
const exec = (tabId, func, ...args) =>
  api.scripting.executeScript({ target: { tabId }, func, args }).then(r => r[0]?.result);
const settings = async () => (await api.storage.local.get('settings')).settings ?? {};
const activeTab = async () => (await api.tabs.query({ active: true, currentWindow: true }))[0];

// Chrome allows ~2 captureVisibleTab calls per second.
let lastCapture = 0;
async function capture(windowId) {
  const wait = lastCapture + 550 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCapture = Date.now();
  return api.tabs.captureVisibleTab(windowId, { format: 'png' });
}

function flagError(e) {
  console.warn('Onion Lens:', e);
  api.action.setBadgeBackgroundColor?.({ color: '#f28b82' });
  api.action.setBadgeText({ text: '!' });
  setTimeout(() => api.action.setBadgeText({ text: '' }), 4000);
}

// ---------- color picker ----------
async function startPicker(tab) {
  const dataUrl = await capture(tab.windowId);
  await inject(tab.id, ['colors.js', 'picker.js']);
  await exec(tab.id, url => { window.__onionPick(url); }, dataUrl);
}

// ---------- screenshots ----------
// Every shot is a rectangle in document coordinates. Starting a shot resolves once
// the overlay is up; the capture itself continues in the background.
async function startShot(tab, opts) {
  await inject(tab.id, ['colors.js', 'shot.js']);
  if (opts.mode === 'area' || opts.mode === 'element') {
    // shot.js replies later with a {type:'region'} message (keeps the worker free while the user selects)
    await exec(tab.id, o => { window.__onion.select(o); }, opts);
    return;
  }
  const m = await exec(tab.id, () => window.__onion.metrics());
  let rect = opts.mode === 'full'
    ? { x: 0, y: 0, w: m.dw, h: m.dh }
    : { x: m.sx, y: m.sy, w: m.cw, h: m.ch };
  if (opts.mode === 'image') {
    rect = await exec(tab.id, src => window.__onion.imageRect(src), opts.src);
    if (!rect) throw new Error('Image not found on page');
  }
  shootRegion(tab, rect, opts).catch(flagError);
}

async function shootRegion(tab, rect, opts) {
  if (opts.delay) await exec(tab.id, s => window.__onion.countdown(s), +opts.delay);
  const shot = await stitch(tab, rect);
  await deliver(tab, shot, opts);
}

const steps = (start, len, view) => { const out = []; for (let p = start; p < start + len; p += view) out.push(p); return out; };

async function stitch(tab, rect) {
  const m = await exec(tab.id, () => window.__onion.metrics());
  rect = {  // clamp to the document
    x: Math.max(0, rect.x), y: Math.max(0, rect.y),
    w: Math.min(rect.w, m.dw - Math.max(0, rect.x)), h: Math.min(rect.h, m.dh - Math.max(0, rect.y)),
  };
  if (rect.w < 1 || rect.h < 1) throw new Error('Empty capture area');
  const inView = rect.x >= m.sx && rect.y >= m.sy && rect.x + rect.w <= m.sx + m.cw && rect.y + rect.h <= m.sy + m.ch;
  const xs = inView ? [m.sx] : steps(rect.x, rect.w, m.cw);
  const ys = inView ? [m.sy] : steps(rect.y, rect.h, m.ch);
  let canvas, ctx, scale, clipped = false, first = true;
  try {
    for (const y of ys) for (const x of xs) {
      // after the first tile, hide fixed/sticky elements so headers don't repeat
      const pos = inView ? m : await exec(tab.id, (x, y, hide) => window.__onion.scrollTo(x, y, hide), x, y, !first);
      first = false;
      const bmp = await createImageBitmap(await (await fetch(await capture(tab.windowId))).blob());
      if (!canvas) {
        scale = bmp.width / pos.vw;
        const W = Math.max(1, Math.round(rect.w * scale));
        let H = Math.max(1, Math.round(rect.h * scale));
        // ponytail: browsers cap canvases near 16k px per side / ~268 MP, so very long pages are clipped.
        // Upgrade path: split into several images.
        const maxH = Math.min(16384, Math.floor(268e6 / W));
        if (H > maxH) { H = maxH; clipped = true; }
        canvas = new OffscreenCanvas(Math.min(W, 16384), H);
        ctx = canvas.getContext('2d');
      }
      // part of this tile inside the target rect (scrollbars excluded via cw/ch)
      const x1 = Math.max(rect.x, pos.sx), y1 = Math.max(rect.y, pos.sy);
      const x2 = Math.min(rect.x + rect.w, pos.sx + m.cw), y2 = Math.min(rect.y + rect.h, pos.sy + m.ch);
      if (x2 > x1 && y2 > y1) {
        ctx.drawImage(bmp,
          (x1 - pos.sx) * scale, (y1 - pos.sy) * scale, (x2 - x1) * scale, (y2 - y1) * scale,
          (x1 - rect.x) * scale, (y1 - rect.y) * scale, (x2 - x1) * scale, (y2 - y1) * scale);
      }
      bmp.close();
    }
  } finally {
    if (!inView) await exec(tab.id, () => window.__onion.restore()).catch(() => {});
  }
  return { blob: await canvas.convertToBlob({ type: 'image/png' }), clipped };
}

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function toJpeg(blob, quality) {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality });
}

function fileName(pageUrl, ext) {
  let host = 'page';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, '') || host; } catch {}
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  return `Onion Lens/${host.replace(/[^\w.-]/g, '_')}-${stamp}.${ext}`;
}

async function download(blob, filename, saveAs) {
  // Service workers have no URL.createObjectURL; Firefox's background page does.
  const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : await blobToDataUrl(blob);
  await api.downloads.download({ url, filename, saveAs: !!saveAs });
  if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function openEditor(tab, shot, extra = {}) {
  await OnionDB.put('shot', { blob: shot.blob, url: tab.url, title: tab.title, time: Date.now(), clipped: shot.clipped, ...extra });
  await api.tabs.create({ url: api.runtime.getURL('editor.html'), index: tab.index + 1 });
}

async function deliver(tab, shot, opts) {
  const s = await settings();
  const action = opts.mode === 'image' ? 'editor' : opts.action || s.shotAction || 'editor';
  const toast = msg => exec(tab.id, t => window.__onion?.toast(t), msg).catch(() => {});
  const note = shot.clipped ? ' (page too long — clipped)' : '';
  if (action === 'save') {
    const jpeg = s.shotFormat === 'jpeg';
    const blob = jpeg ? await toJpeg(shot.blob, (s.jpegQuality ?? 92) / 100) : shot.blob;
    await download(blob, fileName(tab.url, jpeg ? 'jpg' : 'png'), s.saveAs);
    return toast('Screenshot saved' + note);
  }
  if (action === 'copy') {
    const ok = await exec(tab.id, url => window.__onion.copyImage(url), await blobToDataUrl(shot.blob)).catch(() => false);
    if (ok) return toast('Screenshot copied to clipboard' + note);
    // Clipboard refused (page lost focus/activation): editor offers a one-click copy.
    return openEditor(tab, shot, { copy: true });
  }
  return openEditor(tab, shot, { palette: opts.mode === 'image' });
}

// ---------- entry points ----------
const run = (p, respond) => p.then(() => respond?.({ ok: true }), e => { flagError(e); respond?.({ ok: false, error: String(e?.message || e) }); });

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'pick') { run(activeTab().then(startPicker), sendResponse); return true; }
  if (msg?.type === 'shot') { run(activeTab().then(t => startShot(t, msg)), sendResponse); return true; }
  if (msg?.type === 'inspect') {
    run(activeTab().then(async t => { await inject(t.id, ['colors.js', 'shot.js']); await exec(t.id, () => { window.__onion.inspect(); }); }), sendResponse);
    return true;
  }
  if (msg?.type === 'region' && sender.tab) { shootRegion(sender.tab, msg.rect, msg.opts).catch(flagError); }
});

api.commands.onCommand.addListener(async (cmd, tab) => {
  tab ??= await activeTab();
  if (cmd === 'pick-color') run(startPicker(tab));
  if (cmd === 'shot-area') run(startShot(tab, { mode: 'area' }));
  if (cmd === 'shot-full') run(startShot(tab, { mode: 'full' }));
});

const MENU = [
  ['pick', 'Pick color from page', ['page', 'image', 'link', 'selection']],
  ['inspect', 'Inspect element colors', ['page', 'link', 'selection']],
  ['shot-visible', 'Screenshot — visible area', ['page', 'image', 'link', 'selection']],
  ['shot-full', 'Screenshot — full page', ['page', 'image', 'link', 'selection']],
  ['shot-area', 'Screenshot — select area', ['page', 'image', 'link', 'selection']],
  ['shot-element', 'Screenshot — element / container', ['page', 'image', 'link', 'selection']],
  ['shot-image', 'Extract palette from this image', ['image']],
];
api.runtime.onInstalled.addListener(async () => {
  await api.contextMenus.removeAll();
  for (const [id, title, contexts] of MENU) api.contextMenus.create({ id, title, contexts });
});
api.contextMenus.onClicked.addListener((info, tab) => {
  const id = info.menuItemId;
  if (id === 'pick') run(startPicker(tab));
  else if (id === 'inspect') run((async () => { await inject(tab.id, ['colors.js', 'shot.js']); await exec(tab.id, () => { window.__onion.inspect(); }); })());
  else if (id.startsWith('shot-')) run(startShot(tab, { mode: id.slice(5), src: info.srcUrl }));
});
