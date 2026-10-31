# Punishment Watch

Weekly leaderboard for an ESPN fantasy basketball points league. ESPN's season points never reset, so this rebuilds each week from 0 by summing every day's team score, then shows who's last and projects who cops the punishment.

The site is laid out like a front office, dark and dense, with seven sections along the top:

- **Dashboard**: who is on track for the punishment, with a **confidence** meter on the percentage and an **O-SHIT meter** for how much trouble that team is in, the week's leaderboard, the game-day card, best free agents, hot players and the injury report
- **My Team**: your lineup by slot with each player's game that day (opponent, tip-off in your time zone, expected points), and the best lineup with the swaps that get you there (advice only; ESPN has no way for other apps to set a lineup). It **moves to the next game day by itself** once the current day's games are all finished. **Next** and **Next week** step forward through the season; **Back** goes only as far as the day before today, which shows who started and what they scored
- **Players**: the full player pool in a 2K-style picker (showcase panel plus a sortable, filterable table), **Free agents** with waiver-wire sorts (best ranked, recent form, most improved, games this week), **Compare** for up to four players, and a **profile** for every player (form, consistency, game log, per-game stats, upcoming games and projection)
- **League**: season standings (points, weeks won, punishments), the punishment history and the draft board with the best and worst picks so far
- **Transactions**: the **Trade centre** (side-by-side lineups, stars, multi-way, simulate odds, why), the **Trade finder**, the **Trade block** (every manager's target list, trading block and untouchables) and the **Activity** feed
- **Matchups**: day recap (live "so far" and final), rest-of-week outlook, and the week's NBA schedule with how many of your players play each day
- **Analytics**: season race, points by week, roster depth, hidden gems on the wire and the player market, each chart explained in a line

Old links (`#week`, `#recap`, `#shame`, `#trade`) still land in the right place. The **Colours** button (it also opens by itself on a first visit) lets each person choose how many theme colours to use, one to three, and set each with a colour wheel, a colour picker or a hex code at the same time. It is saved in that browser only.

You don't need to be league manager. Any league member's login can read the league. If the manager turns on **Make league viewable to public** in league settings, no login is needed at all.

There are three ways to run it. They share the same page and the same scoring code (`public/logic.js`).

| | Where it runs | Data | Needs |
|---|---|---|---|
| **PC** | `npm start` on your computer | live, fetched when you open or refresh | Node 18+ |
| **GitHub Pages** | free static site | a snapshot rebuilt every hour by GitHub Actions | a GitHub repo |
| **Cloudflare** | a Worker | live | a Cloudflare account |

## Get your league ID, season and cookies

**For this league you can skip this:** the league ID (823721722) and hiding team 3 are built in, so there is nothing to type on the PC, Cloudflare or GitHub versions. Set `LEAGUE_ID` or `HIDE_TEAMS` only to change them (a blank `HIDE_TEAMS` hides nobody). Cookies are still needed only if the league becomes private.

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
3. Same page, **Variables tab**: add `LEAGUE_ID` and `SEASON` (for example `2027`), and optionally `TIMEZONE` (default `Australia/Melbourne`), `WEEK_START` (default `Tuesday`) and `HIDE_TEAMS` (team IDs, abbreviations or names, comma-separated, for anyone who left the comp; hidden teams are left out of the published data too).
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
   - `TIMEZONE` (text, optional): time zone for game times, default `Australia/Melbourne`
   - `WEEK_START` (text, optional): the day weeks start in US Eastern time, default `Tuesday`
   - `HIDE_TEAMS` (text, optional): team IDs, abbreviations or names to leave off, comma-separated
5. Open the `workers.dev` link. Press **Check against ESPN season totals** in the footer.

**Check it in Cloudflare's real runtime before deploying**: `npm install`, then `npm run check:cloudflare`. It runs both the pasted bundle and the Wrangler setup in `workerd` (the engine Cloudflare uses) against live ESPN and checks every page and API route. It cannot enforce Cloudflare's free-plan CPU limit, so the slow routes (injuries, free agents, scoreboard) cache their trimmed answers to keep CPU use small.

**With Wrangler (needs Node)**: set `LEAGUE_ID` in `wrangler.jsonc`, then `npm install`, `npx wrangler login`, `npx wrangler secret put ESPN_S2`, `npx wrangler secret put ESPN_SWID`, `npm run deploy`. For `npm run dev`, copy `.dev.vars.example` to `.dev.vars`.

After editing anything in `public/` or `src/`, run `npm run build:dashboard` to regenerate `dist/worker-dashboard.js`.

## How it works

- `src/api.js` proxies ESPN's own league API (the data the ESPN site loads), only for whitelisted views, with cookies kept server-side. The same file runs in the local server, the Cloudflare Worker and the snapshot build.
- `public/pipeline.js` loads a league through a data source (the `/api` routes, or a snapshot) and rebuilds each day's team score. If the league has a matchup feed it uses that; otherwise it reads each day's lineup and only counts players in starting slots (bench and IR don't score).
- Each ESPN scoring period is one US Eastern calendar day. **Weeks run Tuesday to Monday** (US Eastern, so they end during Tuesday morning in Australia), starting with the Tue 20 Oct opener, unless you set `WEEK_START` to another day, or ESPN's own matchup periods look like real weeks, in which case those are used. The footer says which.
- The Day recap shows the current US game day "so far" while its games are being played, with a switch to the last finished day. ESPN keeps a day as current for hours after its last game, so the app treats a day as finished 3.5 hours after its last tip-off, and then recaps it as final.
- Game day card: shows when the US game day starts, when it likely finishes (last tip-off plus 2.5 hours) and whether it's finished, in **Victoria time** (`Australia/Melbourne`, set `TIMEZONE` to change it). It asks ESPN's live scoreboard whether the games are final; if that can't be reached it estimates from the clock and marks the line "estimated". When all games are final the Day recap switches to that day's final results.
- Projection and odds: the rest of the week is simulated 4,000 times. Each player has an uncertain true scoring level (more uncertain early in the season), may miss games (ESPN's injury status sets the chance; healthy players still sit about 8% of games, and a miss tends to repeat the next game), and scores a noisy amount when he plays. Today uses the lineup as set; later days assume the best starters by expected points, chosen before knowing who sits. Each manager also gets a lineup-quality luck factor for the week. A player's expected points when he plays are his games so far pulled toward ESPN's preseason projection (16 games of weight), which tested better than the raw average. The odds are the share of simulations where each team finishes last.
- Honest odds: `npm run backtest` replays every finished week using only what was known each morning and prints how far off the projections were. An rms z near 1.0 means the stated uncertainty matches reality; the first version scored 2.4 (far too confident), the current one about 1.2. Tight races will still be near toss-ups; that is the model being honest, not wrong. Not yet modelled: positions in the weekly odds, games in progress, and ESPN's pre-game inactive lists.

## Trade tab and the star rating

Your team fills the left side and the other teams are on the right. Tap a team and the screen becomes a workspace with your lineup on the left and theirs on the right, starting players, bench and injured reserve all on one screen with no scrolling (the header and tabs step out of the way until you press **Cancel**). Tick the players you would give and the players you would get, and the bar at the top rates the trade from 0.5 to 5 stars in half-star steps. **5 stars means too close to call; fewer stars mean one side clearly comes out ahead**, and it shows each team's gain in points a week. **Copy summary** copies a message for the group chat, and **Why & details** (or the small **why?** beside the numbers) explains them: for the trade you have ticked it shows each player's points a game when he plays, how often he plays, what that makes per team game, the games left and what he is worth above a free agent, and splits each team's gain into the swap in player value and the lineup fit. That is why two players who both score about 60 a game can rate differently: the first has played every game and the second has missed one, which is worth a few points a week. It also has the warnings (injuries, roster spots). It only judges a trade. Make the real one in ESPN.

**Simulate.** Press **Simulate** to see what the trade would do to the punishment odds. The bar shows who is projected to finish last now and after the trade, for the rest of this week and for a typical week from here on, and **Odds** opens a table of every team's chance of finishing last before and after, with their projected points. It updates as you change the trade. Points already scored this week stay with the team that scored them, and players who move start on their new team's bench today. Teams the trade does not touch get exactly the same random numbers in both runs, so a change in their numbers comes from the trade and not from luck.

**Multi-way trades.** Use the menu at the top (Multi-way trade) to add a third, fourth, up to a sixth team. Each ticked player then has a "goes to" menu so you decide where he ends up, which covers swaps in a circle or one team receiving from two others. Every team's gain is shown, and the rating compares the team that gains most with the team that gains least. A team you added but did not use is flagged. On a phone the extra teams sit side by side and you swipe across.

**Signing in.** By default "sign in" is just a team picker that remembers your team on that device. Everything on the site is already visible to the whole league, so there is nothing private to protect. If you want each team to need a PIN (Cloudflare or the PC version; GitHub Pages cannot check one):

1. Run `npm run pins`. It prints a random 6-digit PIN for each team and a `TEAM_PINS` line (like `1=482913,2=193846`). Nothing is saved, so copy it from the screen.
2. In Cloudflare, Settings, Variables and Secrets, add `TEAM_PINS` as a **secret** with that line (or put it in `.env` on a PC). Optionally add a secret `SESSION_SECRET` with any long random text.
3. Give each manager their PIN. Picking a team now asks for it. A correct PIN keeps that manager signed in on that device for 90 days.

Keep the PINs out of the code and out of GitHub: this repository's files are public to anyone who can see the repo. Changing `TEAM_PINS` or `SESSION_SECRET` signs everyone out. Be honest about what this is: a speed bump among friends, not bank security. After 5 wrong PINs a team is locked for ten minutes, but Cloudflare runs many copies of the Worker that do not share memory, so that limit is best-effort; 6 digits keeps guessing slow anyway. The PIN only controls who can use the signed-in Trade view as a team, since the league's scores and rosters stay public.

**Sending the trade.** Tick the players, then press **Copy trade summary** for a message to paste into the group chat. The app does not send trades into ESPN: ESPN has no official way to do that, and it would need each manager's own ESPN login. A link opens your league in ESPN.

How a trade is rated:

1. **A player's value** is the points he scores when he plays (his games so far, pulled toward ESPN's preseason projection as if it were 16 games of evidence) times how often he plays (pulled toward the league-wide rate of 70.5%).
2. **A team's value** is its best legal lineup (positions and the three UTIL slots) on every remaining game day, where an empty slot is filled by a free agent. The league's 6th best healthy free agent sets the replacement level. A player who is out starts at zero and drifts back to his usual rate.
3. **The gap** is each team's change in points a week after the trade. The winner is the side that gains more.
4. **The stars** (for any number of teams, using the gap between the best-off and worst-off team) come from how often the predicted winner really wins at that gap: `confidence = normalCdf(gap / (60 * sqrt(players moved)))`, `stars = 5 - 4.5 * (2 * confidence - 1)` rounded to the nearest half. The more players move, the less a given gap tells you.

Why this and not something simpler: `npm run backtest:trades` downloads last season's game logs and tests it. On 311 players, the shrunk estimate predicts a player's rest-of-season points per game with an error of about 8 points, against about 11 for the raw season average (and for the formula this app used before). On 3,024 simulated trades, adding up raw season averages picks the right winner 66% of the time; value over replacement picks it 72%. Adding the lineup positions did not beat the simple version on average, but it handles squeezes the simple version cannot (such as trading for a third centre you cannot start), so it is what the app uses. `npm run backtest:trades -- --multi` repeats the test on 3- and 4-team trades: on 3-team trades the predicted biggest winner really beat the predicted biggest loser 74% of the time, and the same scale holds (it is slightly cautious there). The star scale is calibrated on those trades: a gap under 10 points a week picks the winner barely better than a coin flip (about 55%), 20 to 40 points about 63%, 40 to 80 about 72%, and over 80 about 87%.

Injuries use ESPN's injury report, which gives an expected return date for each hurt player. Before that date he adds nothing; after it he ramps back over a few games. Short-term dates follow the next game's status, so they are fairly reliable; for long injuries they are ESPN's estimate, and when the write-up says there is no timetable the date is a placeholder, which the app flags as a guess. Without a date the older assumption applies (a player who is out drifts back over about 10 games). The return-date handling could not be backtested, because past injury reports are not published; the weekly odds and the trade rating share it.

Check how the stars hold up on your own league's real trades with `npm run score-trades`. It reads executed trades from ESPN, rates each one using only what was known that day, and shows who has come out ahead since. Your league has had no trades yet, so it prints that; the trade format ESPN uses is assumed from its other transaction types and is unconfirmed until the first real one. A handful of trades says little about calibration, so the star scale itself still comes from the last-season simulation.

Limits to know: injuries are the biggest unknown (a player's play rate misses by about 23 percentage points even when you know his history), so stars measure how sure we are, not a promise. The test used last season's data, and the free-agent list changes daily. Players you would receive who are currently out are flagged. Trades that need a team to drop players are flagged too.

## Make a team lose

On **Transactions, Trade finder**, switch to **Make a team lose**. Choose who benefits (you by default) and the team you want to finish last. It looks at trades for the beneficiary with every other team except the target, re-runs the punishment odds for each, and lists the ones that raise the target's chance of finishing last without costing the beneficiary points (more than 1.5 a week) or raising their own chance of last place (more than 2 points). Each result shows the target's and the beneficiary's last-place chance before and after. The effect is honestly small: a fair trade only makes its partner a little stronger, so when a team's fate is already settled the page says so and shows the closest trades instead. Settings are in `WISH` in `public/wishlose.js`.

## Terms and Conditions record

The first time someone opens the site they must pick their team (with their PIN if PINs are on) and answer **"Do you accept the Terms and Conditions?"**. The Terms include the punishment pact and sit behind links, with the Privacy policy, in `public/ui/legal.js` (edit the wording there; it is a friendly agreement among friends, not legal advice). Pressing **I accept** writes a record to the server with the team, the date and time, the terms version, the browser and a short one-way fingerprint of the network address. It is saved once per team, keeps its original time if repeated, and the site has no way to remove it, so nobody can back out. There is no decline or close button. The **League, Terms record** tab shows who has accepted and when. Raise `TERMS_VERSION` in `src/api.js` to make everyone accept again after changing the terms.

It uses the same storage as the Trade block (PC version works as is; on Cloudflare bind the `BOARD` KV namespace). **Turn on team PINs** so each record is PIN-verified: without them anyone could accept on behalf of a team and the record says "Not PIN-verified". Without any server storage (GitHub Pages) it can only remember the acceptance in that browser, so use the PC or Cloudflare version if you want a real record.

## Install it on your phone

Open the site in the phone's browser, then **Add to Home Screen** (iPhone: Share, Add to Home Screen; Android Chrome: menu, Install app). It opens full screen like an app, named **NBA Punishments**, with the icon in `public/icons/`. The logo is `public/icons/` (made from your picture); `docs/LOGO_PROMPT.md` has a prompt for ChatGPT to make a real logo and says which files to replace. The site only saves its page files for fast opening (`public/sw.js`); scores and odds are always fetched live, so they are never stale.

On a phone the top bar is just the name, the week and Refresh; the team chip sits at the end of the navigation row, **Change colours** is at the bottom of every page, and the Trade centre hides the small Ideas/Proj buttons (use a player's profile for the projection).

## Players, lineup advice and the meters

- **Where the player data comes from.** One request to ESPN's player pool (the 500 most-owned players, owned and free, with season, last 7/15/30 days, preseason projection, ownership, rank and the last five games), cached ten minutes and passed through unparsed so a free Cloudflare plan stays inside its CPU limit. Opening a profile asks for that one player's last 40 games and last season's line. Ages and sizes come from the 30 NBA team rosters, one small request per team, cached a day. On the GitHub version the pool and bios are baked into the snapshot every hour, so a profile there shows the last five games and no box scores.
- **Nothing is invented.** The percentile bars on a profile compare a player's real numbers with every player in the pool who has at least 3 games. ESPN's own rank is shown as ESPN's rank. There are no made-up attribute ratings.
- **Rank** is ESPN's rank among all players this season for your scoring. **Form** is the last 7 days against the season average. **Consistency** is the spread of his last games (lower is steadier).
- **Lineup advice** uses the trade rating's player values and lineup engine: it picks the starters that maximise expected points for the next game day with a game still to tip off, using each player's eligible slots. Players whose game has already started are locked where they are, injured-out and injured-reserve players never start.
- **Confidence meter** (on the Dashboard percentage): half is how much of the week's points are already scored, half is how lopsided the "last place" odds are (an entropy measure). It describes how settled the race is; it is not a statistical margin of error.
- **O-SHIT meter**: 50% the team's chance of finishing last, 30% how far behind the safest team it projects (against its own ups and downs), 20% how much of the week is locked in. 0 to 19 Chill, 20 to 39 Uneasy, 40 to 59 Sweating, 60 to 79 Panic, 80 and up O-SHIT.
- **League table.** This league scores total points and has no head-to-head, so ESPN reports no wins, losses or points against. Teams are ranked by season points; weeks won and punishments are counted from each finished week.

## Trade block

Each manager can post a **Target list** (up to 10 players on other teams), a **Trading block** (up to 10 of their own), **Untouchables** (up to 3), up to 5 positions they need and a short note. Everyone can see everyone's lists; only that team can edit its own (they sign in with their team PIN, see above). The Trade finder respects them: untouchables are never offered, and ideas say when a player is on a team's block or target list.

The lists need somewhere to be stored:

- **PC version**: works as is (saved in `.data/board.json`, git-ignored). With no PINs, any team can be edited from the PC version because only your own computer can reach it.
- **Cloudflare**: create a KV namespace and bind it to the Worker as `BOARD`. In the dashboard: Storage & Databases, KV, Create a namespace (any name), then Workers & Pages, your Worker, Settings, Bindings, Add, KV namespace, variable name `BOARD`. With Wrangler: `npx wrangler kv namespace create BOARD`, then paste the printed `kv_namespaces` block into `wrangler.jsonc` (an example is commented there). Also turn on team PINs, or nobody can save (the site refuses anonymous edits). KV is eventually consistent, so a saved list can take up to about a minute to show for other managers on the other side of the world.
- **GitHub Pages**: read-only, so the Trade block tab explains that it needs the PC or Cloudflare version.

## Troubleshooting

- **"This league is private and no ESPN login is set"**: add the cookies, or ask the manager to make the league viewable to the public.
- **"The cookies have probably expired"**: copy `espn_s2` and `SWID` again. Also check that the ESPN account is a member of this league.
- **"ESPN couldn't find league…"**: wrong `LEAGUE_ID`, or `SEASON` isn't the year the season ends.
- **Totals don't match**: add `?source=roster` to the URL to force the lineup-based method, and run `npm run check -- --roster`.
- **GitHub run fails**: open the run in the Actions tab. The error names the missing secret or variable, or the ESPN problem.

## Refresh limit

The Refresh button works once every 5 seconds. It is enforced on the server too, so it cannot be skipped by clicking faster or reloading: the limit is counted for each signed-in team (when team PINs are on) or for each device, and separately for each kind of data. Going over the limit is not an error: you get the latest cached data (never more than a minute or two old) with a note. Change it with `REFRESH_SECONDS` (0 turns it off). Automatic hourly refreshes are not affected.

## Season-long points leagues

ESPN reports this league type (`TOTAL_SEASON_POINTS`) with no weekly matchups and one meaningless matchup period, so the page ignores it and uses 7-day weeks starting on `WEEK_START` (Tuesday unless you change it). Head-to-head leagues that have real weekly matchup periods use those instead, and read daily team scores from ESPN's matchup feed when it has them.

## Tests

```bash
npm test
```

Covers the player pool parsing (a real ESPN pool fixture), lineup advice, standings, draft, activity, schedule, analytics and the colour theme maths, the confidence and O-SHIT meters, the API validation for the new routes, the scoring logic, the week simulation, a guard that the loser odds stay calibrated against a real replayed week (including a real ESPN NBA schedule and an anonymised real league captured with `npm run capture`), the ESPN error handling, the snapshot build (secrets never published, caching, hidden teams) and the Cloudflare bundle. All offline.
