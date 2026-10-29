import { buildModel, dayInfo, dayLabel, duration, etDateKey, gameDays, localTime, validTimeZone, zoneName } from './logic.js';
import { loadLeague, loadSeasonDays } from './pipeline.js';
import { createApiSource, createSnapshotSource, checkSnapshot, fetchScoreboard } from './sources.js';

const HOUR = 3_600_000;
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const FORCE_ROSTER = params.get('source') === 'roster';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => Number(v || 0).toLocaleString('en-AU', { maximumFractionDigits: 1 });
const pct = (p) => (p < 0.005 ? '<1%' : p > 0.995 ? '>99%' : `${Math.round(p * 100)}%`);
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const stamp = (ms) => new Date(ms).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const clock = (ms) => new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const names = (rows) => rows.map((r) => r.name).join(' and ');

const AGO = (ms) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} hours ago`;
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATIC_POLL = 10 * 60_000;
const STALE_AFTER = 3 * HOUR;

/* ---------- Data source ---------- */

async function apiGet(path, { fresh } = {}) {
  let res;
  try {
    res = await fetch(path, fresh ? { cache: 'no-store' } : undefined);
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection, or that the local server is still running.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status}).`);
  if (body == null) throw new Error('The server sent something unexpected. Try again.');
  return body;
}

// A server with /api (local or Cloudflare) wins; otherwise this is the static GitHub Pages site.
async function pickSource({ fresh }) {
  if (DEMO) return (await import('./demo.js')).createDemo();
  let hasApi = false;
  const staticSite = document.querySelector('meta[name=pw-mode]')?.content === 'static';
  if (!staticSite) {
    try {
      const res = await fetch('api/config', { cache: 'no-store' });
      hasApi = (res.headers.get('content-type') || '').includes('json');
    } catch {}
  }
  if (hasApi) return createApiSource(apiGet);

  let res;
  try {
    res = await fetch('data/snapshot.json', { cache: fresh ? 'reload' : 'no-cache' });
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection and try again.');
  }
  if (res.status === 404) {
    const err = new Error('No data snapshot has been published yet.');
    err.setup = 'snapshot';
    throw err;
  }
  const snap = await res.json().catch(() => null);
  return createSnapshotSource(checkSnapshot(snap));
}

// Finished days are final after a day, so keep them in the browser for 12 hours.
const dayCache = (cfg) => ({
  key: (sp) => `pw:${cfg.leagueId}:${cfg.season}:${sp}`,
  get(sp) {
    if (DEMO || cfg.platform === 'static') return null;
    try {
      const hit = JSON.parse(localStorage.getItem(this.key(sp)));
      if (hit && Date.now() - hit.t < 12 * HOUR) return new Map(hit.d);
    } catch {}
    return null;
  },
  set(sp, dayMap) {
    if (DEMO || cfg.platform === 'static') return;
    try {
      localStorage.setItem(this.key(sp), JSON.stringify({ t: Date.now(), d: [...dayMap] }));
    } catch {}
  },
});

/* ---------- Load ---------- */

const state = { tab: 'week', recapView: 'live', model: null, ctx: null, src: null, updated: 0, tried: 0, busy: false, check: null, board: null, tz: 'Australia/Melbourne' };
const BOARD_POLL = 3 * 60_000;

async function load({ fresh = false } = {}) {
  if (state.busy) return;
  state.tried = Date.now();
  setBusy(true);
  try {
    const src = await pickSource({ fresh });
    const cfg = await src.config();
    if (!cfg.configured) return renderSetup(cfg);

    const ctx = await loadLeague(src, { forceRoster: FORCE_ROSTER, fresh, cache: dayCache(cfg) });
    state.src = src;
    state.ctx = ctx;
    state.tz = validTimeZone(cfg.timezone) ? cfg.timezone : 'Australia/Melbourne';
    state.model = buildModel({ ...ctx, now: src.now(), dayDone: boardDone() });
    state.updated = Date.now();
    state.check = null;
    state.seasonLoaded = false;
    if (src.offline) await loadSeason(); // history is already in the snapshot
    render();
    refreshBoard();
  } catch (err) {
    renderError(err);
  } finally {
    setBusy(false);
  }
}

