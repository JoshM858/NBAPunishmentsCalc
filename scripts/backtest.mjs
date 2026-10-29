// Replays finished weeks from the real-league capture: each morning, project the week using only what
// was known then, and score it against how the week ended. Usage: npm run backtest
// Refresh the capture with `npm run capture` as more weeks finish.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ACTIVE_MAX_SLOT, buildWeeks, parseEntry, parseLeague, parseProSchedule, projectTeam, simulateWeek } from '../public/logic.js';

const fixture = (f) => JSON.parse(readFileSync(new URL(`../test/fixtures/${f}`, import.meta.url), 'utf8'));

export function replay({ hide = [3], quiet = true } = {}) {
  const real = fixture('real-league.json');
  const pro = parseProSchedule(fixture('pro-2027.json'));
  const league = parseLeague(real.league, 2027);
  const weeks = buildWeeks(league, pro).filter((w) => w.sps.at(-1) < real.cur);
  const ids = league.teams.map((t) => t.id).filter((id) => !hide.includes(id));
  const preseason = new Map(league.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.projAvg])));

  const day = {};
  const log = new Map(); // playerId -> Map(sp -> points)
  for (const sp of Object.keys(real.days).map(Number)) {
    day[sp] = new Map();
    for (const t of real.days[sp].teams) {
      if (hide.includes(t.id)) continue;
      const ents = t.roster.entries.map((e) => parseEntry(e, 2027));
      day[sp].set(t.id, ents);
      for (const p of ents) {
        if (p.bySP[sp] === undefined) continue;
        if (!log.has(p.playerId)) log.set(p.playerId, new Map());
        log.get(p.playerId).set(sp, p.bySP[sp]);
      }
    }
  }
  const actual = (tid, sp) => day[sp].get(tid).filter((p) => p.slot <= ACTIVE_MAX_SLOT).reduce((s, p) => s + (p.bySP[sp] ?? 0), 0);
  // Roster as set that morning, with averages from games played before it. (ESPN's injury status is only
  // known as of today, so it is left out: this replay is harder than live use.)
  const rosterAt = (tid, d) => day[d].get(tid).map((p) => {
    const played = [...(log.get(p.playerId) || [])].filter(([sp, v]) => sp < d && v > 0).map(([, v]) => v);
    const avg = played.length ? played.reduce((a, b) => a + b, 0) / played.length : 0;
    return { ...p, injury: 'ACTIVE', seasonAvg: avg, seasonGP: played.length, last15Avg: avg, projAvg: preseason.get(p.playerId) || avg };
  });

  const z = [];
  let absErr = 0;
  let bias = 0;
  let n = 0;
  let minOdds = 1;
  const odds = [];
  for (const week of weeks) {
    const total = Object.fromEntries(ids.map((id) => [id, week.sps.reduce((s, sp) => s + (day[sp] ? actual(id, sp) : 0), 0)]));
    const last = ids.reduce((a, b) => (total[a] < total[b] ? a : b));
    for (const d of week.sps) {
      if (!day[d]) continue;
      const now = (pro.spDate.get(d) ?? 0) - 3_600_000;
      const rows = ids.map((id) => {
        const current = week.sps.filter((sp) => sp < d).reduce((s, sp) => s + actual(id, sp), 0);
        const p = projectTeam({ roster: rosterAt(id, d) }, { week, currentSP: d, pro, now, activeSlots: league.activeSlots });
        return { id, current, mean: p.mean, plan: p.plan };
      });
      const sim = simulateWeek(rows);
      for (const r of rows) {
        const s = sim.get(r.id);
        const miss = total[r.id] - (r.current + s.mean);
        absErr += Math.abs(miss);
        bias += r.current + s.mean - total[r.id];
        n++;
        z.push(miss / s.sd);
      }
      const p = sim.get(last).odds;
      odds.push(p);
      minOdds = Math.min(minOdds, p);
      if (!quiet) console.log(`week ${week.id} day ${d}: model gave the team that finished last ${(p * 100).toFixed(0)}%`);
    }
  }
  return {
    weeks: weeks.length,
    n,
    meanAbsError: absErr / n,
    bias: bias / n,
    rmsZ: Math.sqrt(z.reduce((s, v) => s + v * v, 0) / z.length), // 1.0 = the stated uncertainty is honest
    logLoss: -odds.reduce((s, p) => s + Math.log(Math.max(p, 0.005)), 0) / odds.length,
    minOddsOnActualLoser: minOdds,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = replay({ quiet: false });
  console.log(`\n${r.weeks} finished week(s), ${r.n} team-projections`);
  console.log(`mean absolute error of projected final: ${r.meanAbsError.toFixed(0)} pts (bias ${r.bias.toFixed(0)})`);
  console.log(`rms z: ${r.rmsZ.toFixed(2)}  (1.0 means the stated uncertainty matches reality; above 1 is overconfident)`);
  console.log(`log-loss on the team that finished last: ${r.logLoss.toFixed(2)}; lowest chance it was ever given: ${(r.minOddsOnActualLoser * 100).toFixed(1)}%`);
}
