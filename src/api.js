// ESPN proxy shared by every deploy style (Cloudflare Worker, local Node server, snapshot builder).
// Cookies stay server-side and are optional: leave them out if the league manager has made the
// league viewable to the public. Responses are streamed without parsing to stay under the free
// Cloudflare plan's 10 ms CPU limit.

const ESPN = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons';
const VIEWS = new Set(['mSettings', 'mTeam', 'mRoster', 'mMatchup', 'mMatchupScore', 'mStatus', 'mScoreboard', 'mStandings', 'mTransactions2', 'mDraftDetail']);
const LIVE_TTL = 90;
const PAST_TTL = 12 * 3600;
const SCHEDULE_TTL = 6 * 3600;
const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const TEAMS = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams';
const POOL_LIMIT = 500;
const INJURIES = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';

// Stand-in for the Workers Cache API when running under Node.
const memory = new Map();
const memoryCache = {
  async match(key) {
    const hit = memory.get(key.url);
    if (!hit || hit.expires < Date.now()) return undefined;
    return new Response(hit.body, hit.init);
  },
  async put(key, res) {
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] ?? 60);
    memory.set(key.url, { expires: Date.now() + maxAge * 1000, body: await res.arrayBuffer(), init: { status: res.status, headers: [...res.headers] } });
    while (memory.size > 40) memory.delete(memory.keys().next().value);
  },
};

