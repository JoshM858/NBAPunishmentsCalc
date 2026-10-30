// Hash router. Routes look like #/players/123?pos=PG. Old links (#week, #recap, #shame, #trade) still work.
const LEGACY = { week: '/dashboard', recap: '/matchups/recap', shame: '/league/punishments', trade: '/transactions/trade' };

export function parseHash(hash = location.hash) {
  let h = hash.replace(/^#/, '');
  if (LEGACY[h]) h = LEGACY[h];
  if (!h.startsWith('/')) h = `/${h}`;
  const [path, query = ''] = h.split('?');
  const [section = '', tab = '', ...rest] = path.split('/').filter(Boolean);
  return { section: section || 'dashboard', tab, rest, query: new URLSearchParams(query), path };
}

export const link = (section, tab = '', rest = '') => `#/${[section, tab, rest].filter(Boolean).join('/')}`;

export function onRoute(fn) {
  const go = () => fn(parseHash());
  window.addEventListener('hashchange', go);
  return go;
}

export function navigate(path) {
  if (location.hash === path) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = path;
}

// Update the query part (filters) without adding history entries or re-rendering the page
export function setQuery(route, values) {
  const q = new URLSearchParams(route.query);
  for (const [k, v] of Object.entries(values)) v == null || v === '' ? q.delete(k) : q.set(k, v);
  const s = q.toString();
  history.replaceState(null, '', `${location.pathname}${location.search}#${route.path}${s ? `?${s}` : ''}`);
}
