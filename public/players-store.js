// Loads the player pool once per league refresh and keeps it for every Players page.
// Ages and sizes arrive a moment later (30 small requests); `onBios` fires when they do.
import { enrich } from './players-data.js';

// The slim pool is also kept in this browser (10 minutes during games, an hour once the day is done), so reopening the
// Players pages doesn't download it again. A manual Refresh skips it.
const keyOf = (ctx) => `pw:pool:${ctx.cfg?.leagueId ?? 'site'}:${ctx.cfg?.season ?? ''}`;
const stored = (ctx, ttl) => {
  try {
    const hit = JSON.parse(localStorage.getItem(keyOf(ctx)));
    return hit && Date.now() - hit.t < ttl ? hit.players : null;
  } catch {
    return null;
  }
};
const keep = (ctx, players) => {
  try {
    localStorage.setItem(keyOf(ctx), JSON.stringify({ t: Date.now(), players }));
  } catch {}
};

export function createPlayerStore(data) {
  let cache = null;
  let skipStored = false;
  const listeners = new Set();

  async function load() {
    const { ctx, src } = data();
    const idle = data().dayDone === true;
    const raw = (!skipStored && src.kind !== 'static' && stored(ctx, idle ? 3_600_000 : 600_000)) || (await src.players());
    if (src.kind !== 'static') keep(ctx, raw);
    skipStored = false;
    const bios = new Map();
    const make = () => enrich(raw, { league: ctx.league, injuries: ctx.injuries, bios, pro: ctx.pro });
    const state = { players: make(), loading: true, byId: null };
    state.byId = new Map(state.players.map((p) => [p.id, p]));
    const abbrevs = [...new Set([...ctx.pro.abbrev.values()].filter((a) => a && a !== 'FA'))];
    // Fill in age and size on the same player objects, so nothing already on screen is replaced
    Promise.resolve(src.bios ? src.bios(abbrevs) : new Map())
      .then((map) => {
        for (const [id, b] of map) bios.set(id, b);
        for (const p of state.players) {
          const b = bios.get(p.id);
          if (b) Object.assign(p, { age: b.age ?? null, height: b.height || null, weight: b.weight || null, exp: b.exp ?? null });
        }
      })
      .catch(() => {})
      .finally(() => {
        state.loading = false;
        listeners.forEach((fn) => fn(state));
      });
    return state;
  }

  return {
    reset: (fresh = false) => {
      cache = null;
      skipStored = Boolean(fresh);
    },
    get() {
      cache ||= load().catch((err) => {
        cache = null; // let the next visit try again
        throw err;
      });
      return cache;
    },
    onBios: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  };
}
