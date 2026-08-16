# Benders Availability

A single-page availability grid for the C2 Benders — game dates down the side,
players across the top, click a cell to say who's playing.

No logins and no accounts. Works on its own out of the box; switch on
[team sync](#team-sync) and everyone marks their own row from their own phone.

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
- **I am** — pick yourself; your column gets highlighted.
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

The pill under the title says which mode you're in:

- **This browser only** — no sync configured. Marks stay on this device.
- **Team sync on** — everyone shares one live grid. Each player marks their own
  row from their own phone and the change shows up on everyone else's screen a
  moment later, briefly outlined so it isn't a silent edit.

Sync needs no accounts and no logins for your players — just a free database
that the page reads and writes directly.

### Turning it on

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and
   create a project (any name; skip Analytics).
2. In the left sidebar pick **Build → Realtime Database → Create Database**.
   Choose a location and start it in **test mode**.
3. Open the **Rules** tab and set:

   ```json
   { "rules": { ".read": true, ".write": true } }
   ```

   Publish. This makes the grid readable and writable by anyone with the URL —
   that's the trade for having no logins. See the caveat below.

4. Copy the database URL shown at the top of the Data tab. It looks like
   `https://benders-abc123-default-rtdb.firebaseio.com`.
5. Paste it into [`config.js`](config.js) and commit:

   ```js
   window.SYNC_URL = "https://benders-abc123-default-rtdb.firebaseio.com";
   ```

Reload and the pill should turn green. Anything already marked in your browser
gets merged into the team grid the first time you connect, so you won't lose
what's already there.

**The caveat:** open rules mean anyone who has the URL can read and change the
grid. For a beer-league roster that's usually fine — the same trade as a shared
Google Sheet with link access. If you'd rather lock it down, set
`".write": false` and use Export/Import to publish updates yourself, or add
Firebase anonymous auth.

Free tier is 1 GB stored and 10 GB/month transferred. This grid is a few
kilobytes, so a season won't come close.

### Offline and conflicts

- Writes are per-cell, so two people marking different cells never overwrite
  each other.
- Marking something while offline keeps it locally, tells you, and pushes it up
  automatically once the connection returns.
- Last write wins if two people change *the same* cell.

## Sharing without sync

These work in either mode:

- **Copy share link** — packs the whole grid into a URL. Send it to someone and
  opening it loads that state. With sync on, opening a share link replaces the
  team grid, so it asks first.
- **Export / Import** — saves and reloads a `.json` file.
- **Reset** — wipes everything (the whole team grid, when sync is on).

## Running it

Just open `index.html` — double-click it, or drag it into a browser. It works
straight off the filesystem with no server and no internet connection.

If it's published to GitHub Pages, use that URL instead so everyone's looking at
the same page.

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
index.html              the page
styles.css              styling, including dark mode
app.js                  grid rendering, state, sync, share/export
config.js               SYNC_URL — the one thing you edit by hand
data/data.js            generated — what the page loads
data/*.json             generated — same data, for anything else you build
scripts/parse_excel.py  Excel → JSON converter
```

## Season parsed from the current files

2026 Winter C2 Division — 63 games total, 22 of them Benders regular season,
plus 8 playoff slots. Aug 15 2026 through May 10 2027, Saturdays at the West
Rink except for three Monday playoff dates.

42 date rows in all: 28 with hockey for us, 6 bye weeks, 8 weeks with no games.
Every Saturday between the opener and Apr 17 is accounted for.
