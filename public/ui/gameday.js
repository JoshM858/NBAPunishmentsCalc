// The game-day card: when play starts and likely ends in the viewer's time zone, and whether it is finished.
import { dayLabel, duration, gameDays, localTime, zoneName } from '../logic.js';
import { esc, panel, plural } from './dom.js';

export function gameDayHtml(app) {
  if (!app.ctx || app.demo) return '';
  const { tz, board } = app;
  const now = Date.now();
  const when = (ms) => `${localTime(ms, tz)} ${zoneName(ms, tz)}`;
  const { today, next } = gameDays(app.ctx.pro, app.ctx.league.currentSP, now, board);

  const line = (d, { isNext = false } = {}) => {
    const label = `${dayLabel(app.ctx.pro, d.sp)} (US)`;
    const slate = `${plural(d.games, 'game')}, first game ${when(d.firstTip)}, likely finished by ${localTime(d.likelyEnd, tz)}.`;
    const tag = d.estimated ? ' <span class="est">estimated</span>' : '';
    if (isNext) return `<p><b>Next: ${esc(label)}:</b> ${esc(slate)}</p>`;
    let status;
    if (d.state === 'done') status = '<span class="chip done">Finished for the day</span>';
    else if (d.state === 'live') {
      const left = d.likelyEnd - now;
      const progress = d.final == null ? '' : `${d.final} of ${d.games} games final. `;
      status = `<span class="chip live">In progress</span> ${progress}${left > 0 ? `About ${duration(left)} to go.` : 'Should be wrapping up.'}`;
    } else status = `<span class="chip soon">${d.firstTip - now > 60_000 ? `Starts in ${duration(d.firstTip - now)}` : 'Starting now'}</span>`;
    return `<p><b>${esc(label)}</b> ${status}${tag}</p><p class="times">${d.state === 'done' ? `Played from ${when(d.firstTip)}.` : esc(slate)}</p>`;
  };

  const over = !today || today.state === 'done';
  const parts = [today && line(today), over && next && line(next, { isNext: true })].filter(Boolean);
  if (!parts.length) return '';
  return panel(`Game day · ${esc(tz.replace('_', ' '))}`, `<div class="gameday-b">${parts.join('')}</div>`, { cls: 'gameday' });
}