// Pull every finished day so we can fill the Shame tab and compare with ESPN's totals.
async function loadSeason() {
  const { shame, check } = await loadSeasonDays(state.ctx, state.src, { cache: dayCache(state.ctx.cfg) });
  state.model.shame = shame;
  state.check = check;
  state.seasonLoaded = true;
}

/* ---------- Render ---------- */

function setBusy(on) {
  state.busy = on;
  const b = $('refresh');
  b.disabled = on;
  b.textContent = on ? 'Refreshing…' : 'Refresh';
}

function render() {
  const m = state.model;
  renderGameDay();
  $('league-name').textContent = m.leagueName;
  $('week-label').textContent = `Week ${m.week.id}, day ${m.week.dayNumber} of ${m.week.days}. ${m.week.label}`;
  const snap = state.src.generatedAt;
  $('updated').textContent = snap
    ? `Data from ${stamp(snap)} (${AGO(snap)}). Checked ${clock(state.updated)}.`
    : `Updated ${clock(state.updated)}. Next ${clock(state.updated + HOUR)}.`;
  document.title = `${m.loser?.name ?? 'Punishment Watch'} on track for the punishment`;

  const banner = $('banner');
  const stale = snap && Date.now() - snap > STALE_AFTER;
  banner.hidden = !DEMO && !stale;
  if (DEMO) banner.innerHTML = 'Demo data. <a href="./">Open your league</a> once the ESPN cookies are set.';
  else if (stale) banner.textContent = `This data is ${AGO(snap).replace(' ago', '')} old. The hourly GitHub job may be failing: open the repo’s Actions tab to see why.`;

  $('hero').innerHTML = renderHero(m);
  $('panel-week').innerHTML = renderWeek(m);
  $('panel-recap').innerHTML = renderRecap(m);
  $('panel-shame').innerHTML = renderShame(m);
  $('foot').innerHTML = renderFoot(m);
  document.querySelector('.tabs').hidden = false;
  showTab(state.tab, false);
}

function renderHero(m) {
  const L = m.loser;
  if (!L) return '';
  const r = m.recap;
  const final = r?.final
    ? `<p class="final">Week ${r.week.id} final: ${esc(names(r.last))} ${r.last.length > 1 ? 'share' : 'cops'} the punishment on ${fmt(r.last[0].weekPts)}.</p>`
    : '';
  const gap = m.safety ? `${fmt(m.gap)} behind ${esc(m.safety.name)} on projection.` : '';
  return `${final}
    <div class="key">
      <div class="paint">
        <p class="kicker">On track for the punishment</p>
        <h2 class="key-team">${esc(L.name)}</h2>
        ${L.owner ? `<p class="key-owner">${esc(L.owner)}</p>` : ''}
        <p class="key-line">Sitting on ${fmt(L.weekPts)}, projected ${fmt(L.projFinal)}. ${gap}
          ${plural(L.gamesLeft, 'game')} left across ${plural(L.playersLeft, 'player')}.</p>
      </div>
      <div class="ft" aria-label="${pct(L.odds)} chance of the punishment">
        <span class="ft-num">${pct(L.odds)}</span>
        <span class="ft-label">chance</span>
      </div>
    </div>`;
}

function moveBadge(prev, rank) {
  if (prev == null) return '';
  const d = prev - rank;
  if (!d) return '<span class="move flat" aria-label="no change">–</span>';
  return d > 0
    ? `<span class="move up" aria-label="up ${d}">▲${d}</span>`
    : `<span class="move down" aria-label="down ${-d}">▼${-d}</span>`;
}

