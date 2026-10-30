// Small helpers every page shares: escaping, number formats, and a few bits of markup.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (v, digits = 1) => Number(v || 0).toLocaleString('en-AU', { maximumFractionDigits: digits });
export const fmt1 = (v) => (v == null || !Number.isFinite(v) ? '–' : Number(v).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const pct = (p) => (p < 0.005 ? '<1%' : p > 0.995 ? '>99%' : `${Math.round(p * 100)}%`);
export const signed = (v, digits = 1) => `${v < -(10 ** -digits) / 2 ? '−' : '+'}${Math.abs(v).toFixed(digits)}`;
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const names = (rows) => rows.map((r) => r.name).join(' and ');
export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
export const stamp = (ms) => new Date(ms).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const clock = (ms) => new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
export const ago = (ms) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} hours ago`;
};

export const starRow = (n) => `<span class="stars" role="img" aria-label="${n} out of 5 stars">${[1, 2, 3, 4, 5].map((i) => `<span class="star ${n >= i ? 'on' : n >= i - 0.5 ? 'half' : ''}">★</span>`).join('')}</span>`;

export const moveBadge = (prev, rank) => {
  if (prev == null) return '';
  const d = prev - rank;
  if (!d) return '<span class="move flat" aria-label="no change">–</span>';
  return d > 0 ? `<span class="move up" aria-label="up ${d}">▲${d}</span>` : `<span class="move down" aria-label="down ${-d}">▼${-d}</span>`;
};

// A panel: titled box with optional right-hand tools. `body` is trusted markup.
export const panel = (title, body, { tools = '', cls = '' } = {}) =>
  `<section class="panel ${cls}"><header class="panel-h"><h2>${title}</h2>${tools ? `<div class="panel-tools">${tools}</div>` : ''}</header><div class="panel-b">${body}</div></section>`;

export const empty = (text) => `<p class="empty">${text}</p>`;

// Segmented control. items = [{id,label}]
export const segmented = (name, items, active) =>
  `<div class="seg" role="group" aria-label="${esc(name)}">${items.map((i) => `<button type="button" data-seg="${esc(name)}" data-id="${esc(i.id)}" aria-pressed="${i.id === active}">${i.label}</button>`).join('')}</div>`;
