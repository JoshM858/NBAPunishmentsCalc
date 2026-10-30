// Dependency-free SVG charts. Colours come from CSS variables so they follow the theme.
import { esc, fmt1 } from './dom.js';

const W = 640;

// Bars for a series (game scores), with an optional dashed average line. items = [{ label, value, note }]
export function barChart(items, { avg, height = 180, unit = '' } = {}) {
  if (!items.length) return '<p class="empty">No games yet.</p>';
  const max = Math.max(...items.map((i) => i.value), avg || 0, 1) * 1.1;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const bw = Math.min(28, (iw / items.length) * 0.7);
  const step = iw / items.length;
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.5, 1].map((t) => max * t / 1.1);
  const grid = ticks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line-soft)"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="10">${Math.round(v)}</text>`).join('');
  const bars = items.map((it, i) => {
    const x = pad.l + step * i + (step - bw) / 2;
    const hot = avg != null && it.value >= avg;
    return `<g><title>${esc(it.label)}: ${fmt1(it.value)}${unit}${it.note ? ` (${esc(it.note)})` : ''}</title><rect x="${x}" y="${y(it.value)}" width="${bw}" height="${Math.max(1, pad.t + ih - y(it.value))}" fill="${hot ? 'var(--accent)' : '#59616e'}"/>${items.length <= 24 ? `<text x="${x + bw / 2}" y="${height - 6}" text-anchor="middle" fill="var(--muted)" font-size="9">${esc(it.label)}</text>` : ''}</g>`;
  }).join('');
  const line = avg != null ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--text)" stroke-dasharray="4 4" opacity="0.6"/><text x="${W - pad.r}" y="${y(avg) - 4}" text-anchor="end" fill="var(--text-2)" font-size="10">avg ${fmt1(avg)}</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="Bar chart of ${items.length} values, average ${avg != null ? fmt1(avg) : 'n/a'}">${grid}${bars}${line}</svg>`;
}
