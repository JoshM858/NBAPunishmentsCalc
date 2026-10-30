// Activity: adds, drops, waiver claims and trades across the league, newest first (read only).
import { describe, parseActivity } from '../activity.js';
import { esc, panel } from '../ui/dom.js';
import { link } from '../ui/router.js';

const when = (ms, tz) => new Date(ms).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz });

export async function renderActivity(app, el, route) {
  el.innerHTML = '<p class="loading">Loading activity…</p>';
  const [raw, pool] = await Promise.all([Promise.resolve(app.src.activity?.()).catch(() => null), app.store.get().catch(() => null)]);
  if (app.route !== route) return;
  const teams = app.ctx.league.teams;
  const events = parseActivity(raw, { teamIds: teams.map((t) => t.id) });
  if (!events.length) {
    el.innerHTML = panel('Activity', '<p class="empty">No adds, drops or trades yet.</p>');
    return;
  }
  const teamOf = (id) => teams.find((t) => t.id === id)?.name || 'Another team';
  const nameOf = (id) => {
    const p = pool?.byId.get(id);
    return p ? `<a class="plink" href="${link('players', id)}">${esc(p.name)}</a>` : `Player ${id}`;
  };
  const rows = events.map((e) => {
    const text = describe(e, { nameOf: (id) => `\u0000${id}\u0000`, teamOf });
    // Names are links (HTML); the rest of the sentence is escaped
    const html = esc(text).replace(/\u0000(\d+)\u0000/g, (_, id) => nameOf(Number(id)));
    return `<tr><td class="num muted">${esc(when(e.at, app.tz))}</td><td><span class="badge${e.kind.startsWith('trade') ? ' accent' : ''}">${esc(e.kind)}</span></td><td><b>${esc(teamOf(e.teamId))}</b> ${html}</td></tr>`;
  }).join('');
  el.innerHTML = panel('Activity', `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Type</th><th>Move</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note" style="padding:12px 16px">Lineup changes are left out. Times are in ${esc(app.tz.replace('_', ' '))}.</p>`, { cls: 'flush' });
}