function renderWeek(m) {
  const top = Math.max(1, ...m.rows.map((r) => r.weekPts));
  const lastRank = Math.max(...m.rows.map((r) => r.rank));
  const items = m.rows
    .map((r) => {
      const cls = [r.rank === lastRank && 'last', r.id === m.loser?.id && 'danger'].filter(Boolean).join(' ');
      return `<li class="row ${cls}">
        <div class="rank"><span class="pos">${r.rank}</span>${moveBadge(r.prevRank, r.rank)}</div>
        <div class="who">
          <p class="team">${esc(r.name)}</p>
          ${r.owner ? `<p class="owner">${esc(r.owner)}</p>` : ''}
        </div>
        <div class="pts">
          <span class="big">${fmt(r.weekPts)}</span>
          ${r.todayPts ? `<span class="today">+${fmt(r.todayPts)} today</span>` : ''}
        </div>
        <div class="bar" aria-hidden="true"><span style="width:${(r.weekPts / top) * 100}%"></span></div>
        <p class="facts">
          <span>Projected <b>${fmt(r.projFinal)}</b></span>
          <span>${plural(r.gamesLeft, 'game')} left, ${plural(r.playersLeft, 'player')}</span>
          <span class="${r.odds >= 0.1 ? 'risk hot' : 'risk'}">${pct(r.odds)} risk</span>
        </p>
      </li>`;
    })
    .join('');
  return `<p class="lede">Points since the week started. Everyone resets to 0 when the next week begins.</p>
    <ol class="board">${items}</ol>`;
}

function renderRecap(m) {
  const live = m.recapLive && state.recapView !== 'final' ? m.recapLive : null;
  const r = live || m.recap;
  if (!r) return '<p class="empty">The first recap appears after the season’s opening night.</p>';

  const lines = [];
  if (r.final) lines.push(`<li><b>${esc(names(r.last))}</b> finished last for week ${r.week.id} on ${fmt(r.last[0].weekPts)}.</li>`);
  for (const c of r.climbers.slice(0, 3)) lines.push(`<li><b>${esc(c.name)}</b> climbed ${c.move} to ${ordinal(c.rank)} with ${fmt(c.dayPts)} on the day.</li>`);
  for (const f of r.fallers.slice(0, 3)) lines.push(`<li><b>${esc(f.name)}</b> dropped ${-f.move} to ${ordinal(f.rank)}.</li>`);
  if (!r.climbers.length && !r.fallers.length) lines.push(`<li>${r.dayNumber === 1 ? 'First day of the week, so these are the starting positions.' : 'No change in the order.'}</li>`);
  lines.push(`<li>Best day: <b>${esc(r.topDay.name)}</b> with ${fmt(r.topDay.dayPts)}. Worst: <b>${esc(r.lowDay.name)}</b> with ${fmt(r.lowDay.dayPts)}.</li>`);

  const table = r.rows
    .map((x) => `<tr class="${r.last.some((l) => l.id === x.id) ? 'last' : ''}">
        <td class="num">${x.rank}${moveBadge(x.prevRank, x.rank)}</td>
        <th scope="row">${esc(x.name)}</th>
        <td class="num">${fmt(x.dayPts)}</td>
        <td class="num strong">${fmt(x.weekPts)}</td>
      </tr>`)
    .join('');

  const players = r.best
    ? `<div class="players">
        <p><span class="tag">Player of the day</span><b>${esc(r.best.name)}</b> ${fmt(r.best.pts)} for ${esc(r.best.team)}</p>
        <p><span class="tag">Dud of the day</span><b>${esc(r.worst.name)}</b> ${fmt(r.worst.pts)} for ${esc(r.worst.team)}</p>
      </div>`
    : '';

  const sameWeek = r.week.id === m.week.id;
  const rest = [...m.rows]
    .sort((a, b) => b.odds - a.odds || a.projFinal - b.projFinal)
    .map((x) => `<tr class="${x.id === m.loser?.id ? 'last' : ''}">
        <th scope="row">${esc(x.name)}</th>
        <td class="num">${x.gamesLeft}</td>
        <td class="num">${x.playersLeft}</td>
        <td class="num">${fmt(x.projFinal)}</td>
        <td class="num strong">${pct(x.odds)}</td>
      </tr>`)
    .join('');

  const switcher = m.recapLive
    ? `<div class="seg" role="group" aria-label="Which day">
        <button type="button" data-recap="live" aria-pressed="${Boolean(live)}">${esc(m.recapLive.label)}, so far</button>
        <button type="button" data-recap="final" aria-pressed="${!live}">${esc(m.recap.label)}, final</button>
      </div>`
    : '';
  return `${switcher}<h2 class="panel-title">${esc(r.label)}${live ? ' so far' : ''}</h2>
    <p class="lede">${live ? 'Games are still being played, so these are points so far for' : 'Results for'} week ${r.week.id}, day ${r.dayNumber} of ${r.week.sps.length} (US date).</p>
    <ul class="movers">${lines.join('')}</ul>
    <div class="scroll"><table>
      <thead><tr><th scope="col" class="num">Pos</th><th scope="col">Team</th><th scope="col" class="num">Day</th><th scope="col" class="num">Week</th></tr></thead>
      <tbody>${table}</tbody>
    </table></div>
    ${players}
    <h3 class="panel-sub">${sameWeek ? 'Rest of the week' : `Week ${m.week.id} outlook`}</h3>
    <p class="lede">The rest of the week is simulated: today’s set lineup, then each team’s best players on later days. Injured players are discounted, healthy ones still sit out about 1 game in 12, and a close race stays close.</p>
    <div class="scroll"><table>
      <thead><tr><th scope="col">Team</th><th scope="col" class="num">Games</th><th scope="col" class="num">Players</th><th scope="col" class="num">Projected</th><th scope="col" class="num">Risk</th></tr></thead>
      <tbody>${rest}</tbody>
    </table></div>`;
}

