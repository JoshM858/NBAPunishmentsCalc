import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLeague, parseProSchedule } from '../public/logic.js';
import {
  STARS, TRADE, assign, dayPicks, dayValue, evaluateMultiTrade, evaluateTrade, maxMatching, multiSummary, normalCdf, playChance, playerValue, rosterValue,
  starsFor, teamGamesThrough, tradeContext, tradeGains, tradeSummary, verdict, winnerConfidence, shortDate,
} from '../public/trade.js';
import { injuryMap, buildModel, simulateWeek } from '../public/logic.js';
import { applyMoves, explainMoves, simulateTrade, tradeBaseline } from '../public/trade.js';
import { loadLeague } from '../public/pipeline.js';

const OUT_STATUSES_TEST = new Set(['OUT', 'SUSPENSION', 'INJURY_RESERVE']);
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

/* ---------- Known return dates ---------- */

{
  const days = Array.from({ length: 20 }, (_, i) => i + 1);
  const dayMs = (d) => Date.UTC(2026, 9, 29) + d * 86_400_000;
  const mk = (id, extra = {}) => ({ playerId: id, v: 40, slots: [11], ...extra });
  const base = { days, slotIds: [11], r: 5, plays: () => true, dayMs, item: (p) => ({ v: p.v, slots: p.slots, outNow: Boolean(p.out), outUntil: p.until ?? null }) };
  const healthy = rosterValue([mk(1)], days, base);
  const backDay11 = rosterValue([mk(1, { out: true, until: dayMs(11) })], days, base);
  const backDay21 = rosterValue([mk(1, { out: true, until: dayMs(21) })], days, base);
  const unknown = rosterValue([mk(1, { out: true })], days, base);
  assert.ok(backDay21 < backDay11 && backDay11 < healthy, 'the later he returns, the less he is worth');
  // 10 days out at 5 (free agent) then back, with a ramp: close to 10 days of replacement + ~10 days of him
  near(backDay21, 20 * 5, 1e-9, 'out through the end of the window: only the free agent plays');
  assert.ok(backDay11 > 10 * 5 + 8 * 40 && backDay11 < 10 * 5 + 10 * 40, `back on day 11: ${backDay11}`);
  assert.ok(unknown > backDay21 && unknown < healthy, 'no date: assumed to drift back');
  // first game back he is only partly there (returnRecover 0.5)
  const justBack = rosterValue([mk(1, { out: true, until: dayMs(1) })], [1], base);
  near(justBack, 40 * 0.5, 1e-9, 'half a player in his first game back (returnRecover 0.5)');

  assert.equal(shortDate(Date.UTC(2026, 10, 20)), '20 Nov');
}

/* ---------- Real injury report ---------- */

