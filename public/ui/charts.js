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

// One colour per team, readable on the dark background. The first is the accent.
export const PALETTE = ['#e8f02a', '#6fb3d2', '#d98a5f', '#8fcf9b', '#b393d9', '#e07a8f', '#7fd0c8', '#c4b27a', '#8aa0b8', '#d4d4d4'];

const niceMax = (v) => {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v)) || p * 10;
};

/**
 * Lines over a shared x axis. series = [{ name, color, bold, points: [{ x, y }] }]
 * opts: { xLabel(x) -> text, height }
 */
export function lineChart(series, { xLabel = (x) => x, height = 260 } = {}) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return '<p class="empty">No data yet.</p>';
  const pad = { l: 46, r: 30, t: 12, b: 26 };
  const xs = pts.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const ymax = niceMax(Math.max(...pts.map((p) => p.y)));
  const X = (x) => pad.l + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - y / ymax) * (height - pad.t - pad.b);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(ymax * t)}" y2="${Y(ymax * t)}" stroke="var(--line-soft)"/><text x="${pad.l - 6}" y="${Y(ymax * t) + 4}" text-anchor="end" fill="var(--muted)" font-size="10">${Math.round(ymax * t).toLocaleString('en-AU')}</text>`).join('');
  const ticks = [...new Set(xs)].sort((a, b) => a - b);
  const every = Math.ceil(ticks.length / 8);
  const shown = ticks.filter((_, i) => i % every === 0);
  const xt = shown.map((x, i) => `<text x="${X(x)}" y="${height - 8}" text-anchor="${i === shown.length - 1 && X(x) > W - 40 ? 'end' : 'middle'}" fill="var(--muted)" font-size="10">${esc(xLabel(x))}</text>`).join('');
  const lines = series.map((s) => {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join('');
    const last = s.points.at(-1);
    return `<g><title>${esc(s.name)}</title><path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.bold ? 3 : 1.6}" stroke-linejoin="round" opacity="${s.bold ? 1 : 0.85}"/>${last ? `<circle cx="${X(last.x)}" cy="${Y(last.y)}" r="${s.bold ? 4 : 2.5}" fill="${s.color}"/>` : ''}</g>`;
  }).join('');
  const legend = `<ul class="legend">${series.map((s) => `<li><i style="background:${s.color}"></i>${esc(s.name)}</li>`).join('')}</ul>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="Line chart of ${series.length} series">${grid}${xt}${lines}</svg>${legend}`;
}

/**
 * Dots. points = [{ x, y, label, href?, hot? }]; hot dots are drawn in the accent colour on top.
 */
export function scatter(points, { xLabel, yLabel, height = 300, xMax, yMax } = {}) {
  if (!points.length) return '<p class="empty">No data yet.</p>';
  const W = 960;
  const pad = { l: 46, r: 14, t: 12, b: 34 };
  const mx = xMax ?? niceMax(Math.max(...points.map((p) => p.x)));
  const my = yMax ?? niceMax(Math.max(...points.map((p) => p.y)));
  const X = (x) => pad.l + (x / mx) * (W - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - y / my) * (height - pad.t - pad.b);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(my * t)}" y2="${Y(my * t)}" stroke="var(--line-soft)"/><text x="${pad.l - 6}" y="${Y(my * t) + 4}" text-anchor="end" fill="var(--muted)" font-size="10">${Math.round(my * t)}</text><text x="${X(mx * t)}" y="${height - 16}" text-anchor="middle" fill="var(--muted)" font-size="10">${Math.round(mx * t)}</text>`).join('');
  const dot = (p) => {
    const c = `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.hot ? 3.6 : 2.6}" fill="${p.hot ? 'var(--accent)' : '#6b7482'}" opacity="${p.hot ? 0.9 : 0.6}"><title>${esc(p.label)}</title></circle>`;
    return p.href ? `<a href="${esc(p.href)}">${c}</a>` : c;
  };
  const ordered = [...points].sort((a, b) => Number(a.hot) - Number(b.hot));
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="Scatter plot of ${points.length} players">${grid}<text x="${W / 2}" y="${height - 2}" text-anchor="middle" fill="var(--text-2)" font-size="11">${esc(xLabel || '')}</text><text x="12" y="${height / 2}" fill="var(--text-2)" font-size="11" transform="rotate(-90 12 ${height / 2})" text-anchor="middle">${esc(yLabel || '')}</text>${ordered.map(dot).join('')}</svg>`;
}

// Horizontal bars made of segments (HTML, not SVG, so text wraps). rows = [{ label, parts: [{ label, value }] }]
export function stackedBars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((s, p) => s + p.value, 0)));
  return `<div class="stack">${rows.map((r) => {
    const total = r.parts.reduce((s, p) => s + p.value, 0);
    return `<div class="stack-row"><span class="stack-l">${esc(r.label)}</span><div class="stack-bar" style="width:${(total / max) * 100}%">${r.parts.map((p, i) => `<i style="flex:${p.value};opacity:${(1 - (i / Math.max(1, r.parts.length)) * 0.65).toFixed(2)}" title="${esc(p.label)}: ${fmt1(p.value)}"></i>`).join('')}</div><b>${Math.round(total).toLocaleString('en-AU')}</b></div>`;
  }).join('')}</div>`;
}
