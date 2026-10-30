import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injuryMap, parseLeague } from '../public/logic.js';
import { asRosterPlayer, enrich, filterPlayers, form, lastFive, parseLastSeason, parsePool, parseProfile, percentileOf, sortPlayers, spread } from '../public/players-data.js';
import { createPlayerStore } from '../public/players-store.js';

const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const raw = fixture('pool-2027.json');
const real = fixture('real-league.json');
const league = parseLeague(real.league, 2027);

// ---- parsing real ESPN pool entries
const pool = parsePool(raw, 2027);
assert.equal(pool.length, raw.players.length);
const wemby = pool.find((p) => p.name === 'Victor Wembanyama');
assert.equal(wemby.id, 5104157);
assert.deepEqual(wemby.pos, ['C']);
assert.equal(wemby.gp, 5);
assert.equal(wemby.avg, 64.2);
assert.equal(wemby.rank, 1);
assert.ok(wemby.own > 99);
// per-game lines come from season totals / games played (125 points over 5 games = 25.0)
assert.equal(wemby.per.pts, 25);
assert.equal(wemby.per.reb, 11.4);
assert.equal(wemby.per.min, 32.2);
assert.ok(Math.abs(wemby.per.fgPct - 0.48) < 0.005);
// recent games are this season's, oldest first, and equal the points ESPN gave
assert.deepEqual(lastFive(wemby), [47, 47, 53, 83, 91]);
assert.ok(wemby.games.every((g) => g.sp >= 1) && wemby.games.every((g, i, a) => !i || a[i - 1].sp < g.sp));
assert.equal(wemby.games[0].box, undefined, 'box scores are left out of the slim pool');
const full = parseProfile(raw.players.find((e) => e.id === 5104157), 2027, { box: true, outlook: true });
assert.equal(full.games.at(-1).box.pts, 36);
assert.ok(full.outlook.length > 0);
// last season's rows are ignored for this season's games
const e0 = structuredClone(raw.players[0]);
e0.player.stats.push({ id: '05999', seasonId: 2026, scoringPeriodId: 3, statSourceId: 0, appliedTotal: 999 });
assert.ok(!parseProfile(e0, 2027).games.some((g) => g.pts === 999));
// slim enough to ship a whole pool of 500 around 250 KB
assert.ok(JSON.stringify(pool).length / pool.length < 700, `${JSON.stringify(pool).length / pool.length} bytes a player`);
// ESPN ranks of 0 mean "none yet"
assert.ok(pool.some((p) => p.rank == null), 'a player with no stats has no rank');
assert.ok(pool.every((p) => p.rank == null || p.rank > 0));

// last season's line from the single-player view
const lastEntry = { player: { stats: [{ id: '002026', seasonId: 2026, scoringPeriodId: 0, appliedAverage: 52.4, stats: { 0: 1600, 6: 736, 3: 200, 40: 1870, 42: 64 } }] } };
const ls = parseLastSeason(lastEntry, 2027);
assert.equal(ls.gp, 64);
assert.equal(ls.per.pts, 25);
assert.equal(parseLastSeason({ player: { stats: [] } }, 2027), null);

// ---- derived numbers
assert.equal(form({ avg: 50, l7: 60, l15: 55 }), 20);
assert.equal(form({ avg: 0, l7: 60 }), null);
assert.equal(spread({ games: [{ pts: 10 }, { pts: 20 }] }), null, 'needs three games');
assert.ok(Math.abs(spread({ games: [{ pts: 10 }, { pts: 20 }, { pts: 30 }] }) - 10) < 1e-9);
const hi = pool.reduce((a, b) => (b.avg > a.avg ? b : a));
assert.equal(percentileOf(pool, hi, (p) => p.avg), 100);
const lo = pool.filter((p) => p.gp >= 1).reduce((a, b) => (b.avg < a.avg ? b : a));
assert.equal(percentileOf(pool, lo, (p) => p.avg), 0);
assert.equal(percentileOf(pool, { gp: 0 }, () => null), null);