function renderShame(m) {
  const weeks = m.shame;
  const needsLoad = state.ctx.source === 'roster' && !state.seasonLoaded && m.week.id > 1;
  if (needsLoad && !weeks.length) {
    return `<p class="empty">Past weeks are rebuilt from ESPN’s daily stats, one request per day.</p>
      <button type="button" class="action" data-action="season">Load past weeks</button>`;
  }
  if (!weeks.length) return '<p class="empty">No finished weeks yet. The first punishment is decided after the last game of week 1.</p>';

  const tally = new Map();
  for (const w of weeks) for (const l of w.losers) tally.set(l.id, (tally.get(l.id) || 0) + 1);
  const nameOf = (id) => state.ctx.league.teams.find((t) => t.id === id)?.name || `Team ${id}`;
  const counts = [...tally].sort((a, b) => b[1] - a[1]).map(([id, n]) => `<li><b>${esc(nameOf(id))}</b><span>${n}</span></li>`).join('');
  const list = weeks
    .map((w) => `<li>
        <p class="wk">Week ${w.week}<span>${esc(w.label)}</span></p>
        <p class="who-lost">${esc(w.losers.map((l) => nameOf(l.id)).join(' and '))}</p>
        <p class="sub">${fmt(w.losers[0].pts)} points${w.margin ? `, ${fmt(w.margin)} short of safety` : ''}. Top score ${fmt(w.top.pts)} by ${esc(nameOf(w.top.id))}.</p>
      </li>`)
    .join('');
  const more = needsLoad ? '<button type="button" class="action" data-action="season">Load all past weeks</button>' : '';
  return `<h2 class="panel-title">Punishments so far</h2>
    <ol class="tally">${counts}</ol>
    <ol class="shame">${list}</ol>${more}`;
}

function renderFoot(m) {
  const how = m.source === 'schedule' ? 'ESPN’s day-by-day team scores' : 'each day’s ESPN lineup and player stats';
  const weeks = m.weeksSource === 'espn' ? 'Weeks follow ESPN’s matchup periods.' : `Weeks run ${DAYS[m.weekStart]} to ${DAYS[(m.weekStart + 6) % 7]}, US Eastern time.`;
  const refresh = state.src.kind === 'static' ? 'The data updates about hourly from a GitHub job; Refresh reloads the latest snapshot.' : 'Auto-refreshes hourly.';
  let check = '<button type="button" class="link" data-action="check">Check against ESPN season totals</button>';
  if (state.check) {
    const bad = state.check.filter((c) => !c.ok);
    check = bad.length
      ? `<p class="warn">${plural(bad.length, 'team')} don’t match ESPN’s season total: ${bad.map((b) => `${esc(b.name)} (ESPN ${fmt(b.espn)}, rebuilt ${fmt(b.ours)})`).join('; ')}. Try <a href="?source=roster">roster mode</a>.</p>`
      : `<p class="ok">Every team’s rebuilt total matches ESPN’s season total${state.check.every((c) => c.basis === 'finished days') ? ' (ESPN counts finished days only, so today isn’t in it)' : ''}.</p>`;
  }
  return `<p>Weekly points are rebuilt from ${how}, so they start at 0 each week no matter what ESPN’s season total says. Dates are US game days. ${weeks} ${refresh}</p>${check}`;
}

