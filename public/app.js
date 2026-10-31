// The shell: loads the league, owns shared state, draws the frame and hands each route to a page in pages/.
import { buildModel, dayInfo, etDateKey, validTimeZone } from './logic.js';
import { loadLeague, loadSeasonDays } from './pipeline.js';
import { createAccount } from './account.js';
import { createPlayerStore } from './players-store.js';
import { openThemeChooser, startTheme } from './ui/theme-ui.js';
import { agreedOn, isAccepted, openAgreement } from './ui/agree.js';
import { openLegal } from './ui/legal.js';
import { tradeContext } from './trade.js';
import { createTradeUI } from './trade-ui.js';
import { createApiSource, createSnapshotSource, checkSnapshot, fetchScoreboard } from './sources.js';
import { PAGES } from './pages/index.js';
import { ago, clock, esc, fmt, plural, stamp } from './ui/dom.js';
import { link, onRoute, parseHash } from './ui/router.js';
import { renderAccount, renderNav, renderSubnav } from './ui/shell.js';

const HOUR = 3_600_000;
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const FORCE_ROSTER = params.get('source') === 'roster';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REFRESH_COOLDOWN = 5000; // the Refresh button works once every 5 seconds (the server enforces the same)
const STATIC_POLL = 10 * 60_000;
const STALE_AFTER = 3 * HOUR;
const BOARD_POLL = 3 * 60_000;

const $ = (id) => document.getElementById(id);

/* ---------- Shared state: pages read this ---------- */

const app = {
  demo: DEMO,
  model: null,
  ctx: null,
  src: null,
  board: null,
  check: null,
  seasonLoaded: false,
  seasonLoading: null,
  tz: 'Australia/Melbourne',
  route: parseHash(),
  limited: false,
  refreshAt: null,
  updated: 0,
  tried: 0,
  busy: false,
  boardDone: () => boardDone(),
  loadSeason: () => loadSeason(),
  // Start loading the earlier weeks (roster method only) and redraw `route` when they arrive. Returns true while loading.
  ensureSeason(route) {
    const need = app.ctx?.source === 'roster' && !app.seasonLoaded && app.model?.week.id > 1;
    if (need && !app.seasonLoading) {
      app.seasonLoading = loadSeason().catch(() => {}).finally(() => {
        app.seasonLoading = null;
        if (app.route === route) show();
      });
    }
    return Boolean(app.seasonLoading);
  },
  rerender: () => show(),
};
const data = () => ({ ctx: app.ctx, src: app.src, now: app.src?.now?.(), dayDone: boardDone() });
app.account = createAccount({ data });
app.store = createPlayerStore(data);
// The trade/projection context (replacement level from the real free-agent list), built once per refresh
let tctx = null;
app.tradeContext = () =>
  (tctx ||= (async () => {
    const freeAgents = await app.src.freeAgents().catch(() => []);
    return tradeContext({ league: app.ctx.league, pro: app.ctx.pro, freeAgents, injuries: app.ctx.injuries });
  })());
app.trade = createTradeUI({ data, account: app.account });
app.account.onChange(() => app.ctx && (renderAccount($('account'), app.account.team()), show()));

/* ---------- Data source ---------- */

