// Terms (including the punishment pact), Privacy policy and what the site stores. Plain language, kept short.
// This is a friendly agreement among a league of friends, not legal advice.
const DOCS = {
  terms: ['Terms and punishment pact', `
    <h4>The punishment pact</h4>
    <p>Each week the team with the lowest score receives a punishment from the league. By accepting, you agree that if your team finishes last in any week you will complete that punishment, whatever it is, in full and on time, and you won't dispute the result as the site calculates it from ESPN's scores.</p>
    <h4>Using the site</h4>
    <p>The site is a private tool for one fantasy league. Its odds, ratings and advice are estimates, not promises. It cannot make trades or change lineups: do that in ESPN. Don't try to overload it, bypass the refresh limit or sign in as another manager.</p>
    <h4>Changes</h4>
    <p>The league organiser may update these terms. You may be asked to accept again.</p>`],
  privacy: ['Privacy policy', `
    <h4>What we collect</h4>
    <p>No accounts, no email addresses, no advertising and no analytics. The site shows data that ESPN already shows to the league. If team PINs are on, your PIN is only checked on the server; the site does not save it or send it anywhere else.</p>
    <h4>What is stored</h4>
    <p><b>In your browser:</b> which team you are, your colour choice, that you accepted the pact (and when), a short-lived copy of finished days to load faster, and the page files so the app opens quickly. <b>On the server:</b> if you use the Trade block, the lists you save (players, positions, a note) with your team number, and, with PINs on, a signed sign-in cookie called <code>pw_team</code> that keeps you signed in for 90 days. To rate-limit the Refresh button the server briefly remembers your team or your network address for a few seconds.</p>
    <h4>Other services</h4>
    <p>Your browser loads fonts from Google Fonts and player and team pictures from ESPN's image servers, and the server asks ESPN for league data. Those services see the usual connection details (such as your network address) as with any website.</p>
    <h4>Your choices</h4>
    <p>Clear this site's data in your browser settings to remove everything stored on your device (you will be asked to accept again). Ask the organiser to delete your saved Trade block lists.</p>`],
  storage: ['Cookies and storage', `
    <p>The site uses browser storage (not tracking cookies) for the items listed in the Privacy policy. The only cookie is <code>pw_team</code>, set only when team PINs are on, marked HttpOnly, and used only to know which team you are.</p>`],
};

export function openLegal(which = 'terms') {
  document.getElementById('legal-modal')?.remove();
  const root = document.createElement('div');
  root.id = 'legal-modal';
  root.className = 'modal-back';
  root.style.zIndex = 120;
  const draw = (k) => {
    root.innerHTML = `<div class="modal legal" role="dialog" aria-modal="true" aria-labelledby="lg-title">
      <header><h2 id="lg-title">${DOCS[k][0]}</h2><button type="button" class="link" data-x aria-label="Close">✕</button></header>
      <div class="seg" role="group" aria-label="Document">${Object.entries(DOCS).map(([id, [t]]) => `<button type="button" data-doc="${id}" aria-pressed="${id === k}">${t.split(' ')[0]}</button>`).join('')}</div>
      <div class="legal-body">${DOCS[k][1]}</div>
      <footer><span class="grow"></span><button type="button" class="btn primary" data-x>Close</button></footer></div>`;
  };
  draw(which);
  root.addEventListener('click', (e) => {
    const d = e.target.closest('[data-doc]');
    if (d) return draw(d.dataset.doc);
    if (e.target === root || e.target.closest('[data-x]')) root.remove();
  });
  root.addEventListener('keydown', (e) => e.key === 'Escape' && root.remove());
  document.body.append(root);
  root.querySelector('[data-x].btn')?.focus();
}
