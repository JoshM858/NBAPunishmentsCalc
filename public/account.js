// Who is using the site. With team PINs on, the server remembers the team (signed cookie); without them the
// choice is just remembered in this browser. Pages ask `team()` and re-render when `onChange` fires.
export function createAccount({ data }) {
  const st = { me: null, pins: false, pending: null, pinError: '' };
  const listeners = new Set();
  const league = () => data().ctx.league;
  const known = (id) => league().teams.some((t) => t.id === id);
  const key = () => `pw:me:${data().ctx.cfg.leagueId ?? 'site'}`;
  const changed = () => listeners.forEach((fn) => fn(st.me));

  async function serverMe() {
    try {
      const id = (await (await fetch('api/me', { cache: 'no-store' })).json()).teamId;
      return known(id) ? id : null;
    } catch {
      return null;
    }
  }

  function localMe() {
    try {
      const id = Number(localStorage.getItem(key()));
      return known(id) ? id : null;
    } catch {
      return null;
    }
  }

  function setMe(id) {
    st.me = id;
    try {
      if (id == null) localStorage.removeItem(key());
      else localStorage.setItem(key(), String(id));
    } catch {}
    changed();
  }

  return {
    state: st,
    team: () => (st.me == null || !data().ctx ? null : league().teams.find((t) => t.id === st.me) ?? null),
    onChange: (fn) => listeners.add(fn),
    // Called after every (re)load of the league
    async reset(pins) {
      const before = st.me;
      st.pins = Boolean(pins);
      st.me = st.pins ? await serverMe() : localMe();
      if (st.me !== before) changed();
    },
    // A team was chosen: with PINs ask for the PIN first, otherwise sign in straight away
    choose(id) {
      if (st.pins) {
        st.pending = id;
        st.pinError = '';
        changed();
      } else setMe(id);
    },
    async signInWithPin(id, pin) {
      st.pinError = '';
      try {
        const res = await fetch('api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamId: id, pin }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) st.pinError = body.error || 'Couldn’t sign in. Try again.';
        else {
          st.pending = null;
          st.me = id;
        }
      } catch {
        st.pinError = 'Couldn’t reach the server. Try again.';
      }
      changed();
    },
    async signOut() {
      if (st.pins) await fetch('api/logout', { method: 'POST' }).catch(() => {});
      st.pending = null;
      st.pinError = '';
      setMe(null);
    },
  };
}
