// League: the punishment history (standings, draft and more arrive in later phases).
import { esc, fmt, panel } from '../ui/dom.js';

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

export default {
  id: 'league',
  label: 'League',
  render(app, el) {
    el.innerHTML = punishmentsHtml(app);
  },
};
