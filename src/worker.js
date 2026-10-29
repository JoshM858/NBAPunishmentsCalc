// Wrangler deploy: static files come from ./public, /api/* goes to the ESPN proxy.
import { handleApi } from './api.js';

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    return pathname.startsWith('/api/') ? handleApi(request, env, ctx) : env.ASSETS.fetch(request);
  },
};
