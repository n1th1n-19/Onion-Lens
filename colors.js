// Shared color math. Plain script (not a module) so the popup, editor, injected
// content scripts and Node (test.js) can all load the same file.
(() => {
  const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
  const round = (x, d = 0) => { const p = 10 ** d; return Math.round(x * p) / p; };
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const BLACK = { r: 0, g: 0, b: 0, a: 1 };
  const GRAY = { r: 128, g: 128, b: 128, a: 1 };

  // ---------- parsing ----------
  const alpha = s => s == null ? 1 : clamp(s.endsWith('%') ? parseFloat(s) / 100 : +s);
  const rgbObj = (r, g, b, a = 1) => ({
    r: Math.round(clamp(r, 0, 255)), g: Math.round(clamp(g, 0, 255)), b: Math.round(clamp(b, 0, 255)), a,
  });

  function parse(input) {
    if (input && typeof input === 'object') return rgbObj(input.r, input.g, input.b, input.a ?? 1);
    const str = String(input ?? '').trim().toLowerCase();
    if (!str) return null;
    let m = str.match(/^#?([0-9a-f]{3,8})$/);
    if (m && [3, 4, 6, 8].includes(m[1].length)) {
      let h = m[1];
      if (h.length < 5) h = [...h].map(c => c + c).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return rgbObj(n >> 16, (n >> 8) & 255, n & 255, h.length === 8 ? round(parseInt(h.slice(6), 16) / 255, 3) : 1);
    }
    m = str.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
    if (m) return rgbObj(+m[1], +m[2], +m[3], alpha(m[4]));
    m = str.match(/^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
    if (m) return { ...hslToRgb(+m[1], +m[2], +m[3]), a: alpha(m[4]) };
    if (NAMES[str]) return parse(NAMES[str]);
    return parseWithCanvas(str);
  }

  // Any other CSS color (lab(), oklch(), color(display-p3 …), …): let the browser
  // paint it and read the sRGB pixel back.
  let ctx;
  function parseWithCanvas(str) {
    if (typeof CSS === 'undefined' || !CSS.supports('color', str)) return null;
    ctx ??= (typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : Object.assign(document.createElement('canvas'), { width: 1, height: 1 })
    ).getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = str;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return rgbObj(r, g, b, round(a / 255, 3));
  }

  // ---------- conversions ----------
  const hex2 = x => Math.round(x).toString(16).padStart(2, '0');
  const toHex = c => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) + (c.a < 1 ? hex2(c.a * 255) : '');

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
  }

  function hue(r, g, b, max, d) {
    if (!d) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }

  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    return { h: hue(r, g, b, max, d), s: d ? d / (1 - Math.abs(2 * l - 1)) * 100 : 0, l: l * 100 };
  }

  function rgbToHsv({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    return { h: hue(r, g, b, max, d), s: max ? d / max * 100 : 0, v: max * 100 };
  }

  function rgbToHwb(c) {
    const max = Math.max(c.r, c.g, c.b) / 255, min = Math.min(c.r, c.g, c.b) / 255;
    return { h: rgbToHsv(c).h, w: min * 100, b: (1 - max) * 100 };
  }

  function rgbToCmyk({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const k = 1 - Math.max(r, g, b);
    if (k === 1) return [0, 0, 0, 100];
    return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map(x => x * 100);
  }

  const toLin = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const fromLin = v => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  const lin = c => [toLin(c.r), toLin(c.g), toLin(c.b)];

  // CSS lab()/lch() are CIE Lab relative to D50.
  function rgbToLab(c) {
    const [r, g, b] = lin(c);
    const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
    const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    const Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
    // Bradford D65 -> D50
    const x = 1.0479298208405488 * X + 0.022946793341019088 * Y - 0.05019222954313557 * Z;
    const y = 0.029627815688159344 * X + 0.990434484573249 * Y - 0.01707382502938514 * Z;
    const z = -0.009243058152591178 * X + 0.015055144896577895 * Y + 0.7518742899580008 * Z;
    const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
    const fx = f(x / 0.96422), fy = f(y), fz = f(z / 0.82521);
    return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  function rgbToOklab(c) {
    const [r, g, b] = lin(c);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return {
      l: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    };
  }

  // hue is meaningless (rounding noise) for near-neutral colors, so report 0
  const polar = ({ l, a, b }, eps) => { const c = Math.hypot(a, b); return { l, c, h: c < eps ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 }; };

  const FORMATS = { hex: 'HEX', rgb: 'RGB', hsl: 'HSL', hsv: 'HSV', hwb: 'HWB', cmyk: 'CMYK', lab: 'LAB', lch: 'LCH', oklab: 'OKLAB', oklch: 'OKLCH' };

  function formats(c, upper = false) {
    const A = c.a < 1, a = round(c.a, 2), sl = A ? ` / ${a}` : '';
    const hsl = rgbToHsl(c), hsv = rgbToHsv(c), hwb = rgbToHwb(c), cmyk = rgbToCmyk(c);
    const lab = rgbToLab(c), lch = polar(lab, 0.05), ok = rgbToOklab(c), okl = polar(ok, 0.0005);
    const hex = toHex(c);
    return {
      hex: upper ? hex.toUpperCase() : hex,
      rgb: A ? `rgba(${c.r}, ${c.g}, ${c.b}, ${a})` : `rgb(${c.r}, ${c.g}, ${c.b})`,
      hsl: A ? `hsla(${round(hsl.h)}, ${round(hsl.s)}%, ${round(hsl.l)}%, ${a})` : `hsl(${round(hsl.h)}, ${round(hsl.s)}%, ${round(hsl.l)}%)`,
      hsv: `hsv(${round(hsv.h)}, ${round(hsv.s)}%, ${round(hsv.v)}%)`,
      hwb: `hwb(${round(hwb.h)} ${round(hwb.w)}% ${round(hwb.b)}%${sl})`,
      cmyk: `cmyk(${cmyk.map(x => round(x) + '%').join(', ')})`,
      lab: `lab(${round(lab.l, 2)}% ${round(lab.a, 2)} ${round(lab.b, 2)}${sl})`,
      lch: `lch(${round(lch.l, 2)}% ${round(lch.c, 2)} ${round(lch.h, 2)}${sl})`,
      oklab: `oklab(${round(ok.l * 100, 2)}% ${round(ok.a, 4)} ${round(ok.b, 4)}${sl})`,
      oklch: `oklch(${round(okl.l * 100, 2)}% ${round(okl.c, 4)} ${round(okl.h, 2)}${sl})`,
    };
  }

  // ---------- names ----------
  const NAMES = Object.fromEntries((
    'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 ' +
    'black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 ' +
    'chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff ' +
    'darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkkhaki:bdb76b ' +
    'darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a ' +
    'darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 ' +
    'deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 ' +
    'forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 ' +
    'green:008000 greenyellow:adff2f honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 ' +
    'khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 ' +
    'lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightpink:ffb6c1 ' +
    'lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightsteelblue:b0c4de ' +
    'lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa ' +
    'mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee ' +
    'mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa ' +
    'mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 ' +
    'orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee ' +
    'palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 ' +
    'purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 ' +
    'sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd ' +
    'slategray:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 ' +
    'tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32'
  ).split(' ').map(p => p.split(':')));

  let namedLab;
  function nearestName(c) {
    namedLab ??= Object.entries(NAMES).map(([name, hex]) => [name, rgbToOklab(parse(hex))]);
    const t = rgbToOklab(c);
    let best, bestD = Infinity;
    for (const [name, o] of namedLab) {
      const d = (o.l - t.l) ** 2 + (o.a - t.a) ** 2 + (o.b - t.b) ** 2;
      if (d < bestD) { bestD = d; best = name; }
    }
    return { name: best, exact: bestD < 1e-9 };
  }

  // ---------- palettes ----------
  const mix = (a, b, t) => ({
    r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t), a: round(a.a + ((b.a ?? 1) - a.a) * t, 3),
  });

  function harmonies(c) {
    const { h, s, l } = rgbToHsl(c);
    const rot = degs => degs.map(d => ({ ...hslToRgb(h + d, s, l), a: c.a }));
    const steps = to => [0.15, 0.3, 0.45, 0.6, 0.75].map(t => mix(c, { ...to, a: c.a }, t));
    return {
      Complementary: rot([0, 180]),
      Analogous: rot([-30, 0, 30]),
      Triadic: rot([0, 120, 240]),
      'Split complementary': rot([0, 150, 210]),
      Tetradic: rot([0, 90, 180, 270]),
      Tints: steps(WHITE),
      Shades: steps(BLACK),
      Tones: steps(GRAY),
    };
  }

  // ---------- accessibility ----------
  const luminance = c => { const [r, g, b] = lin(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }

  // Walk the foreground's HSL lightness toward whichever extreme (black/white)
  // contrasts more with the background; first passing step = smallest visual change.
  function fixContrast(fg, bg, target = 4.5) {
    const { h, s, l } = rgbToHsl(fg);
    const dirs = contrast(BLACK, bg) > contrast(WHITE, bg) ? [-1, 1] : [1, -1];
    for (const d of dirs) {
      for (let L = l; L >= 0 && L <= 100; L += d * 0.5) {
        const c = { ...hslToRgb(h, s, L), a: 1 };
        if (contrast(c, bg) >= target) return c;
      }
    }
    return null;
  }

  // Machado et al. 2009, severity 1.0, applied in linear RGB.
  const CVD = {
    protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
    tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
  };
  function simulate(c, type) {
    const v = lin(c);
    let out;
    if (type === 'achromatopsia') out = Array(3).fill(0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]);
    else if (CVD[type]) { const m = CVD[type]; out = [0, 1, 2].map(i => m[i * 3] * v[0] + m[i * 3 + 1] * v[1] + m[i * 3 + 2] * v[2]); }
    else return c;
    const [r, g, b] = out.map(x => Math.round(clamp(fromLin(clamp(x))) * 255));
    return { r, g, b, a: c.a };
  }

  // ---------- image palette (median cut) ----------
  // pixels: RGBA Uint8ClampedArray. Samples at most ~40k pixels for speed.
  function extractPalette(pixels, count = 8) {
    const step = Math.max(1, Math.floor(pixels.length / 4 / 40000));
    const pts = [];
    for (let i = 0; i < pixels.length; i += 4 * step) if (pixels[i + 3] > 127) pts.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
    if (!pts.length) return [];
    let boxes = [pts];
    while (boxes.length < count * 3) { // over-split, then merge look-alikes below
      // split the box with the widest channel range
      let bi = -1, bc = 0, br = -1;
      boxes.forEach((box, i) => {
        if (box.length < 2) return;
        for (let ch = 0; ch < 3; ch++) {
          let lo = 255, hi = 0;
          for (const p of box) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
          if (hi - lo > br) { br = hi - lo; bi = i; bc = ch; }
        }
      });
      if (bi < 0 || br === 0) break;
      const box = boxes[bi].sort((p, q) => p[bc] - q[bc]), mid = box.length >> 1;
      boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
    }
    const out = [];
    for (const box of boxes.sort((p, q) => q.length - p.length)) {
      const s = box.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      const c = rgbObj(s[0] / box.length, s[1] / box.length, s[2] / box.length), o = rgbToOklab(c);
      // skip colors visually indistinguishable from a more common one (OKLab ΔE < 0.06)
      if (out.every(([, q]) => Math.hypot(o.l - q.l, o.a - q.a, o.b - q.b) > 0.06)) out.push([c, o]);
      if (out.length === count) break;
    }
    return out.map(([c]) => c);
  }

  const Color = {
    parse, toHex, formats, FORMATS, nearestName, harmonies, mix, contrast, fixContrast, simulate,
    rgbToHsl, hslToRgb, rgbToOklab, extractPalette, WHITE, BLACK,
  };
  globalThis.Color = Color;
  if (typeof module !== 'undefined') module.exports = Color;
})();
