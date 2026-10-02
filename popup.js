const api = globalThis.browser ?? globalThis.chrome;
const C = globalThis.Color;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

const DEFAULT_SETTINGS = {
  format: 'hex', autoCopy: true, upper: false, sample: 1, theme: 'dark',
  shotAction: 'editor', shotFormat: 'png', jpegQuality: 92, saveAs: false, delay: 0,
};
const state = {
  current: '#d29bf5', bg: '#1e1f22', tab: 'formats', history: [],
  palettes: [{ name: 'Favorites', colors: [] }], settings: { ...DEFAULT_SETTINGS },
};
let color;
let pageColors = [];
let gradientCss = '';

const save = (...keys) => api.storage.local.set(Object.fromEntries(keys.map(k => [k, state[k]])));
const hex = c => C.toHex(c);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1500);
}
async function copy(text, label = text) {
  try { await navigator.clipboard.writeText(text); toast(`Copied ${label}`); }
  catch { toast('Clipboard blocked by browser'); }
}

function swatch(c, { title, onClick, onRemove, badge, cls = '' } = {}) {
  const h = typeof c === 'string' ? c : hex(c);
  const b = el('button', { className: `swatch checker ${cls}`, title: title || h });
  b.append(el('i', { style: `background:${h}` }));
  if (badge) b.append(el('small', { textContent: badge }));
  b.onclick = onClick || (() => setColor(C.parse(h)));
  if (onRemove) b.oncontextmenu = e => { e.preventDefault(); onRemove(); };
  return b;
}

// ---------- current color ----------
function setColor(c, skip) {
  if (!c) return;
  color = c;
  state.current = hex(c);
  save('current');
  render(skip);
}

function render(skip) {
  const h = hex(color);
  $('#swatch i').style.background = h;
  const text = $('#colorText');
  if (skip !== 'text') text.value = C.formats(color, state.settings.upper)[state.settings.format];
  text.classList.remove('bad');
  if (skip !== 'native') $('#native').value = h.slice(0, 7);
  $('#alpha').value = Math.round(color.a * 100);
  $('#alphaOut').textContent = Math.round(color.a * 100) + '%';
  const n = C.nearestName(color);
  $('#name').textContent = (n.exact ? '' : '≈ ') + n.name;
  $('#fav').classList.toggle('on', !!favorites()?.colors.includes(h));
  renderFormats();
  renderHarmony();
  renderContrast();
}

function renderFormats() {
  const f = C.formats(color, state.settings.upper);
  $('#formatList').replaceChildren(...Object.entries(C.FORMATS).map(([k, label]) => {
    const b = el('button', { className: k === state.settings.format ? 'default' : '', title: 'Copy' },
      el('b', { textContent: label }), el('code', { textContent: f[k] }));
    b.onclick = () => copy(f[k]);
    return b;
  }));
}

// ---------- harmony + gradient ----------
function renderHarmony() {
  $('#harmonies').replaceChildren(...Object.entries(C.harmonies(color)).map(([name, list]) =>
    el('div', { className: 'group' }, el('h3', { textContent: name }), el('div', { className: 'swatches wide' }, ...list.map(c => swatch(c))))));
  renderGradient();
}

function renderGradient() {
  const input = $('#gradB'), b = C.parse(input.value);
  input.classList.toggle('bad', !b);
  if (!b) return;
  $('#gradNative').value = hex(b).slice(0, 7);
  const a = hex(color), bh = hex(b), ang = $('#gradAngle').value, type = $('#gradType').value;
  $('#gradAngleOut').textContent = ang + '°';
  const css = type === 'linear' ? `linear-gradient(${ang}deg, ${a}, ${bh})`
    : type === 'radial' ? `radial-gradient(circle, ${a}, ${bh})`
    : `conic-gradient(from ${ang}deg, ${a}, ${bh}, ${a})`;
  $('#gradPreview').style.background = css;
  gradientCss = `background: ${css};`;
  $('#gradSteps').replaceChildren(...Array.from({ length: 9 }, (_, i) => swatch(C.mix(color, b, i / 8))));
}

// ---------- contrast ----------
const VISION = [['none', 'Normal'], ['protanopia', 'Protan'], ['deuteranopia', 'Deutan'], ['tritanopia', 'Tritan'], ['achromatopsia', 'Mono']];

