# Punishment Watch

Weekly leaderboard for an ESPN fantasy basketball points league. ESPN's season points never reset, so this rebuilds each week from 0 by summing every day's team score, then shows who's last and projects who cops the punishment.

- **This week**: standings from 0, today's live points, projected final, games and players left, chance of finishing last
- **Day recap**: yesterday's movers, day scores, player and dud of the day, rest-of-week outlook
- **Shame**: every finished week's last-place team and a running tally

You don't need to be league manager. Any league member's login can read the league. If the manager turns on **Make league viewable to public** in league settings, no login is needed at all.

There are three ways to run it. They share the same page and the same scoring code (`public/logic.js`).

| | Where it runs | Data | Needs |
|---|---|---|---|
| **PC** | `npm start` on your computer | live, fetched when you open or refresh | Node 18+ |
| **GitHub Pages** | free static site | a snapshot rebuilt every hour by GitHub Actions | a GitHub repo |
| **Cloudflare** | a Worker | live | a Cloudflare account |

## Get your league ID, season and cookies

- **`LEAGUE_ID`**: open your league on fantasy.espn.com. The link looks like `.../basketball/league?leagueId=12345678`. The number is the ID.
- **`SEASON`**: ESPN names NBA seasons by the year they end, so 2026-27 is `2027`.
- **Cookies** (skip if the league is viewable to the public): on a computer where you're logged in to fantasy.espn.com, press F12, then **Application** (Chrome/Edge) or **Storage** (Firefox), then **Cookies**, then `https://fantasy.espn.com`. Copy the values of `espn_s2` (a very long string) and `SWID` (looks like `{XXXXXXXX-XXXX-...}`, keep the braces). Paste them as they are, URL-encoded characters and all.

Treat the cookies like a password. They stop working if you log out of ESPN in that browser or change your password; copy them again if you see "cookies have probably expired".

## PC (local)

