# Benders Availability

A single-page availability grid for the C2 Benders — game dates down the side,
players across the top, click a cell to say who's playing.

No logins and no accounts. Works on its own out of the box; switch on
[team sync](#team-sync) and everyone marks their own row from their own phone,
without being able to mark anyone else's by accident.

| | |
|---|---|
| **Site** | https://bengrier.github.io/benders-scheduler/ |
| **Backend** | https://benders-availability.bengrier.workers.dev |
| **Status** | Team sync is **on**. |

## Using it

Click a cell to cycle through:

| | meaning |
|---|---|
| ✓ | **In** — playing |
| ✗ | **Out** — can't make it |
| ? | **Maybe** — unsure |
| _(blank)_ | hasn't answered |

Controls along the top:

- **Filter players** — type a few letters to narrow the columns.
- **I am** — with sync off, pick yourself and your column is highlighted. With
  sync on it's set by your personal link and locked, so it always matches the
  row you're allowed to edit.
- **Only my column** — hides everyone else, handy on a phone.
- **Games** — upcoming Benders games (default), the full Benders season, or
  every game in the division. Some Saturdays have two league games, so each row
  shows its start time.

The right-hand column counts confirmed skaters per game and flags games with no
goalie. The bottom row totals each player's games across the season.

### Weeks off

Every date on the league sheet gets a row, so the grid lines up with a calendar
instead of jumping over the gaps:

- **Bye week** (tinted) — the league plays but the Benders don't. Six of these.
- **No games — league off** (grey) — nobody plays. Eight of these, including the
  long Halloween-through-mid-November break.

The whole-division view skips the bye markers, since it already lists the games
the other teams are playing that night.

## Team sync

Off by default: the grid works on its own, saving to your browser, with every
column editable. Switch sync on and the whole team shares one live grid.

The pill under the title says where you stand:

| Pill | What you can do |
|---|---|
| **This browser only** | No sync. Marks stay on this device. |
| **Ben Grier — your row** | Mark your own row. Everyone else's is read-only. |
| **Captain — can edit any row** | Mark anyone, plus Import and Reset. |
| **Viewing only** | Read the grid. No personal link yet. |

Nobody signs in or creates an account. Each player opens a **personal link**
once; the browser remembers it. Because they can only write their own row,
nobody marks the wrong person by accident — and that's enforced by the server,
not just hidden in the interface. Your own column is drawn with rails down both
sides so it's obvious which one to tap on a phone.

### Already set up

Sync is live — the Worker is deployed, `TEAM_SECRET` is set in Cloudflare, and
[`config.js`](config.js) points at it. Nothing below needs doing again unless
you're rebuilding from scratch or moving to another Cloudflare account.

### How it was set up

The backend is the Cloudflare Worker in [`worker/`](worker/) — one Durable
Object holding the season. Free tier covers it many times over: Workers give
100,000 requests/day and the object's storage is a few kilobytes.

From the `worker/` directory:

```bash
npx wrangler deploy
```

Pick a team secret and set it (this is what player codes are derived from —
change it and every old link stops working):

```bash
npx wrangler secret put TEAM_SECRET
```

Put the deployed URL in [`config.js`](config.js) and commit:

```js
window.SYNC_URL = "https://benders-availability.bengrier.workers.dev";
```

Then generate everyone's personal link:

```bash
node scripts/make_links.mjs --out ~/Desktop/benders-player-links.txt
```

It prompts for the team secret (hidden, so it stays out of shell history) and
writes one link per player plus a captain link, owner-readable only. Drop
`--out` to print to the screen instead.

Text each player their own link. Opening it once claims their column — after
that the plain site URL works and remembers who they are.

The script resolves its own paths, so it runs from any directory; give it the
full path if you're not in the project folder. Pass a different site URL as the
first argument, or set `TEAM_SECRET` in the environment to skip the prompt.

**The links are credentials.** Each one can mark that player's row, and the
captain link can mark anyone and reset the whole season. `--out` refuses to
write inside this repo, since it's public, and `.gitignore` covers
`*links*.txt` as a second line of defence.

Anything already marked in a browser gets merged into the team grid the first
time it connects, so nothing is lost switching sync on.

### Local development

```bash
cd worker && npx wrangler dev --local
```

Put `TEAM_SECRET=whatever` in `worker/.dev.vars` (gitignored) and point
`SYNC_URL` at `http://127.0.0.1:8787`.

### Offline and conflicts

- Writes are per-cell, so two people marking at once never overwrite each other.
  The Durable Object handles one request at a time, so there's no lost update
  even if the whole team taps simultaneously.
- Marking something while offline — likely at the rink — keeps it locally, says
  so, and pushes it up automatically when the connection returns.
- The socket reconnects on its own with backoff.
- Last write wins if two people change *the same* cell, which only the captain
  can cause.

### Who can do what

| | Player link | Captain link | No link |
|---|---|---|---|
| Read the grid | ✓ | ✓ | ✓ |
| Mark own row | ✓ | ✓ | |
| Mark anyone's row | | ✓ | |
| Import / Reset / load a share link | | ✓ | |

Codes are an HMAC of the team secret and the player's key, so there's no list of
codes stored anywhere — `make_links.mjs` regenerates them whenever you need
them. Rotating `TEAM_SECRET` invalidates every link at once.

### Keeping it running

**Someone lost their link.** Re-run `make_links.mjs` with the same secret — the
codes are derived, not random, so you get the identical link back. Nothing to
reset.

**Someone's phone forgot who they are.** Same fix: send their link again.

**Adding or dropping a player.** Edit `C2 Benders Players.xlsx`, re-run
`python3 scripts/parse_excel.py`, commit, then re-run `make_links.mjs` and send
the new person their link. Everyone else's link is unchanged.

**Renaming a player.** Their key changes, which orphans their existing marks and
invalidates their old link. Avoid mid-season if you can.

**A link leaked, or someone left the team.** Set a new secret and reissue
everything:

```bash
cd worker && npx wrangler secret put TEAM_SECRET
```

Every existing link stops working the moment you do. Re-run `make_links.mjs`
with the new secret and send all 14 out again. No redeploy needed.

**Changing the Worker code.** `cd worker && npx wrangler deploy`. The season
data lives in the Durable Object and survives deploys.

**Is it alive?**

```bash
curl https://benders-availability.bengrier.workers.dev/health
```

Should return `{"ok":true,"service":"benders-availability"}`. To see the raw
grid, swap `/health` for `/state`.

**Backing up.** Export from the site saves a `.json` of everything. Worth doing
once mid-season; Import restores it (captain only).

**End of season.** Captain link → Reset clears the grid for everyone. Export
first if you want to keep the record.

## Sharing without sync

These work in either mode:

- **Copy share link** — packs the whole grid into a URL. Send it to someone and
  opening it loads that state. Not to be confused with a *personal* link: a
  share link carries a snapshot of the grid, a personal link carries who you
  are. With sync on, loading a share link replaces the team grid, so it's
  captain-only and asks first.
- **Export** — saves a `.json` file. Anyone can.
- **Import / Reset** — replace or wipe the whole grid. Captain only once sync is
  on, and hidden entirely for everyone else.

## Running it

Normally: https://bengrier.github.io/benders-scheduler/ — that's what the
team's links point at, and it's the copy everyone shares.

You can also open `index.html` straight off the filesystem by double-clicking
it. That still works, and with sync on it connects to the same live grid. With
sync off it runs entirely offline, no server and no internet.

## Updating the schedule or roster

The grid is generated from the two Excel files in the repo root:

- `C2 Benders Players.xlsx` — one player per row. Suffix a name with `(C)` for
  captain or `(G)` for goalie.
- `C2 Schedule.xlsx` — the league's schedule sheet, as sent.

Drop in the new file(s) and re-run:

```bash
python3 scripts/parse_excel.py
```

That rewrites `data/players.json`, `data/schedule.json`, and `data/data.js`
(the last is what the page actually loads). Requires `openpyxl`:

```bash
pip3 install openpyxl
```

Three things to know when the season file changes:

- Games are keyed by date and time slot, so existing marks survive a schedule
  update as long as those don't move.
- Players are keyed by a slug of their name (`ben-grier`). Renaming someone
  orphans their marks; the script refuses to run if two names collide.
- Share links encode player and game *positions*, so links made before a roster
  change won't load afterward. The app detects this and says so rather than
  loading the wrong data.

## Files

```
index.html               the page
styles.css               styling, including dark mode
app.js                   grid rendering, state, sync, share/export
config.js                SYNC_URL — the one thing you edit by hand
data/data.js             generated — what the page loads
data/*.json              generated — same data, for anything else you build
scripts/parse_excel.py   Excel → JSON converter
scripts/make_links.mjs   prints each player's personal link
worker/src/worker.js     the shared backend (Worker + Durable Object)
worker/wrangler.toml     its deploy config
```

## Season parsed from the current files

2026 Winter C2 Division — 63 games total, 22 of them Benders regular season,
plus 8 playoff slots. Aug 15 2026 through May 10 2027, Saturdays at the West
Rink except for three Monday playoff dates.

42 date rows in all: 28 with hockey for us, 6 bye weeks, 8 weeks with no games.
Every Saturday between the opener and Apr 17 is accounted for.
