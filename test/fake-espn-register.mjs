// `node --import ./test/fake-espn-register.mjs script.mjs` runs a script against the fake ESPN.
// FAKE_ESPN_MODE=private requires cookies; FAKE_ESPN_SCHEDULE=1 adds ESPN's matchup feed; FAKE_ESPN_LOG=file logs requests.
import { appendFileSync } from 'node:fs';
import { installFakeEspn } from './fake-espn.mjs';

const fake = installFakeEspn({ mode: process.env.FAKE_ESPN_MODE || 'ok', withSchedule: process.env.FAKE_ESPN_SCHEDULE === '1' });
if (process.env.FAKE_ESPN_LOG) {
  const inner = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const res = await inner(...args);
    appendFileSync(process.env.FAKE_ESPN_LOG, `${new URL(String(args[0])).search}\n`);
    return res;
  };
}
void fake;
