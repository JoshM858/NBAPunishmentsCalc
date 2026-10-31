import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { parseEnv } from '../src/env.js';
import { installFakeEspn } from './fake-espn.mjs';

const ctx = { waitUntil() {} };
const get = async (path, env) => {
  const res = await handleApi(new Request(`http://local${path}`), { LEAGUE_ID: '424242', SEASON: '2027', REFRESH_SECONDS: '0', HIDE_TEAMS: '', ...env }, ctx);
  return { res, body: await res.json().catch(() => null) };
};
const LEAGUE = '/api/league?view=mTeam&view=mRoster';
const COOKIES = { ESPN_S2: 'AEBxyz123', ESPN_SWID: '{AAAA-1111}' };

// ESPN answers, as seen from the real API (404 body and 400 body were captured from the live endpoint).
let fake = installFakeEspn();
{
  const { res, body } = await get(LEAGUE);
  assert.equal(res.status, 200);
  assert.equal(body.seasonId, 2027);
  assert.ok(body.teams.length === 10);
  const day = await get(`${LEAGUE}&scoringPeriodId=7`);
  assert.equal(day.body.scoringPeriodId, 7);
  assert.match(fake.calls.at(-1).url, /scoringPeriodId=7/);
  assert.equal(fake.calls.at(-1).cookie, '', 'no cookie header when none configured');

  // Second identical call is served from the cache, fresh=1 skips it
  const n = fake.calls.length;
  await get(LEAGUE);
  assert.equal(fake.calls.length, n, 'cached');
  await get(`${LEAGUE}&fresh=1`);
  assert.equal(fake.calls.length, n + 1, 'fresh=1 bypasses the cache');

  const pro = await get('/api/pro-schedule');
  assert.equal(pro.res.status, 200);
  assert.ok(pro.body.settings.proTeams.length > 20);
  assert.equal(fake.calls.at(-1).cookie, '', 'the schedule is requested without cookies');
}
fake.restore();

// The player pool, one player, and bios: validated, passed through, never trusting the query string
{
  fake = installFakeEspn();
  const pool = await get('/api/players');
  assert.equal(pool.res.status, 200);
  assert.ok(Array.isArray(pool.body.players));
  assert.match(fake.calls.at(-1).url, /_=pool$/, 'a URL of its own, since caches key on the URL and ESPN tells filters apart by header');
  const f = JSON.parse(fake.calls.at(-1).filter);
  assert.deepEqual(f.players.filterStatus.value, ['FREEAGENT', 'WAIVERS', 'ONTEAM']);
  assert.equal(f.players.limit, 500);
  assert.ok(f.players.filterStatsForTopScoringPeriodIds.additionalValue.includes('102027'));
  const n = fake.calls.length;
  await get('/api/players');
  assert.equal(fake.calls.length, n, 'the pool is cached');

  assert.equal((await get('/api/player?id=abc')).res.status, 400);
  assert.equal((await get('/api/player?id=1;drop')).res.status, 400);
  assert.equal((await get('/api/player')).res.status, 400);
  assert.equal((await get('/api/player?id=5104157')).res.status, 200);
  const one = JSON.parse(fake.calls.at(-1).filter);
  assert.deepEqual(one.players.filterIds.value, [5104157]);
  assert.equal(one.players.filterStatsForTopScoringPeriodIds.value, 40);
  assert.ok(one.players.filterStatsForTopScoringPeriodIds.additionalValue.includes('002026'), 'last season totals');

  assert.equal((await get('/api/bios?team=../etc')).res.status, 400);
  assert.equal((await get('/api/bios')).res.status, 400);
  const bios = await get('/api/bios?team=sa');
  assert.deepEqual(bios.body.players, [{ playerId: 6578, age: 34, height: "6' 8\"", weight: '225 lbs', exp: 14, jersey: '40', born: '1992-05-30' }]);
  assert.ok(!JSON.stringify(bios.body).includes('Not Kept'), 'only the fields the page reads');
  assert.equal((await get('/api/bios?team=zz')).res.status, 502);
  assert.equal((await get('/api/league?view=mDraftDetail')).res.status, 200);
  assert.equal((await get('/api/players', { LEAGUE_ID: '' })).res.status, 500);
  fake.restore();
}

