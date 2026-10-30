// Compare 2-4 players side by side. Every number is from ESPN's stats; the best value in each row is highlighted.
import { form, lastFive, spread } from '../players-data.js';
import { esc, fmt1, panel, signed } from '../ui/dom.js';
import { headshot, spark, statusChip, teamLogo } from '../ui/player.js';
import { link, setQuery } from '../ui/router.js';

export const compareSet = new Set();
const MAX = 4;

const pct1 = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
// [label, value(p) -> number|null, text(v), best: 'high'|'low']
const ROWS = [
  ['Fantasy points per game', (p) => p.avg, fmt1, 'high'],
  ['ESPN projection', (p) => p.proj, fmt1, 'high'],
  ['Last 7 days', (p) => p.l7, fmt1, 'high'],
  ['Last 15 days', (p) => p.l15, fmt1, 'high'],
  ['Last 30 days', (p) => p.l30, fmt1, 'high'],
  ['Form (last 7 vs season)', form, (v) => `${signed(v, 0)}%`, 'high'],
  ['Consistency (spread of last 5, lower is steadier)', spread, fmt1, 'low'],
  ['ESPN rank', (p) => p.rank, (v) => v, 'low'],
  ['Owned in ESPN leagues', (p) => p.own, (v) => `${fmt1(v)}%`, 'high'],
  ['Games played', (p) => p.gp, (v) => v, 'high'],
  ['Minutes', (p) => p.per?.min, fmt1, 'high'],
  ['Points', (p) => p.per?.pts, fmt1, 'high'],
  ['Rebounds', (p) => p.per?.reb, fmt1, 'high'],
  ['Assists', (p) => p.per?.ast, fmt1, 'high'],
  ['Steals', (p) => p.per?.stl, fmt1, 'high'],
  ['Blocks', (p) => p.per?.blk, fmt1, 'high'],
  ['Turnovers', (p) => p.per?.to, fmt1, 'low'],
  ['3-pointers made', (p) => p.per?.tpm, fmt1, 'high'],
  ['FG%', (p) => p.per?.fgPct, pct1, 'high'],
  ['FT%', (p) => p.per?.ftPct, pct1, 'high'],
  ['3P%', (p) => p.per?.tpPct, pct1, 'high'],
];

export function renderCompare(app, el, route, state) {
  const fromUrl = (route.query.get('ids') || '').split(',').map(Number).filter((n) => state.byId.has(n));
  if (fromUrl.length) { compareSet.clear(); fromUrl.slice(0, MAX).forEach((n) => compareSet.add(n)); }
  const draw = () => {
    const picked = [...compareSet].map((id) => state.byId.get(id)).filter(Boolean);
    const head = picked.map((p) => `<th scope="col" class="num cmp-head">${headshot(p.id, 'shot lg')}<br><a href="${link('players', p.id)}"><b>${esc(p.name)}</b></a><br><span class="tcell">${teamLogo(p.team)}${esc(p.team)} · ${esc(p.pos.join('/'))}</span><br>${statusChip(p)}<br><button type="button" class="link" data-rm="${p.id}">Remove</button></th>`).join('');
    const body = ROWS.map(([label, get, text, best]) => {
      const vals = picked.map(get).map((v) => (v == null || !Number.isFinite(v) ? null : v));
      const real = vals.filter((v) => v != null);
      const top = real.length > 1 ? (best === 'high' ? Math.max(...real) : Math.min(...real)) : null;
      return `<tr><th scope="row">${esc(label)}</th>${vals.map((v) => `<td class="num${v != null && v === top ? ' best' : ''}">${v == null ? '–' : text(v)}</td>`).join('')}</tr>`;
    }).join('');
    const last5 = `<tr><th scope="row">Last 5 games</th>${picked.map((p) => `<td class="num">${spark(lastFive(p), { height: 28 })}</td>`).join('')}</tr>`;
    const adder = picked.length < MAX
      ? `<label class="field"><span>Add a player (${picked.length} of ${MAX})</span><input id="cmp-add" list="cmp-names" placeholder="Start typing a name" autocomplete="off"></label><datalist id="cmp-names">${state.players.filter((p) => !compareSet.has(p.id)).map((p) => `<option value="${esc(p.name)}"></option>`).join('')}</datalist>`
      : '<span class="note">Four is the most. Remove one to add another.</span>';
    el.innerHTML = panel('Compare players', picked.length < 2
      ? `<div class="filters flat">${adder}</div><p class="lede">Pick two to four players to compare. You can also press Compare on any player in the database.</p>${picked.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th>${head}</tr></thead><tbody></tbody></table></div>` : ''}`
      : `<div class="filters flat">${adder}</div><div class="tbl-wrap"><table class="tbl cmp"><thead><tr><th></th>${head}</tr></thead><tbody>${last5}${body}</tbody></table></div><p class="note" style="padding:12px 16px">Highlighted cells are the best in the row. Everything comes from ESPN’s season stats, so players with few games played have noisy numbers.</p>`, { cls: 'flush' });
    setQuery(route, { ids: [...compareSet].join(',') });
  };
  draw();
  el.onclick = (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { compareSet.delete(Number(rm.dataset.rm)); draw(); }
  };
  el.onchange = (e) => {
    if (e.target.id !== 'cmp-add') return;
    const hit = state.players.find((p) => p.name.toLowerCase() === e.target.value.trim().toLowerCase());
    if (hit && compareSet.size < MAX) { compareSet.add(hit.id); draw(); }
  };
}
