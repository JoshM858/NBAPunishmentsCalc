// First-visit agreement: you cannot use the site until you accept that you will complete any punishment the league
// gives you. Saved in this browser (a social agreement among friends, not a legal one).
const KEY = 'pw:agreed';

export function hasAgreed() {
  try {
    return Boolean(localStorage.getItem(KEY));
  } catch {
    return false;
  }
}

export function agreedOn() {
  try {
    const t = Number(localStorage.getItem(KEY));
    return t ? new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  } catch {
    return null;
  }
}

// Shows the blocking agreement; calls onDone after the manager accepts. There is deliberately no close button.
export function openAgreement({ onDone = () => {} } = {}) {
  document.getElementById('agree-modal')?.remove();
  const root = document.createElement('div');
  root.id = 'agree-modal';
  root.className = 'modal-back';
  root.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="ag-title" aria-describedby="ag-text">
    <header><h2 id="ag-title">The punishment pact</h2></header>
    <p id="ag-text" class="lede">Every week the team with the lowest score gets a punishment. By pressing <b>I accept</b> you agree, fully and without arguing, that if your team finishes last in any week you will complete the punishment the league gives you, whatever it is, and on time.</p>
    <p class="note">No accept, no entry. Your acceptance is remembered on this device.</p>
    <footer><span class="grow"></span><button type="button" class="btn primary" data-accept>I accept</button></footer>
  </div>`;
  document.body.append(root);
  const btn = root.querySelector('[data-accept]');
  btn.focus();
  root.addEventListener('keydown', (e) => e.key === 'Tab' && (e.preventDefault(), btn.focus())); // keep focus on the only button
  btn.addEventListener('click', () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {}
    root.remove();
    onDone();
  });
}
