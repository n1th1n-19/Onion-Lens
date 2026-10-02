// Run: node test.js
const assert = require('node:assert/strict');
const C = require('./colors.js');

const red = C.parse('#f00');
assert.deepEqual(red, { r: 255, g: 0, b: 0, a: 1 });
assert.equal(C.toHex(C.parse('rgba(18, 52, 86, 0.5)')), '#12345680');
assert.deepEqual(C.parse('hsl(120, 100%, 25%)'), { r: 0, g: 128, b: 0, a: 1 });
assert.deepEqual(C.parse('rebeccapurple'), { r: 102, g: 51, b: 153, a: 1 });
assert.equal(C.parse('nope'), null);

const f = C.formats(red);
assert.equal(f.rgb, 'rgb(255, 0, 0)');
assert.equal(f.hsl, 'hsl(0, 100%, 50%)');
assert.equal(f.cmyk, 'cmyk(0%, 100%, 100%, 0%)');
assert.equal(f.lab, 'lab(54.29% 80.82 69.9)');      // ≈ CSS Color 4 reference lab(54.29 80.82 69.91)
assert.equal(f.oklch, 'oklch(62.8% 0.2577 29.23)');
assert.equal(C.formats(C.parse('#abcdef'), true).hex, '#ABCDEF');

assert.equal(C.contrast(C.WHITE, C.BLACK), 21);
assert.ok(C.contrast(C.fixContrast(C.parse('#aaaaaa'), C.WHITE), C.WHITE) >= 4.5);
assert.deepEqual(C.nearestName(C.parse('#fe0101')), { name: 'red', exact: false });
assert.equal(C.nearestName(red).exact, true);
assert.equal(C.toHex(C.harmonies(red).Complementary[1]), '#00ffff');
assert.equal(C.toHex(C.simulate(C.WHITE, 'protanopia')), '#ffffff');

const px = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
assert.deepEqual(C.extractPalette(px, 2).map(C.toHex).sort(), ['#0000ff', '#ff0000']);

assert.equal(C.formats(C.parse('#777777')).oklch, 'oklch(56.93% 0 0)');

console.log('colors.js: all checks passed');
