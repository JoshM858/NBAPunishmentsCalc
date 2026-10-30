// Dashboard: who is on track for the punishment, how sure we are, game-day times and the week at a glance.
import { bankedShare, confidence, oshit } from '../meters.js';
import { esc, fmt, moveBadge, names, panel, pct, plural } from '../ui/dom.js';
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
  const hot = oshit(L, m.safety, bankedShare(m.rows));
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
        <div class="gauge-h"><span>O-SHIT meter</span><b>${hot.score}<small>${esc(hot.level)}</small></b></div>
        ${segbar(hot.score, true)}<p class="why">${esc(hot.line)}</p>
        <details><summary>How is this worked out?</summary><p>Half is ${esc(L.name)}’s chance of finishing last, 30% is how far behind the safest team it projects (against its own ups and downs), and 20% is how much of the week is already locked in. 0 is nowhere near trouble, 100 is the punishment looking certain.</p></details>
      </div>
    </div>
  </section>`;
}

function boardHtml(m, app) {
  const top = Math.max(1, ...m.rows.map((r) => r.weekPts));
  const lastRank = Math.max(...m.rows.map((r) => r.rank));
  const mine = app.account.team()?.id;
  const banked = bankedShare(m.rows);
  const rows = m.rows
    .map((r) => {
      const cls = [r.rank === lastRank && 'last', r.id === mine && 'me'].filter(Boolean).join(' ');
      const o = oshit(r, m.safety, banked);
      return `<tr class="${cls}">
        <td class="num strong">${r.rank}${moveBadge(r.prevRank, r.rank)}</td>
        <th scope="row"><div class="who-cell"><b>${esc(r.name)}</b>${r.owner ? `<small>${esc(r.owner)}</small>` : ''}</div></th>
        <td class="num strong">${fmt(r.weekPts)}${r.todayPts ? `<small class="muted"> +${fmt(r.todayPts)}</small>` : ''}</td>
        <td class="hide-sm" style="min-width:110px"><div class="meter ${r.rank === lastRank ? 'bad' : ''}"><span style="width:${(r.weekPts / top) * 100}%"></span></div></td>
        <td class="num">${fmt(r.projFinal)}</td>
        <td class="num hide-sm">${r.gamesLeft}<span class="muted"> / ${r.playersLeft}</span></td>
        <td class="num ${r.odds >= 0.1 ? 'risk-hot' : ''}">${pct(r.odds)}</td>
        <td class="hide-sm" style="min-width:90px"><div class="meter ${o.score >= 60 ? 'bad' : ''}" title="O-SHIT ${o.score}: ${esc(o.level)}"><span style="width:${o.score}%"></span></div></td>
      </tr>`;
    })
    .join('');
  return panel('This week', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num">Week pts</th><th class="hide-sm"></th><th class="num">Projected</th><th class="num hide-sm">Games / players left</th><th class="num">Last place</th><th class="hide-sm">O-SHIT</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`, { cls: 'flush', tools: `<a class="btn sm" href="${link('matchups')}">Matchups</a>` });
}

export default {
  id: 'dashboard',
  label: 'Dashboard',
  render(app, el) {
    const m = app.model;
    const day = gameDayHtml(app);
    el.innerHTML = `${heroHtml(m)}${day ? `<div class="grid main-side">${boardHtml(m, app)}${day}</div>` : boardHtml(m, app)}`;
  },
};