function renderContrast() {
  const bg = C.parse(state.bg) || C.WHITE;
  if (document.activeElement !== $('#bgText')) $('#bgText').value = hex(bg);
  $('#bgNative').value = hex(bg).slice(0, 7);
  const fg = C.mix(bg, { ...color, a: 1 }, color.a); // composite translucent text over the background
  const ratio = C.contrast(fg, bg);
  Object.assign($('#contrastPreview').style, { color: hex(color), background: hex(bg) });
  $('#ratio').textContent = ratio.toFixed(2) + ':1';
  const checks = [['AA', 4.5], ['AA Large', 3], ['AAA', 7], ['AAA Large', 4.5], ['UI', 3]];
  $('#badges').replaceChildren(...checks.map(([n, t]) =>
    el('span', { className: ratio >= t ? 'pass' : 'fail', textContent: `${ratio >= t ? '✓' : '✗'} ${n}`, title: `needs ${t}:1` })));
  $('#fix').hidden = ratio >= 4.5;
  $('#vision').replaceChildren(...VISION.map(([type, label]) =>
    el('div', { className: 'vis' },
      el('div', { style: `background:${hex(C.simulate(bg, type))};color:${hex(C.simulate(fg, type))}`, textContent: 'Aa' }),
      el('span', { textContent: label }))));
}

// ---------- page scan ----------
// Runs inside the page (serialised by scripting.executeScript), so it must be self-contained.
function collectPageColors() {
  const counts = {};
  const add = v => { if (v && v !== 'none' && v !== 'transparent' && !/(,\s*0\)|\/\s*0\))$/.test(v)) counts[v] = (counts[v] || 0) + 1; };
  for (const node of [...document.querySelectorAll('body, body *')].slice(0, 5000)) {
    const cs = getComputedStyle(node);
    add(cs.color);
    add(cs.backgroundColor);
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') add(cs.borderTopColor);
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) add(cs.outlineColor);
    if (node instanceof SVGElement) { add(cs.fill); add(cs.stroke); }
  }
  return counts;
}

const activeTab = async () => (await api.tabs.query({ active: true, currentWindow: true }))[0];
const runInPage = async (func, args = [], files) => {
  const tab = await activeTab();
  if (files) await api.scripting.executeScript({ target: { tabId: tab.id }, files });
  const [res] = await api.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return res?.result;
};

async function scanPage() {
  $('#pageInfo').textContent = 'Scanning…';
  try {
    const counts = await runInPage(collectPageColors);
    const merged = {};
    for (const [value, n] of Object.entries(counts)) {
      const c = C.parse(value);
      if (c && c.a > 0) merged[hex(c)] = (merged[hex(c)] || 0) + n;
    }
    pageColors = Object.entries(merged).sort((a, b) => b[1] - a[1]);
    $('#pageInfo').textContent = `${pageColors.length} colors found. Click to select + highlight on page · right-click to copy.`;
    $('#pageActions').hidden = !pageColors.length;
    $('#pageColors').replaceChildren(...pageColors.slice(0, 120).map(([h, n]) => {
      const s = swatch(h, {
        title: `${h} — used ${n}×`, badge: n > 999 ? '1k+' : String(n),
        onClick: async () => {
          setColor(C.parse(h));
          $$('#pageColors .hit').forEach(x => x.classList.remove('hit'));
          s.classList.add('hit');
          const found = await runInPage(x => window.__onion.find(x), [h], ['colors.js', 'shot.js']).catch(() => 0);
          toast(`${found} element${found === 1 ? '' : 's'} highlighted`);
        },
      });
      s.oncontextmenu = e => { e.preventDefault(); copy(h); };
      return s;
    }));
  } catch (e) {
    $('#pageInfo').textContent = 'This page can’t be scanned (browser pages and extension stores are protected).';
  }
}

// ---------- saved ----------
const favorites = () => state.palettes.find(p => p.name === 'Favorites');
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'color';
const EXPORTS = [['css', 'CSS variables'], ['scss', 'SCSS'], ['tailwind', 'Tailwind'], ['json', 'JSON'], ['hex', 'HEX list']];

function exportPalette(p, kind) {
  const n = slug(p.name);
  switch (kind) {
    case 'css': return `:root {\n${p.colors.map((c, i) => `  --${n}-${i + 1}: ${c};`).join('\n')}\n}`;
    case 'scss': return p.colors.map((c, i) => `$${n}-${i + 1}: ${c};`).join('\n');
    case 'tailwind': return JSON.stringify({ [n]: Object.fromEntries(p.colors.map((c, i) => [(i + 1) * 100, c])) }, null, 2);
    case 'json': return JSON.stringify({ name: p.name, colors: p.colors }, null, 2);
    default: return p.colors.join(', ');
  }
}

