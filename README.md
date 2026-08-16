# Benders Availability

A single-page availability grid for the C2 Benders — game dates down the side,
players across the top, click a cell to say who's playing.

No login, no accounts, no server. Open it and use it.

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
  every game in the division.
- **Compact** — tighter rows so more of the season fits on screen.

The right-hand column counts confirmed skaters per game and flags games with no
goalie. The bottom row totals each player's games across the season.

## Sharing

Availability is stored in **your browser only** — it does not sync between
people or devices on its own. Three ways to move it around:

- **Copy share link** — packs the whole grid into a URL. Send it to someone and
  opening it loads that state into their browser. This is the easy one.
- **Export / Import** — saves and reloads a `.json` file.
- **Reset** — wipes everything in this browser.

In practice the simplest setup is one person (the captain) keeping the master
grid and sending out a fresh share link when it changes.

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

Two things to know when the season file changes:

- Games are keyed by date and time slot, so existing marks survive a schedule
  update as long as those don't move.
- Share links encode player and game *positions*, so links made before a roster
  change won't load afterward. The app detects this and says so rather than
  loading the wrong data.

## Files

```
index.html              the page
styles.css              styling, including dark mode
app.js                  grid rendering, state, share/export
data/data.js            generated — what the page loads
data/*.json             generated — same data, for anything else you build
scripts/parse_excel.py  Excel → JSON converter
```

## Season parsed from the current files

2026 Winter C2 Division — 63 games total, 22 of them Benders regular season,
plus 8 playoff slots. Aug 15 2026 through May 10 2027, Saturdays at the West
Rink except for four Monday playoff dates.
