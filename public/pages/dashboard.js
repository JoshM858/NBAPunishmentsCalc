// Dashboard: who is on track for the punishment, how sure we are, game-day times and the week at a glance.
import { confidence, oshit } from '../meters.js';
import { form } from '../players-data.js';
import { esc, fmt, fmt1, moveBadge, names, panel, pct, plural, signed } from '../ui/dom.js';
import { headshot, statusChip } from '../ui/player.js';
import { gameDayHtml } from '../ui/gameday.js';
import { link } from '../ui/router.js';

const segbar = (score, heat = false) => `<div class="segbar${heat ? ' heat' : ''}" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="${score > i * 10 ? 'on' : ''}"></i>`).join('')}</div>`;

function heroHtml(m) {
  const L = m.loser;
  if (!L) return '';
  const r = m.recap;
  const final = r?.final ? `<p class="final-banner">Week ${r.week.id} final: ${esc(names(r.last))} ${r.last.length > 1 ? 'share' : 'cops'} the punishment on ${fmt(r.last[0].weekPts)}.</p>` : '';
  const gap = m.safety ? `${fmt(m.gap)} behind ${esc(m.safety.name)} on projection.` : '';
  const conf = confidence(m);
  const hot = oshit(L, m.rows);
  return `${final}<section class="hero" aria-label="Projected last place">
    <div>
      <p class="kicker">On track for the punishment</p>
      <h2>${esc(L.name)}</h2>
      ${L.owner ? `<p class="owner">${esc(L.owner)}</p>` : ''}
      <p class="line">Sitting on ${fmt(L.weekPts)}, projected ${fmt(L.projFinal)}. ${gap} ${plural(L.gamesLeft, 'game')} left across ${plural(L.playersLeft, 'player')}.</p>
    </div>
    <div class="gauges">
      <div class="gauge">
        <div class="gauge-h"><span>Chance of last place</span><b>${pct(L.odds)}</b></div>
        ${conf ? `${segbar(conf.score)}<p class="why"><b>Confidence: ${conf.level} (${conf.score})</b>. ${esc(conf.why)}</p>
        <details><summary>What does confidence mean?</summary><p>It is not a margin of error. It shows how settled the race is: half is how much of the week’s points are already banked, half is how lopsided the odds are. Early in the week, or with several teams in the mix, the percentage can move a lot.</p></details>` : ''}
      </div>
      <div class="gauge">
        <div class="gauge-h"><span>Oh Fuck - Binky sungle</span><b>${hot.score}<small>${esc(hot.level)}</small></b></div>
        ${segbar(hot.score, true)}<p class="why"><b>${esc(hot.level)}.</b> ${esc(hot.line)} ${Math.round(hot.odds * 100)}% chance of last place, ${Math.round(hot.certainty * 100)}% certain.</p>
        <details><summary>How is this worked out?</summary><p>Chance of finishing last multiplied by how certain that chance is. A 70% chance on day one is only a guess, so the meter stays low; the same 70% late in the week with the team already well behind is nearly settled, so it climbs. Certainty is 60% how much of the week is done (nothing until 15% is scored, full at 85%) and 40% how far the team is already behind the next-worst team on points scored, against what is left to swing. Levels: Cruising, Relaxed, Getting twitchy, Sweating, Panic stations, Code red, Locked in.</p></details>
      </div>
    </div>
  </section>`;
}

function boardHtml(m, app) {
  const top = Math.max(1, ...m.rows.map((r) => r.weekPts));
  const lastRank = Math.max(...m.rows.map((r) => r.rank));
  const mine = app.account.team()?.id;
  const rows = m.rows
    .map((r) => {
      const cls = [r.rank === lastRank && 'last', r.id === mine && 'me'].filter(Boolean).join(' ');
      const o = oshit(r, m.rows);
      return `<tr class="${cls}">
        <td class="num strong">${r.rank}${moveBadge(r.prevRank, r.rank)}</td>
        <th scope="row"><div class="who-cell"><b>${esc(r.name)}</b>${r.owner ? `<small>${esc(r.owner)}</small>` : ''}</div></th>
        <td class="num strong">${fmt(r.weekPts)}${r.todayPts ? `<small class="muted"> +${fmt(r.todayPts)}</small>` : ''}</td>
        <td class="hide-sm" style="min-width:110px"><div class="meter ${r.rank === lastRank ? 'bad' : ''}"><span style="width:${(r.weekPts / top) * 100}%"></span></div></td>
        <td class="num">${fmt(r.projFinal)}</td>
        <td class="num hide-sm">${r.gamesLeft}<span class="muted"> / ${r.playersLeft}</span></td>
        <td class="num ${r.odds >= 0.1 ? 'risk-hot' : ''}">${pct(r.odds)}</td>
        <td class="hide-sm" style="min-width:90px"><div class="meter ${o.score >= 55 ? 'bad' : ''}" title="Oh Fuck - Binky sungle ${o.score}: ${esc(o.level)}"><span style="width:${o.score}%"></span></div></td>
      </tr>`;
    })
    .join('');
  return panel('This week', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num">Week pts</th><th class="hide-sm"></th><th class="num">Projected</th><th class="num hide-sm">Games / players left</th><th class="num">Last place</th><th class="hide-sm" title="Oh Fuck - Binky sungle">Binky</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`, { cls: 'flush', tools: `<a class="btn sm" href="${link('matchups')}">Matchups</a>` });
}

// A short list of players for a side panel
const miniList = (title, rows, href, line) =>
  panel(title, rows.length ? `<ul class="mini">${rows.map((p) => `<li><a href="${link('players', p.id)}">${headshot(p.id)}<span><b>${esc(p.name)}</b><small>${esc(p.team)} · ${esc(p.pos.join('/'))}${p.fantasyTeam ? ` · ${esc(p.fantasyTeam.name)}` : ''}</small></span></a><em>${line(p)}</em></li>`).join('')}</ul>` : '<p class="empty">Nothing to show yet.</p>', { cls: 'flush', tools: `<a class="btn sm" href="${href}">All</a>` });

function sideHtml(state) {
  const pool = state.players.filter((p) => p.proTeamId);
  const best = pool.filter((p) => p.free && p.rank && p.injury === 'ACTIVE').sort((a, b) => a.rank - b.rank).slice(0, 5);
  const hot = pool.filter((p) => p.gp >= 3 && p.own >= 20 && form(p) != null).sort((a, b) => form(b) - form(a)).slice(0, 5);
  const hurt = pool.filter((p) => !p.free && p.injury !== 'ACTIVE').sort((a, b) => b.avg - a.avg).slice(0, 6);
  return [
    miniList('Best available', best, link('players', 'free'), (p) => `${fmt1(p.avg)} <small>avg</small>`),
    miniList('Hot right now', hot, link('players'), (p) => `<span class="pos-text">${signed(form(p), 0)}%</span>`),
    miniList('Injury report', hurt, link('players'), (p) => statusChip(p)),
  ].join('');
}

export default {
  id: 'dashboard',
  label: 'Dashboard',
  async render(app, el, route) {
    const m = app.model;
    const day = gameDayHtml(app);
    const draw = (side) => {
      el.innerHTML = `${heroHtml(m)}<div class="grid main-side"><div class="grid">${boardHtml(m, app)}</div><div class="grid">${day}${side}</div></div>`;
    };
    draw('');
    // Player panels come from the pool, which loads a moment later; the page is usable without them
    const state = await app.store.get().catch(() => null);
    if (state?.players.length && app.route === route) draw(sideHtml(state));
  },
};