{
  const real = fixture('real-league.json');
  const pro = parseProSchedule(fixture('pro-2027.json'));
  const league = parseLeague(real.league, 2027);
  const injuries = injuryMap(real.injuries);
  assert.ok(injuries.size > 20);
  const withDates = tradeContext({ league, pro, freeAgents: real.freeAgents, injuries });
  const without = tradeContext({ league, pro, freeAgents: real.freeAgents });
  const everyone = league.teams.flatMap((t) => t.roster.map((p) => ({ team: t, player: p })));
  // (the fixture's schedule ends mid-December, so "due back inside it" and "past its end" are both available)
  const inside = everyone.find(({ player: p }) => withDates.returnOf(p) != null && withDates.returnOf(p) < withDates.seasonEnd && withDates.missed(p) >= 15);
  assert.ok(inside, 'someone is out for 15+ games and due back before the schedule ends');
  const { team, player } = inside;
  // alone on a roster, a player out for weeks is worth less once the date is known than under the blind
  // "drifts back within about 10 games" assumption; for a short injury the date is worth more than the blind guess
  const alone = (ctx, p) => rosterValue([p], ctx.days, ctx);
  assert.ok(alone(withDates, player) < alone(without, player), `${player.name}: dated ${alone(withDates, player).toFixed(0)} vs blind ${alone(without, player).toFixed(0)}`);
  const shortOut = [...injuries].filter(([, i]) => i.returnMs && i.returnMs <= Date.UTC(2026, 10, 3)).map(([id]) => id);
  const sp1 = everyone.map((x) => x.player).find((p) => shortOut.includes(p.playerId) && OUT_STATUSES_TEST.has(String(p.injury).toUpperCase()));
  if (sp1) assert.ok(alone(withDates, sp1) > alone(without, sp1), `${sp1.name} due back within days is worth more with the date`);
  assert.ok(withDates.missed(player) >= 15, `${player.name} misses ${withDates.missed(player)} games`);
  const other = league.teams.find((t) => t !== team);
  const asked = evaluateTrade(withDates, team, other, [player.playerId], [other.roster.find((p) => p.slot <= 11).playerId]);
  assert.ok(asked.notes.some((n) => n.includes(player.name) && /out until about/.test(n)), asked.notes.join(' | '));
  // out past the end of the schedule reads as season-ending
  const seasonOut = [...injuries].find(([id, i]) => i.returnMs > withDates.seasonEnd && league.teams.some((t) => t.roster.some((p) => p.playerId === id)));
  if (seasonOut) {
    const owner = league.teams.find((t) => t.roster.some((p) => p.playerId === seasonOut[0]));
    const sp = owner.roster.find((p) => p.playerId === seasonOut[0]);
    const oth = league.teams.find((t) => t !== owner);
    assert.ok(evaluateTrade(withDates, owner, oth, [sp.playerId], [oth.roster[0].playerId]).notes.some((n) => n.includes(sp.name) && /rest of the season/.test(n)));
  }
  // a placeholder date is called a guess
  const guessId = real.injuries.find((i) => i.guess && league.teams.some((t) => t.roster.some((p) => p.playerId === i.playerId)))?.playerId;
  if (guessId) {
    const owner = league.teams.find((t) => t.roster.some((p) => p.playerId === guessId));
    const gp = owner.roster.find((p) => p.playerId === guessId);
    const oth = league.teams.find((t) => t !== owner);
    const n = evaluateTrade(withDates, owner, oth, [guessId], [oth.roster[0].playerId]).notes.find((x) => x.includes(gp.name));
    assert.ok(!n || /guess|rest of the season/.test(n), n);
  }
  // injured free agents (or ones due back later) cannot set the replacement level
  const onlyHurt = tradeContext({ league, pro, freeAgents: real.freeAgents.filter((p) => injuries.get(p.playerId)?.returnMs > withDates.dayMs(withDates.days[0])), injuries });
  assert.equal(onlyHurt.replacementFromData, false);
}

/* ---------- Multi-way trades ---------- */

