// My Team: your lineup, what it is worth, and the best lineup for the next game day (view only: set it in ESPN).
import { suggestLineup } from '../lineup.js';
import { bankedShare, oshit } from '../meters.js';
import { dayLabel } from '../logic.js';
import { esc, fmt, fmt1, panel, pct, plural } from '../ui/dom.js';
import { headshot, statusChip, teamLogo } from '../ui/player.js';
import { link } from '../ui/router.js';
import { focusPin, signInClick, signInHtml, signInSubmit } from '../ui/signin.js';

const SLOT = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 7: 'SG/SF', 8: 'G/F', 9: 'PF/C', 10: 'F/C', 11: 'UTIL', 12: 'BN', 13: 'IR' };
const GROUPS = [['Starting lineup', (p) => p.slot >= 0 && p.slot <= 11], ['Bench', (p) => p.slot === 12], ['Injured reserve', (p) => p.slot >= 13]];

function rosterTable(app, team, pool, ctx, advice) {
  const startIds = new Set(advice?.best.map((b) => b.player.playerId));
  const gamesLeft = (p) => app.model.week.sps.filter((sp) => sp >= app.ctx.league.currentSP && app.ctx.pro.games.get(p.proTeamId)?.has(sp)).length;
  const rows = GROUPS.flatMap(([title, test]) => {
    const players = team.roster.filter(test).sort((a, b) => a.slot - b.slot || b.seasonAvg - a.seasonAvg);
    if (!players.length) return [];
    return [`<tr class="grp"><th colspan="9">${title} (${players.length})</th></tr>`, ...players.map((p) => {
      const r = pool?.byId.get(p.playerId);
      const row = r || { id: p.playerId, name: p.name, injury: p.injury, pos: [], team: app.ctx.pro.abbrev.get(p.proTeamId) || '', avg: p.seasonAvg, l7: null, proj: p.projAvg, own: 0, returnMs: p.returnMs ?? null, injuryDetail: p.injuryDetail };
      const benchStart = advice && p.slot === 12 && startIds.has(p.playerId);
      const sitStarter = advice && advice.moves.some((m) => m.sit?.playerId === p.playerId);
      const flag = benchStart ? '<span class="badge good">Should start</span>' : sitStarter ? '<span class="badge warn">Could sit</span>' : '';
      return `<tr>
        <td><span class="slot-tag">${SLOT[p.slot] ?? p.slot}</span></td>
        <td><div class="player-cell">${headshot(p.playerId)}<div><a class="plink" href="${link('players', p.playerId)}"><b>${esc(p.name)}</b></a><small>${flag}</small></div></div></td>
        <td>${esc((r?.pos || []).join('/') || '–')}</td>
        <td><span class="tcell">${teamLogo(row.team)}${esc(row.team)}</span></td>
        <td class="num"><b>${fmt1(row.avg)}</b></td>
        <td class="num">${fmt1(row.l7)}</td>
        <td class="num">${fmt1(row.proj)}</td>
        <td class="num">${gamesLeft(p)}</td>
        <td>${statusChip(row)}</td>
      </tr>`;
    })];
  });
  return `<div class="tbl-wrap"><table class="tbl lineup"><thead><tr><th>Slot</th><th>Player</th><th>Pos</th><th>NBA team</th><th class="num">FPTS avg</th><th class="num">L7</th><th class="num">Proj</th><th class="num">Wk games</th><th>Status</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function adviceHtml(app, advice) {
  if (!advice) return '<p class="empty">No upcoming games to plan for.</p>';
  const label = `${dayLabel(app.ctx.pro, advice.sp)} (US)`;
  const moves = advice.moves.filter((m) => m.start || m.sit);
  const list = moves.length
    ? `<ul class="moves">${moves.map((m) => `<li>${m.start ? `Start <b>${esc(m.start.name)}</b>` : ''}${m.start && m.sit ? ' instead of ' : ''}${m.sit ? `${m.start ? '' : 'Bench '}<b>${esc(m.sit.name)}</b>` : ''}</li>`).join('')}</ul>`
    : '<p class="ok">Your lineup is already the best one for that day.</p>';
  return `<p class="lede">Best lineup for <b>${esc(label)}</b>, from who has a game, who is healthy, and the slots each player can fill.</p>
    <div class="stats"><div class="stat"><span>Your lineup</span><b>${fmt1(advice.now)}</b><small>expected points</small></div><div class="stat accent"><span>Best lineup</span><b>${fmt1(advice.bestTotal)}</b><small>${advice.gain > 0.05 ? `+${fmt1(advice.gain)} better` : 'same'}</small></div></div>
    ${list}<p class="note">${advice.locked.length ? `${plural(advice.locked.length, 'player')} already tipped off and ${advice.locked.length === 1 ? 'is' : 'are'} locked in. ` : ''}${plural(advice.best.length, 'open slot')} filled from ${plural(advice.best.length + advice.benched.length, 'healthy player')} with a game still to play. This only advises: ESPN doesn’t let other apps set your lineup, so make the change there.</p>`;
}

export default {
  id: 'team',
  label: 'My Team',
  async render(app, el, route) {
    const team = app.account.team();
    if (!team) {
      el.innerHTML = signInHtml(app.account, app.ctx.league.teams, 'to see your lineup and lineup advice');
      el.onclick = (e) => signInClick(e, app.account);
      el.onsubmit = (e) => signInSubmit(e, app.account);
      focusPin(el);
      return;
    }
    const m = app.model;
    const row = m.rows.find((r) => r.id === team.id);
    const banked = bankedShare(m.rows);
    const heat = row ? oshit(row, row.id === m.loser?.id ? m.safety : m.rows.filter((r) => r.id !== row.id).sort((a, b) => b.projFinal - a.projFinal).at(-1), banked) : null;

    const draw = (pool, ctx) => {
      const cur = app.ctx.league.currentSP;
      const now = app.src.now();
      // The next day on which one of your players still has a game to start
      const sp = [cur, ...(ctx?.days || [])].find((d) => team.roster.some((p) => { const g = app.ctx.pro.games.get(p.proTeamId)?.get(d); return g && g.date > now; }));
      const advice = ctx && sp != null ? suggestLineup(ctx, team, sp, { pro: app.ctx.pro, now }) : null;
      el.innerHTML = `<div class="grid">
        <section class="hero team-hero">
          <div><p class="kicker">Your team</p><h2>${esc(team.name)}</h2><p class="owner">${esc(team.owner || '')} · <button type="button" class="link" data-a="signout">Not you? Switch team</button></p>
            <p class="line">${row ? `Week rank <b>${row.rank}</b> of ${m.rows.length} with ${fmt(row.weekPts)} points, projected ${fmt(row.projFinal)}. ${plural(row.gamesLeft, 'game')} left across ${plural(row.playersLeft, 'player')}.` : ''}</p></div>
          <div class="gauges">${row ? `<div class="gauge"><div class="gauge-h"><span>Chance of last place</span><b>${pct(row.odds)}</b></div></div>
            <div class="gauge"><div class="gauge-h"><span>O-SHIT meter</span><b>${heat.score}<small>${esc(heat.level)}</small></b></div><div class="segbar heat">${Array.from({ length: 10 }, (_, i) => `<i class="${heat.score > i * 10 ? 'on' : ''}"></i>`).join('')}</div><p class="why">${esc(heat.line)}</p></div>` : ''}</div>
        </section>
        <div class="grid main-side">
          ${panel('Lineup', pool ? rosterTable(app, team, pool, ctx, advice) : '<p class="loading">Loading players…</p>', { cls: 'flush' })}
          ${panel('Lineup advice', ctx ? adviceHtml(app, advice) : '<p class="loading">Working it out…</p>')}
        </div>
      </div>`;
    };
    draw(null, null);
    el.onclick = (e) => { if (e.target.closest('[data-a=signout]')) app.account.signOut(); };
    const [pool, ctx] = await Promise.all([app.store.get().catch(() => null), app.tradeContext().catch(() => null)]);
    if (app.route !== route) return;
    draw(pool, ctx);
  },
};