// Terms record: append-only, one per team, needs somewhere to store it, verified when PINs are on
{
  const { createFileKV } = await import('../src/file-kv.js');
  const kvFile = new URL('../.cache/accept-test.json', import.meta.url).pathname;
  const { rmSync } = await import('node:fs');
  rmSync(kvFile, { force: true });
  const BOARD = createFileKV(kvFile);
  const post = async (body, env, headers = {}) => {
    const res = await handleApi(new Request('http://local/api/accept', { method: 'POST', headers: { 'user-agent': 'test-agent', ...headers }, body: JSON.stringify(body) }), { LEAGUE_ID: '424242', SEASON: '2027', REFRESH_SECONDS: '0', BOARD, ...env }, ctx);
    return { res, body: await res.json() };
  };
  const read = async (env) => (await get('/api/accept', { BOARD, ...env })).body;
  assert.equal((await post({ teamId: 1, version: 1 }, { BOARD: undefined })).res.status, 503, 'no storage, no record');
  assert.equal((await post({ version: 1 }, {})).res.status, 400, 'a team is required');
  assert.equal((await post({ teamId: 1, version: 99 }, {})).res.status, 409, 'wrong terms version');
  const first = await post({ teamId: 1, version: 1 }, {});
  assert.equal(first.res.status, 200);
  assert.equal(first.body.verified, false, 'without PINs the record is marked unverified');
  assert.equal(first.body.agent, 'test-agent');
  await new Promise((r) => setTimeout(r, 15));
  const again = await post({ teamId: 1, version: 1 }, {});
  assert.equal(again.body.at, first.body.at, 'accepting again keeps the original time');
  assert.equal((await read({})).accepted[1].at, first.body.at);
  assert.equal((await handleApi(new Request('http://local/api/accept', { method: 'DELETE' }), { LEAGUE_ID: '424242', BOARD }, ctx)).status, 405, 'there is no way to remove a record');
  // With PINs: only the signed-in team, and the record is verified
  const pinEnv = { TEAM_PINS: '2=193846', SESSION_SECRET: 's' };
  assert.equal((await post({ teamId: 2, version: 1 }, pinEnv)).res.status, 401, 'PINs on: signing in is required');
  const login = await handleApi(new Request('http://local/api/login', { method: 'POST', body: JSON.stringify({ teamId: 2, pin: '193846' }) }), { LEAGUE_ID: '424242', SEASON: '2027', ...pinEnv }, ctx);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const signed = await post({ teamId: 5, version: 1 }, pinEnv, { cookie });
  assert.equal(signed.body.teamId, 2, 'the signed-in team is recorded, whatever the request says');
  assert.equal(signed.body.verified, true);
  assert.deepEqual(Object.keys((await read({})).accepted).sort(), ['1', '2']);
  rmSync(kvFile, { force: true });
}

// This league is built in: no setup needed, and setting a value (even blank) overrides it
{
  const bare = async (env) => (await (await handleApi(new Request('http://local/api/config'), env, ctx)).json());
  const d = await bare({});
  assert.equal(d.configured, true);
  assert.equal(d.leagueId, '823721722');
  assert.deepEqual(d.hideTeams, ['3']);
  assert.deepEqual((await bare({ LEAGUE_ID: '555', HIDE_TEAMS: '' })).hideTeams, [], 'a blank value hides nobody');
  assert.equal((await bare({ LEAGUE_ID: '555' })).leagueId, '555');
  assert.equal((await bare({ LEAGUE_ID: '' })).configured, false);
}

// Config never leaks cookie values
{
  fake = installFakeEspn();
  const { body } = await get('/api/config', { ...COOKIES, HIDE_TEAMS: 'Bench Mob, 3' });
  assert.deepEqual(body, { configured: true, hasCookies: true, leagueId: '424242', season: 2027, platform: 'cloudflare', weekStart: null, timezone: null, pins: false, hideTeams: ['Bench Mob', '3'] });
  assert.ok(!JSON.stringify(body).includes('AEBxyz123'));
  assert.equal((await get('/api/config', { LEAGUE_ID: '' })).body.configured, false);
  assert.equal((await get('/api/config', { ...COOKIES, ESPN_SWID: '' })).body.hasCookies, false, 'needs both cookies');
  fake.restore();
}