{
  const days = Array.from({ length: 14 }, (_, i) => i + 1);
  const mk = (id, v, name = `P${id}`) => ({ playerId: id, name, v, slots: [0, 1, 11, 12, 13], injury: 'ACTIVE' });
  const ctx = { days, slotIds: [0, 1, 11], r: 5, plays: () => true, item: (p) => ({ v: p.v, slots: p.slots, outNow: false }), rosterLimit: 4, returnOf: () => null, guessOf: () => false, missed: () => 0, seasonEnd: 0 };
  const A = { id: 1, name: 'Alpha', roster: [mk(1, 40), mk(2, 30), mk(3, 20)] };
  const B = { id: 2, name: 'Bravo', roster: [mk(4, 38), mk(5, 12), mk(6, 8)] };
  const C = { id: 3, name: 'Charlie', roster: [mk(7, 25), mk(8, 22), mk(9, 15)] };
  const move = (playerId, from, to) => ({ playerId, from, to });

  // Two teams: identical to the two-team evaluation
  const two = evaluateMultiTrade(ctx, [A, B], [move(1, 1, 2), move(5, 2, 1)]);
  const old = evaluateTrade(ctx, A, B, [1], [5]);
  near(two.teams[0].gain, old.a.gain, 1e-9);
  near(two.teams[1].gain, old.b.gain, 1e-9);
  near(two.spread, Math.abs(old.gap), 1e-9);
  assert.equal(two.stars, old.stars);
  assert.equal(two.winnerId, old.winner === 'a' ? 1 : 2);
  assert.equal(two.players, 2);

  // Three teams in a circle: A sends 1 to B, B sends 4 to C, C sends 7 to A
  const circle = evaluateMultiTrade(ctx, [A, B, C], [move(1, 1, 2), move(4, 2, 3), move(7, 3, 1)]);
  assert.equal(circle.teams.length, 3);
  assert.ok(circle.teams.every((t) => t.involved));
  assert.equal(circle.players, 3);
  // A swaps a 40 for a 25, B a 38 for a 40, C a 25 for a 38: B and C gain, A loses
  assert.equal(circle.loserId, 1);
  assert.ok(circle.teams.find((t) => t.id === 1).gain < 0);
  assert.ok(circle.teams.find((t) => t.id === 3).gain > 0);
  assert.equal(circle.winnerId, circle.teams.reduce((a, b) => (b.gain > a.gain ? b : a)).id);
  near(circle.spread, Math.max(...circle.teams.map((t) => t.gain)) - Math.min(...circle.teams.map((t) => t.gain)), 1e-9);
  assert.equal(circle.stars, starsFor(circle.spread, 3));
  assert.deepEqual(circle.idle, []);

  // A team not in any swap is reported as idle and gains nothing
  const idle = evaluateMultiTrade(ctx, [A, B, C], [move(1, 1, 2), move(5, 2, 1)]);
  assert.deepEqual(idle.idle, [3]);
  assert.equal(idle.teams.find((t) => t.id === 3).gain, 0);
  assert.equal(idle.teams.find((t) => t.id === 3).involved, false);

  // Players can all go to one team, and others just give
  const gift = evaluateMultiTrade(ctx, [A, B, C], [move(1, 1, 3), move(4, 2, 3)]);
  assert.ok(gift.teams.find((t) => t.id === 3).gain > 0 && gift.teams.find((t) => t.id === 1).gain < 0);
  assert.equal(gift.teams.find((t) => t.id === 3).mustDrop, 1, 'C would hold 5 players on a limit of 4');

  // Nonsense is ignored rather than crashing: unknown player, wrong owner, to the same team, unknown team
  const junk = evaluateMultiTrade(ctx, [A, B], [move(1, 1, 2), move(5, 2, 1), move(999, 1, 2), move(2, 2, 1), move(3, 1, 1), move(3, 1, 77)]);
  assert.equal(junk.players, 2);
  near(junk.spread, two.spread, 1e-9);
  const empty = evaluateMultiTrade(ctx, [A, B], []);
  assert.deepEqual([empty.spread, empty.players, empty.winnerId, empty.stars], [0, 0, null, 5]);
  assert.equal(evaluateMultiTrade(ctx, [A, B], [move(1, 1, 2), move(5, 2, 1)]).label, two.label);

  // Dead even trades have no winner
  const same = evaluateMultiTrade(ctx, [{ id: 1, name: 'A', roster: [mk(1, 30), mk(2, 20)] }, { id: 2, name: 'B', roster: [mk(3, 30), mk(4, 20)] }], [move(1, 1, 2), move(3, 2, 1)]);
  assert.equal(same.winnerId, null);

  // Group-chat text
  const text = multiSummary(circle, [{ ...move(1, 1, 2), name: 'Wemby' }, { ...move(4, 2, 3), name: 'Cade' }, { ...move(7, 3, 1), name: 'Curry' }]);
  assert.match(text, /^Trade idea \(from Punishment Watch\)\nAlpha sends: Wemby to Bravo\nBravo sends: Cade to Charlie\nCharlie sends: Curry to Alpha\n/);
  assert.match(text, /Biggest winner: \w+\. Biggest loser: Alpha\./);
  assert.match(text, /Alpha −/);
}

/* ---------- What if the trade happens? ---------- */