async function apiGet(path, { fresh } = {}) {
  let res;
  try {
    res = await fetch(path, fresh ? { cache: 'no-store' } : undefined);
    if (res.headers.get('x-refresh-limited')) app.limited = true;
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

async function load({ fresh = false } = {}) {
  if (app.busy) return;
  app.tried = Date.now();
  app.limited = false;
  setBusy(true);
  try {
    const src = await pickSource({ fresh });
    const cfg = await src.config();
    if (!cfg.configured) return renderSetup(cfg);

    const ctx = await loadLeague(src, { forceRoster: FORCE_ROSTER, fresh, cache: dayCache(cfg) });
    app.src = src;
    app.ctx = ctx;
    app.trade.reset();
    app.store.reset();
    tctx = null;
    await app.account.reset(cfg.pins);
    app.tz = validTimeZone(cfg.timezone) ? cfg.timezone : 'Australia/Melbourne';
    app.model = buildModel({ ...ctx, now: src.now(), dayDone: boardDone() });
    app.updated = Date.now();
    app.check = null;
    app.seasonLoaded = false;
    if (src.offline) await loadSeason(); // history is already in the snapshot
    show();
    refreshBoard();
    app.trade.prefetch();
  } catch (err) {
    renderError(err);
  } finally {
    setBusy(false);
  }
}

// Pull every finished day so we can fill the punishments history and compare with ESPN's totals.
async function loadSeason() {
  const { shame, check } = await loadSeasonDays(app.ctx, app.src, { cache: dayCache(app.ctx.cfg) });
  app.model.shame = shame;
  app.check = check;
  app.seasonLoaded = true;
}

/* ---------- Refresh button ---------- */

function setBusy(on) {
  app.busy = on;
  updateRefreshButton();
}

// "Refresh", "Refreshing…", or "Refresh in 3s" while the 5-second limit is running (it survives a page reload)
let coolTimer = null;
function updateRefreshButton() {
  const b = $('refresh');
  const left = cooldownLeft();
  b.disabled = app.busy || left > 0;
  b.textContent = app.busy ? 'Refreshing…' : left > 0 ? `Refresh in ${Math.ceil(left / 1000)}s` : 'Refresh';
  clearTimeout(coolTimer);
  if (left > 0) coolTimer = setTimeout(updateRefreshButton, Math.min(left, 250));
}

function cooldownLeft() {
  let at = app.refreshAt;
  if (at == null) {
    try {
      at = Number(localStorage.getItem('pw:refreshAt')) || 0;
    } catch {
      at = 0;
    }
    app.refreshAt = at;
  }
  return Math.max(0, at + REFRESH_COOLDOWN - Date.now());
}

function startRefresh() {
  if (app.busy || cooldownLeft() > 0) return;
  app.refreshAt = Date.now();
  try {
    localStorage.setItem('pw:refreshAt', String(app.refreshAt));
  } catch {}
  load({ fresh: true });
}

/* ---------- Render ---------- */

function pageFor(route) {
  return PAGES.find((p) => p.id === route.section) || PAGES[0];
}

function show() {
  const m = app.model;
  if (!m) return;
  const route = app.route;
  const page = pageFor(route);
  if (page.id !== route.section) return void (location.hash = link(page.id)); // unknown route -> dashboard

  $('league-name').textContent = m.leagueName;
  $('week-label').textContent = `Week ${m.week.id}, day ${m.week.dayNumber} of ${m.week.days}. ${m.week.label}`;
  const snap = app.src.generatedAt;
  $('updated').textContent = snap
    ? `Data from ${stamp(snap)} (${ago(snap)}). Checked ${clock(app.updated)}.`
    : `Updated ${clock(app.updated)}. Next ${clock(app.updated + HOUR)}.${app.limited ? ' You refreshed a moment ago, so this is the latest available right now.' : ''}`;
  document.title = `${m.loser?.name ?? 'NBA Punishments'} on track for the punishment`;

  const banner = $('banner');
  const stale = snap && Date.now() - snap > STALE_AFTER;
  banner.hidden = !DEMO && !stale;
  if (DEMO) banner.innerHTML = 'Demo data. <a href="./">Open your league</a> once the ESPN cookies are set.';
  else if (stale) banner.textContent = `This data is ${ago(snap).replace(' ago', '')} old. The hourly GitHub job may be failing: open the repo’s Actions tab to see why.`;

  $('mainnav').hidden = false;
  renderNav(PAGES, route, $('mainnav'), app.account.team());
  renderSubnav(page, route, $('subnav'), $('subnav-in'));
  renderAccount($('account'), app.account.team());
  document.body.classList.toggle('wide', page.id === 'transactions');
  if (page.id !== 'transactions') document.body.classList.remove('trading');

  const view = $('view');
  for (const ev of ['onclick', 'oninput', 'onchange', 'ondblclick', 'onkeydown', 'onsubmit']) view[ev] = null; // each page sets its own
  page.render(app, view, route);
  $('foot').innerHTML = renderFoot(m);
  if (!show.lastKey || show.lastKey !== route.path) window.scrollTo(0, 0);
  show.lastKey = route.path;
}

function renderFoot(m) {
  const how = m.source === 'schedule' ? 'ESPN’s day-by-day team scores' : 'each day’s ESPN lineup and player stats';
  const weeks = m.weeksSource === 'espn' ? 'Weeks follow ESPN’s matchup periods.' : `Weeks run ${DAYS[m.weekStart]} to ${DAYS[(m.weekStart + 6) % 7]}, US Eastern time.`;
  const refresh = app.src.kind === 'static' ? 'The data updates about hourly from a GitHub job; Refresh reloads the latest snapshot.' : 'Auto-refreshes hourly.';
  let check = '<button type="button" class="link" data-action="check">Check against ESPN season totals</button>';
  if (app.check) {
    const bad = app.check.filter((c) => !c.ok);
    check = bad.length
      ? `<p class="warn">${plural(bad.length, 'team')} don’t match ESPN’s season total: ${bad.map((b) => `${esc(b.name)} (ESPN ${fmt(b.espn)}, rebuilt ${fmt(b.ours)})`).join('; ')}. Try <a href="?source=roster">roster mode</a>.</p>`
      : `<p class="ok">Every team’s rebuilt total matches ESPN’s season total${app.check.every((c) => c.basis === 'finished days') ? ' (ESPN counts finished days only, so today isn’t in it)' : ''}.</p>`;
  }
  return `<p>Weekly points are rebuilt from ${how}, so they start at 0 each week no matter what ESPN’s season total says. Dates are US game days. ${weeks} ${refresh}</p>${check} <button type="button" class="link" data-open="colours">Change colours</button> <button type="button" class="link" data-legal="terms">Terms</button> <button type="button" class="link" data-legal="privacy">Privacy</button>${agreedOn() ? ` <span class="muted">Punishment pact accepted ${agreedOn()}.</span>` : ''}`;
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

function hideChrome() {
  $('mainnav').hidden = true;
  $('subnav').hidden = true;
  $('account').hidden = true;
}

function renderSetup(cfg, kind = cfg?.platform === 'local' ? 'local' : 'cloudflare') {
  hideChrome();
  $('view').innerHTML = `<div class="setup">
      <h2>${kind === 'snapshot' ? 'Waiting for the first data snapshot' : 'Connect your ESPN league'}</h2>
      ${SETUP[kind]}
      <p><a href="?demo">Preview with demo data</a></p>
    </div>`;
}

function renderError(err) {
  if (err.setup) return renderSetup(null, err.setup);
  if (app.model) hideChrome();
  $('view').innerHTML = `<div class="error" role="alert">
      <h2>Couldn’t load the league</h2>
      <p>${esc(err.message)}</p>
      <button type="button" class="btn primary" data-action="retry">Try again</button>
    </div>`;
}

/* ---------- Game-day scoreboard ---------- */

// True/false once the live scoreboard covers today's slate, otherwise undefined (the clock decides).
// A snapshot's numbers can be older than the scoreboard, so the snapshot keeps using the clock.
function boardDone() {
  if (!app.ctx || app.src?.kind === 'static') return undefined;
  const info = dayInfo(app.ctx.pro, app.ctx.league.currentSP, Date.now(), app.board);
  return info && !info.estimated ? info.state === 'done' : undefined;
}

// Ask ESPN's scoreboard how today's games are going. Quietly skipped if it can't be reached.
async function refreshBoard() {
  if (DEMO || !app.ctx) return;
  const { league, pro } = app.ctx;
  const info = dayInfo(pro, league.currentSP, Date.now());
  const key = etDateKey(pro, league.currentSP);
  if (!info || !key || info.firstTip - Date.now() > 3 * HOUR) return; // nothing to watch yet
  const before = boardDone();
  // Through our own server when there is one (no browser restrictions), otherwise straight from ESPN
  const viaServer = app.src?.kind === 'api' ? await fetchScoreboard(league.currentSP, key, () => fetch(`api/scoreboard?date=${key}`)) : null;
  const board = viaServer || (await fetchScoreboard(league.currentSP, key));
  if (!board) return;
  app.board = board;
  if (pageFor(app.route).id === 'dashboard') show();
  // The day just finished: reload so the recap and standings use the final numbers
  if (boardDone() === true && before !== true && app.src?.kind !== 'static') load({ fresh: true });
}

/* ---------- Events ---------- */

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open=colours]')) openThemeChooser();
  const l = e.target.closest('.foot [data-legal]');
  if (l) openLegal(l.dataset.legal);
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
    show();
  } catch (err) {
    btn.textContent = `Couldn’t load: ${err.message}`;
  }
});

