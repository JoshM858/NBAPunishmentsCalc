// ESPN proxy shared by every deploy style (Cloudflare Worker, local Node server, snapshot builder).
// Cookies stay server-side and are optional: leave them out if the league manager has made the
// league viewable to the public. Responses are streamed without parsing to stay under the free
// Cloudflare plan's 10 ms CPU limit.

const ESPN = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons';
const VIEWS = new Set(['mSettings', 'mTeam', 'mRoster', 'mMatchup', 'mMatchupScore', 'mStatus', 'mScoreboard', 'mStandings']);
const LIVE_TTL = 90;
const PAST_TTL = 12 * 3600;
const SCHEDULE_TTL = 6 * 3600;
const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

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

export async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({ error: 'Only GET is supported.' }, 405);
  const season = Number(env.SEASON) || defaultSeason();
  const leagueId = String(env.LEAGUE_ID || '').trim();
  const cookie = cookieHeader(env);

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
        hideTeams: String(env.HIDE_TEAMS || '').split(',').map((s) => s.trim()).filter(Boolean),
      });
    }

    if (url.pathname === '/api/pro-schedule') {
      return await proxy(`${ESPN}/${season}?view=proTeamSchedules_wl`, { ctx, ttl: SCHEDULE_TTL, fresh: false, what: 'schedule', season });
    }

    // Which games are scheduled, in play or final on a US date. No login needed; trimmed to what the page reads.
    if (url.pathname === '/api/scoreboard') {
      const date = url.searchParams.get('date') || '';
      if (!/^\d{8}$/.test(date)) return json({ error: 'date must look like 20261028.' }, 400);
      const res = await fetch(`${SCOREBOARD}?dates=${date}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return json({ error: `ESPN’s scoreboard returned HTTP ${res.status}.` }, 502);
      const body = await res.json();
      const events = (body.events || []).map((e) => ({ id: e.id, date: e.date, status: { type: { state: e.status?.type?.state, detail: e.status?.type?.detail } } }));
      return new Response(JSON.stringify({ events }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30' } });
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
      return await proxy(target, { cookie, ctx, ttl: past ? PAST_TTL : LIVE_TTL, fresh: url.searchParams.get('fresh') === '1', what: 'league', season, leagueId });
    }

    return json({ error: 'Not found.' }, 404);
  } catch (err) {
    return json({ error: `Couldn’t reach ESPN: ${err.message}` }, 502);
  }
}

async function proxy(target, { cookie = '', ctx, ttl, fresh, what, season, leagueId }) {
  const cache = globalThis.caches?.default ?? memoryCache;
  const key = new Request(`https://espn-cache.invalid/${encodeURIComponent(target)}`);
  if (!fresh) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }

  const headers = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (fantasy-punishment-tracker)' };
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