// ---- enrich: owners, injuries, bios
const injuries = injuryMap([{ playerId: wemby.id, status: 'Out', returnDate: '2026-11-20', type: 'Knee', detail: 'Sprain' }]);
const bios = new Map([[wemby.id, { age: 22, height: "7' 4\"", weight: '240 lbs' }]]);
const rich = enrich(pool, { league, injuries, bios, pro: { abbrev: new Map([[24, 'SA']]) } });
const w = rich.find((p) => p.id === wemby.id);
assert.equal(w.team, 'SA');
assert.equal(w.age, 22);
assert.equal(w.returnMs, Date.UTC(2026, 10, 20));
assert.equal(w.injuryDetail, 'Sprain');
const owned = rich.filter((p) => !p.free);
assert.ok(owned.length > 5 && owned.every((p) => p.fantasyTeam));
// a team that is hidden from the board still owns its players: they are not free agents
const gone = enrich([{ ...pool[0], id: 1, teamId: 99 }], { league, pro: { abbrev: new Map() } })[0];
assert.equal(gone.free, false);
assert.equal(gone.fantasyTeam.name, 'Another team');

// ---- filter and sort
const nameOf = (p) => p.name;
assert.ok(filterPlayers(rich, { pos: 'C' }).every((p) => p.pos.includes('C')));
assert.deepEqual(filterPlayers(rich, { q: 'wemban' }).map(nameOf), ['Victor Wembanyama']);
assert.ok(filterPlayers(rich, { avail: 'free' }).every((p) => p.free));
assert.ok(filterPlayers(rich, { avail: 'owned' }).every((p) => !p.free));
assert.ok(filterPlayers(rich, { health: 'hurt' }).every((p) => p.injury !== 'ACTIVE'));
assert.equal(filterPlayers(rich, { q: 'zzzz' }).length, 0);
const byAvg = sortPlayers(rich, 'avg');
assert.ok(byAvg.every((p, i) => !i || byAvg[i - 1].avg >= p.avg), 'high to low');
const byRank = sortPlayers(rich, 'rank', true);
const ranked = byRank.filter((p) => p.rank != null);
assert.ok(ranked.every((p, i) => !i || ranked[i - 1].rank <= p.rank), 'rank 1 first');
assert.ok(byRank.slice(ranked.length).every((p) => p.rank == null), 'unranked players sink to the bottom');
const byName = sortPlayers(rich, 'name', true);
assert.ok(byName.every((p, i) => !i || byName[i - 1].name.localeCompare(p.name) <= 0));

// ---- the roster shape the trade and projection code expects
const rp = asRosterPlayer(wemby);
assert.equal(rp.playerId, wemby.id);
assert.equal(rp.seasonAvg, 64.2);
assert.deepEqual(rp.eligibleSlots, wemby.slots);

// ---- the store: loads once, fills in bios later, retries after a failure
{
  let loads = 0;
  let fail = false;
  const src = { players: async () => (loads++, fail ? Promise.reject(new Error('boom')) : structuredClone(pool)), bios: async () => bios };
  const data = () => ({ ctx: { league, injuries, pro: { abbrev: new Map([[24, 'SA']]) } }, src });
  const store = createPlayerStore(data);
  const seen = [];
  store.onBios((s) => seen.push(s.loading));
  const a = await store.get();
  assert.equal(a.loading, true, 'bios have not arrived yet');
  assert.equal((await store.get()), a, 'one load');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seen, [false]);
  assert.equal(a.byId.get(wemby.id).age, 22, 'age filled in on the same object');
  store.reset();
  fail = true;
  await assert.rejects(store.get(), /boom/);
  fail = false;
  assert.ok((await store.get()).players.length, 'a failed load is retried');
  assert.equal(loads, 3);
}

console.log('Players tests passed');
