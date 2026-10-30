// League: season standings, the punishment history and the draft board.
import { finishedThrough } from '../logic.js';
import { draftBoard, draftValue, parseDraft } from '../draft.js';
import { seasonStandings } from '../standings.js';
import { esc, fmt, fmt1, moveBadge, panel } from '../ui/dom.js';
import { headshot, spark } from '../ui/player.js';
import { link } from '../ui/router.js';

function punishmentsHtml(app) {
  const m = app.model;
  const weeks = m.shame;
  const needsLoad = app.ctx.source === 'roster' && !app.seasonLoaded && m.week.id > 1;
  if (needsLoad && !weeks.length) {
    return panel('Punishments', `<p class="lede">Past weeks are rebuilt from ESPN’s daily stats, one request per day.</p><button type="button" class="btn primary" data-action="season">Load past weeks</button>`);
  }
  if (!weeks.length) return panel('Punishments', '<p class="empty">No finished weeks yet. The first punishment is decided after the last game of week 1.</p>');

  const tally = new Map();
  for (const w of weeks) for (const l of w.losers) tally.set(l.id, (tally.get(l.id) || 0) + 1);
  const nameOf = (id) => app.ctx.league.teams.find((t) => t.id === id)?.name || `Team ${id}`;
  const counts = [...tally].sort((a, b) => b[1] - a[1]).map(([id, n]) => `<li><b>${esc(nameOf(id))}</b><span>${n}</span></li>`).join('');
  const list = weeks
    .map((w) => `<li>
        <p class="wk"><span>Week ${w.week}</span><span>${esc(w.label)}</span></p>
        <p class="who-lost">${esc(w.losers.map((l) => nameOf(l.id)).join(' and '))}</p>
        <p class="note">${fmt(w.losers[0].pts)} points${w.margin ? `, ${fmt(w.margin)} short of safety` : ''}. Top score ${fmt(w.top.pts)} by ${esc(nameOf(w.top.id))}.</p>
      </li>`)
    .join('');
  const more = needsLoad ? '<button type="button" class="btn primary" data-action="season">Load all past weeks</button>' : '';
  return `<div class="grid">${panel('Punishments so far', `<ol class="tally">${counts}</ol>`)}${panel('Every week', `<ol class="shame">${list}</ol>${more}`)}</div>`;
}

