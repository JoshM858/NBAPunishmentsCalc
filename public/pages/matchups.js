// Matchups: the day recap (live "so far" and final) and the rest-of-week outlook.
import { dayLabel, localTime, zoneName } from '../logic.js';
import { gamesOn, playersPerDay } from '../schedule.js';
import { esc, fmt, moveBadge, names, ordinal, panel, pct, plural, segmented } from '../ui/dom.js';
import { teamLogo } from '../ui/player.js';

const state = { view: 'live' };

function recapHtml(app) {
  const m = app.model;
  const live = m.recapLive && state.view !== 'final' ? m.recapLive : null;
  const r = live || m.recap;
  if (!r) return panel('Day recap', '<p class="empty">The first recap appears after the season’s opening night.</p>');

  const lines = [];
  if (r.final) lines.push(`<li><b>${esc(names(r.last))}</b> finished last for week ${r.week.id} on ${fmt(r.last[0].weekPts)}.</li>`);
  for (const c of r.climbers.slice(0, 3)) lines.push(`<li><b>${esc(c.name)}</b> climbed ${c.move} to ${ordinal(c.rank)} with ${fmt(c.dayPts)} on the day.</li>`);
  for (const f of r.fallers.slice(0, 3)) lines.push(`<li><b>${esc(f.name)}</b> dropped ${-f.move} to ${ordinal(f.rank)}.</li>`);
  if (!r.climbers.length && !r.fallers.length) lines.push(`<li>${r.dayNumber === 1 ? 'First day of the week, so these are the starting positions.' : 'No change in the order.'}</li>`);
  lines.push(`<li>Best day: <b>${esc(r.topDay.name)}</b> with ${fmt(r.topDay.dayPts)}. Worst: <b>${esc(r.lowDay.name)}</b> with ${fmt(r.lowDay.dayPts)}.</li>`);

  const mine = app.account.team()?.id;
  const table = r.rows
    .map((x) => `<tr class="${[r.last.some((l) => l.id === x.id) && 'last', x.id === mine && 'me'].filter(Boolean).join(' ')}">
        <td class="num">${x.rank}${moveBadge(x.prevRank, x.rank)}</td>
        <th scope="row">${esc(x.name)}</th>
        <td class="num">${fmt(x.dayPts)}</td>
        <td class="num strong">${fmt(x.weekPts)}</td>
      </tr>`)
    .join('');

  const players = r.best
    ? `<div class="duo">
        <p><span class="tag">Player of the day</span><b>${esc(r.best.name)}</b> ${fmt(r.best.pts)} for ${esc(r.best.team)}</p>
        <p><span class="tag">Dud of the day</span><b>${esc(r.worst.name)}</b> ${fmt(r.worst.pts)} for ${esc(r.worst.team)}</p>
      </div>`
    : '';

  const switcher = m.recapLive
    ? segmented('recap', [{ id: 'live', label: `${esc(m.recapLive.label)}, so far` }, { id: 'final', label: `${esc(m.recap.label)}, final` }], live ? 'live' : 'final')
    : '';
  return panel(`${esc(r.label)}${live ? ' so far' : ''}`, `
      <p class="lede">${live ? 'Games are still being played, so these are points so far for' : 'Results for'} week ${r.week.id}, day ${r.dayNumber} of ${r.week.sps.length} (US date).</p>
      <ul class="movers">${lines.join('')}</ul>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th class="num">Pos</th><th>Team</th><th class="num">Day</th><th class="num">Week</th></tr></thead>
        <tbody>${table}</tbody></table></div>
      ${players}`, { tools: switcher });
}

function outlookHtml(app) {
  const m = app.model;
  const r = m.recapLive || m.recap;
  const sameWeek = !r || r.week.id === m.week.id;
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
  return panel(sameWeek ? 'Rest of the week' : `Week ${m.week.id} outlook`, `
      <p class="lede">The rest of the week is simulated: today’s set lineup, then each team’s best players on later days. Injured players are discounted, healthy ones still sit out about 1 game in 12, and a close race stays close.</p>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Team</th><th class="num">Games</th><th class="num">Players</th><th class="num">Projected</th><th class="num">Last place</th></tr></thead>
        <tbody>${rest}</tbody></table></div>`, { cls: 'flush' });
}

// This week's NBA games day by day, and how many of each fantasy team's players have a game each day
function scheduleHtml(app) {
  const { week, currentSP } = app.model;
  const { pro } = app.ctx;
  const tz = app.tz;
  const sps = week.sps.filter((sp) => pro.spDate.has(sp));
  const mine = app.account.team()?.id;
  const matrix = playersPerDay(app.ctx.league.teams, pro, sps);
  const max = Math.max(1, ...matrix.flatMap((r) => r.perDay));
  const head = sps.map((sp) => `<th class="num${sp === currentSP ? ' today' : ''}">${esc(dayLabel(pro, sp).split(' ').slice(0, 1))}<small>${esc(dayLabel(pro, sp).split(' ').slice(1).join(' '))}</small></th>`).join('');
  const rows = matrix.map((r) => `<tr class="${r.id === mine ? 'me' : ''}"><th scope="row">${esc(r.name)}</th>${r.perDay.map((n, i) => `<td class="num heat${sps[i] < currentSP ? ' past' : ''}" style="--h:${n / max}">${n || '–'}</td>`).join('')}<td class="num strong">${r.total}</td></tr>`).join('');
  const days = sps.map((sp) => {
    const games = gamesOn(pro, sp);
    return `<section class="sched-day${sp === currentSP ? ' now' : ''}"><h4>${esc(dayLabel(pro, sp))} <small>${plural(games.length, 'game')}</small></h4><ul>${games.map((g) => `<li>${teamLogo(g.away)}<b>${esc(g.away)}</b> @ ${teamLogo(g.home)}<b>${esc(g.home)}</b><em>${esc(localTime(g.date, tz))} ${esc(zoneName(g.date, tz))}</em></li>`).join('')}</ul></section>`;
  }).join('');
  return `<div class="grid">${panel('Players with a game', `<div class="tbl-wrap"><table class="tbl matrix"><thead><tr><th>Team</th>${head}<th class="num">Total</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note" style="padding:12px 16px">Players on injured reserve aren’t counted. Brighter cells mean more of the team’s players are in action that day. Days are US dates; tip-off times are in ${esc(tz.replace('_', ' '))}.</p>`, { cls: 'flush' })}
    ${panel('NBA games this week', `<div class="sched">${days}</div>`)}</div>`;
}

export default {
  id: 'matchups',
  label: 'Matchups',
  tabs: [{ id: '', label: 'Day recap' }, { id: 'schedule', label: 'Week schedule' }],
  render(app, el, route) {
    if (route.tab === 'schedule') {
      el.innerHTML = scheduleHtml(app);
      return;
    }
    const draw = () => {
      el.innerHTML = `<div class="grid cols-2">${recapHtml(app)}${outlookHtml(app)}</div>`;
    };
    draw();
    el.onclick = (e) => {
      const b = e.target.closest('[data-seg=recap]');
      if (!b) return;
      state.view = b.dataset.id;
      draw();
    };
  },
};