// Cookies as typed into a settings box: tolerate quotes, a pasted "name=" prefix and URL-encoded braces.
function cookieHeader(env) {
  const clean = (v) => String(v ?? '').replace(/[\r\n]/g, '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  const s2 = clean(env.ESPN_S2).replace(/^espn_s2=/i, '');
  let swid = clean(env.ESPN_SWID).replace(/^swid=/i, '');
  if (/%7B/i.test(swid)) swid = decodeURIComponent(swid);
  if (swid) swid = `{${swid.replace(/[{}]/g, '')}}`;
  return s2 && swid ? `espn_s2=${s2}; SWID=${swid}` : '';
}

// ESPN names NBA seasons by the year they end (2026-27 = 2027).
function defaultSeason(now = new Date()) {
  return now.getUTCFullYear() + (now.getUTCMonth() >= 7 ? 1 : 0);
}

// Fresh data (the Refresh button, `fresh=1`) is limited to once every REFRESH_SECONDS (default 5) for each route,
// per signed-in team, or per device when nobody is signed in. Over the limit it is not an error: the request is
// answered from the cache, which is at most a minute or two old, and the response says so (x-refresh-limited).
export async function handleApi(request, env, ctx) {
  const state = { limited: false };
  const res = await handle(request, env, ctx, state);
  if (!state.limited) return res;
  const out = new Response(res.body, res); // cached responses have read-only headers
  out.headers.set('x-refresh-limited', '1');
  return out;
}

async function handle(request, env, ctx, state) {
  const url = new URL(request.url);
  const signIn = url.pathname === '/api/login' || url.pathname === '/api/logout';
  const board = url.pathname === '/api/board';
  const allowed = signIn ? ['POST'] : board ? ['GET', 'POST'] : ['GET'];
  if (!allowed.includes(request.method)) return json({ error: signIn ? 'Use POST to sign in.' : 'Only GET is supported.' }, 405);
  const season = Number(env.SEASON) || defaultSeason();
  const leagueId = String(env.LEAGUE_ID || '').trim();
  const cookie = cookieHeader(env);
  const refreshSeconds = env.REFRESH_SECONDS == null || env.REFRESH_SECONDS === '' ? 5 : Number(env.REFRESH_SECONDS);
  // true when this request may bypass the cache (it asked for fresh data and is within its allowance)
  const wantFresh = async (route) => {
    if (url.searchParams.get('fresh') !== '1') return false;
    if (!(refreshSeconds > 0)) return true;
    if (await refreshLimited(request, env, route, refreshSeconds)) {
      state.limited = true;
      return false;
    }
    return true;
  };

  try {
    if (url.pathname === '/api/config') {
      return json({
        configured: Boolean(leagueId),
        hasCookies: Boolean(cookie),
        leagueId: leagueId || null,
        season,
        platform: env.PLATFORM || 'cloudflare',
        weekStart: env.WEEK_START || null,
        timezone: env.TIMEZONE || null,
        pins: pinsOf(env).size > 0, // whether team PINs are switched on; the PINs themselves never leave the server
        hideTeams: String(env.HIDE_TEAMS || '').split(',').map((s) => s.trim()).filter(Boolean),
      });
    }

    // The trade block: each team's block, targets, untouchables and notes, readable by everyone, editable by that team
    if (board) return request.method === 'POST' ? await saveBoard(request, env, leagueId) : await readBoard(request, env, leagueId);

    // Team PINs: optional, and only a speed bump among friends (see README). Set TEAM_PINS="1=482913,2=193846".
    if (url.pathname === '/api/me') return json({ pins: pinsOf(env).size > 0, teamId: await teamFromCookie(request, env) });
    if (url.pathname === '/api/logout') return json({ teamId: null }, 200, { 'set-cookie': sessionCookie('', 0, url) });
    if (url.pathname === '/api/login') return await login(request, env, url);

    if (url.pathname === '/api/pro-schedule') {
      return await proxy(`${ESPN}/${season}?view=proTeamSchedules_wl`, { ctx, ttl: SCHEDULE_TTL, fresh: false, what: 'schedule', season });
    }

    // Which games are scheduled, in play or final on a US date. No login needed; trimmed to what the page reads.
    if (url.pathname === '/api/scoreboard') {
      const date = url.searchParams.get('date') || '';
      if (!/^\d{8}$/.test(date)) return json({ error: 'date must look like 20261028.' }, 400);
      return trimmed(`scoreboard-${date}`, 30, ctx, await wantFresh('scoreboard'), async () => {
        const res = await fetch(`${SCOREBOARD}?dates=${date}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return json({ error: `ESPN’s scoreboard returned HTTP ${res.status}.` }, 502);
        const body = await res.json();
        return { events: (body.events || []).map((e) => ({ id: e.id, date: e.date, status: { type: { state: e.status?.type?.state, detail: e.status?.type?.detail } } })) };
      });
    }

    // Who is hurt and when ESPN expects them back. Trimmed to what the page reads (the raw feed is about 1 MB).
    if (url.pathname === '/api/injuries') {
      return trimmed('injuries', 1800, ctx, await wantFresh('injuries'), async () => {
        const res = await fetch(INJURIES, { headers: { Accept: 'application/json' } });
        if (!res.ok) return json({ error: `ESPN’s injury report returned HTTP ${res.status}.` }, 502);
        const players = [];
        for (const team of (await res.json()).injuries || []) {
          for (const i of team.injuries || []) {
            const playerId = Number(/\/id\/(\d+)/.exec(i.athlete?.links?.find((l) => l.rel?.includes('playercard'))?.href || '')?.[1]);
            if (!playerId) continue;
            // No timetable in the write-up means the date is ESPN's placeholder, not a real estimate
            const guess = /timetable|indefinite/i.test(`${i.shortComment || ''} ${i.longComment || ''}`);
            players.push({ playerId, status: i.status, returnDate: i.details?.returnDate || null, guess, type: i.details?.type || null, detail: i.details?.detail || null, comment: String(i.shortComment || '').slice(0, 180) });
          }
        }
        return { players };
      });
    }

    // Every player ESPN knows about (owned and free, by ownership), as ESPN sends it. Streamed unparsed and cached
    // ten minutes: the page slims it, which keeps the Worker well inside the free plan's CPU limit.
    if (url.pathname === '/api/players') {
      if (!leagueId) return json({ error: 'LEAGUE_ID is not set.' }, 500);
      const filter = {
        players: {
          filterStatus: { value: ['FREEAGENT', 'WAIVERS', 'ONTEAM'] },
          limit: POOL_LIMIT,
          sortPercOwned: { sortAsc: false, sortPriority: 1 },
          filterStatsForTopScoringPeriodIds: { value: 5, additionalValue: [`00${season}`, `01${season}`, `02${season}`, `03${season}`, `10${season}`] },
        },
      };
      const target = `${ESPN}/${season}/segments/0/leagues/${leagueId}?view=kona_player_info&_=pool`; // the extra parameter keeps this URL distinct from the free-agent one: only a header tells ESPN them apart, and caches key on the URL
      return await proxy(target, { cookie, ctx, ttl: 600, fresh: await wantFresh('players'), what: 'league', season, leagueId, headers: { 'x-fantasy-filter': JSON.stringify(filter) }, variant: '#pool' });
    }

    // One player with his recent games (and last season's totals), as ESPN sends it
    if (url.pathname === '/api/player') {
      if (!leagueId) return json({ error: 'LEAGUE_ID is not set.' }, 500);
      const id = url.searchParams.get('id') || '';
      if (!/^\d{1,9}$/.test(id)) return json({ error: 'id must be a player number.' }, 400);
      const filter = {
        players: {
          filterIds: { value: [Number(id)] },
          filterStatsForTopScoringPeriodIds: { value: 40, additionalValue: [`00${season}`, `01${season}`, `02${season}`, `03${season}`, `10${season}`, `00${season - 1}`] },
        },
      };
      const target = `${ESPN}/${season}/segments/0/leagues/${leagueId}?view=kona_player_info&_=p${id}`;
      return await proxy(target, { cookie, ctx, ttl: 300, fresh: await wantFresh('player'), what: 'league', season, leagueId, headers: { 'x-fantasy-filter': JSON.stringify(filter) }, variant: `#p${id}` });
    }

    // Age, height, weight and experience for one NBA team's players (ESPN's public roster feed), cached a day.
    // One team per request keeps each call small; the page asks for all 30.
    if (url.pathname === '/api/bios') {
      const team = url.searchParams.get('team') || '';
      if (!/^[a-z]{2,5}$/i.test(team)) return json({ error: 'team must be an NBA team abbreviation like sa or lal.' }, 400);
      return trimmed(`bios-${team.toLowerCase()}`, 86_400, ctx, false, async () => {
        const res = await fetch(`${TEAMS}/${team.toLowerCase()}/roster`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return json({ error: `ESPN’s roster for ${team} returned HTTP ${res.status}.` }, 502);
        return {
          players: ((await res.json()).athletes || []).map((a) => ({ playerId: Number(a.id), age: a.age ?? null, height: a.displayHeight || null, weight: a.displayWeight || null, exp: a.experience?.years ?? null, jersey: a.jersey || null, born: a.dateOfBirth?.slice(0, 10) || null })),
        };
      });
    }

    // Best players nobody owns, for working out what a replacement is worth. Trimmed to what the page reads.
    if (url.pathname === '/api/free-agents') {
      if (!leagueId) return json({ error: 'LEAGUE_ID is not set.' }, 500);
      const filter = {
        players: {
          filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
          limit: 60,
          sortAppliedStatTotal: { sortAsc: false, sortPriority: 1, value: `10${season}` }, // by preseason projection
          filterStatsForTopScoringPeriodIds: { value: 5, additionalValue: [`00${season}`, `10${season}`] },
        },
      };
      const target = `${ESPN}/${season}/segments/0/leagues/${leagueId}?view=kona_player_info&_=fa`;
      return trimmed('free-agents', 600, ctx, await wantFresh('free-agents'), async () => {
        const res = await proxy(target, { cookie, ctx, ttl: 1, fresh: true, what: 'league', season, leagueId, headers: { 'x-fantasy-filter': JSON.stringify(filter) }, variant: '#fa' });
        if (!res.ok) return res;
        const stat = (p, id) => p.stats?.find((s) => s.id === id);
        return {
          players: ((await res.json()).players || []).map((e) => ({
            playerId: e.player.id,
            name: e.player.fullName,
            proTeamId: e.player.proTeamId,
            injury: e.player.injuryStatus || 'ACTIVE',
            seasonGP: stat(e.player, `00${season}`)?.stats?.['42'] ?? 0,
            seasonAvg: stat(e.player, `00${season}`)?.appliedAverage ?? 0,
            projAvg: stat(e.player, `10${season}`)?.appliedAverage ?? 0,
            eligibleSlots: e.player.eligibleSlots || [],
          })),
        };
      });
    }

    if (url.pathname === '/api/league') {
      if (!leagueId) return json({ error: 'LEAGUE_ID is not set.' }, 500);
      if (!/^\d{1,10}$/.test(leagueId) || Number(leagueId) > 2147483647) {
        return json({ error: `LEAGUE_ID “${leagueId}” isn’t a valid league number. It is the digits after leagueId= in your ESPN league link, like 12345678.` }, 500);
      }
      const views = url.searchParams.getAll('view').filter((v) => VIEWS.has(v));
      if (!views.length) return json({ error: 'Ask for at least one ESPN view.' }, 400);
      const q = new URLSearchParams();
      for (const v of views) q.append('view', v);
      const sp = url.searchParams.get('scoringPeriodId');
      if (sp) {
        if (!/^\d{1,3}$/.test(sp)) return json({ error: 'scoringPeriodId must be a number.' }, 400);
        q.set('scoringPeriodId', sp);
      }
      const target = `${ESPN}/${season}/segments/0/leagues/${leagueId}?${q}`;
      const past = url.searchParams.get('past') === '1';
      return await proxy(target, { cookie, ctx, ttl: past ? PAST_TTL : LIVE_TTL, fresh: await wantFresh('league'), what: 'league', season, leagueId });
    }

    return json({ error: 'Not found.' }, 404);
  } catch (err) {
    return json({ error: `Couldn’t reach ESPN: ${err.message}` }, 502);
  }
}

// Cache the trimmed answer, not ESPN's big one: parsing a megabyte of JSON on every request would eat the
// Cloudflare free plan's 10 ms of CPU, but it costs nothing when the cached answer is served as it is.
// `make` returns the object to send, or a Response (an error) which is passed through uncached.
async function trimmed(name, ttl, ctx, fresh, make) {
  const cache = globalThis.caches?.default ?? memoryCache;
  const key = new Request(`https://espn-cache.invalid/trimmed/${name}`);
  if (!fresh) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }
  const made = await make();
  if (made instanceof Response) return made;
  const out = new Response(JSON.stringify(made), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${ttl}` } });
  ctx.waitUntil(cache.put(key, out.clone()).catch(() => {}));
  return out;
}

async function proxy(target, { cookie = '', ctx, ttl, fresh, what, season, leagueId, headers: extra = {}, variant = '' }) {
  const cache = globalThis.caches?.default ?? memoryCache;
  const key = new Request(`https://espn-cache.invalid/${encodeURIComponent(target)}${variant}`);
  if (!fresh) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }

  const headers = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (fantasy-punishment-tracker)', ...extra };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(target, { headers, redirect: 'manual' });
  const type = res.headers.get('content-type') || '';
  const failure = res.ok && type.includes('json') ? null : explain(res, { cookie, what, season, leagueId, type });
  if (failure) return json({ error: failure.error }, failure.status);

  const out = new Response(res.body, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${ttl}` },
  });
  ctx.waitUntil(cache.put(key, out.clone()).catch(() => {}));
  return out;
}

// Plain-language reason for a failed ESPN response.
function explain(res, { cookie, what, season, leagueId, type }) {
  const s = res.status;
  if ((s >= 300 && s < 400) || s === 401 || s === 403 || (res.ok && !type.includes('json'))) {
    return {
      status: 401,
      error: cookie
        ? 'ESPN won’t show this league to the saved login. The cookies have probably expired (logging out of ESPN or changing your password kills them), or that ESPN account isn’t a member of the league. Copy espn_s2 and SWID again from a browser that is logged in and update them.'
        : 'This league is private and no ESPN login is set. Add your espn_s2 and SWID cookies, or ask the league manager to turn on “Make league viewable to public” in league settings.',
    };
  }
  if (s === 404) {
    return what === 'schedule'
      ? { status: 404, error: `ESPN has no NBA schedule for season ${season}. SEASON should be the year the season ends (2026-27 is 2027).` }
      : { status: 404, error: `ESPN couldn’t find league ${leagueId} in the ${season} season. Check LEAGUE_ID (the digits after leagueId= in your league link) and SEASON (the year the season ends, so 2026-27 is 2027).` };
  }
  if (s === 400) return { status: 400, error: 'ESPN didn’t accept the request. Check that LEAGUE_ID is only digits and SEASON is a year like 2027.' };
  if (s === 429) return { status: 502, error: 'ESPN is limiting requests right now. Wait a few minutes and try again.' };
  if (s >= 500) return { status: 502, error: `ESPN is having problems (HTTP ${s}). Try again in a few minutes.` };
  return { status: 502, error: `ESPN returned an unexpected response (HTTP ${s}).` };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

/* ---------- Refresh limit ---------- */

// Who is asking: a signed-in team, else the device (its IP address as the host reports it).
async function identityOf(request, env) {
  const team = await teamFromCookie(request, env);
  if (team != null) return `team:${team}`;
  const h = request.headers;
  return `ip:${h.get('cf-connecting-ip') || h.get('x-real-ip') || String(h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'}`;
}

// True if this identity already refreshed this route within `seconds`. The marker lives in the same cache as the
// ESPN responses (shared between the copies of a Worker in one data centre), so the limit holds across requests.
async function refreshLimited(request, env, route, seconds) {
  const cache = globalThis.caches?.default ?? memoryCache;
  const key = new Request(`https://espn-cache.invalid/refresh-limit/${encodeURIComponent(`${await identityOf(request, env)}|${route}`)}`);
  if (await cache.match(key).catch(() => null)) return true;
  await cache.put(key, new Response('1', { headers: { 'cache-control': `public, max-age=${Math.max(1, Math.ceil(seconds))}` } })).catch(() => {});
  return false;
}

/* ---------- Trade block ---------- */

const BOARD_LIMITS = { block: 10, targets: 10, untouchables: 3, positions: 5, note: 140 };
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const boardKey = (leagueId, teamId) => `board:${leagueId}:${teamId}`;

// Who may edit: the signed-in team when PINs are on; on the PC version (nobody else can reach it) any team.
async function boardEditor(request, env, body) {
  if (pinsOf(env).size) return { teamId: await teamFromCookie(request, env), why: 'Sign in with your team PIN to edit your trade block.' };
  if (env.PLATFORM === 'local') {
    const id = Number(body?.teamId);
    return { teamId: Number.isInteger(id) && id > 0 ? id : null, why: 'Say which team this is for.' };
  }
  return { teamId: null, why: 'Turn on team PINs (TEAM_PINS) so each manager can edit only their own trade block.' };
}

async function readBoard(request, env, leagueId) {
  const editor = await boardEditor(request, env, null);
  const base = { enabled: Boolean(env.BOARD), canEdit: Boolean(env.BOARD) && (editor.teamId != null || env.PLATFORM === 'local'), teamId: editor.teamId, limits: BOARD_LIMITS, teams: {} };
  if (!env.BOARD || !leagueId) return json(base);
  const listed = await env.BOARD.list({ prefix: `board:${leagueId}:` });
  await Promise.all((listed.keys || []).map(async ({ name }) => {
    const raw = await env.BOARD.get(name);
    if (raw) base.teams[name.split(':').pop()] = JSON.parse(raw);
  }));
  return json(base);
}

// Whole numbers only, no repeats, capped
const ids = (list, max) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, max);

async function saveBoard(request, env, leagueId) {
  if (!env.BOARD) return json({ error: 'The trade block needs somewhere to store its lists, and that is not switched on for this site yet. See the README (Trade block).' }, 503);
  if (!leagueId) return json({ error: 'LEAGUE_ID is not set.' }, 500);
  const text = await request.text();
  if (text.length > 4096) return json({ error: 'That is too much to save.' }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'That did not look right. Try again.' }, 400);
  }
  const { teamId, why } = await boardEditor(request, env, body);
  if (teamId == null) return json({ error: why }, pinsOf(env).size ? 401 : 403);
  if (await refreshLimited(request, env, 'board-save', 1)) return json({ error: 'Slow down: one save a second.' }, 429);
  const untouchables = ids(body.untouchables, BOARD_LIMITS.untouchables);
  const record = {
    teamId,
    untouchables,
    block: ids(body.block, BOARD_LIMITS.block).filter((id) => !untouchables.includes(id)), // not both
    targets: ids(body.targets, BOARD_LIMITS.targets),
    positions: [...new Set((Array.isArray(body.positions) ? body.positions : []).filter((p) => POSITIONS.includes(p)))].slice(0, BOARD_LIMITS.positions),
    note: String(body.note ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, BOARD_LIMITS.note),
    updatedAt: Date.now(),
  };
  await env.BOARD.put(boardKey(leagueId, teamId), JSON.stringify(record));
  return json(record);
}

/* ---------- Team PINs ---------- */

const SESSION_DAYS = 90;
const COOKIE = 'pw_team';
const attempts = new Map(); // teamId -> recent failures (per server instance, so a best-effort limit only)

// TEAM_PINS="1=482913, 2=193846"  ->  Map(1 -> '482913', 2 -> '193846')
function pinsOf(env) {
  const out = new Map();
  for (const part of String(env.TEAM_PINS || '').split(',')) {
    const m = /^\s*(\d+)\s*=\s*(\S+)\s*$/.exec(part);
    if (m) out.set(Number(m[1]), m[2]);
  }
  return out;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`pw|${env.SESSION_SECRET || env.TEAM_PINS}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

// Compare without stopping at the first difference
function sameText(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

const sessionCookie = (value, seconds, url) => `${COOKIE}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Lax${url.protocol === 'https:' ? '; Secure' : ''}`;

// The team named by a valid, unexpired session cookie (and only while that team still has a PIN), else null.
async function teamFromCookie(request, env) {
  if (!pinsOf(env).size) return null;
  const raw = /(?:^|;\s*)pw_team=([^;]+)/.exec(request.headers.get('cookie') || '')?.[1];
  const [teamId, expires, sig] = String(raw || '').split('.');
  if (!sig || Number(expires) * 1000 < Date.now() || !pinsOf(env).has(Number(teamId))) return null;
  return sameText(sig, await hmac(env, `${teamId}.${expires}`)) ? Number(teamId) : null;
}

async function login(request, env, url) {
  const pins = pinsOf(env);
  if (!pins.size) return json({ error: 'Team PINs are not switched on for this site.' }, 400);
  const body = await request.json().catch(() => null);
  const teamId = Number(body?.teamId);
  const pin = String(body?.pin ?? '').trim();
  const recent = (attempts.get(teamId) || []).filter((t) => Date.now() - t < 10 * 60_000);
  if (recent.length >= 5) return json({ error: 'Too many wrong PINs for that team. Wait ten minutes and try again.' }, 429);
  if (!pins.has(teamId)) return json({ error: 'That team doesn’t have a PIN yet. Ask the league organiser to add one.' }, 403);
  if (!sameText(pin, pins.get(teamId))) {
    attempts.set(teamId, [...recent, Date.now()]);
    await new Promise((r) => setTimeout(r, 400)); // slows down guessing
    return json({ error: 'That PIN isn’t right for that team.' }, 401);
  }
  attempts.delete(teamId);
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return json({ teamId }, 200, { 'set-cookie': sessionCookie(`${teamId}.${expires}.${await hmac(env, `${teamId}.${expires}`)}`, SESSION_DAYS * 86400, url) });
}
