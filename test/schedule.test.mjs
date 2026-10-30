import assert from 'node:assert/strict';
import { gamesOn, playersPerDay } from '../public/schedule.js';

// Teams 1 and 2 play on day 1 (1 at home); teams 3 and 4 play on days 1 and 2 (3 home on day 1, 4 home on day 2)
const games = new Map();
const add = (id, sp, g) => { if (!games.has(id)) games.set(id, new Map()); games.get(id).set(sp, g); };
add(1, 1, { date: 100, opp: 2, home: true }); add(2, 1, { date: 100, opp: 1, home: false });
add(3, 1, { date: 50, opp: 4, home: true }); add(4, 1, { date: 50, opp: 3, home: false });
add(4, 2, { date: 200, opp: 3, home: true }); add(3, 2, { date: 200, opp: 4, home: false });
const pro = { games, abbrev: new Map([[1, 'AAA'], [2, 'BBB'], [3, 'CCC'], [4, 'DDD']]) };

assert.deepEqual(gamesOn(pro, 1), [{ home: 'CCC', away: 'DDD', date: 50 }, { home: 'AAA', away: 'BBB', date: 100 }], 'each game once, earliest first');
assert.deepEqual(gamesOn(pro, 2), [{ home: 'DDD', away: 'CCC', date: 200 }]);
assert.deepEqual(gamesOn(pro, 9), []);

const teams = [{ id: 1, name: 'T1', roster: [{ proTeamId: 1, slot: 0 }, { proTeamId: 3, slot: 12 }, { proTeamId: 3, slot: 13 }, { proTeamId: 4, slot: 5 }] }];
const [r] = playersPerDay(teams, pro, [1, 2]);
assert.deepEqual(r.perDay, [3, 2], 'injured reserve never counts');
assert.equal(r.total, 5);
assert.equal(r.best, 0);
console.log('Schedule tests passed');
