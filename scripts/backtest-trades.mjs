// The evidence behind the trade stars. Pulls last season's game logs for the 400 most-owned players, then
//  1. compares ways of valuing a player (how well each predicts the rest of the season), and
//  2. simulates leagues and trades at three points in the season, to see how often the predicted winner
//     really came out ahead, which is what the star scale is calibrated on.
// Usage: npm run backtest:trades   (needs LEAGUE_ID in .env; first run downloads about 17 MB into .cache/)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../src/env.js';
import { TRADE, STARS, dayPicks, normalCdf, playerValue, rosterValue, starsFor } from '../public/trade.js';

const { env } = loadEnv();
const CACHE = new URL('../.cache/players400.json', import.meta.url);
const SEASON = Number(env.SEASON) || 2027;
const SLOTS = [0, 1, 2, 3, 4, 5, 6, 11, 11, 11];
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

async function players() {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'));
  if (!env.LEAGUE_ID) throw new Error('Set LEAGUE_ID in .env first.');
  console.log('Downloading last season’s game logs (about 17 MB)...');
  const filter = { players: { limit: 400, sortPercOwned: { sortPriority: 1, sortAsc: false }, filterStatsForTopScoringPeriodIds: { value: 200, additionalValue: [`00${SEASON}`, `10${SEASON}`, `00${SEASON - 1}`, `10${SEASON - 1}`] } } };
  const res = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${SEASON}/segments/0/leagues/${env.LEAGUE_ID}?view=kona_player_info`, { headers: { 'x-fantasy-filter': JSON.stringify(filter) } });
  if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
  const out = (await res.json()).players.map((p) => ({
    id: p.player.id, elig: p.player.eligibleSlots,
    proj: p.player.stats.find((s) => s.id === `10${SEASON - 1}`)?.appliedAverage ?? null,
    games: p.player.stats.filter((s) => s.seasonId === SEASON - 1 && s.statSplitTypeId === 5 && s.statSourceId === 0).map((s) => ({ sp: s.scoringPeriodId, pts: s.appliedTotal, min: s.stats?.['28'] ?? null })),
  }));
  mkdirSync(new URL('../.cache/', import.meta.url), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

const pool = (await players())
  .filter((p) => p.proj != null && p.games.length >= 60 && Array.isArray(p.elig))
  .map((p) => ({ ...p, rows: new Map(p.games.map((r) => [r.sp, { pts: r.pts || 0, played: (r.min || 0) > 0 }])) }));
const allDays = [...new Set(pool.flatMap((p) => [...p.rows.keys()]))].sort((a, b) => a - b);
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/* 1. Valuing a player */
{
  const R0 = mean(pool.flatMap((p) => [...p.rows.values()]).map((r) => (r.played ? 1 : 0)));
  const est = {
    'season average to date': (h) => mean(h.map((x) => x.pts)),
    'ESPN projection only': (h, p) => p.proj * R0,
    'shrunk toward projection (used)': (h, p) => { const pl = h.filter((x) => x.played).map((x) => x.pts); return ((pl.length * mean(pl) + TRADE.prior * p.proj) / (pl.length + TRADE.prior)) * ((pl.length + TRADE.availPrior * R0) / (h.length + TRADE.availPrior)); },
  };
  console.log(`\n1. Predicting each player's points per team game for the rest of last season (${pool.length} players, league play rate ${(R0 * 100).toFixed(1)}%)`);
  console.log('   RMSE in points per game; lower is better'.padEnd(46), [5, 10, 20, 40].map((k) => `after ${k}`.padStart(9)).join(''));
  for (const [name, f] of Object.entries(est)) {
    const cells = [5, 10, 20, 40].map((k) => { let se = 0, n = 0; for (const p of pool) { const rows = [...p.rows].sort((a, b) => a[0] - b[0]).map(([, r]) => r); if (rows.length - k < 25) continue; se += (f(rows.slice(0, k), p) - mean(rows.slice(k).map((r) => r.pts))) ** 2; n++; } return Math.sqrt(se / n); });
    console.log(`   ${name.padEnd(43)}`, cells.map((c) => c.toFixed(2).padStart(9)).join(''));
  }
}

