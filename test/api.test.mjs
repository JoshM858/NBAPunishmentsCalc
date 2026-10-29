import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { parseEnv } from '../src/env.js';
import { installFakeEspn } from './fake-espn.mjs';

const ctx = { waitUntil() {} };
const get = async (path, env) => {
  const res = await handleApi(new Request(`http://local${path}`), { LEAGUE_ID: '424242', SEASON: '2027', ...env }, ctx);
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

// Config never leaks cookie values
{
  fake = installFakeEspn();
  const { body } = await get('/api/config', { ...COOKIES, HIDE_TEAMS: 'Bench Mob, 3' });
  assert.deepEqual(body, { configured: true, hasCookies: true, leagueId: '424242', season: 2027, platform: 'cloudflare', weekStart: null, timezone: null, hideTeams: ['Bench Mob', '3'] });
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
  assert.match(seen[0].url, /view=kona_player_info$/);
  assert.equal((await get('/api/free-agents', { LEAGUE_ID: '' })).res.status, 500);
  globalThis.fetch = async () => new Response('{}', { status: 404 });
  const missing = await get('/api/free-agents?fresh=1', { LEAGUE_ID: '555' });
  assert.equal(missing.res.status, 404);
  assert.match(missing.body.error, /league 555/);
  globalThis.fetch = real;
}

// .env parsing
assert.deepEqual(
  parseEnv('# comment\nLEAGUE_ID=123456\r\nSEASON = 2027 # this year\nESPN_S2="AEB%2Bxyz=="\nexport ESPN_SWID={ABC-123}\n\nBAD LINE\nHIDE_TEAMS=\n'),
  { LEAGUE_ID: '123456', SEASON: '2027', ESPN_S2: 'AEB%2Bxyz==', ESPN_SWID: '{ABC-123}', HIDE_TEAMS: '' },
);

console.log('All API tests passed');