function addToPalette(p, h) {
  if (!p.colors.includes(h)) p.colors.push(h);
  save('palettes');
  renderSaved();
  render();
  toast(`Added to ${p.name}`);
}

function renderSaved() {
  $('#history').replaceChildren(...state.history.map(h => swatch(h)));
  $('#historyEmpty').hidden = state.history.length > 0;
  $('#palettes').replaceChildren(...state.palettes.map((p, i) => {
    const exp = el('select', { title: 'Copy palette as…' },
      el('option', { value: '', textContent: 'Export' }), ...EXPORTS.map(([v, t]) => el('option', { value: v, textContent: t })));
    exp.onchange = () => { if (exp.value) copy(exportPalette(p, exp.value), `${p.name} as ${exp.selectedOptions[0].textContent}`); exp.value = ''; };
    const add = el('button', { textContent: '+ Current', title: 'Add current color' });
    add.onclick = () => addToPalette(p, state.current);
    // two-click delete (confirm() is unavailable in Firefox popups)
    const del = el('button', { textContent: 'Delete', className: 'danger' });
    del.onclick = () => {
      if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Sure?'; return; }
      state.palettes.splice(i, 1);
      save('palettes');
      renderSaved();
      render();
    };
    return el('div', { className: 'palette' },
      el('div', { className: 'pal-head' }, el('b', { textContent: `${p.name} · ${p.colors.length}` }), add, exp, del),
      el('div', { className: 'swatches' }, ...(p.colors.length ? p.colors.map((h, j) => swatch(h, {
        title: `${h} — right-click to remove`,
        onRemove: () => { p.colors.splice(j, 1); save('palettes'); renderSaved(); render(); },
      })) : [el('span', { className: 'muted small', textContent: 'Empty — add colors with “+ Current”.' })])));
  }));
}

// ---------- tabs ----------
function showTab(name) {
  state.tab = name;
  save('tab');
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
  if (name === 'saved') renderSaved();
}

// ---------- settings ----------
function applySettings() {
  const s = state.settings;
  document.documentElement.dataset.theme = s.theme;
  $('#setFormat').value = s.format;
  $('#setSample').value = String(s.sample);
  $('#setTheme').value = s.theme;
  $('#setAutoCopy').checked = s.autoCopy;
  $('#setUpper').checked = s.upper;
  $$('#shotAction button').forEach(b => b.classList.toggle('on', b.dataset.value === s.shotAction));
  $('#shotDelay').value = String(s.delay);
  $('#shotFormat').value = s.shotFormat;
  $('#jpegQuality').value = s.jpegQuality;
  $('#qualityWrap').style.visibility = s.shotFormat === 'jpeg' ? 'visible' : 'hidden';
  $('#saveAs').checked = s.saveAs;
}
function setSetting(key, value) {
  state.settings[key] = value;
  save('settings');
  applySettings();
  render();
}

