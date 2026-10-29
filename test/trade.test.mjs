import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLeague, parseProSchedule } from '../public/logic.js';
import {
  STARS, TRADE, assign, dayPicks, dayValue, evaluateTrade, maxMatching, normalCdf, playChance, playerValue, rosterValue,
  starsFor, teamGamesThrough, tradeContext, tradeGains, verdict, winnerConfidence,
} from '../public/trade.js';

const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);

/* ---------- Lineup matching ---------- */

{
  // Brute force agrees on random matrices (including zero weights and non-square shapes)
  let seed = 5;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let t = 0; t < 300; t++) {
    const R = 1 + Math.floor(rand() * 6);
    const C = 1 + Math.floor(rand() * 6);
    const w = Array.from({ length: R }, () => Array.from({ length: C }, () => (rand() < 0.4 ? 0 : Math.round(rand() * 20))));
    let best = 0;
    const used = Array(C).fill(false);
    (function go(i, sum) {
      if (i === R) return void (best = Math.max(best, sum));
      go(i + 1, sum);
      for (let j = 0; j < C; j++) if (!used[j]) (used[j] = true), go(i + 1, sum + w[i][j]), (used[j] = false);
    })(0, 0);
    near(maxMatching(w), best, 1e-9, `matrix ${t}`);
  }
  assert.equal(maxMatching([]), 0);
  assert.deepEqual(assign([[10, 0], [8, 8], [0, 7]]).total, 18, 'the flexible player takes the slot the specialists cannot');

  // One day: slots PG(0), SG(1); a free agent is worth 5 anywhere
  const players = [{ v: 10, slots: [0] }, { v: 8, slots: [0, 1] }, { v: 7, slots: [1] }];
  assert.equal(dayValue(players, [0, 1], 5), 18);
  assert.deepEqual(dayPicks(players, [0, 1], 5).sort(), [0, 1]);
  assert.equal(dayValue([], [0, 1, 2], 6), 18, 'empty slots are filled by free agents');
  assert.equal(dayValue([{ v: 4, slots: [0] }], [0], 6), 6, 'a player worse than a free agent adds nothing');
  assert.equal(dayValue([{ v: 30, slots: [4] }], [0, 1], 5), 10, 'a centre cannot fill guard slots');
  assert.equal(dayValue([{ v: 30, slots: [4, 11] }], [4, 11], 5), 30 + 5 - 0 + 0, 'one player fills one slot only');
}

/* ---------- Player value ---------- */

{
  const proj = 40;
  // no games yet: all projection, and a typical play rate
  const fresh = playerValue({ seasonGP: 0, seasonAvg: 0, projAvg: proj }, 0);
  near(fresh.ppg, proj);
  near(fresh.rate, TRADE.baseRate);
  near(fresh.perGame, proj * TRADE.baseRate);
  // a few hot games move him only part of the way; many games move him most of the way
  const hot5 = playerValue({ seasonGP: 5, seasonAvg: 60, projAvg: proj }, 5);
  const hot60 = playerValue({ seasonGP: 60, seasonAvg: 60, projAvg: proj }, 60);
  assert.ok(hot5.ppg > proj && hot5.ppg < 50, `5 games: ${hot5.ppg}`);
  assert.ok(hot60.ppg > 55 && hot60.ppg < 60);
  // play rate: a player who missed half his team's games is rated below one who missed none, but not at 50%
  const healthy = playerValue({ seasonGP: 20, seasonAvg: 30, projAvg: 30 }, 20);
  const hurt = playerValue({ seasonGP: 10, seasonAvg: 30, projAvg: 30 }, 20);
  assert.ok(healthy.rate > hurt.rate && hurt.rate > 0.5 * 1.0 * 0.9 - 0.1 && hurt.rate < healthy.rate);
  assert.ok(healthy.rate <= 1 && hurt.rate >= 0);
  // no projection and no games: worth nothing rather than NaN
  const nobody = playerValue({ seasonGP: 0, seasonAvg: 0, projAvg: 0 }, 0);
  assert.equal(nobody.perGame, 0);
  // a player who is out ramps back toward his usual rate
  assert.equal(playChance(0.7, false, 0), 0.7);
  assert.ok(playChance(0.7, true, 0) < playChance(0.7, true, 5) && playChance(0.7, true, 5) < playChance(0.7, true, 40));
  near(playChance(0.7, true, 200), 0.7, 1e-6);
}

/* ---------- Stars ---------- */