$('account').addEventListener('click', () => (location.hash = link('team')));

// A snapshot site checks for a new file every few minutes; a live site refreshes hourly.
const interval = () => (app.src?.kind === 'static' ? STATIC_POLL : HOUR);
$('refresh').addEventListener('click', startRefresh);
updateRefreshButton();
// The dashboard and My Team follow the clock (My Team moves to the next day once today's games are done)
setInterval(() => app.ctx && ['dashboard', 'team'].includes(pageFor(app.route).id) && show(), 60_000);
setInterval(refreshBoard, BOARD_POLL);
setInterval(() => {
  if (Date.now() - app.tried >= interval() - 1000) load();
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.tried && Date.now() - app.tried > interval()) load();
});

onRoute((route) => {
  app.route = route;
  show();
});
// Saved colours apply straight away; on a first visit the chooser opens once the page behind it has drawn
if ('serviceWorker' in navigator && !DEMO && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {}); // lets the site install as an app
const firstVisit = startTheme();
$('colours').addEventListener('click', () => openThemeChooser());
const afterAgree = () => firstVisit && openThemeChooser({ firstRun: true });
// Everyone must be on the Terms record (their team, with the time) before using the site; signing in as a team that has
// not accepted asks again
async function gate() {
  if (!app.ctx || await isAccepted(app)) return false;
  openAgreement(app, { onDone: () => { show(); afterAgree(); } });
  return true;
}
app.account.onChange(() => gate());
load().finally(async () => { if (!(await gate())) afterAgree(); });
