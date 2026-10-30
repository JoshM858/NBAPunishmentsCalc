// One player: who he is, how he scores, how steady and how hot he is, every game, and what is coming up.
import { asRosterPlayer, form, percentileOf, spread } from '../players-data.js';
import { playerProjection } from '../projection.js';
import { dayLabel, localTime, zoneName } from '../logic.js';
import { esc, fmt1, panel, signed } from '../ui/dom.js';
import { barChart } from '../ui/charts.js';
import { bar, headshot, spark, statusChip, teamLogo } from '../ui/player.js';
import { link } from '../ui/router.js';

const shortDate = (ms, tz) => new Date(ms).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
const pctTxt = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);

function perGameTable(p, last) {
  const row = (label, per) => per ? `<tr><th scope="row">${label}</th>${['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'tpm'].map((k) => `<td class="num">${fmt1(per[k])}</td>`).join('')}${['fgPct', 'ftPct', 'tpPct'].map((k) => `<td class="num">${pctTxt(per[k])}</td>`).join('')}</tr>` : '';
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th>${['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', '3PM', 'FG%', 'FT%', '3P%'].map((h) => `<th class="num">${h}</th>`).join('')}</tr></thead><tbody>${row(`This season (${p.gp} GP)`, p.per)}${last ? row(`${last.season - 1}-${String(last.season).slice(2)} (${last.gp} GP)`, last.per) : ''}</tbody></table></div>`;
}

function gameLog(app, p) {
  const { pro } = app.ctx;
  const games = [...p.games].reverse();
  if (!games.length) return '<p class="empty">No games played yet this season.</p>';
  const rows = games.map((g) => {
    const date = pro.spDate.get(g.sp);
    const b = g.box;
    return `<tr><td>${date ? shortDate(date, 'America/New_York') : `Day ${g.sp}`}</td><td class="num"><b>${fmt1(g.pts)}</b></td>${b ? ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'to'].map((k) => `<td class="num">${b[k]}</td>`).join('') + `<td class="num">${b.fgm}-${b.fga}</td><td class="num">${b.tpm}</td>` : '<td class="num muted" colspan="9">–</td>'}</tr>`;
  }).join('');
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date (US)</th><th class="num">FPTS</th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">TO</th><th class="num">FG</th><th class="num">3PM</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function upcoming(app, proj) {
  const tz = app.tz;
  if (!proj.games.length) return '<p class="empty">No upcoming games are scheduled.</p>';
  const rows = proj.games.map((g) => `<tr><td>${shortDate(g.date, tz)}</td><td>${localTime(g.date, tz)} ${zoneName(g.date, tz)}</td><td>${g.home ? 'vs' : '@'} ${esc(g.opp)}</td><td class="num">${g.out ? '<span class="neg-text">out</span>' : `${Math.round(g.playChance * 100)}%`}</td><td class="num"><b>${fmt1(g.expected)}</b></td></tr>`).join('');
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Day</th><th>Tip-off</th><th>Opponent</th><th class="num">Plays</th><th class="num">Expected FPTS</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export async function renderProfile(app, el, route, state) {
  const id = Number(route.tab);
  let p = state.byId.get(id);
  if (!p) {
    el.innerHTML = panel('Player', `<p class="empty">That player isn’t in the pool of the 500 most-owned players. <a class="link" href="${link('players')}">Back to the database</a></p>`);
    return;
  }
  const draw = (detail, proj) => {
    const full = detail ? { ...p, games: detail.games.length ? detail.games : p.games, outlook: detail.outlook, lastSeason: detail.lastSeason } : p;
    const f = form(full);
    const sd = spread(full);
    const pool = state.players;
    const pc = (get, opts) => percentileOf(pool, full, get, { minGP: 3, ...opts });
    const tiles = [['FPTS avg', fmt1(full.avg), `${full.gp} games`, 'accent'], ['Last 7', fmt1(full.l7), f == null ? '' : `${signed(f, 0)}% vs season`], ['Last 15', fmt1(full.l15), ''], ['Last 30', fmt1(full.l30), ''], ['Projection', fmt1(full.proj), 'ESPN preseason'], ['Rank', full.rank ?? '–', full.posRank ? `${full.homePos || ''} #${full.posRank}` : '']]
      .map(([k, v, s, c]) => `<div class="stat ${c || ''}"><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('');
    const bio = [full.age ? `${full.age} yrs` : null, full.height, full.weight, full.exp != null ? (full.exp ? `${full.exp} yr${full.exp === 1 ? '' : 's'} in the NBA` : 'Rookie') : null].filter(Boolean).join(' · ');
    const ownerLine = full.fantasyTeam ? `On <b>${esc(full.fantasyTeam.name)}</b>` : '<span class="badge accent">Free agent</span>';
    const items = [...full.games].slice(-30).map((g) => ({ label: app.ctx.pro.spDate.get(g.sp) ? new Date(app.ctx.pro.spDate.get(g.sp)).toLocaleDateString('en-AU', { day: 'numeric', month: 'numeric', timeZone: 'America/New_York' }) : String(g.sp), value: g.pts }));

    const hdr = `<section class="panel profile-head">
      <div class="ph-img">${headshot(full.id, 'ph-photo')}</div>
      <div class="ph-main">
        <p class="kicker">${esc(full.team)} · ${esc(full.pos.join('/') || '–')}${full.jersey ? ` · #${esc(full.jersey)}` : ''}</p>
        <h2>${esc(full.name)}</h2>
        <p class="tcell">${teamLogo(full.team, 'logo lg')}<span class="dim">${esc(bio || '')}</span></p>
        <p class="ph-badges">${statusChip(full)} ${ownerLine} <span class="badge">${fmt1(full.own)}% owned</span> <span class="badge">${fmt1(full.started)}% started</span></p>
        ${full.injury !== 'ACTIVE' && full.injuryDetail ? `<p class="note">${esc(full.injuryDetail)}</p>` : ''}
        ${full.outlook ? `<p class="outlook">${esc(full.outlook)}</p>` : ''}
      </div>
      <div class="stats ph-stats">${tiles}</div>
    </section>`;

    const consistencyPct = sd == null ? null : percentileOf(pool.filter((x) => x.games.length >= 3), full, (x) => (spread(x) == null ? null : -spread(x)), { minGP: 3 });
    const bars = `<div class="bars">
      ${bar('Scoring', pc((x) => x.avg), { text: `${fmt1(full.avg)}` })}
      ${bar('Form', pc((x) => form(x)), { text: f == null ? '–' : `${signed(f, 0)}%` })}
      ${bar('Consistency', consistencyPct, { text: sd == null ? '–' : `±${fmt1(sd)}` })}
      ${bar('Minutes', pc((x) => x.per?.min), { text: full.per ? fmt1(full.per.min) : '–' })}
      ${bar('Ownership', full.own, { text: `${fmt1(full.own)}%` })}
    </div><p class="note">Bars are percentiles against every player in the pool with at least 3 games (how many of them he beats). Consistency is the spread of his last games: a higher bar means steadier. Nothing here is an invented rating.</p>`;

    const projHtml = proj
      ? `<div class="stats">${[['This week', fmt1(proj.thisWeek.expected), `${proj.thisWeek.games} game${proj.thisWeek.games === 1 ? '' : 's'} left`], ['Next 7 days', fmt1(proj.next7.expected), `${proj.next7.games} games`], ['Rest of season', fmt1(proj.restOfSeason.expected), `${proj.restOfSeason.games} games`], ['Per week', fmt1(proj.restOfSeason.perWeek), 'rest of season']].map(([k, v, s]) => `<div class="stat"><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('')}</div>${upcoming(app, proj)}<p class="note" style="padding:12px 16px">Expected points = his usual points per game when he plays (pulled toward ESPN’s projection early in the season) times the chance he plays, from his injury status or ESPN’s return date. It does not adjust for the opponent.</p>`
      : '<p class="empty">Projection is loading…</p>';

    el.innerHTML = `<div class="grid">
      <p><a class="link" href="${link('players')}">← Players</a></p>
      ${hdr}
      <div class="grid cols-2">
        ${panel('Form and consistency', bars)}
        ${panel('Last games', `${barChart(items, { avg: full.avg })}${full.games.length ? `<p class="note">Fantasy points in each of his last ${items.length} games. Highlighted bars beat his season average.</p>` : ''}`)}
      </div>
      ${panel('Per-game stats', perGameTable(full, full.lastSeason), { cls: 'flush' })}
      <div class="grid cols-2">
        ${panel('Upcoming games and projection', projHtml, { cls: 'flush' })}
        ${panel('Game log', gameLog(app, full), { cls: 'flush' })}
      </div>
    </div>`;
  };

  const isCurrent = () => app.route === route;
  draw(null, null);
  // Box scores, outlook and last season come from a second request; the projection needs the free-agent list
  const [detail, ctx] = await Promise.all([Promise.resolve(app.src.player?.(id)).catch(() => null), app.tradeContext().catch(() => null)]);
  if (!isCurrent()) return;
  const rp = asRosterPlayer(p);
  const proj = ctx ? playerProjection(ctx, app.ctx.pro, rp, { week: app.model.week, currentSP: app.ctx.league.currentSP, now: app.src.now(), games: 8 }) : null;
  draw(detail?.id === id ? detail : null, proj);
}