Needs [Node](https://nodejs.org) 18 or newer. No `npm install` is required.

```bash
cp .env.example .env     # Windows: copy .env.example .env
npm start                # http://localhost:8787
```

Open `.env` in any text editor and fill in `LEAGUE_ID`, `SEASON`, and (private leagues only) `ESPN_S2` and `ESPN_SWID`. Restart `npm start` after changing it.

`.env` is git-ignored. The server only listens on your own computer, and your cookies never reach the browser. Open `http://localhost:8787/?demo` to see the page with fake data.

Check that the maths lines up with ESPN, from the terminal:

```bash
npm run check
```

It prints the shape of ESPN's data, rebuilds the weekly points from every finished day, and compares each team with ESPN's season total (ESPN's own total only counts finished days, so today's games are left out of that comparison). `GREEN` means they all match. Without the terminal: scroll to the page footer and press **Check against ESPN season totals**.

## GitHub (GitHub Pages)

GitHub Pages is static, so it can't hold secrets or call ESPN from the browser. Instead a GitHub Action runs every hour, fetches ESPN using your secrets, saves a snapshot as `data/snapshot.json`, and publishes it with the site. The page reads that snapshot, shows when it was generated, and **Refresh** reloads the latest one.

1. Put this project in a GitHub repository whose default branch is `main` (the workflow also runs on pushes to `main`).
2. **Settings, then Secrets and variables, then Actions, Secrets tab**: add `ESPN_S2` and `ESPN_SWID` (skip both for a public league).
3. Same page, **Variables tab**: add `LEAGUE_ID` and `SEASON` (for example `2027`), and optionally `WEEK_START` (default `Tuesday`) and `HIDE_TEAMS` (team IDs, abbreviations or names, comma-separated, for anyone who left the comp; hidden teams are left out of the published data too).
4. **Settings, then Pages**: set **Source** to **GitHub Actions**.
5. **Actions tab, then Build and deploy, then Run workflow**. When it finishes (a minute or two) the site is at `https://<your-username>.github.io/<repo-name>/`.

From then on it rebuilds at about 7 minutes past every hour. GitHub's scheduler can run late, and it pauses scheduled workflows after 60 days with no repository activity (re-enable in the Actions tab). If the data gets more than 3 hours old the page shows a warning, and a failed run (for example expired cookies) emails you and leaves the last good version live.

Things to know:

- **The published site is public**, even from a private repository: anyone with the link can see team names, owners' first names and scores. The cookies are not published: they exist only as Actions secrets, and the build refuses to write a snapshot if a cookie value shows up in it.
- The snapshot holds the league, the NBA schedule, per-day lineups for this week's finished days plus yesterday (for the recap), and each finished day's team totals (for the Shame tab and the totals check). Days older than yesterday are cached between runs so ESPN isn't asked for them again.
- To build the site on your own computer: `npm run snapshot` writes `_site/` (needs `.env`). Serve that folder with any static server to preview it.

## Cloudflare

**From the browser (no installs)**

1. Sign in at dash.cloudflare.com (free account).
2. Workers & Pages, then Create, then start from the Hello World Worker, name it, Deploy.
3. Edit code, replace everything in `worker.js` with `dist/worker-dashboard.js`, Deploy.
4. Worker settings, then Variables and Secrets, add:
   - `LEAGUE_ID` (text) and `SEASON` (text, `2027`)
   - `ESPN_S2` and `ESPN_SWID` (secrets, skip if the league is public)
   - `WEEK_START` (text, optional): the day weeks start in US Eastern time, default `Tuesday`
   - `HIDE_TEAMS` (text, optional): team IDs, abbreviations or names to leave off, comma-separated
5. Open the `workers.dev` link. Press **Check against ESPN season totals** in the footer.

**With Wrangler (needs Node)**: set `LEAGUE_ID` in `wrangler.jsonc`, then `npm install`, `npx wrangler login`, `npx wrangler secret put ESPN_S2`, `npx wrangler secret put ESPN_SWID`, `npm run deploy`. For `npm run dev`, copy `.dev.vars.example` to `.dev.vars`.

After editing anything in `public/` or `src/`, run `npm run build:dashboard` to regenerate `dist/worker-dashboard.js`.

## How it works

- `src/api.js` proxies ESPN's own league API (the data the ESPN site loads), only for whitelisted views, with cookies kept server-side. The same file runs in the local server, the Cloudflare Worker and the snapshot build.
- `public/pipeline.js` loads a league through a data source (the `/api` routes, or a snapshot) and rebuilds each day's team score. If the league has a matchup feed it uses that; otherwise it reads each day's lineup and only counts players in starting slots (bench and IR don't score).
- Each ESPN scoring period is one US Eastern calendar day. **Weeks run Tuesday to Monday** (US Eastern, so they end during Tuesday morning in Australia), starting with the Tue 20 Oct opener, unless you set `WEEK_START` to another day, or ESPN's own matchup periods look like real weeks, in which case those are used. The footer says which.
- The Day recap shows the current US game day "so far" while its games are being played, with a switch to the last finished day. ESPN keeps a day as current for hours after its last game, so the app treats a day as finished 3.5 hours after its last tip-off, and then recaps it as final.
- Projection and odds: the rest of the week is simulated 4,000 times. Each player has an uncertain true scoring level (more uncertain early in the season), may miss games (ESPN's injury status sets the chance; healthy players still sit about 8% of games, and a miss tends to repeat the next game), and scores a noisy amount when he plays. Today uses the lineup as set; later days assume the best starters by expected points, chosen before knowing who sits. Each manager also gets a lineup-quality luck factor for the week. Expected points blend season average, last 15 days and ESPN's preseason projection while the sample is small. The odds are the share of simulations where each team finishes last.
- Honest odds: `npm run backtest` replays every finished week using only what was known each morning and prints how far off the projections were. An rms z near 1.0 means the stated uncertainty matches reality; the first version scored 2.4 (far too confident), the current one about 1.2. Tight races will still be near toss-ups; that is the model being honest, not wrong. Not yet modelled: positions, games in progress, and ESPN's pre-game inactive lists.

## Troubleshooting

- **"This league is private and no ESPN login is set"**: add the cookies, or ask the manager to make the league viewable to the public.
- **"The cookies have probably expired"**: copy `espn_s2` and `SWID` again. Also check that the ESPN account is a member of this league.
- **"ESPN couldn't find league…"**: wrong `LEAGUE_ID`, or `SEASON` isn't the year the season ends.
- **Totals don't match**: add `?source=roster` to the URL to force the lineup-based method, and run `npm run check -- --roster`.
- **GitHub run fails**: open the run in the Actions tab. The error names the missing secret or variable, or the ESPN problem.

## Season-long points leagues

ESPN reports this league type (`TOTAL_SEASON_POINTS`) with no weekly matchups and one meaningless matchup period, so the page ignores it and uses 7-day weeks starting on `WEEK_START` (Tuesday unless you change it). Head-to-head leagues that have real weekly matchup periods use those instead, and read daily team scores from ESPN's matchup feed when it has them.

## Tests

```bash
npm test
```

Covers the scoring logic, the week simulation, a guard that the loser odds stay calibrated against a real replayed week (including a real ESPN NBA schedule and an anonymised real league captured with `npm run capture`), the ESPN error handling, the snapshot build (secrets never published, caching, hidden teams) and the Cloudflare bundle. All offline.