const SETUP = {
  local: `<p>This is the local server. Open the <code>.env</code> file in the project folder (copy <code>.env.example</code> if it isn’t there) and set:</p>
      <ol>
        <li><code>LEAGUE_ID</code>: the number after <code>leagueId=</code> in your ESPN league link.</li>
        <li><code>SEASON</code>: <code>2027</code> for the 2026-27 season.</li>
        <li><code>ESPN_S2</code> and <code>ESPN_SWID</code>: your ESPN login cookies, unless the league is viewable to the public.</li>
      </ol>
      <p>Stop the server, run <code>npm start</code> again, then reload this page.</p>`,
  cloudflare: `<p>In Cloudflare, open this Worker’s settings, then Variables and Secrets, and add:</p>
      <ol>
        <li><code>LEAGUE_ID</code> as text: the number after <code>leagueId=</code> in your ESPN league link.</li>
        <li><code>SEASON</code> as text: <code>2027</code> for the 2026-27 season.</li>
        <li><code>ESPN_S2</code> and <code>ESPN_SWID</code> as secrets, unless the league is viewable to the public.</li>
      </ol>
      <p>Deploy, then reload this page.</p>`,
  snapshot: `<p>This site shows a data snapshot that a GitHub Action builds every hour, and the first one hasn’t been published yet. In the repository:</p>
      <ol>
        <li>Settings, then Secrets and variables, then Actions: add the secrets <code>ESPN_S2</code> and <code>ESPN_SWID</code> and the variables <code>LEAGUE_ID</code> and <code>SEASON</code>.</li>
        <li>Settings, then Pages: set Source to <b>GitHub Actions</b>.</li>
        <li>Actions tab, then <b>Build and deploy</b>, then <b>Run workflow</b>.</li>
      </ol>
      <p>Reload this page when the run finishes.</p>`,
};

function renderSetup(cfg, kind = cfg?.platform === 'local' ? 'local' : 'cloudflare') {
  $('hero').innerHTML = `<div class="setup">
      <h2>${kind === 'snapshot' ? 'Waiting for the first data snapshot' : 'Connect your ESPN league'}</h2>
      ${SETUP[kind]}
      <p><a href="?demo">Preview with demo data</a></p>
    </div>`;
  document.querySelector('.tabs').hidden = true;
  for (const p of ['week', 'recap', 'shame']) $(`panel-${p}`).hidden = true;
}

function renderError(err) {
  if (err.setup) return renderSetup(null, err.setup);
  $('hero').innerHTML = `<div class="error" role="alert">
      <h2>Couldn’t load the league</h2>
      <p>${esc(err.message)}</p>
      <button type="button" class="action" data-action="retry">Try again</button>
    </div>`;
}

/* ---------- Game day times ---------- */

// True/false once the live scoreboard covers today's slate, otherwise undefined (the clock decides).
// A snapshot's numbers can be older than the scoreboard, so the snapshot keeps using the clock.
function boardDone() {
  if (!state.ctx || state.src?.kind === 'static') return undefined;
  const info = dayInfo(state.ctx.pro, state.ctx.league.currentSP, Date.now(), state.board);
  return info && !info.estimated ? info.state === 'done' : undefined;
}

const when = (ms) => `${localTime(ms, state.tz)} ${zoneName(ms, state.tz)}`;

function dayLine(d, now, { next = false } = {}) {
  const label = `${dayLabel(state.ctx.pro, d.sp)} (US)`;
  const slate = `${plural(d.games, 'game')}, first game ${when(d.firstTip)}, likely finished by ${localTime(d.likelyEnd, state.tz)}.`;
  const tag = d.estimated ? ' <span class="est">estimated</span>' : '';
  if (next) return `<p><b>Next: ${esc(label)}:</b> ${esc(slate)}</p>`;
  let status;
  if (d.state === 'done') status = '<span class="chip done">Finished for the day</span>';
  else if (d.state === 'live') {
    const left = d.likelyEnd - now;
    const progress = d.final == null ? '' : `${d.final} of ${d.games} games final. `;
    status = `<span class="chip live">In progress</span> ${progress}${left > 0 ? `About ${duration(left)} to go.` : 'Should be wrapping up.'}`;
  } else status = `<span class="chip soon">${d.firstTip - now > 60_000 ? `Starts in ${duration(d.firstTip - now)}` : 'Starting now'}</span>`;
  return `<p><b>${esc(label)}</b> ${status}${tag}</p><p class="times">${d.state === 'done' ? `Played from ${when(d.firstTip)}.` : esc(slate)}</p>`;
}

