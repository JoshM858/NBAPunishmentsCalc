// Follow every relative import (and the stylesheets in index.html) from the page, like a browser would.
// `fetchText(path)` returns { status, text } for a site path such as "/app.js".
export async function crawlSite(fetchText) {
  const seen = new Map();
  const queue = ['/app.js'];
  const home = await fetchText('/');
  for (const m of home.text.matchAll(/(?:href|src)="((?!https?:|data:)[^"#?]+\.(?:css|js))"/g)) queue.push(`/${m[1]}`);
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    const { status, text } = await fetchText(path);
    seen.set(path, status);
    if (!path.endsWith('.js') || status !== 200) continue;
    for (const m of text.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) queue.push(new URL(m[1], `http://x${path}`).pathname);
  }
  return seen;
}
