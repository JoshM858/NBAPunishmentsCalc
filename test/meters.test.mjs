import assert from 'node:assert/strict';
import { OSHIT_LEVELS, bankedShare, concentration, confidence, oshit } from '../public/meters.js';

const row = (odds, projFinal, weekPts, sd = 80) => ({ odds, projFinal, weekPts, sd });
const race = (rows) => ({ rows });

// Banked share: nothing scored -> 0, everything scored -> 1
assert.equal(bankedShare([row(0.5, 1000, 0), row(0.5, 1000, 0)]), 0);
assert.equal(bankedShare([row(0.5, 1000, 1000), row(0.5, 1000, 1000)]), 1);

// Concentration: a coin toss between everyone is 0, a sure thing is 1
assert.ok(concentration(Array.from({ length: 10 }, () => row(0.1, 1, 1))) < 0.001);
assert.ok(concentration([row(1, 1, 1), row(0, 1, 1), row(0, 1, 1)]) > 0.999);

// Confidence grows as the week is banked and the odds concentrate
const early = confidence(race(Array.from({ length: 10 }, () => row(0.1, 1000, 100))));
const late = confidence(race([row(0.9, 1000, 950), row(0.05, 1100, 1050), row(0.05, 1200, 1150)]));
assert.ok(early.score < 20 && early.level === 'Low', JSON.stringify(early));
assert.ok(late.score >= 70 && late.level === 'High', JSON.stringify(late));
assert.equal(confidence(race([row(1, 1, 1)])), null);

// O-SHIT = chance of last place x how certain it is. Rows: id, odds, weekPts (scored so far), projFinal, sd.
const mk = (id, odds, weekPts, projFinal, sd = 80) => ({ id, odds, weekPts, projFinal, sd });
const week = (frac, odds, behind) => { // a 4-team week `frac` of the way through; team 1 is last by `behind` points
  const final = 1000;
  return [mk(1, odds, final * frac - behind, final), mk(2, (1 - odds) / 3, final * frac, final), mk(3, (1 - odds) / 3, final * frac, final), mk(4, (1 - odds) / 3, final * frac, final)];
};
// Early in the week even a 70% chance is only a guess: a low meter
const earlyW = week(0.08, 0.7, 5);
assert.ok(oshit(earlyW[0], earlyW).score <= 12, `early: ${oshit(earlyW[0], earlyW).score}`);
assert.ok(['Cruising', 'Relaxed'].includes(oshit(earlyW[0], earlyW).level));
// The same chance late in the week with the team already far behind: it climbs a long way
const lateW = week(0.9, 0.7, 200);
assert.ok(oshit(lateW[0], lateW).score >= 60, `late: ${oshit(lateW[0], lateW).score}`);
// Day four, three teams all flip-flopping around 80% (what happened): none of them is in the red
const midW = week(0.5, 0.8, 10);
assert.ok(oshit(midW[0], midW).score <= 40, `mid-week flip-flop: ${oshit(midW[0], midW).score}`);
// More certainty never lowers the meter, and neither does a higher chance
const sc = (frac, odds, behind) => { const r = week(frac, odds, behind); return oshit(r[0], r).score; };
assert.ok(sc(0.3, 0.7, 20) <= sc(0.6, 0.7, 20) && sc(0.6, 0.7, 20) <= sc(0.9, 0.7, 20), 'later in the week, higher');
assert.ok(sc(0.6, 0.7, 5) <= sc(0.6, 0.7, 150), 'further behind, higher');
assert.ok(sc(0.6, 0.3, 50) < sc(0.6, 0.7, 50), 'a higher chance, higher');
// A team far from last is at the bottom of the scale, and every score is 0-100 with a named level
assert.equal(oshit(lateW[1], lateW).level, 'Cruising');
for (const f of [0, 0.5, 1]) for (const o of [0, 0.5, 1]) for (const b of [-100, 0, 500]) { const r = week(f, o, b); const m = oshit(r[0], r); assert.ok(m.score >= 0 && m.score <= 100 && m.level && m.line); }
assert.equal(oshit({ id: 1, odds: 1, weekPts: 0, projFinal: 1, sd: 0 }, [{ id: 1, odds: 1, weekPts: 0, projFinal: 1, sd: 0 }]).score, 0, 'nothing is certain with nothing scored');
assert.equal(oshit(null), null);
assert.deepEqual(OSHIT_LEVELS.map((l) => l[1]), ['Locked in', 'Code red', 'Panic stations', 'Sweating', 'Getting twitchy', 'Relaxed', 'Cruising']);

console.log('Meter tests passed');