/* 2. Trades */
function trades(cutoff, seed) {
  const rand = rng(seed);
  const days = allDays.filter((d) => d > cutoff);
  const weeks = days.length / 7;
  const known = pool.map((p) => {
    const hist = [...p.rows].filter(([sp]) => sp <= cutoff).map(([, r]) => r);
    const played = hist.filter((r) => r.played).map((r) => r.pts);
    const o = { playerId: p.id, seasonGP: played.length, seasonAvg: mean(played), projAvg: p.proj, eligibleSlots: p.elig, src: p };
    return { ...o, v: playerValue(o, hist.length), future: mean([...p.rows].filter(([sp]) => sp > cutoff).map(([, r]) => r.pts)) };
  });
  const out = [];
  for (let L = 0; L < 3; L++) {
    const order = [...known].sort((a, b) => b.projAvg * (0.85 + 0.3 * rand()) - a.projAvg * (0.85 + 0.3 * rand()));
    const teams = Array.from({ length: 6 }, () => []);
    for (let i = 0; i < 84; i++) teams[Math.floor(i / 6) % 2 ? 5 - (i % 6) : i % 6].push(order[i]);
    const owned = new Set(teams.flat().map((p) => p.playerId));
    const fa = known.filter((p) => !owned.has(p.playerId)).sort((a, b) => b.v.perGame - a.v.perGame);
    const r = fa[STARS.replacementRank - 1].v.perGame;
    const rReal = mean(fa.slice(STARS.replacementRank - 1, STARS.replacementRank + 9).map((p) => p.future));
    const plays = (p, d) => p.src.rows.has(d);
    const ctx = { days, slotIds: SLOTS, r, plays, item: (p) => ({ v: p.v.perGame, slots: p.eligibleSlots, outNow: false }) };
    const real = (roster) => { let tot = 0; for (const d of days) { const t = roster.filter((p) => plays(p, d)); const picks = dayPicks(t.map((p) => ({ v: p.v.perGame, slots: p.eligibleSlots })), SLOTS, r); tot += picks.reduce((s, i) => s + t[i].src.rows.get(d).pts, 0) + (SLOTS.length - picks.length) * rReal; } return tot; };
    const base = teams.map((t) => ({ pred: rosterValue(t, days, ctx), real: real(t) }));
    const buckets = [[0, 5], [5, 10], [10, 20], [20, 40], [40, 80], [80, 1e9]], quota = buckets.map(() => 0);
    for (let tries = 0; tries < 6000 && quota.some((q) => q < 14); tries++) {
      const ai = Math.floor(rand() * 6); let bi = Math.floor(rand() * 6); if (bi === ai) bi = (bi + 1) % 6;
      const A = teams[ai], B = teams[bi];
      const give = [...A].sort(() => rand() - 0.5).slice(0, 1 + Math.floor(rand() * 3));
      const vor = (arr) => arr.reduce((s, p) => s + Math.max(0, p.v.perGame - r), 0) * 3.4;
      const goal = vor(give);
      const get = []; let acc = 0;
      for (const p of [...B].sort(() => rand() - 0.5)) { if (get.length >= 1 + Math.floor(rand() * 3)) break; const x = Math.max(0, p.v.perGame - r) * 3.4; if (acc + x <= goal * (0.6 + 0.8 * rand()) + 7) { get.push(p); acc += x; } }
      if (!get.length) get.push(B[0]);
      const bk = buckets.findIndex(([lo, hi]) => Math.abs(vor(get) - goal) >= lo && Math.abs(vor(get) - goal) < hi);
      if (bk < 0 || quota[bk] >= 14) continue;
      quota[bk]++;
      const gi = give.map((p) => p.playerId), ge = get.map((p) => p.playerId);
      const aA = [...A.filter((p) => !gi.includes(p.playerId)), ...get], aB = [...B.filter((p) => !ge.includes(p.playerId)), ...give];
      out.push({
        size: give.length + get.length,
        pa: (rosterValue(aA, days, ctx) - base[ai].pred) / weeks, pb: (rosterValue(aB, days, ctx) - base[bi].pred) / weeks,
        ra: (real(aA) - base[ai].real) / weeks, rb: (real(aB) - base[bi].real) / weeks,
      });
    }
  }
  return out;
}
const all = [];
for (const cutoff of [30, 70, 110]) for (const seed of [1, 2, 3, 4]) all.push(...trades(cutoff, seed));
const gap = (t) => t.pa - t.pb, truth = (t) => t.ra - t.rb;
const decided = all.filter((t) => Math.abs(truth(t)) > 1);
console.log(`\n2. ${all.length} simulated trades from last season: how often the predicted winner really won`);
console.log('   predicted |gap| (pts/week)   trades   winner right   stars for a 4-player trade');
for (const [lo, hi] of [[0, 5], [5, 10], [10, 20], [20, 40], [40, 80], [80, 1e9]]) {
  const b = decided.filter((t) => Math.abs(gap(t)) >= lo && Math.abs(gap(t)) < hi);
  if (b.length) console.log(`   ${String(lo).padStart(4)} to ${(hi > 1e8 ? 'more' : String(hi)).padEnd(5)}             ${String(b.length).padStart(5)}      ${(b.filter((t) => gap(t) * truth(t) > 0).length / b.length * 100).toFixed(0).padStart(5)}%        ${starsFor((lo + Math.min(hi, 160)) / 2, 4)}`);
}
const ll = (s0) => -mean(decided.map((t) => { const p = Math.min(0.999, Math.max(0.001, normalCdf(Math.abs(gap(t)) / (s0 * Math.sqrt(t.size))))); return Math.log(gap(t) * truth(t) > 0 ? p : 1 - p); }));
console.log(`   log-loss by sigma (STARS.sigma = ${STARS.sigma}; a coin flip scores 0.693):`, [40, 50, 60, 70, 80].map((s) => `${s}: ${ll(s).toFixed(3)}`).join('  '));
