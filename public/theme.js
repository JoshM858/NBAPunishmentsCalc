// Colour theme: how many colours to use (1-3) and what they are, kept in this browser. Pure helpers plus a tiny
// store; the picker UI is in ui/theme-ui.js. Roles: 1 = accent (buttons, selection, active tab, charts),
// 2 = secondary (hover states, meter ends), 3 = highlight (your team, stars). Fewer colours derive the rest.

export const DEFAULT_THEME = { count: 2, colors: ['#e8f02a', '#c8d51e', '#e8f02a'] }; // the original palette
export const ROLES = ['Accent', 'Secondary', 'Highlight'];
const KEY = 'pw:theme';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// '#abc', 'ABCDEF' and '#AbCdEf' -> '#aabbcc'; anything else -> null
export function normalizeHex(v) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex) || '#000000';
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;

// h 0-360, s and l 0-1
export function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

export function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

// WCAG relative luminance, 0 (black) to 1 (white)
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Text colour that stays readable on `bg`: near-black on light colours, white on dark ones
export const onColour = (bg) => (luminance(bg) > 0.4 ? '#101216' : '#ffffff');

// A slightly darker, calmer version of a colour, for hover states when the manager picks only one
export function deriveSecondary(hex) {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s * 0.92, clamp(l - 0.07, 0.05, 0.95));
}

// Always three usable colours, whatever was stored
export function resolveTheme(t) {
  const count = clamp(Math.round(Number(t?.count)) || DEFAULT_THEME.count, 1, 3);
  const picked = (t?.colors || []).slice(0, count).map((c) => normalizeHex(c));
  const accent = picked[0] || DEFAULT_THEME.colors[0];
  const secondary = count >= 2 ? picked[1] || deriveSecondary(accent) : deriveSecondary(accent);
  const highlight = count >= 3 ? picked[2] || accent : accent;
  return { count, colors: [accent, secondary, highlight] };
}

// CSS variables for a theme
export function themeVars(t) {
  const [accent, secondary, highlight] = resolveTheme(t).colors;
  return { '--accent': accent, '--accent-2': secondary, '--hl': highlight, '--on-accent': onColour(accent), '--on-hl': onColour(highlight) };
}

export function applyTheme(t, root = document.documentElement) {
  for (const [k, v] of Object.entries(themeVars(t))) root.style.setProperty(k, v);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = '#101216';
}

export const loadTheme = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw ? resolveTheme(raw) : null;
  } catch {
    return null;
  }
};

export function saveTheme(t) {
  try {
    localStorage.setItem(KEY, JSON.stringify(resolveTheme(t)));
  } catch {}
}

export const resetTheme = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {}
};
