// Pieces for showing players and NBA teams: headshots, logos, status chips, tiny charts.
import { esc, fmt1 } from './dom.js';

export const headshot = (id, cls = 'shot') => `<img class="${cls}" src="https://a.espncdn.com/i/headshots/nba/players/full/${id}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
export const teamLogo = (abbr, cls = 'logo') => (abbr ? `<img class="${cls}" src="https://a.espncdn.com/i/teamlogos/nba/500/${esc(String(abbr).toLowerCase())}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '');

const SHORT = { OUT: 'Out', INJURY_RESERVE: 'IR', SUSPENSION: 'Susp', DAY_TO_DAY: 'DTD', GTD: 'GTD', QUESTIONABLE: 'Q', DOUBTFUL: 'Doubtful' };
export function statusChip(p) {
  if (!p.injury || p.injury === 'ACTIVE') return '<span class="badge good">Active</span>';
  const label = SHORT[p.injury] || p.injury.replace(/_/g, ' ').toLowerCase();
  const back = p.returnMs ? ` · back ${new Date(p.returnMs).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : '';
  return `<span class="inj" title="${esc(p.injuryDetail || label)}">${esc(label)}${esc(back)}</span>`;
}

// Five tiny bars for the last five fantasy scores, scaled to the biggest of them
export function spark(values, { height = 22 } = {}) {
  if (!values.length) return '<span class="muted">–</span>';
  const max = Math.max(...values, 1);
  return `<span class="spark" style="height:${height}px" role="img" aria-label="Last ${values.length} games: ${values.map((v) => fmt1(v)).join(', ')}">${values.map((v) => `<i style="height:${Math.max(8, (v / max) * 100)}%" title="${fmt1(v)}"></i>`).join('')}</span>`;
}

// A labelled bar from 0-100 (a percentile, a share)
export const bar = (label, value, { text, tone = '' } = {}) =>
  `<div class="rowbar"><span>${esc(label)}</span><div class="meter ${tone}"><span style="width:${Math.max(2, Math.min(100, value ?? 0))}%"></span></div><b>${esc(text ?? (value == null ? '–' : Math.round(value)))}</b></div>`;
