// Players: the database (2K-style picker: showcase panel + dense table), free agents, compare, and the profile.
import { filterPlayers, form, lastFive, sortPlayers } from '../players-data.js';
import { esc, fmt1, panel, signed } from '../ui/dom.js';
import { headshot, spark, statusChip, teamLogo } from '../ui/player.js';
import { link, navigate, setQuery } from '../ui/router.js';
import { nextSort, pager, tableHtml } from '../ui/table.js';
import { renderCompare, compareSet } from './compare.js';
import { renderProfile } from './profile.js';

const PAGE_SIZE = 40;
const ASC_FIRST = ['name', 'team', 'pos', 'rank', 'adp', 'age'];
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const ui = { sel: null }; // the highlighted player survives tab changes and refreshes

/* ---------- columns ---------- */

const ownerCell = (p) => (p.fantasyTeam ? esc(p.fantasyTeam.name) : '<span class="badge accent">Free agent</span>');
const COLUMNS = {
  player: { key: 'name', label: 'Player', sortable: true, cell: (p) => `<div class="player-cell">${headshot(p.id)}<div><a class="plink" href="${link('players', p.id)}"><b>${esc(p.name)}</b></a><small>${p.jersey ? `#${esc(p.jersey)}` : ''}</small></div></div>` },
  pos: { key: 'pos', label: 'Pos', sortable: true, cell: (p) => esc(p.pos.join('/') || '–') },
  team: { key: 'team', label: 'NBA team', sortable: true, cell: (p) => `<span class="tcell">${teamLogo(p.team)}${esc(p.team || '–')}</span>` },
  age: { key: 'age', label: 'Age', num: true, sortable: true, cell: (p) => p.age ?? '–' },
  avg: { key: 'avg', label: 'FPTS avg', num: true, sortable: true, title: 'Fantasy points per game this season', cell: (p) => `<b>${fmt1(p.avg)}</b>` },
  proj: { key: 'proj', label: 'Projection', num: true, sortable: true, title: 'ESPN’s preseason projection, fantasy points per game', cell: (p) => fmt1(p.proj) },
  l5: { key: 'l5', label: 'Last 5', sortable: true, title: 'Fantasy points in the last five games', cell: (p) => spark(lastFive(p)) },
  rank: { key: 'rank', label: 'Rank', num: true, sortable: true, title: 'ESPN’s rank among all players this season', cell: (p) => p.rank ?? '–' },
  status: { key: 'status', label: 'Status', sortable: true, cell: statusChip },
  gp: { key: 'gp', label: 'GP', num: true, sortable: true, cell: (p) => p.gp },
  l7: { key: 'l7', label: 'L7', num: true, sortable: true, title: 'Fantasy points per game, last 7 days', cell: (p) => fmt1(p.l7) },
  l15: { key: 'l15', label: 'L15', num: true, sortable: true, cell: (p) => fmt1(p.l15) },
  l30: { key: 'l30', label: 'L30', num: true, sortable: true, cell: (p) => fmt1(p.l30) },
  form: { key: 'form', label: 'Form', num: true, sortable: true, title: 'Last 7 days against the season average', cell: (p) => { const f = form(p); return f == null ? '–' : `<span class="${f >= 0 ? 'pos-text' : 'neg-text'}">${signed(f, 0)}%</span>`; } },
  own: { key: 'own', label: 'Own %', num: true, sortable: true, title: 'Share of ESPN leagues that roster him', cell: (p) => `${fmt1(p.own)}%` },
  adp: { key: 'adp', label: 'ADP', num: true, sortable: true, title: 'Average draft position', cell: (p) => (p.adp ? fmt1(p.adp) : '–') },
  min: { key: 'min', label: 'MIN', num: true, cell: (p) => (p.per ? fmt1(p.per.min) : '–') },
  size: { key: 'size', label: 'Ht / Wt', cell: (p) => (p.height ? `${esc(p.height)} · ${esc(p.weight || '')}` : '–') },
  wk: { key: 'wk', label: 'Wk games', num: true, sortable: true, title: 'Games left this week', cell: (p) => p.weekGames ?? '–' },
  owner: { key: 'owner', label: 'Fantasy team', cell: ownerCell },
};
const BASE = ['player', 'pos', 'team', 'age', 'avg', 'proj', 'l5', 'rank', 'status'];
const OPTIONAL = [['gp', 'Games played'], ['l7', 'Last 7'], ['l15', 'Last 15'], ['l30', 'Last 30'], ['form', 'Form'], ['own', 'Owned %'], ['adp', 'ADP'], ['min', 'Minutes'], ['size', 'Height / weight'], ['wk', 'Games this week'], ['owner', 'Fantasy team']];

const chosenCols = () => {
  try { return new Set(JSON.parse(localStorage.getItem('pw:plcols')) || []); } catch { return new Set(); }
};
const saveCols = (set) => { try { localStorage.setItem('pw:plcols', JSON.stringify([...set])); } catch {} };

/* ---------- data helpers ---------- */

// Games each NBA team has left this week, for the schedule sort
function addWeekGames(app, players) {
  const { week, currentSP } = app.model;
  const games = app.ctx.pro.games;
  for (const p of players) p.weekGames = week.sps.filter((sp) => sp >= currentSP && games.get(p.proTeamId)?.has(sp)).length;
}

function sortRows(rows, sort) {
  if (sort.key === 'wk') return [...rows].sort((a, b) => ((a.weekGames ?? -1) - (b.weekGames ?? -1)) * (sort.asc ? 1 : -1) || b.avg - a.avg);
  return sortPlayers(rows, sort.key, sort.asc);
}

/* ---------- the showcase panel (left) ---------- */

export function showcaseHtml(p, app) {
  if (!p) return panel('Player', '<p class="empty">Pick a player.</p>', { cls: 'showcase' });
  const f = form(p);
  const per = p.per;
  const line = per ? [['PTS', per.pts], ['REB', per.reb], ['AST', per.ast], ['STL', per.stl], ['BLK', per.blk], ['3PM', per.tpm]].map(([k, v]) => `<div><span>${k}</span><b>${fmt1(v)}</b></div>`).join('') : '';
  const inCompare = compareSet.has(p.id);
  return `<section class="panel showcase">
    <div class="show-top">
      ${headshot(p.id, 'show-img')}
      <div class="show-id">
        <h3>${esc(p.name)}</h3>
        <p class="tcell">${teamLogo(p.team, 'logo lg')}<span>${esc(p.team)} · ${esc(p.pos.join('/') || '–')}${p.jersey ? ` · #${esc(p.jersey)}` : ''}</span></p>
        <p>${statusChip(p)} ${p.fantasyTeam ? `<span class="badge">${esc(p.fantasyTeam.name)}</span>` : '<span class="badge accent">Free agent</span>'}</p>
      </div>
    </div>
    <div class="stats">
      <div class="stat accent"><span>FPTS avg</span><b>${fmt1(p.avg)}</b><small>${p.gp} games</small></div>
      <div class="stat"><span>Projection</span><b>${fmt1(p.proj)}</b><small>ESPN preseason</small></div>
      <div class="stat"><span>Last 7</span><b>${fmt1(p.l7)}</b><small>${f == null ? '' : `${signed(f, 0)}% vs season`}</small></div>
      <div class="stat"><span>Rank</span><b>${p.rank ?? '–'}</b><small>${p.posRank ? `${p.homePos || ''} #${p.posRank}` : ''}</small></div>
    </div>
    <div class="show-body">
      <div class="show-row"><span>Last 5 games</span>${spark(lastFive(p), { height: 34 })}</div>
      ${line ? `<div class="line5">${line}</div>` : ''}
      <div class="show-row"><span>Owned in ESPN leagues</span><b>${fmt1(p.own)}%</b></div>
      ${p.age ? `<div class="show-row"><span>Age · size</span><b>${p.age}${p.height ? ` · ${esc(p.height)}` : ''}</b></div>` : ''}
    </div>
    <div class="show-actions">
      <a class="btn primary" href="${link('players', p.id)}">Full profile</a>
      <button type="button" class="btn${inCompare ? ' on' : ''}" data-go="compare" data-id="${p.id}">${inCompare ? 'In compare' : 'Compare'}</button>
    </div>
  </section>`;
}

/* ---------- the database and free-agent tables ---------- */

function mountTable(app, el, route, state, mode) {
  const q = route.query;
  const players = state.players.filter((p) => p.proTeamId); // players with no NBA team can't be played
  if (mode === 'free') addWeekGames(app, players);
  const cols = () => {
    const picked = chosenCols();
    return [...BASE, ...OPTIONAL.map(([k]) => k).filter((k) => picked.has(k) || (mode === 'free' && ['wk', 'own'].includes(k)))].map((k) => COLUMNS[k]);
  };
  const f = { q: q.get('q') || '', pos: q.get('pos') || '', team: q.get('team') || '', avail: mode === 'free' ? 'free' : q.get('avail') || '', health: q.get('health') || '', owner: q.get('owner') || '' };
  const key = q.get('sort') || (mode === 'free' ? 'rank' : 'avg');
  let sort = { key, asc: q.has('dir') ? q.get('dir') === 'asc' : ASC_FIRST.includes(key) };
  let page = Number(q.get('page')) || 1;

  const teams = [...new Set(players.map((p) => p.team).filter(Boolean))].sort();
  const sel = (name, label, options, value) => `<label class="field"><span>${label}</span><select data-f="${name}"><option value="">All</option>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const presets = mode === 'free'
    ? `<label class="field"><span>Sort by</span><select data-preset>${[['rank:1', 'Best ranked'], ['avg:0', 'Season average'], ['l7:0', 'Recent form (last 7)'], ['form:0', 'Most improved'], ['wk:0', 'Games this week'], ['own:0', 'Most owned'], ['pos:1', 'Position'], ['status:1', 'Healthiest first']].map(([v, l]) => `<option value="${v}"${v === `${sort.key}:${sort.asc ? 1 : 0}` ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`
    : '';

  el.innerHTML = `<div class="players-layout">
    <div id="pl-show"></div>
    <section class="panel flush players-main">
      <header class="panel-h"><h2>${mode === 'free' ? 'Free agents' : 'Players database'}</h2><div class="panel-tools"><span class="note" id="pl-count"></span>
        <details class="colpick"><summary class="btn sm">Columns</summary><div class="colmenu">${OPTIONAL.map(([k, l]) => `<label><input type="checkbox" data-col="${k}"${chosenCols().has(k) ? ' checked' : ''}> ${l}</label>`).join('')}</div></details></div></header>
      <div class="filters">
        <label class="field grow"><span>Search</span><input id="pl-q" type="search" placeholder="Player or team" value="${esc(f.q)}" autocomplete="off"></label>
        ${sel('pos', 'Position', POSITIONS.map((p) => [p, p]), f.pos)}
        ${sel('team', 'NBA team', teams.map((t) => [t, t]), f.team)}
        ${mode === 'free' ? presets : sel('avail', 'Availability', [['free', 'Free agents'], ['owned', 'On a team']], f.avail)}
        ${sel('health', 'Health', [['healthy', 'Healthy'], ['hurt', 'Injured']], f.health)}
        ${mode === 'free' ? '' : sel('owner', 'Fantasy team', app.ctx.league.teams.map((t) => [t.id, t.name]), f.owner)}
      </div>
      <div id="pl-results" tabindex="0" aria-label="Players. Use the arrow keys to move and Enter to open a profile."></div>
    </section>
  </div>`;

  const results = el.querySelector('#pl-results');
  let rows = [];

  function drawResults() {
    rows = sortRows(filterPlayers(players, f), sort);
    const pg = pager(rows.length, page, PAGE_SIZE);
    page = pg.page;
    const slice = rows.slice(pg.from, pg.to);
    if (!rows.some((p) => p.id === ui.sel)) ui.sel = slice[0]?.id ?? null;
    results.innerHTML = `${tableHtml(cols(), slice, { sort, selected: ui.sel, empty: 'No players match these filters.' })}${pg.html}`;
    el.querySelector('#pl-count').textContent = `${rows.length} players${state.loading ? ' · loading ages…' : ''}`;
    drawShow();
    el.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' });
  }
  const drawShow = () => (el.querySelector('#pl-show').innerHTML = showcaseHtml(state.byId.get(ui.sel), app));
  const remember = () => setQuery(route, { q: f.q, pos: f.pos, team: f.team, avail: mode === 'free' ? '' : f.avail, health: f.health, owner: f.owner, sort: sort.key, dir: sort.asc ? 'asc' : 'desc', page: page > 1 ? page : '' });
  const open = (id) => navigate(link('players', id));

  let timer;
  el.oninput = (e) => {
    if (e.target.id !== 'pl-q') return;
    clearTimeout(timer);
    timer = setTimeout(() => { f.q = e.target.value; page = 1; remember(); drawResults(); }, 120);
  };
  el.onchange = (e) => {
    const t = e.target;
    if (t.dataset.f) { f[t.dataset.f] = t.value; page = 1; remember(); drawResults(); }
    else if (t.dataset.preset != null) { const [k, a] = t.value.split(':'); sort = { key: k, asc: a === '1' }; page = 1; remember(); drawResults(); }
    else if (t.dataset.col) { const set = chosenCols(); t.checked ? set.add(t.dataset.col) : set.delete(t.dataset.col); saveCols(set); drawResults(); }
  };
  el.onclick = (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) { sort = nextSort(sort, th.dataset.sort, ASC_FIRST); page = 1; remember(); return drawResults(); }
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { page = Number(pg.dataset.page); remember(); return drawResults(); }
    const go = e.target.closest('[data-go=compare]');
    if (go) { const id = Number(go.dataset.id); compareSet.has(id) ? compareSet.delete(id) : compareSet.size < 4 && compareSet.add(id); return drawShow(); }
    if (e.target.closest('a')) return; // names are real links
    const tr = e.target.closest('tr[data-row]');
    if (tr) { ui.sel = Number(tr.dataset.row); drawResults(); }
  };
  el.ondblclick = (e) => { const tr = e.target.closest('tr[data-row]'); if (tr) open(tr.dataset.row); };
  el.onkeydown = (e) => {
    if (!results.contains(document.activeElement) && document.activeElement !== results) return;
    const i = rows.findIndex((p) => p.id === ui.sel);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (!next) return;
      ui.sel = next.id;
      page = Math.floor(rows.indexOf(next) / PAGE_SIZE) + 1;
      drawResults();
      results.focus({ preventScroll: true });
    } else if (e.key === 'Enter' && ui.sel) open(ui.sel);
  };

  drawResults();
  // Ages and sizes arrive a moment after the pool: refresh the table, not the filters
  const off = state.loading ? app.store.onBios(() => { if (app.route === route && el.contains(results)) drawResults(); off?.(); }) : null;
}

/* ---------- the page ---------- */

export default {
  id: 'players',
  label: 'Players',
  tabs: [{ id: '', label: 'Database' }, { id: 'free', label: 'Free agents' }, { id: 'compare', label: 'Compare' }],
  async render(app, el, route) {
    el.innerHTML = '<p class="loading">Loading players…</p>';
    let state;
    try {
      state = await app.store.get();
    } catch (err) {
      if (app.route !== route) return;
      el.innerHTML = panel('Players', `<p class="warn">Couldn’t load the player pool: ${esc(err.message)}</p><p class="note">Reload to try again.</p>`);
      return;
    }
    if (app.route !== route) return;
    if (!state.players.length) {
      el.innerHTML = panel('Players', '<p class="empty">No player data is available yet. On the GitHub version it appears after the next hourly build.</p>');
      return;
    }
    if (/^\d+$/.test(route.tab)) return renderProfile(app, el, route, state);
    if (route.tab === 'compare') return renderCompare(app, el, route, state);
    mountTable(app, el, route, state, route.tab === 'free' ? 'free' : 'all');
  },
};