// Cookies are cleaned up before they are sent
{
  fake = installFakeEspn();
  await get(`${LEAGUE}&fresh=1`, { ESPN_S2: '"AEBxyz123"', ESPN_SWID: 'swid=%7BAAAA-1111%7D' });
  assert.equal(fake.calls.at(-1).cookie, 'espn_s2=AEBxyz123; SWID={AAAA-1111}');
  await get(`${LEAGUE}&fresh=1`, { ESPN_S2: 'espn_s2=AEBxyz123', ESPN_SWID: 'AAAA-1111' });
  assert.equal(fake.calls.at(-1).cookie, 'espn_s2=AEBxyz123; SWID={AAAA-1111}', 'braces added when missing');
  fake.restore();
}

// Private league: no cookies vs bad cookies read differently
{
  fake = installFakeEspn({ mode: { status: 401, body: JSON.stringify({ details: [{ type: 'AUTH_LEAGUE_NOT_VISIBLE' }] }) } });
  let r = await get(`${LEAGUE}&fresh=1`);
  assert.equal(r.res.status, 401);
  assert.match(r.body.error, /private/i);
  assert.match(r.body.error, /espn_s2 and SWID/);
  r = await get(`${LEAGUE}&fresh=1`, COOKIES);
  assert.equal(r.res.status, 401);
  assert.match(r.body.error, /expired/i);
  assert.ok(!r.body.error.includes('AEBxyz123'));
  fake.restore();
}

// Redirect to a login page and HTML responses count as "not logged in" too
for (const mode of [{ status: 302, location: 'https://registerdisney.go.com/login' }, { status: 200, type: 'text/html', body: '<html>sign in</html>' }]) {
  fake = installFakeEspn({ mode });
  const r = await get(`${LEAGUE}&fresh=1`);
  assert.equal(r.res.status, 401, JSON.stringify(mode));
  assert.match(r.body.error, /private/i);
  fake.restore();
}

// Wrong league id / season: ESPN says 404 {"messages":["Not Found"],...GENERAL_NOT_FOUND}
{
  fake = installFakeEspn();
  const r = await get(`${LEAGUE}&fresh=1`, { LEAGUE_ID: '555' });
  assert.equal(r.res.status, 404);
  assert.match(r.body.error, /league 555/);
  assert.match(r.body.error, /LEAGUE_ID/);
  assert.match(r.body.error, /SEASON/);
  const s = await get('/api/pro-schedule', { SEASON: '2099' });
  assert.equal(s.res.status, 404);
  assert.match(s.body.error, /no NBA schedule for season 2099/);
  fake.restore();
}

// LEAGUE_ID that can't be a league never reaches ESPN
{
  fake = installFakeEspn();
  for (const id of ['abc', '12 34', '999999999999', 'https://fantasy.espn.com/?leagueId=1']) {
    const r = await get(LEAGUE, { LEAGUE_ID: id });
    assert.equal(r.res.status, 500, id);
    assert.match(r.body.error, /isn’t a valid league number/);
  }
  assert.equal(fake.calls.length, 0);
  fake.restore();
}

// Everything else ESPN might say
for (const [mode, status, pattern] of [
  [{ status: 400, body: '{"messages":["Invalid parameter for \'leagueId\'."]}' }, 400, /didn’t accept the request/],
  [{ status: 429, body: '{}' }, 502, /limiting requests/],
  [{ status: 503, body: 'down', type: 'text/plain' }, 502, /having problems \(HTTP 503\)/],
  [{ status: 418, body: '{}' }, 502, /unexpected response \(HTTP 418\)/],
]) {
  fake = installFakeEspn({ mode });
  const r = await get(`${LEAGUE}&fresh=1`);
  assert.equal(r.res.status, status, JSON.stringify(mode));
  assert.match(r.body.error, pattern);
  fake.restore();
}

// Network failure
{
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  const r = await get(`${LEAGUE}&fresh=1`);
  assert.equal(r.res.status, 502);
  assert.match(r.body.error, /Couldn’t reach ESPN/);
  globalThis.fetch = real;
}