{
  const real = fixture('real-league.json');
  const proRaw = fixture('pro-2027.json');
  const src = { config: async () => ({ configured: true, season: 2027, hideTeams: ['3'] }), pro: async () => proRaw, league: async (v, { sp } = {}) => (sp ? real.days[sp] : real.league), now: () => Date.parse(real.capturedAt) };
  const ctx = await loadLeague(src);
  const input = { ...ctx, now: src.now() };
  const league = ctx.league;
  const before = buildModel(input);

  // applyMoves: the trade done, nothing mutated, movers on the new bench
  const giver = league.teams.find((t) => t.id === before.rows[0].id); // the strongest team
  const taker = league.teams.find((t) => t.id === before.loser.id); // the projected loser
  const star = giver.roster.filter((p) => p.slot <= 11).sort((a, b) => b.seasonAvg - a.seasonAvg)[0];
  const sizes = league.teams.map((t) => t.roster.length);
  const moved = applyMoves(league, [{ playerId: star.playerId, from: giver.id, to: taker.id }, { playerId: 1234567, from: giver.id, to: taker.id }, { playerId: star.playerId, from: taker.id, to: giver.id }]);
  assert.deepEqual(league.teams.map((t) => t.roster.length), sizes, 'the original league is untouched');
  assert.equal(moved.teams.find((t) => t.id === giver.id).roster.length, giver.roster.length - 1);
  assert.equal(moved.teams.find((t) => t.id === taker.id).roster.length, taker.roster.length + 1);
  const arrived = moved.teams.find((t) => t.id === taker.id).roster.find((p) => p.playerId === star.playerId);
  assert.equal(arrived.slot, 12, 'he starts on the bench');
  assert.ok(star.slot <= 11 && giver.roster.find((p) => p.playerId === star.playerId).slot === star.slot, 'and the original entry still shows where he was');
  assert.equal(moved.teams.length, league.teams.length);
  assert.deepEqual(applyMoves(league, []).teams.map((t) => t.roster.length), sizes);

  // The baseline is exactly the odds the page already shows, and no change leaves everything alone
  const base = tradeBaseline(input);
  assert.deepEqual(base.before.rows.map((r) => [r.id, r.odds]), before.rows.map((r) => [r.id, r.odds]));
  const none = simulateTrade(base, []);
  assert.ok(none.thisWeek.rows.every((r) => r.risk0 === r.risk1 && r.final0 === r.final1), 'no trade, no change');
  assert.ok(none.nextWeek.rows.every((r) => r.risk0 === r.risk1));
  assert.equal(none.thisWeek.loser0, none.thisWeek.loser1);

  // Giving the strongest team's best player to the projected loser helps the loser and hurts the giver
  const mv = [{ playerId: star.playerId, from: giver.id, to: taker.id }];
  const r = simulateTrade(base, mv);
  const row = (wk, id) => wk.rows.find((x) => x.id === id);
  for (const wk of [r.thisWeek, r.nextWeek]) {
    assert.ok(Math.abs(wk.rows.reduce((s, x) => s + x.risk0, 0) - 1) < 1e-9, 'odds add up to 1 before');
    assert.ok(Math.abs(wk.rows.reduce((s, x) => s + x.risk1, 0) - 1) < 1e-9, 'and after');
    assert.ok(row(wk, taker.id).final1 > row(wk, taker.id).final0, 'the receiver projects higher');
    assert.ok(row(wk, giver.id).final1 < row(wk, giver.id).final0, 'the giver projects lower');
    assert.ok(row(wk, taker.id).risk1 < row(wk, taker.id).risk0, 'the receiver is less likely to finish last');
    assert.ok(row(wk, giver.id).risk1 > row(wk, giver.id).risk0, 'the giver is more likely to');
    // teams the trade does not touch project exactly as before
    for (const x of wk.rows.filter((q) => q.id !== giver.id && q.id !== taker.id)) assert.equal(x.final1, x.final0, `${x.name} untouched`);
  }
  assert.match(r.thisWeek.label, /^Rest of week 2/);
  assert.match(r.nextWeek.label, /week 3/);
  assert.ok(row(r.thisWeek, taker.id).current === before.rows.find((x) => x.id === taker.id).weekPts, 'points already scored stay put');

  // The shortcut gives exactly what running everything from scratch gives
  const scratch = buildModel({ ...input, league: applyMoves(league, mv), seed: before.simSeed });
  for (const x of scratch.rows) assert.equal(row(r.thisWeek, x.id).risk1, x.odds, `${x.name}: reuse equals a fresh run`);

  // Trading the loser's star away makes them the likelier loser
  const loserStar = taker.roster.filter((p) => p.slot <= 11).sort((a, b) => b.seasonAvg - a.seasonAvg)[0];
  const worse = simulateTrade(base, [{ playerId: loserStar.playerId, from: taker.id, to: giver.id }]);
  assert.ok(row(worse.thisWeek, taker.id).risk1 > row(worse.thisWeek, taker.id).risk0);

  // The projected loser can change hands
  const flip = simulateTrade(base, [{ playerId: star.playerId, from: giver.id, to: taker.id }, ...giver.roster.filter((p) => p.slot <= 11 && p.playerId !== star.playerId).sort((a, b) => b.seasonAvg - a.seasonAvg).slice(0, 2).map((p) => ({ playerId: p.playerId, from: giver.id, to: taker.id }))]);
  assert.notEqual(flip.nextWeek.loser1, flip.nextWeek.loser0, 'gifting three starters to the projected loser moves the "last place" label to someone else');

  // Once the week is over only the typical week is shown
  const over = tradeBaseline({ ...input, league: { ...league, teams: league.teams.map((t) => ({ ...t, roster: t.roster.map((p) => ({ ...p, proTeamId: 0 })) })) } });
  assert.equal(simulateTrade(over, []).thisWeek, null, 'no games left this week, so nothing to re-run');
}

