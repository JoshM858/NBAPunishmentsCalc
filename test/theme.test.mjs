import assert from 'node:assert/strict';
import { DEFAULT_THEME, deriveSecondary, hexToHsl, hslToHex, luminance, normalizeHex, onColour, resolveTheme, themeVars } from '../public/theme.js';

assert.equal(normalizeHex('#ABC'), '#aabbcc');
assert.equal(normalizeHex('E8F02A'), '#e8f02a');
assert.equal(normalizeHex('#12345'), null);
assert.equal(normalizeHex('red'), null);
assert.equal(normalizeHex(null), null);

// HSL round trip
for (const hex of ['#e8f02a', '#ff0000', '#00ff00', '#3366cc', '#808080', '#101216', '#ffffff']) {
  const [h, s, l] = hexToHsl(hex);
  const back = hslToHex(h, s, l);
  const d = (a, b) => [1, 3, 5].reduce((m, i) => Math.max(m, Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16))), 0);
  assert.ok(d(hex, back) <= 1, `${hex} -> ${back}`);
}
assert.equal(hslToHex(0, 1, 0.5), '#ff0000');
assert.equal(hslToHex(120, 1, 0.5), '#00ff00');

// Readable text on any colour
assert.equal(onColour('#e8f02a'), '#101216', 'dark text on the yellow');
assert.equal(onColour('#ffffff'), '#101216');
assert.equal(onColour('#101216'), '#ffffff');
assert.equal(onColour('#1d4ed8'), '#ffffff', 'white text on a dark blue');
assert.ok(luminance('#ffffff') > 0.99 && luminance('#000000') < 0.01);

// The derived secondary is darker but the same hue
const [h1, , l1] = hexToHsl('#e8f02a');
const [h2, , l2] = hexToHsl(deriveSecondary('#e8f02a'));
assert.ok(l2 < l1 && Math.abs(h1 - h2) < 2);

// Always three usable colours
assert.deepEqual(resolveTheme(null).colors.length, 3);
const one = resolveTheme({ count: 1, colors: ['#1d4ed8', '#ff0000', '#00ff00'] });
assert.equal(one.count, 1);
assert.equal(one.colors[0], '#1d4ed8');
assert.equal(one.colors[1], deriveSecondary('#1d4ed8'), 'with one colour the rest are derived');
assert.equal(one.colors[2], '#1d4ed8');
const three = resolveTheme({ count: 3, colors: ['#111111', '#222222', '#333333'] });
assert.deepEqual(three.colors, ['#111111', '#222222', '#333333']);
assert.equal(resolveTheme({ count: 9, colors: ['#111111'] }).count, 3, 'clamped');
assert.equal(resolveTheme({ count: 2, colors: ['nonsense', '#222222'] }).colors[0], DEFAULT_THEME.colors[0], 'a bad colour falls back to the default');
const vars = themeVars({ count: 2, colors: ['#e8f02a', '#c8d51e'] });
assert.equal(vars['--accent'], '#e8f02a');
assert.equal(vars['--accent-2'], '#c8d51e');
assert.equal(vars['--on-accent'], '#101216');
console.log('Theme tests passed');