// Only whitelisted views and GET
{
  fake = installFakeEspn();
  assert.equal((await get('/api/league?view=bogus')).res.status, 400);
  assert.equal((await get(`${LEAGUE}&scoringPeriodId=abc`)).res.status, 400);
  assert.equal((await get('/api/nope')).res.status, 404);
  const post = await handleApi(new Request('http://local/api/config', { method: 'POST' }), {}, ctx);
  assert.equal(post.status, 405);
  fake.restore();
}

// Scoreboard: trimmed to what the page reads, and only for a real date
{
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (input) => {
    asked.push(String(input));
    return new Response(JSON.stringify({ events: [{ id: '1', date: '2026-10-28T23:00Z', shortName: 'MIA @ ATL', competitions: [{ big: 'payload' }], status: { type: { state: 'post', detail: 'Final', completed: true }, clock: 0 } }] }), { status: 200 });
  };
  const r = await get('/api/scoreboard?date=20261028');
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.body, { events: [{ id: '1', date: '2026-10-28T23:00Z', status: { type: { state: 'post', detail: 'Final' } } }] });
  assert.match(asked[0], /scoreboard\?dates=20261028$/);
  for (const bad of ['', 'abc', '2026-10-28', '20261028;x']) assert.equal((await get(`/api/scoreboard?date=${encodeURIComponent(bad)}`)).res.status, 400, bad);
  globalThis.fetch = async () => new Response('x', { status: 503 });
  const down = await get('/api/scoreboard?date=20261028&fresh=1');
  assert.equal(down.res.status, 502);
  assert.match(down.body.error, /HTTP 503/);
  globalThis.fetch = real;
}