/* ---------- Explaining the numbers ---------- */

{
  const real = fixture('real-league.json');
  const pro = parseProSchedule(fixture('pro-2027.json'));
  const league = parseLeague(real.league, 2027);
  const ctx = tradeContext({ league, pro, freeAgents: real.freeAgents, injuries: injuryMap(real.injuries) });
  const find = (n) => { for (const t of league.teams) for (const p of t.roster) if (p.name.includes(n)) return { team: t, player: p }; };
  const wemby = find('Wembanyama');
  const luka = find('Doncic');
  const teams = [wemby.team, luka.team];
  const moves = [{ playerId: wemby.player.playerId, from: wemby.team.id, to: luka.team.id }, { playerId: luka.player.playerId, from: luka.team.id, to: wemby.team.id }];
  const why = explainMoves(ctx, teams, moves);
  const [w, l] = why.rows;

  // Whatever the exact numbers, the working must add up and match the rating it explains
  near(w.perGame, w.ppg * w.rate, 1e-9);
  near(l.perGame, l.ppg * l.rate, 1e-9);
  near(w.aboveFa, w.perGame - ctx.r, 1e-9);
  near(w.perWeek, (w.aboveFa * w.canPlay) / why.weeks, 1e-9);
  assert.ok(w.gp <= w.teamGames && l.gp <= l.teamGames, 'nobody has played more games than his team');
  assert.ok(why.story.length >= 3);
  const text = why.story.join(' ');
  assert.match(text, /Wembanyama/);
  assert.match(text, /Doncic/);
  assert.match(text, new RegExp(w.ppg.toFixed(1).replace('.', '\\.')));
  assert.match(text, /only scores when he plays/);
  assert.match(text, new RegExp(`played ${w.gp} of his team’s ${w.teamGames} games`));
  assert.match(text, new RegExp(`${Math.round(w.rate * 100)}% and ${Math.round(l.rate * 100)}%`));
  assert.match(text, /free agent would give you/);
  const result = evaluateMultiTrade(ctx, teams, moves);
  const gainA = result.teams.find((t) => t.id === wemby.team.id).gain;
  const gainB = result.teams.find((t) => t.id === luka.team.id).gain;
  const worthGap = Math.abs(w.perWeek - l.perWeek);
  // the team that gives up the more valuable player loses about the gap, the other gains about the gap
  const [loser, winner] = w.perWeek > l.perWeek ? [gainA, gainB] : [gainB, gainA];
  assert.ok(loser < 0 && winner > 0);
  // Each team's gain is the swap in player value plus a lineup-fit adjustment; both parts are shown, and they add up
  const swapA = why.swaps[wemby.team.id];
  const swapB = why.swaps[luka.team.id];
  near(swapA, -(w.perWeek - l.perWeek), 1e-9);
  near(swapB, w.perWeek - l.perWeek, 1e-9);
  near(swapA + (gainA - swapA), gainA, 1e-9);
  assert.ok(Math.sign(swapA) === -Math.sign(swapB), 'the swap is zero-sum between the two teams');
  assert.match(text, /lineup fit/);

  // Your exact question: 60.4 against 60.8 points a game, yet the first is worth about 7.7 points a week more
  {
    const days = Array.from({ length: 150 }, (_, i) => i + 1);
    const mkp = (id, name, gp, avg, proj, proTeamId) => ({ playerId: id, name, seasonGP: gp, seasonAvg: avg, projAvg: proj, proTeamId, slot: 11, injury: 'ACTIVE', eligibleSlots: [11] });
    const A = { id: 2, name: 'Hang Low', roster: [mkp(1, 'Victor Wembanyama', 5, 64.1, 59.3, 24)] };
    const B = { id: 8, name: 'Champions', roster: [mkp(2, 'Luka Doncic', 4, 64.75, 59.8, 13)] };
    const c = {
      days, r: 21.03, replacementFromData: true, missed: () => 0, teamGames: () => 5,
      valueOf: (p) => playerValue(p, 5), plays: (p, d) => d % 2 === 0, // 75 games left each
    };
    const e = explainMoves(c, [A, B], [{ playerId: 1, from: 2, to: 8 }, { playerId: 2, from: 8, to: 2 }]);
    const [x, y] = e.rows;
    assert.deepEqual([x.ppg.toFixed(1), y.ppg.toFixed(1)], ['60.4', '60.8'], 'the two figures on the roster');
    assert.deepEqual([Math.round(x.rate * 100), Math.round(y.rate * 100)], [76, 72], 'but one has played every game and the other missed one');
    assert.deepEqual([x.perGame.toFixed(1), y.perGame.toFixed(1)], ['46.2', '44.0']);
    assert.equal(x.canPlay, 75);
    near(x.perWeek - y.perWeek, ((x.perGame - y.perGame) * 75) / (150 / 7), 1e-9);
    assert.ok(x.perWeek - y.perWeek > 7 && x.perWeek - y.perWeek < 8.5, `${(x.perWeek - y.perWeek).toFixed(2)} points a week`);
    const t = e.story.join('\n');
    // with one starting slot each and nobody else on the roster there is no lineup fit, so the gain is exactly the swap
    const toy = { ...c, slotIds: [11], rosterLimit: 5, returnOf: () => null, guessOf: () => false, seasonEnd: 0, item: (p) => ({ v: c.valueOf(p).perGame, slots: [11], outNow: false }) };
    const toyResult = evaluateMultiTrade(toy, [A, B], [{ playerId: 1, from: 2, to: 8 }, { playerId: 2, from: 8, to: 2 }]);
    near(toyResult.teams.find((q) => q.id === 2).gain, e.swaps[2], 1e-6, 'no lineup fit when there is nothing to fit');
    near(toyResult.teams.find((q) => q.id === 8).gain, e.swaps[8], 1e-6);
    assert.match(t, /Luka Doncic scores 60\.8 a game when he plays and Victor Wembanyama 60\.4, which is close/);
    assert.match(t, /played 5 of his team’s 5 games and Luka Doncic 4 of 5/);
    assert.match(t, /76% and 72%, which makes 46\.2 and 44\.0 points per team game/);
    assert.match(t, /Victor Wembanyama comes out 2\.2 points a game ahead over the 75 games left \(about 3\.5 a week\), which is about 7\.[5-9] points a week/);
  }

  // Injured players: games he can play are cut by the games he misses
  const hurt = [...league.teams.flatMap((t) => t.roster.map((p) => ({ t, p })))].find(({ p }) => ctx.missed(p) > 10);
  const other = league.teams.find((t) => t !== hurt.t);
  const h = explainMoves(ctx, [hurt.t, other], [{ playerId: hurt.p.playerId, from: hurt.t.id, to: other.id }]).rows[0];
  assert.equal(h.canPlay, h.gamesLeft - h.missed);
  assert.ok(h.missed > 10 && h.canPlay < h.gamesLeft);
  // bigger trades still explain, without a head-to-head story
  const big = explainMoves(ctx, teams, [...moves, { playerId: wemby.team.roster[3].playerId, from: wemby.team.id, to: luka.team.id }]);
  assert.equal(big.rows.length, 3);
  assert.ok(big.story.length === 2 && /lineup fit/.test(big.story[0]) && /In general/.test(big.story[1]), 'general explanation only, no head-to-head story');
  assert.ok(!big.story.some((t) => /scores .* a game when he plays and/.test(t)));
  // wrong owner is ignored
  assert.equal(explainMoves(ctx, teams, [{ playerId: wemby.player.playerId, from: luka.team.id, to: wemby.team.id }]).rows.length, 0);
}

/* ---------- The message you can paste into the group chat ---------- */

{
  const result = { stars: 3.5, label: 'Lopsided', winner: 'b', a: { gain: -12.34 }, b: { gain: 12.6 } };
  const text = tradeSummary(result, { a: 'Hang Low', b: 'Drake Fan Club', give: ['Wembanyama', 'Curry'], get: ['Cunningham'] });
  assert.equal(text.split('\n')[1], 'Hang Low gives: Wembanyama, Curry');
  assert.equal(text.split('\n')[2], 'Drake Fan Club gives: Cunningham');
  assert.match(text, /Rating: 3\.5 out of 5 stars, lopsided\. Edge to Drake Fan Club\./);
  assert.match(text, /Hang Low −12\.3 points a week, Drake Fan Club \+12\.6 points a week/);
  assert.match(tradeSummary({ ...result, winner: null }, { a: 'A', b: 'B', give: ['x'], get: ['y'] }), /Dead even\./);
  assert.match(tradeSummary({ ...result, winner: 'a' }, { a: 'A', b: 'B', give: ['x'], get: ['y'] }), /Edge to A\./);
}

console.log('All trade tests passed');