// ---------- wiring ----------
function wire() {
  $('#colorText').addEventListener('input', e => {
    const c = C.parse(e.target.value);
    if (c) setColor(c, 'text'); else e.target.classList.add('bad');
  });
  $('#colorText').addEventListener('blur', () => render());
  $('#native').addEventListener('input', e => setColor({ ...C.parse(e.target.value), a: color.a }, 'native'));
  $('#alpha').addEventListener('input', e => setColor({ ...color, a: e.target.value / 100 }));
  $('#swatch').onclick = () => copy(C.formats(color, state.settings.upper)[state.settings.format]);

  $('#pick').onclick = async () => {
    const res = await api.runtime.sendMessage({ type: 'pick' });
    if (res?.ok) window.close(); else toast('Can’t pick on this page');
  };
  $('#fav').onclick = () => {
    let fav = favorites();
    if (!fav) state.palettes.unshift(fav = { name: 'Favorites', colors: [] });
    if (fav.colors.includes(state.current)) {
      fav.colors = fav.colors.filter(h => h !== state.current);
      save('palettes');
      renderSaved();
      render();
      toast('Removed from Favorites');
    } else addToPalette(fav, state.current);
  };
  $('#gear').onclick = () => {
    const s = $('#settings');
    s.hidden = !s.hidden;
    $('#gear').setAttribute('aria-expanded', String(!s.hidden));
  };

  const opts = $('#setFormat');
  opts.append(...Object.entries(C.FORMATS).map(([v, t]) => el('option', { value: v, textContent: t })));
  opts.onchange = e => setSetting('format', e.target.value);
  $('#setSample').onchange = e => setSetting('sample', +e.target.value);
  $('#setTheme').onchange = e => setSetting('theme', e.target.value);
  $('#setAutoCopy').onchange = e => setSetting('autoCopy', e.target.checked);
  $('#setUpper').onchange = e => setSetting('upper', e.target.checked);

  $$('nav button').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });

  // harmony
  $('#gradB').addEventListener('input', renderGradient);
  $('#gradNative').addEventListener('input', e => { $('#gradB').value = e.target.value; renderGradient(); });
  $('#gradAngle').addEventListener('input', renderGradient);
  $('#gradType').addEventListener('change', renderGradient);
  $('#gradCopy').onclick = () => copy(gradientCss, 'gradient CSS');

  // contrast
  const setBg = v => { const c = C.parse(v); $('#bgText').classList.toggle('bad', !c); if (c) { state.bg = hex(c); save('bg'); renderContrast(); } };
  $('#bgText').addEventListener('input', e => setBg(e.target.value));
  $('#bgNative').addEventListener('input', e => setBg(e.target.value));
  $('#swap').onclick = () => { const fg = state.current; setColor(C.parse(state.bg)); setBg(fg); $('#bgText').value = fg; };
  $('#fix').onclick = () => {
    const fixed = C.fixContrast({ ...color, a: 1 }, C.parse(state.bg));
    if (fixed) { setColor(fixed); toast(`Adjusted to ${hex(fixed)}`); } else toast('No passing lightness for this hue');
  };

  // page
  $('#scan').onclick = scanPage;
  $('#inspect').onclick = async () => {
    const res = await api.runtime.sendMessage({ type: 'inspect' });
    if (res?.ok) window.close(); else toast('Can’t inspect this page');
  };
  $('#clearFind').onclick = () => { runInPage(() => window.__onion?.clearFind()).catch(() => {}); $$('#pageColors .hit').forEach(x => x.classList.remove('hit')); };
  $('#savePage').onclick = async () => {
    let host = 'Page';
    try { host = new URL((await activeTab()).url).hostname.replace(/^www\./, ''); } catch {}
    state.palettes.push({ name: host, colors: pageColors.slice(0, 24).map(([h]) => h) });
    save('palettes');
    toast(`Saved “${host}” palette`);
  };

  // saved
  $('#clearHistory').onclick = () => { state.history = []; save('history'); renderSaved(); };
  const create = () => {
    const name = $('#newName').value.trim();
    if (!name) return $('#newName').focus();
    state.palettes.push({ name, colors: [] });
    $('#newName').value = '';
    save('palettes');
    renderSaved();
  };
  $('#newPalette').onclick = create;
  $('#newName').addEventListener('keydown', e => { if (e.key === 'Enter') create(); });

  // screenshots
  $$('[data-shot]').forEach(b => {
    b.onclick = async () => {
      const s = state.settings;
      const res = await api.runtime.sendMessage({ type: 'shot', mode: b.dataset.shot, delay: s.delay, action: s.shotAction });
      if (res?.ok) window.close(); else toast('Can’t capture this page');
    };
  });
  $$('#shotAction button').forEach(b => { b.onclick = () => setSetting('shotAction', b.dataset.value); });
  $('#shotDelay').onchange = e => setSetting('delay', +e.target.value);
  $('#shotFormat').onchange = e => setSetting('shotFormat', e.target.value);
  $('#jpegQuality').onchange = e => setSetting('jpegQuality', Math.min(100, Math.max(10, +e.target.value || 92)));
  $('#saveAs').onchange = e => setSetting('saveAs', e.target.checked);
}

(async () => {
  const stored = await api.storage.local.get(Object.keys(state));
  Object.assign(state, stored, { settings: { ...DEFAULT_SETTINGS, ...stored.settings } });
  color = C.parse(state.current) || C.parse('#d29bf5');
  $('#version').textContent = 'v' + api.runtime.getManifest().version;
  wire();
  applySettings();
  render();
  showTab(state.tab);
})();