// Injuries: the 1 MB feed is trimmed to who, status and return date; the answer is cached and a failure is not
{
  const real = globalThis.fetch;
  let calls = 0;
  const entry = (id, status, returnDate, extra = {}) => ({ status, shortComment: 'x'.repeat(300), athlete: { links: [{ rel: ['playercard', 'desktop'], href: `https://www.espn.com/nba/player/_/id/${id}/some-player` }] }, details: { fantasyStatus: { abbreviation: 'OUT' }, type: 'Knee', detail: 'Surgery', returnDate }, ...extra });
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ injuries: [{ id: '1', displayName: 'Team', injuries: [entry(4712863, 'Out', '2026-11-20'), entry(111, 'Day-To-Day', null), { status: 'Out', athlete: { links: [] }, details: {} }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const r = await get('/api/injuries?fresh=1');
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.body.players.map((p) => [p.playerId, p.status, p.returnDate, p.type, p.detail]), [[4712863, 'Out', '2026-11-20', 'Knee', 'Surgery'], [111, 'Day-To-Day', null, 'Knee', 'Surgery']], 'player ids come from the player-card link; entries without one are dropped');
  assert.ok(r.body.players[0].comment.length <= 180, 'comments are cut short');
  await get('/api/injuries');
  assert.equal(calls, 1, 'the second request is served from the cache');
  globalThis.fetch = async () => new Response('x', { status: 500 });
  const bad = await get('/api/injuries?fresh=1');
  assert.equal(bad.res.status, 502);
  assert.match(bad.body.error, /HTTP 500/);
  assert.equal((await get('/api/injuries')).res.status, 200, 'a failure did not replace the good cached answer');
  globalThis.fetch = real;
}

// Free agents: trimmed, asks ESPN with the filter header, and is cached apart from other requests
{
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    seen.push({ url: String(input), filter: init.headers?.['x-fantasy-filter'] });
    return new Response(JSON.stringify({ players: [{ id: 1, status: 'FREEAGENT', player: { id: 7, fullName: 'Free Agent', proTeamId: 3, injuryStatus: 'OUT', eligibleSlots: [0, 5], draftRanksByRankType: { big: 1 }, stats: [{ id: '002027', appliedAverage: 21.5, stats: { 42: 6, 0: 99 } }, { id: '102027', appliedAverage: 30 }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const r = await get('/api/free-agents?fresh=1');
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.body, { players: [{ playerId: 7, name: 'Free Agent', proTeamId: 3, injury: 'OUT', seasonGP: 6, seasonAvg: 21.5, projAvg: 30, eligibleSlots: [0, 5] }] });
  const filter = JSON.parse(seen[0].filter);
  assert.deepEqual(filter.players.filterStatus.value, ['FREEAGENT', 'WAIVERS']);
  assert.match(seen[0].url, /view=kona_player_info&_=fa$/);
  assert.equal((await get('/api/free-agents', { LEAGUE_ID: '' })).res.status, 500);
  globalThis.fetch = async () => new Response('{}', { status: 404 });
  const missing = await get('/api/free-agents?fresh=1', { LEAGUE_ID: '555' });
  assert.equal(missing.res.status, 404);
  assert.match(missing.body.error, /league 555/);
  globalThis.fetch = real;
}

// Team PINs
{
  const env = { LEAGUE_ID: '424242', TEAM_PINS: '1=482913, 2=193846, 4=777777', SESSION_SECRET: 'a-long-random-secret' };
  const call = (path, init, e = env, base = 'http://site.test') => handleApi(new Request(base + path, init), e, ctx);
  const post = (path, body, e = env, base) => call(path, { method: 'POST', body: JSON.stringify(body) }, e, base);
  const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];
  const me = async (cookie, e = env) => (await (await call('/api/me', { headers: cookie ? { cookie } : {} }, e)).json()).teamId;

  // Off by default: the picker works exactly as before
  assert.equal((await (await call('/api/me', {}, { LEAGUE_ID: '1' })).json()).pins, false);
  assert.equal((await post('/api/login', { teamId: 1, pin: '1' }, { LEAGUE_ID: '1' })).status, 400);
  assert.equal((await get('/api/config', { TEAM_PINS: '1=482913' })).body.pins, true);
  assert.equal((await get('/api/config', {})).body.pins, false);
  const cfg = JSON.stringify((await get('/api/config', env)).body);
  assert.ok(!/482913|193846|777777|a-long-random-secret/.test(cfg), 'config never shows PINs or the secret');

  // Wrong PIN, then the right one
  let r = await post('/api/login', { teamId: 1, pin: '000000' });
  assert.equal(r.status, 401);
  assert.match((await r.json()).error, /isn’t right/);
  assert.equal(r.headers.get('set-cookie'), null, 'no cookie for a wrong PIN');
  r = await post('/api/login', { teamId: 1, pin: ' 482913 ' });
  assert.equal(r.status, 200);
  const cookie = cookieOf(r);
  const flags = r.headers.get('set-cookie');
  assert.match(flags, /HttpOnly/);
  assert.match(flags, /SameSite=Lax/);
  assert.ok(!/Secure/.test(flags), 'plain http (local) cannot use Secure cookies');
  assert.match((await post('/api/login', { teamId: 1, pin: '482913' }, env, 'https://site.test')).headers.get('set-cookie'), /; Secure/, 'Secure over https');
  assert.ok(!flags.includes('482913'), 'the PIN is not in the cookie');
  assert.equal(await me(cookie), 1);
  assert.equal(await me(null), null);

  // Forgery and tampering
  const [team, exp, sig] = cookie.replace('pw_team=', '').split('.');
  assert.equal(await me(`pw_team=2.${exp}.${sig}`), null, 'cannot change the team in a signed cookie');
  assert.equal(await me(`pw_team=${team}.${Number(exp) + 99999}.${sig}`), null, 'cannot extend it');
  assert.equal(await me(`pw_team=${team}.${exp}.${'0'.repeat(sig.length)}`), null, 'cannot guess the signature');
  assert.equal(await me(`pw_team=${team}.${exp}`), null);
  assert.equal(await me('pw_team=garbage'), null);
  assert.equal(await me(cookie, { ...env, SESSION_SECRET: 'other-secret' }), null, 'rotating the secret signs everyone out');
  assert.equal(await me(cookie, { ...env, TEAM_PINS: '2=193846' }), null, 'removing a team’s PIN signs that team out');
  // expired: sign one by hand with the same key via a short session (exp in the past)
  const past = Math.floor(Date.now() / 1000) - 10;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`pw|${env.SESSION_SECRET}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const old = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`1.${past}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(await me(`pw_team=1.${past}.${old}`), null, 'an expired session is refused even with a valid signature');

  // Teams without a PIN, bad input
  r = await post('/api/login', { teamId: 3, pin: '1234' });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /doesn’t have a PIN/);
  assert.equal((await post('/api/login', { teamId: 'x', pin: '1' })).status, 403);
  assert.equal((await call('/api/login', { method: 'POST', body: 'not json' })).status, 403);
  assert.equal((await call('/api/login')).status, 405, 'sign-in is POST only');
  assert.equal((await call('/api/me', { method: 'POST' })).status, 405, 'other routes stay GET only');

  // Lockout after five wrong PINs, even for the right one afterwards
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/login', { teamId: 4, pin: `00000${i}` })).status, 401);
  r = await post('/api/login', { teamId: 4, pin: '777777' });
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /Wait ten minutes/);
  assert.equal((await post('/api/login', { teamId: 2, pin: '193846' })).status, 200, 'other teams are unaffected');

  // Sign out clears the cookie
  r = await post('/api/logout', {});
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
}

// Trade block: shared lists, editable only by the signed-in team
{
  const mem = () => {
    const m = new Map();
    return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => void m.set(k, String(v)), list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }) };
  };
  const store = mem();
  const pins = { TEAM_PINS: '1=482913,2=193846', SESSION_SECRET: 'board-secret' };
  const env = (extra = {}) => ({ LEAGUE_ID: '555', SEASON: '2027', REFRESH_SECONDS: '0', BOARD: store, ...pins, ...extra });
  const send = (path, { method = 'GET', body, cookie, e = env(), ip = '9.9.9.9' } = {}) =>
    handleApi(new Request(`http://board.test${path}`, { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers: { 'x-real-ip': ip, ...(cookie ? { cookie } : {}) } }), e, ctx);
  const login = async (id, pin) => (await send('/api/login', { method: 'POST', body: { teamId: id, pin } })).headers.get('set-cookie').split(';')[0];
  const c1 = await login(1, '482913');
  const c2 = await login(2, '193846');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // reading: open to everyone, even signed out; says who can edit
  let r = await (await send('/api/board')).json();
  assert.deepEqual([r.enabled, r.canEdit, r.teamId, r.teams], [true, false, null, {}]);
  assert.deepEqual(r.limits, { block: 10, targets: 10, untouchables: 3, positions: 5, note: 140 });
  r = await (await send('/api/board', { cookie: c1 })).json();
  assert.deepEqual([r.canEdit, r.teamId], [true, 1]);

  // writing needs a signed-in team
  let w = await send('/api/board', { method: 'POST', body: { block: [1] } });
  assert.equal(w.status, 401);
  assert.match((await w.json()).error, /Sign in with your team PIN/);
  assert.equal((await send('/api/board', { method: 'POST', body: { block: [1] }, cookie: 'pw_team=1.9999999999.forged' })).status, 401);

  // a team saves its own lists, tidied
  w = await send('/api/board', { method: 'POST', cookie: c1, body: { teamId: 2, block: [10, 11, 11, '12', 'x', -3, 4.5, 99], untouchables: [99, 98, 97, 96], targets: [20, 21], positions: ['PG', 'C', 'XX', 'PG'], note: '  Need a big\n man <b>please</b>  ' } });
  assert.equal(w.status, 200);
  let saved = await w.json();
  assert.equal(saved.teamId, 1, 'the team comes from the sign-in, not from what was sent');
  assert.deepEqual(saved.untouchables, [99, 98, 97], 'at most three untouchables');
  assert.deepEqual(saved.block, [10, 11, 12], 'whole numbers only, no repeats, and no untouchable also on the block');
  assert.deepEqual(saved.targets, [20, 21]);
  assert.deepEqual(saved.positions, ['PG', 'C']);
  assert.equal(saved.note, 'Need a big man <b>please</b>', 'control characters removed (the page escapes the rest)');
  assert.ok(Date.now() - saved.updatedAt < 5000);
  assert.deepEqual(JSON.parse(store.m.get('board:555:1')), saved, 'stored under the league and team');
  assert.equal(store.m.has('board:555:2'), false, 'nothing was written for the team named in the request body');

  // limits
  w = await send('/api/board', { method: 'POST', cookie: c2, body: { block: Array.from({ length: 30 }, (_, i) => i + 1), targets: Array.from({ length: 30 }, (_, i) => i + 1), note: 'x'.repeat(500) } });
  saved = await w.json();
  assert.deepEqual([saved.block.length, saved.targets.length, saved.note.length], [10, 10, 140]);
  assert.equal((await send('/api/board', { method: 'POST', cookie: c2, body: 'x'.repeat(5000) })).status, 413);
  await wait(1100);
  assert.equal((await send('/api/board', { method: 'POST', cookie: c2, body: '{not json' })).status, 400);

  // everyone sees everyone's lists; teams cannot overwrite each other
  r = await (await send('/api/board')).json();
  assert.deepEqual(Object.keys(r.teams).sort(), ['1', '2']);
  assert.deepEqual(r.teams[1].block, [10, 11, 12]);
  assert.equal(r.teams[2].block.length, 10);
  await wait(1100);
  await send('/api/board', { method: 'POST', cookie: c2, body: { block: [7] } });
  r = await (await send('/api/board')).json();
  assert.deepEqual(r.teams[1].block, [10, 11, 12], 'team 2 saving did not touch team 1');
  assert.deepEqual(r.teams[2].block, [7]);

  // saves are limited to one a second per team
  w = await send('/api/board', { method: 'POST', cookie: c2, body: { block: [8] } });
  assert.equal(w.status, 429);
  assert.match((await w.json()).error, /Slow down/);

  // another league's lists never mix in
  r = await (await send('/api/board', { e: env({ LEAGUE_ID: '556' }) })).json();
  assert.deepEqual(r.teams, {});

  // not switched on: readable but empty, and saving explains why
  r = await (await send('/api/board', { e: env({ BOARD: undefined }) })).json();
  assert.deepEqual([r.enabled, r.canEdit, r.teams], [false, false, {}]);
  w = await send('/api/board', { method: 'POST', cookie: c1, body: { block: [1] }, e: env({ BOARD: undefined }) });
  assert.equal(w.status, 503);
  assert.match((await w.json()).error, /needs somewhere to store/);

  // no PINs on a hosted site: nobody can edit (anyone could pose as anyone)
  w = await send('/api/board', { method: 'POST', body: { teamId: 1, block: [1] }, e: env({ TEAM_PINS: undefined }) });
  assert.equal(w.status, 403);
  assert.match((await w.json()).error, /Turn on team PINs/);
  assert.equal((await (await send('/api/board', { e: env({ TEAM_PINS: undefined }) })).json()).canEdit, false);
  // on the PC version without PINs, the team is named in the request
  w = await send('/api/board', { method: 'POST', body: { teamId: 6, block: [5] }, e: env({ TEAM_PINS: undefined, PLATFORM: 'local' }) });
  assert.equal(w.status, 200);
  assert.equal((await w.json()).teamId, 6);
  assert.equal((await send('/api/board', { method: 'POST', body: { block: [5] }, e: env({ TEAM_PINS: undefined, PLATFORM: 'local', REFRESH_SECONDS: '0' }), ip: '1.1.1.1' })).status, 403, 'and it must say which team');

  // methods
  assert.equal((await send('/api/board', { method: 'DELETE' })).status, 405);
  assert.equal((await send('/api/board', { method: 'PUT', body: {} })).status, 405);
}

// Refresh limit: once every 5 seconds per signed-in team, or per device. Over the limit is not an error.
{
  const pins = { TEAM_PINS: '1=482913,2=193846', SESSION_SECRET: 'rl-secret' };
  const real = globalThis.fetch;
  let hits = 0;
  globalThis.fetch = async (input) => {
    hits++;
    return new Response(JSON.stringify({ teams: [], marker: hits }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const send = (path, { env = {}, headers = {} } = {}) => handleApi(new Request(`http://rl.test${path}`, { headers }), { LEAGUE_ID: '777', SEASON: '2027', ...env }, ctx);
  const league = '/api/league?view=mTeam&fresh=1';
  const login = async (id, pin) => {
    const res = await handleApi(new Request('http://rl.test/api/login', { method: 'POST', body: JSON.stringify({ teamId: id, pin }) }), { LEAGUE_ID: '777', ...pins }, ctx);
    return res.headers.get('set-cookie').split(';')[0];
  };

  // first fresh request from a device goes to ESPN; a second one within the window is answered from the cache
  const ip = { 'x-real-ip': '10.0.0.1' };
  let r = await send(league, { headers: ip });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-refresh-limited'), null);
  assert.equal(hits, 1);
  r = await send(league, { headers: ip });
  assert.equal(r.status, 200, 'over the limit is not an error');
  assert.equal(r.headers.get('x-refresh-limited'), '1', 'but it says so');
  assert.equal(hits, 1, 'and ESPN was not asked again');
  assert.equal((await r.json()).marker, 1, 'the cached answer is served');
  // another device is separate
  r = await send(league, { headers: { 'x-real-ip': '10.0.0.2' } });
  assert.equal(r.headers.get('x-refresh-limited'), null);
  assert.equal(hits, 2);
  // normal (non-fresh) requests are never limited and never marked
  r = await send('/api/league?view=mTeam', { headers: ip });
  assert.equal(r.headers.get('x-refresh-limited'), null);
  // the limit is per route: refreshing the league does not block refreshing the injury report
  r = await send('/api/injuries?fresh=1', { headers: ip });
  assert.equal(r.headers.get('x-refresh-limited'), null);

  // signed-in teams are limited as teams, whichever device they use, and separately from each other
  const c1 = await login(1, '482913');
  const c2 = await login(2, '193846');
  const before = hits;
  r = await send(league, { env: pins, headers: { cookie: c1, 'x-real-ip': '10.0.0.3' } });
  assert.equal(r.headers.get('x-refresh-limited'), null, 'team 1’s first refresh');
  r = await send(league, { env: pins, headers: { cookie: c1, 'x-real-ip': '10.0.0.4' } });
  assert.equal(r.headers.get('x-refresh-limited'), '1', 'team 1 from another device is still team 1');
  r = await send(league, { env: pins, headers: { cookie: c2, 'x-real-ip': '10.0.0.3' } });
  assert.equal(r.headers.get('x-refresh-limited'), null, 'team 2 on the same device has its own allowance');
  assert.equal(hits, before + 2, 'two real fetches for three requests');
  // a forged cookie does not buy a separate allowance
  r = await send(league, { env: pins, headers: { cookie: 'pw_team=1.9999999999.deadbeef', 'x-real-ip': '10.0.0.1' } });
  assert.equal(r.headers.get('x-refresh-limited'), '1', 'treated as the device it came from');

  // the window passes
  await new Promise((res) => setTimeout(res, 5200));
  r = await send(league, { headers: ip });
  assert.equal(r.headers.get('x-refresh-limited'), null, 'allowed again after 5 seconds');

  // switchable: REFRESH_SECONDS=0 turns it off, another value changes it
  const n = hits;
  for (let i = 0; i < 3; i++) assert.equal((await send(league, { env: { REFRESH_SECONDS: '0' }, headers: { 'x-real-ip': '10.0.0.9' } })).headers.get('x-refresh-limited'), null);
  assert.equal(hits, n + 3, 'no limit: every request fetched');
  assert.equal((await send('/api/league?view=mTeam&fresh=1', { env: { REFRESH_SECONDS: '60' }, headers: { 'x-real-ip': '10.0.0.8' } })).headers.get('x-refresh-limited'), null);
  assert.equal((await send('/api/league?view=mTeam&fresh=1', { env: { REFRESH_SECONDS: '60' }, headers: { 'x-real-ip': '10.0.0.8' } })).headers.get('x-refresh-limited'), '1');
  globalThis.fetch = real;
}

// .env parsing
assert.deepEqual(
  parseEnv('# comment\nLEAGUE_ID=123456\r\nSEASON = 2027 # this year\nESPN_S2="AEB%2Bxyz=="\nexport ESPN_SWID={ABC-123}\n\nBAD LINE\nHIDE_TEAMS=\n'),
  { LEAGUE_ID: '123456', SEASON: '2027', ESPN_S2: 'AEB%2Bxyz==', ESPN_SWID: '{ABC-123}', HIDE_TEAMS: '' },
);

console.log('All API tests passed');
