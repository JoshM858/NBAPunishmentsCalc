// The same data source the browser uses, but calling the ESPN proxy in-process (for CLI scripts).
import { handleApi } from './api.js';
import { createApiSource } from '../public/sources.js';

export function createDirectSource(env) {
  const get = async (path) => {
    const res = await handleApi(new Request(`http://local/${path}`), { ...env, PLATFORM: 'local', REFRESH_SECONDS: 0 }, { waitUntil() {} });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status}).`);
    return body;
  };
  return createApiSource(get);
}