function standingsHtml(app) {
  const { league, pro, weeks, daily } = app.ctx;
  const through = finishedThrough(league, pro, app.src.now(), app.boardDone());
  // Past weeks come from the rebuilt daily points; on the roster method those load on demand
  const needsLoad = app.ctx.source === 'roster' && !app.seasonLoaded && app.model.week.id > 1;
  const s = seasonStandings({ teams: league.teams, daily, weeks, through, cur: league.currentSP });
  const mine = app.account.team()?.id;
  const top = Math.max(1, ...s.rows.map((r) => r.seasonPts));
  const lastRank = Math.max(...s.rows.map((r) => r.rank));
  const rows = s.rows
    .map((r) => `<tr class="${[r.id === mine && 'me', r.rank === lastRank && s.weeks.length && 'last'].filter(Boolean).join(' ')}">
        <td class="num strong">${r.rank}</td>
        <th scope="row"><div class="who-cell"><b>${esc(r.name)}</b><small>${esc(r.owner || '')}</small></div></th>
        <td class="num strong">${fmt(r.seasonPts)}</td>
        <td class="hide-sm" style="min-width:110px"><div class="meter"><span style="width:${(r.seasonPts / top) * 100}%"></span></div></td>
        <td class="num">${r.avgWeek == null ? '–' : fmt(r.avgWeek)}</td>
        <td class="num">${r.wins}</td>
        <td class="num ${r.punished ? 'neg-text' : ''}">${r.punished}</td>
        <td class="num hide-sm">${r.best == null ? '–' : fmt(r.best)}</td>
        <td class="num hide-sm">${r.worst == null ? '–' : fmt(r.worst)}</td>
        <td class="hide-sm">${r.weeks.length > 1 ? spark(r.weeks.map((w) => w.pts)) : "–"}</td>
        <td class="num">${r.thisWeek ? `${r.thisWeek.rank}<small class="muted"> · ${fmt(r.thisWeek.pts)}</small>` : '–'}</td>
      </tr>`)
    .join('');
  const note = needsLoad ? '<p class="note" style="padding:12px 16px">Past weeks are still loading. <button type="button" class="link" data-action="season">Load past weeks</button> to fill in weeks won and punishments.</p>' : '';
  return panel('Standings', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num" title="Fantasy points scored this season">Season pts</th><th class="hide-sm"></th><th class="num" title="Average points over finished weeks">Avg / week</th><th class="num" title="Weeks with the highest score">Weeks won</th><th class="num" title="Weeks finishing last">Punished</th><th class="num hide-sm">Best week</th><th class="num hide-sm">Worst week</th><th class="hide-sm" title="Points in each finished week">Weekly</th><th class="num">This week</th></tr></thead>
      <tbody>${rows}</tbody></table></div>${note}
      <p class="note" style="padding:12px 16px">This league scores total points each week and punishes the lowest, so there are no wins, losses or points against: teams are ranked by season points.</p>`, { cls: 'flush' });
}

/* ---------- Draft ---------- */

async function draftHtml(app) {
  const raw = await Promise.resolve(app.src.draft?.()).catch(() => null);
  const draft = parseDraft(raw);
  if (!draft?.picks.length) return panel('Draft', '<p class="empty">No draft has been recorded for this league yet.</p>');
  const state = await app.store.get().catch(() => null);
  const byId = state?.byId || new Map();
  const teams = app.ctx.league.teams;
  const ids = draft.order.length ? draft.order.filter((id) => teams.some((t) => t.id === id)) : teams.map((t) => t.id);
  const order = ids.length ? ids : teams.map((t) => t.id);
  const nameOf = (id) => teams.find((t) => t.id === id)?.name || `Team ${id}`;
  const board = draftBoard(draft, order);
  const cell = (pk) => {
    if (!pk) return '<td class="muted">–</td>';
    const pl = byId.get(pk.playerId);
    return `<td class="dcell"><span class="pickno">${pk.n}</span>${pl ? `<a class="plink" href="${link('players', pl.id)}"><b>${esc(pl.name)}</b></a><small>${esc(pl.team)} · ${esc(pl.pos.join('/'))}</small>` : `<b>Player ${pk.playerId}</b>`}</td>`;
  };
  const head = order.map((id) => `<th scope="col">${esc(nameOf(id))}</th>`).join('');
  const body = board.map((r) => `<tr><th scope="row" class="num">R${r.round}</th>${r.cells.map(cell).join('')}</tr>`).join('');
  const val = draftValue(draft, byId, order);
  const list = (rows, good) => `<ul class="mini">${rows.map((r) => `<li><a href="${link('players', r.playerId)}">${headshot(r.playerId)}<span><b>${esc(r.name)}</b><small>Pick ${r.n} · ${esc(nameOf(r.teamId))} · now ranked ${r.rank}</small></span></a><em class="${good ? 'pos-text' : 'neg-text'}">${r.value > 0 ? '+' : '−'}${Math.abs(r.value)}</em></li>`).join('')}</ul>`;
  return `<div class="grid"><div class="grid cols-2">
      ${panel('Best value picks', val.steals.length ? list(val.steals, true) : '<p class="empty">Rankings appear once players have games.</p>', { cls: 'flush' })}
      ${panel('Biggest busts so far', val.busts.length ? list(val.busts, false) : '<p class="empty">Rankings appear once players have games.</p>', { cls: 'flush' })}
    </div>
    ${panel(`Draft board${draft.type ? ` · ${draft.type === 'SNAKE' ? 'snake' : draft.type.toLowerCase()}` : ''}`, `<div class="tbl-wrap"><table class="tbl draft"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="note" style="padding:12px 16px">Value is the pick number minus ESPN’s current rank for the player, so +20 means he has been worth 20 picks more than where he went. Only players ESPN has ranked (they have played) are counted (${val.counted} picks), and players outside the 500 most-owned are left out. The draft is finished: this is a record, not a draft room.</p>`, { cls: 'flush' })}</div>`;
}

export default {
  id: 'league',
  label: 'League',
  tabs: [{ id: '', label: 'Standings' }, { id: 'punishments', label: 'Punishments' }, { id: 'draft', label: 'Draft' }],
  async render(app, el, route) {
    if (route.tab === 'draft') {
      el.innerHTML = '<p class="loading">Loading the draft…</p>';
      const html = await draftHtml(app);
      if (app.route === route) el.innerHTML = html;
      return;
    }
    // On the roster method the earlier weeks are fetched day by day: start that now and redraw when it lands
    if (app.ctx.source === 'roster' && !app.seasonLoaded && app.model.week.id > 1 && !app.seasonLoading) {
      app.seasonLoading = app.loadSeason().catch(() => {}).finally(() => {
        app.seasonLoading = null;
        if (app.route === route) app.rerender();
      });
    }
    const loading = app.seasonLoading ? '<p class="note" style="padding:0 0 12px">Loading earlier weeks…</p>' : '';
    el.innerHTML = loading + (route.tab === 'punishments' ? punishmentsHtml(app) : standingsHtml(app));
  },
};