{
  assert.equal(starsFor(0, 4), 5);
  assert.equal(starsFor(3, 4), 5, 'a few points either way is fair');
  assert.equal(starsFor(1000, 2), 0.5);
  assert.equal(starsFor(-1000, 2), 0.5, 'direction does not matter, only how lopsided');
  for (const n of [2, 4, 6]) {
    let last = 5.5;
    for (const g of [0, 5, 10, 20, 40, 60, 90, 130, 200, 300]) {
      const s = starsFor(g, n);
      assert.ok(s <= last, `stars never rise with a bigger gap (${n} players, gap ${g})`);
      assert.equal(s * 2, Math.round(s * 2), 'half-star steps');
      assert.ok(s >= 0.5 && s <= 5);
      last = s;
    }
  }
  assert.ok(starsFor(60, 6) >= starsFor(60, 2), 'the same gap is less telling in a bigger trade');
  // The calibration measured on 3,000 simulated trades from last season: a 20 pt/week gap in a 4-player trade
  // picks the true winner ~64% of the time, 60 pts ~74%, 130 pts ~87%
  near(winnerConfidence(0, 4), 0.5);
  near(winnerConfidence(20, 4), 0.57, 0.04);
  near(winnerConfidence(60, 4), 0.69, 0.06);
  near(winnerConfidence(130, 4), 0.86, 0.05);
  near(normalCdf(0), 0.5, 1e-6);
  near(normalCdf(1.96), 0.975, 1e-3);
  near(normalCdf(-1), 1 - normalCdf(1), 1e-6);
  assert.deepEqual([5, 4, 3, 2, 1].map(verdict), ['Fair deal', 'Slightly lopsided', 'Lopsided', 'Very one-sided', 'Daylight robbery']);
  assert.equal(STARS.sigma, 60);
}

/* ---------- Team gains on a toy league ---------- */

{
  const days = Array.from({ length: 14 }, (_, i) => i + 1);
  const mk = (id, v, slots = [0, 1, 2, 3, 4, 5, 6, 11, 12, 13], extra = {}) => ({ playerId: id, name: `P${id}`, v, slots, injury: 'ACTIVE', ...extra });
  const ctx = { days, slotIds: [0, 1, 11], r: 5, plays: () => true, item: (p) => ({ v: p.v, slots: p.slots, outNow: p.injury === 'OUT' }) };
  const A = [mk(1, 40), mk(2, 30), mk(3, 20)];
  const B = [mk(4, 38), mk(5, 12), mk(6, 8)];
  // Swapping equal players changes nothing
  const same = tradeGains([mk(1, 30), mk(2, 20)], [mk(3, 30), mk(4, 20)], [1], [3], ctx);
  near(same.a, 0, 1e-9);
  near(same.b, 0, 1e-9);
  // Star for a scrub: the giver loses (40 - 12) a day for 7 of 7 days a week, the taker gains it
  const robbery = tradeGains(A, B, [1], [5], ctx);
  assert.ok(robbery.a < -150 && robbery.b > 150, `${robbery.a} / ${robbery.b}`);
  near(robbery.a, -robbery.b, 1e-6, 'a 1-for-1 swap between two full rosters is zero-sum');
  // Antisymmetric: the same trade seen from the other side
  const flip = tradeGains(B, A, [5], [1], ctx);
  near(flip.a, robbery.b, 1e-9);
  near(flip.b, robbery.a, 1e-9);
  // Getting two extra players you cannot start adds nothing; a roster of stars does not gain from depth
  const deep = tradeGains([mk(1, 40), mk(2, 39), mk(3, 38)], [mk(4, 6), mk(5, 6)], [], [4, 5], ctx);
  near(deep.a, 0, 1e-9, 'players below a free agent never start');
  // A player who is out adds nothing now but something later
  const outNow = rosterValue([mk(9, 50, undefined, { injury: 'OUT' })], days, ctx);
  const healthy = rosterValue([mk(9, 50)], days, ctx);
  const nobody = rosterValue([], days, ctx);
  assert.ok(nobody < outNow && outNow < healthy, 'out now: worth something over the season, less than healthy');
  // Positions: two centres cannot both play the single C slot, but one can take UTIL
  const centres = rosterValue([mk(1, 40, [4, 11]), mk(2, 40, [4, 11])], [1], { ...ctx, slotIds: [4, 11, 11] });
  assert.equal(centres, 40 + 40 + 5);
  const oneSlot = rosterValue([mk(1, 40, [4]), mk(2, 40, [4])], [1], { ...ctx, slotIds: [4, 11, 11] });
  assert.equal(oneSlot, 40 + 5 + 5, 'the second centre has nowhere to play');
  // Games count from now: a player with no game that day contributes nothing that day
  const sometimes = rosterValue([mk(1, 40)], days, { ...ctx, plays: (p, d) => d <= 7, slotIds: [0] });
  near(sometimes, 7 * 40 + 7 * 5, 1e-9);
}

