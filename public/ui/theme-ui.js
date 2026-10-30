// The colour chooser: pick how many colours (1-3), then set each one with a colour wheel, a native colour picker or a
// hex code. All three controls for a colour are on screen together and stay in step. The theme previews live and is
// saved in this browser (see theme.js). Shown automatically the first time the site is opened.
import { DEFAULT_THEME, ROLES, applyTheme, hexToHsl, hslToHex, loadTheme, normalizeHex, resetTheme, resolveTheme, saveTheme } from '../theme.js';
import { esc } from './dom.js';

const PRESETS = [
  ['Court yellow', ['#e8f02a', '#c8d51e', '#e8f02a'], 2],
  ['Electric blue', ['#3d8bff', '#2c6bd1', '#7fd0ff'], 3],
  ['Ember', ['#ff7a2f', '#d95f1a', '#ffd166'], 3],
  ['Mint', ['#3ddc97', '#2bb27a', '#e8f02a'], 3],
  ['Magenta', ['#ff4fa3', '#d93c86', '#ffd1e8'], 3],
];

export function openThemeChooser({ firstRun = false, onDone = () => {} } = {}) {
  document.getElementById('theme-modal')?.remove();
  const saved = loadTheme();
  const before = saved || resolveTheme(DEFAULT_THEME);
  const draft = { count: before.count, colors: [...before.colors] };
  const live = () => applyTheme(draft);

  const root = document.createElement('div');
  root.id = 'theme-modal';
  root.className = 'modal-back';
  root.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="tm-title">
    <header><h2 id="tm-title">${firstRun ? 'Make it yours' : 'Colours'}</h2><button type="button" class="link" data-x="close" aria-label="Close">✕</button></header>
    <p class="lede">${firstRun ? 'Choose how many colours you want, then pick them. You can change this any time from the Colours button.' : 'Change the site colours. Everything updates as you go.'}</p>
    <div class="tm-row"><span class="field-l">How many colours?</span><div class="seg" role="group" aria-label="Number of colours">${[1, 2, 3].map((n) => `<button type="button" data-count="${n}" aria-pressed="${draft.count === n}">${n}</button>`).join('')}</div></div>
    <div class="tm-presets">${PRESETS.map(([name, cols, count], i) => `<button type="button" class="tm-preset" data-preset="${i}" title="${esc(name)}"><i style="background:${cols[0]}"></i>${count > 1 ? `<i style="background:${cols[1]}"></i>` : ''}${count > 2 ? `<i style="background:${cols[2]}"></i>` : ''}<span>${esc(name)}</span></button>`).join('')}</div>
    <div class="tm-slots">${ROLES.map((role, i) => `<section class="tm-slot" data-role="${i}">
        <h3>${i + 1}. ${role}</h3>
        <div class="tm-wheel" data-wheel="${i}" tabindex="0" role="slider" aria-label="${role} hue and saturation"><i class="tm-dot"></i></div>
        <label class="tm-light">Light<input type="range" min="8" max="92" data-light="${i}" aria-label="${role} lightness"></label>
        <div class="tm-inputs"><input type="color" data-native="${i}" aria-label="${role} colour picker"><input type="text" data-hex="${i}" maxlength="7" spellcheck="false" aria-label="${role} hex code"><span class="tm-sw" data-sw="${i}"></span></div>
      </section>`).join('')}</div>
    <footer><button type="button" class="btn ghost" data-x="reset">Reset to default</button><span class="grow"></span><button type="button" class="btn" data-x="cancel">${firstRun ? 'Skip' : 'Cancel'}</button><button type="button" class="btn primary" data-x="save">Save colours</button></footer>
  </div>`;
  document.body.append(root);

  const q = (sel) => root.querySelector(sel);
  const slots = [...root.querySelectorAll('.tm-slot')];

  function syncSlot(i) {
    const hex = draft.colors[i];
    const [h, s, l] = hexToHsl(hex);
    const dot = q(`[data-wheel="${i}"] .tm-dot`);
    const r = s * 50; // percent of the radius
    dot.style.left = `${50 + r * Math.cos((h * Math.PI) / 180)}%`;
    dot.style.top = `${50 + r * Math.sin((h * Math.PI) / 180)}%`;
    dot.style.background = hex;
    q(`[data-light="${i}"]`).value = Math.round(l * 100);
    q(`[data-native="${i}"]`).value = hex;
    const hx = q(`[data-hex="${i}"]`);
    if (document.activeElement !== hx) hx.value = hex;
    q(`[data-sw="${i}"]`).style.background = hex;
  }

  function sync() {
    for (const b of root.querySelectorAll('[data-count]')) b.setAttribute('aria-pressed', String(Number(b.dataset.count) === draft.count));
    slots.forEach((el, i) => {
      el.hidden = i >= draft.count;
      syncSlot(i);
    });
    // Colours not in use are derived, so the preview matches what would be saved
    live();
  }

  const setColour = (i, hex) => {
    const n = normalizeHex(hex);
    if (!n) return;
    draft.colors[i] = n;
    // With one colour the others follow it, so the secondary and highlight inputs stay sensible if shown later
    sync();
  };

  // Wheel: angle is hue, distance from the centre is saturation, the slider sets lightness
  function fromWheel(i, e) {
    const rect = q(`[data-wheel="${i}"]`).getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    const l = Number(q(`[data-light="${i}"]`).value) / 100;
    setColour(i, hslToHex(h, s, l));
  }
  let dragging = null;
  root.addEventListener('pointerdown', (e) => {
    const w = e.target.closest('[data-wheel]');
    if (!w) return;
    dragging = Number(w.dataset.wheel);
    w.setPointerCapture?.(e.pointerId);
    fromWheel(dragging, e);
  });
  root.addEventListener('pointermove', (e) => dragging != null && fromWheel(dragging, e));
  root.addEventListener('pointerup', () => (dragging = null));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close(true);
    const w = e.target.closest?.('[data-wheel]');
    if (w && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const i = Number(w.dataset.wheel);
      const [h, s, l] = hexToHsl(draft.colors[i]);
      const dh = e.key === 'ArrowRight' ? 8 : e.key === 'ArrowLeft' ? -8 : 0;
      const ds = e.key === 'ArrowUp' ? 0.06 : e.key === 'ArrowDown' ? -0.06 : 0;
      setColour(i, hslToHex((h + dh + 360) % 360, Math.min(1, Math.max(0, s + ds)), l));
    }
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.light != null) {
      const i = Number(t.dataset.light);
      const [h, s] = hexToHsl(draft.colors[i]);
      setColour(i, hslToHex(h, s, Number(t.value) / 100));
    } else if (t.dataset.native != null) setColour(Number(t.dataset.native), t.value);
    else if (t.dataset.hex != null) setColour(Number(t.dataset.hex), t.value); // ignored until it is a full colour
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) {
      if (e.target === root) close(true);
      return;
    }
    if (b.dataset.count) { draft.count = Number(b.dataset.count); sync(); }
    else if (b.dataset.preset) {
      const [, cols, count] = PRESETS[Number(b.dataset.preset)];
      draft.colors = [...cols];
      draft.count = count;
      sync();
    } else if (b.dataset.x === 'reset') {
      draft.count = DEFAULT_THEME.count;
      draft.colors = [...DEFAULT_THEME.colors];
      sync();
    } else if (b.dataset.x === 'save') close(false);
    else if (b.dataset.x === 'cancel' || b.dataset.x === 'close') close(true);
  });

  function close(cancel) {
    if (cancel) {
      // Put things back; on first run "Skip" keeps the default and remembers the choice so this isn't shown again
      applyTheme(before);
      if (firstRun) saveTheme(DEFAULT_THEME);
    } else saveTheme(draft);
    root.remove();
    onDone(!cancel);
  }

  sync();
  q('[data-count][aria-pressed=true]')?.focus();
  return root;
}

// Apply the saved theme at start-up; true when none has been saved yet (a first visit)
export function startTheme() {
  const saved = loadTheme();
  if (saved) applyTheme(saved);
  return !saved;
}

export { resetTheme };
