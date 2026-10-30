// Analytics: the season race, week-by-week points, roster depth and the player market. Every chart says what it shows.
import { marketPoints, rosterDepth, seasonRace, undervalued } from '../analytics.js';
import { dayLabel } from '../logic.js';
import { finishedThrough } from '../logic.js';
import { seasonStandings } from '../standings.js';
import { PALETTE, lineChart, scatter, stackedBars } from '../ui/charts.js';
import { esc, fmt, fmt1, panel } from '../ui/dom.js';
import { headshot } from '../ui/player.js';
import { link } from '../ui/router.js';

export default {
  id: 'analytics',
  label: 'Analytics',
  async render(app, el, route) {
    const loading = app.ensureSeason(route);
    const { league, daily, weeks, pro } = app.ctx;
    const teams = league.teams;
    const mine = app.account.team()?.id;
    const color = new Map(teams.map((t, i) => [t.id, PALETTE[i % PALETTE.length]]));

    // 1. Season race
    const race = seasonRace(teams, daily, league.currentSP);
    const raceChart = lineChart(race.map((r) => ({ name: r.name, color: color.get(r.id), bold: r.id === mine, points: r.points })), { xLabel: (sp) => (pro.spDate.get(sp) ? new Date(pro.spDate.get(sp)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'America/New_York' }) : `Day ${sp}`) });

    // 2. Weekly points
    const through = finishedThrough(league, pro, app.src.now(), app.boardDone());
    const s = seasonStandings({ teams, daily, weeks, through, cur: league.currentSP });
    const cur = weeks.find((w) => w.sps.includes(league.currentSP));
    const heat = Math.max(1, ...s.rows.flatMap((r) => r.weeks.map((w) => w.pts)));
    const lastOf = (wk) => Math.min(...s.rows.map((r) => r.weeks.find((w) => w.week === wk)?.pts ?? Infinity));
    const weekTable = s.weeks.length
      ? `<div class="tbl-wrap"><table class="tbl matrix"><thead><tr><th>Team</th>${s.weeks.map((w) => `<th class="num">Wk ${w}</th>`).join('')}<th class="num">Avg</th></tr></thead><tbody>${[...s.rows].sort((a, b) => b.avgWeek - a.avgWeek).map((r) => `<tr class="${r.id === mine ? 'me' : ''}"><th scope="row">${esc(r.name)}</th>${r.weeks.map((w) => `<td class="num heat${w.pts === lastOf(w.week) ? ' low' : ''}" style="--h:${w.pts / heat}">${fmt(w.pts)}</td>`).join('')}<td class="num strong">${fmt(r.avgWeek)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="empty">No week has finished yet.</p>';

    // 3. Roster depth
    const draw = (state) => {
      const depth = rosterDepth(teams, state?.byId, 10);
      const depthHtml = stackedBars(depth.map((d) => ({ label: d.name, parts: d.parts })));
      // 4. The market
      let market = '<p class="loading">Loading players…</p>';
      let gems = '';
      if (state) {
        const pts = marketPoints(state.players).map((p) => ({ x: p.x, y: p.y, label: `${p.name}: ${fmt1(p.y)} avg, ${fmt1(p.x)}% owned`, href: link('players', p.id), hot: p.free }));
        market = `${scatter(pts, { xLabel: 'Owned in ESPN leagues (%)', yLabel: 'Fantasy points per game', xMax: 100 })}<p class="note">Yellow dots are free agents in your league. High and to the left means he scores like a widely-owned player but is rarely owned: a possible pickup.</p>`;
        const u = undervalued(state.players);
        gems = u.rows.length
          ? `<ul class="mini">${u.rows.map((p) => `<li><a href="${link('players', p.id)}">${headshot(p.id)}<span><b>${esc(p.name)}</b><small>${esc(p.team)} · ${esc(p.pos.join('/'))} · ${fmt1(p.own)}% owned</small></span></a><em>${fmt1(p.avg)}</em></li>`).join('')}</ul><p class="note" style="padding:10px 14px">Free agents averaging at least ${fmt1(u.median)} (the median of players owned by half of leagues or more), owned by under 40% of leagues.</p>`
          : '<p class="empty">No free agent currently scores like a widely-owned player.</p>';
      }
      el.innerHTML = `<div class="grid">
        ${loading || app.seasonLoading ? '<p class="note">Loading earlier weeks…</p>' : ''}
        <div class="grid cols-2">
          ${panel('Season race', `${raceChart}<p class="note">Each line is a team’s points added up day by day since the season began. Lines that pull apart show who is running away; the thick line is your team.</p>`)}
          ${panel('Points by week', `${weekTable}<p class="note" style="padding:12px 16px">Points in each finished week. Brighter is higher; the red-edged cell is that week’s punishment.</p>`, { cls: 'flush' })}
        </div>
        <div class="grid cols-2">
          ${panel('Roster depth', `${depthHtml}<p class="note">Each bar adds up the fantasy points per game of a team’s ten best players, so you can see how much of a team’s strength is in a few stars and how much is depth.</p>`)}
          ${panel('Hidden gems on the wire', gems || '<p class="loading">Loading players…</p>', { cls: 'flush' })}
        </div>
        ${panel('The player market', market)}
      </div>`;
    };
    draw(null);
    const state = await app.store.get().catch(() => null);
    if (app.route === route && state?.players.length) draw(state);
  },
};