/* ---------- The real league ---------- */

{
  const real = fixture('real-league.json');
  const pro = parseProSchedule(fixture('pro-2027.json'));
  const league = parseLeague(real.league, 2027);
  assert.deepEqual(league.slotIds, [0, 1, 2, 3, 4, 5, 6, 11, 11, 11], 'seven position slots and three UTIL');
  assert.equal(league.rosterLimit, 23, '10 starters, 10 bench, 3 IR');
  const entry = league.teams[0].roster[0];
  assert.ok(entry.eligibleSlots.length > 0, 'positions come through from ESPN');
  assert.ok(entry.eligibleSlots.every((s) => Number.isInteger(s)));

  // Games a team has played so far, from the real schedule
  assert.equal(teamGamesThrough(pro, 8, 8), 4, 'Detroit played four games in the first eight days (a fifth on day 9)');
  assert.equal(teamGamesThrough(pro, 8, 9), 5);
  assert.ok(teamGamesThrough(pro, 8, 60) > 20);

  // Replacement level comes from the 6th best healthy free agent
  const fa = real.freeAgents;
  assert.ok(fa.length >= 40);
  const withFa = tradeContext({ league, pro, freeAgents: fa });
  const noFa = tradeContext({ league, pro, freeAgents: [] });
  assert.equal(withFa.replacementFromData, true);
  assert.equal(noFa.r, STARS.fallbackReplacement);
  assert.equal(noFa.replacementFromData, false);
  assert.ok(withFa.r > 12 && withFa.r < 30, `replacement ${withFa.r}`);
  const healthy = fa.filter((p) => p.injury === 'ACTIVE').map((p) => withFa.valueOf(p).perGame).sort((a, b) => b - a);
  near(withFa.r, healthy[5], 1e-9, 'the 6th best healthy free agent');
  const outOnly = tradeContext({ league, pro, freeAgents: fa.filter((p) => p.injury === 'OUT') });
  assert.equal(outOnly.replacementFromData, false, 'injured free agents cannot replace anyone today');
  assert.ok(withFa.days.length > 30 && withFa.days.every((d) => d > league.currentSP), 'only future game days');

  // Best player for the worst player, and the reverse
  const [A, B] = [league.teams[1], league.teams[3]];
  const byValue = (t) => [...t.roster].sort((x, y) => withFa.valueOf(y).ppg - withFa.valueOf(x).ppg);
  const best = byValue(A)[0];
  const scrub = byValue(B).at(-1);
  const bad = evaluateTrade(withFa, A, B, [best.playerId], [scrub.playerId]);
  assert.ok(bad.stars <= 1.5, `star for a scrub: ${bad.stars} stars`);
  assert.equal(bad.winner, 'b');
  assert.ok(bad.a.gain < 0 && bad.b.gain > 0);
  assert.equal(bad.label, verdict(bad.stars));
  const reverse = evaluateTrade(withFa, B, A, [scrub.playerId], [best.playerId]);
  near(reverse.gap, -bad.gap, 1e-6, 'the same trade from the other side');
  assert.equal(reverse.stars, bad.stars);
  assert.equal(reverse.winner, 'a', 'the team getting the star is now side a');
  assert.equal(reverse.a.gain, bad.b.gain);

  // Close to even: two similar players
  const pairs = [];
  for (const x of A.roster) for (const y of B.roster) pairs.push([x, y, Math.abs(withFa.valueOf(x).perGame - withFa.valueOf(y).perGame)]);
  const [x, y] = pairs.filter(([a, b]) => a.slot <= 11 && b.slot <= 11).sort((p, q) => p[2] - q[2])[0];
  const fair = evaluateTrade(withFa, A, B, [x.playerId], [y.playerId]);
  assert.ok(fair.stars >= 4, `like for like: ${fair.stars} stars`);

  // Injury notes and roster limits
  const hurt = [...B.roster, ...A.roster].find((p) => p.injury === 'OUT');
  if (hurt) {
    const owner = A.roster.includes(hurt) ? A : B;
    const other = owner === A ? B : A;
    const asked = evaluateTrade(withFa, owner, other, [hurt.playerId], [byValue(other)[5].playerId]);
    assert.ok(asked.notes.some((n) => n.includes(hurt.name) && /out/.test(n)), 'warns that a traded player is out');
  }
  const full = evaluateTrade({ ...withFa, rosterLimit: A.roster.length }, A, B, [byValue(A)[0].playerId], byValue(B).slice(0, 3).map((p) => p.playerId));
  assert.equal(full.a.mustDrop, 2, 'getting 3 for 1 with a full roster means dropping 2');
  assert.equal(full.b.mustDrop, 0);
}

console.log('All trade tests passed');