function renderGameDay() {
  const el = $('gameday');
  if (!state.ctx || DEMO) return void (el.hidden = true);
  const now = Date.now();
  const { today, next } = gameDays(state.ctx.pro, state.ctx.league.currentSP, now, state.board);
  const over = !today || today.state === 'done';
  const parts = [today && dayLine(today, now), over && next && dayLine(next, now, { next: true })].filter(Boolean);
  el.hidden = !parts.length;
  el.innerHTML = parts.length ? `<h2 class="sr">Game day times, ${esc(state.tz.replace('_', ' '))}</h2>${parts.join('')}` : '';
}

// Ask ESPN's scoreboard how today's games are going. Quietly skipped if it can't be reached.
async function refreshBoard() {
  if (DEMO || !state.ctx) return;
  const { league, pro } = state.ctx;
  const info = dayInfo(pro, league.currentSP, Date.now());
  const key = etDateKey(pro, league.currentSP);
  if (!info || !key || info.firstTip - Date.now() > 3 * HOUR) return; // nothing to watch yet
  const before = boardDone();
  // Through our own server when there is one (no browser restrictions), otherwise straight from ESPN
  const viaServer = state.src?.kind === 'api' && !DEMO ? await fetchScoreboard(league.currentSP, key, () => fetch(`api/scoreboard?date=${key}`)) : null;
  const board = viaServer || (await fetchScoreboard(league.currentSP, key));
  if (!board) return;
  state.board = board;
  renderGameDay();
  // The day just finished: reload so the recap and standings use the final numbers
  if (boardDone() === true && before !== true && state.src?.kind !== 'static') load({ fresh: true });
}

/* ---------- Tabs and actions ---------- */

function showTab(tab, focus = true) {
  state.tab = tab;
  try { localStorage.setItem('pw:tab', tab); } catch {}
  for (const btn of document.querySelectorAll('[role=tab]')) {
    const on = btn.dataset.tab === tab;
    btn.setAttribute('aria-selected', on);
    btn.tabIndex = on ? 0 : -1;
    if (on && focus) btn.focus();
    $(btn.getAttribute('aria-controls')).hidden = !on;
  }
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[role=tab]');
  if (btn) showTab(btn.dataset.tab);
});
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const i = tabs.findIndex((t) => t.dataset.tab === state.tab);
  if (e.key === 'ArrowRight') showTab(tabs[(i + 1) % tabs.length].dataset.tab);
  if (e.key === 'ArrowLeft') showTab(tabs[(i + tabs.length - 1) % tabs.length].dataset.tab);
});

document.addEventListener('click', (e) => {
  const view = e.target.closest('[data-recap]')?.dataset.recap;
  if (!view || !state.model) return;
  state.recapView = view;
  $('panel-recap').innerHTML = renderRecap(state.model);
});

document.addEventListener('click', async (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'retry') return load({ fresh: true });
  const btn = e.target.closest('button');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    await loadSeason();
    render();
  } catch (err) {
    btn.textContent = `Couldn’t load: ${err.message}`;
  }
});

// A snapshot site checks for a new file every few minutes; a live site refreshes hourly.
const interval = () => (state.src?.kind === 'static' ? STATIC_POLL : HOUR);
$('refresh').addEventListener('click', () => load({ fresh: true }));
setInterval(() => state.ctx && renderGameDay(), 60_000);
setInterval(refreshBoard, BOARD_POLL);
setInterval(() => {
  if (Date.now() - state.tried >= interval() - 1000) load();
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.tried && Date.now() - state.tried > interval()) load();
});

try {
  const saved = location.hash.slice(1) || localStorage.getItem('pw:tab');
  if (['week', 'recap', 'shame'].includes(saved)) state.tab = saved;
} catch {}

load();
