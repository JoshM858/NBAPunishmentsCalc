import assert from 'node:assert/strict';
import { bankedShare, concentration, confidence, oshit } from '../public/meters.js';

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

// O-SHIT: safe team ~0, a team sure to finish well behind with the week banked is near 100, always 0-100
const safe = oshit(row(0, 1200, 500), row(0.5, 1000, 500), 0.5);
assert.equal(safe.score, 0);
assert.equal(safe.level, 'Chill');
const doomed = oshit(row(0.97, 900, 880, 40), { projFinal: 1200 }, 0.95);
assert.ok(doomed.score >= 80 && doomed.level === 'O-SHIT', JSON.stringify(doomed));
for (const o of [0, 0.3, 1]) for (const b of [0, 1]) { const s = oshit(row(o, 1000, 1, 50), { projFinal: 1100 }, b).score; assert.ok(s >= 0 && s <= 100); }
// Monotonic in the chance of last place
assert.ok(oshit(row(0.6, 1000, 1), { projFinal: 1100 }, 0.5).score > oshit(row(0.3, 1000, 1), { projFinal: 1100 }, 0.5).score);
assert.equal(oshit(null), null);

console.log('Meter tests passed');
