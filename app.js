/* Benders availability grid.
 *
 * Rows are game dates, columns are players, cells are one of four states.
 * Everything lives in localStorage -- there is no server and no login. The
 * share link and Export/Import buttons are how state moves between people.
 */

(function () {
  "use strict";

  var PLAYERS = window.PLAYERS || [];
  var SCHEDULE = window.SCHEDULE || { games: [], title: "", team: "Benders" };
  var GAMES = SCHEDULE.games;
  var TEAM = SCHEDULE.team || "Benders";

  var STORAGE_KEY = "benders-availability-v1";
  var PREFS_KEY = "benders-prefs-v1";
  var CYCLE = ["", "in", "out", "maybe"];
  var GLYPH = { in: "✓", out: "✗", maybe: "?" };
  var STATUS_CHAR = { "": ".", in: "i", out: "o", maybe: "m" };
  var CHAR_STATUS = { ".": "", i: "in", o: "out", m: "maybe" };

  /* state[gameKey][playerName] = "in" | "out" | "maybe" */
  var state = {};
  var prefs = { me: "", scope: "upcoming", onlyMine: false, compact: false };

  var el = {
    grid: document.getElementById("grid"),
    gridWrap: document.getElementById("grid-wrap"),
    empty: document.getElementById("empty-msg"),
    filter: document.getElementById("filter-players"),
    me: document.getElementById("me-select"),
    scope: document.getElementById("game-scope"),
    onlyMine: document.getElementById("toggle-mine"),
    compact: document.getElementById("toggle-compact"),
    seasonLine: document.getElementById("season-line"),
    footerStats: document.getElementById("footer-stats"),
    toast: document.getElementById("toast")
  };

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  function gameKey(game) {
    return game.date + "#" + game.slot;
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function formatDate(iso) {
    var parts = iso.split("-");
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function opponentOf(game) {
    if (game.playoff) return "TBD";
    if (game.home === TEAM) return game.away;
    if (game.away === TEAM) return game.home;
    return null;
  }

  /* A row we can mark availability on: our regular-season games plus the
   * playoff slots, whose opponents the league hasn't seeded yet. */
  function isMarkable(game) {
    return game.isOurs || game.playoff;
  }

  function getStatus(key, name) {
    return (state[key] && state[key][name]) || "";
  }

  function setStatus(key, name, status) {
    if (!state[key]) state[key] = {};
    if (status) state[key][name] = status;
    else delete state[key][name];
    if (!Object.keys(state[key]).length) delete state[key];
  }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  /* ------------------------------------------------------------------ */
  /* persistence                                                         */
  /* ------------------------------------------------------------------ */

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      toast("Could not save — browser storage is blocked.");
    }
  }

  function load() {
    try {
      state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (err) {
      state = {};
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (err) { /* preferences are nice-to-have */ }
  }

  function loadPrefs() {
    try {
      var saved = JSON.parse(localStorage.getItem(PREFS_KEY));
      if (saved) Object.assign(prefs, saved);
    } catch (err) { /* keep defaults */ }
  }

  /* ---- share link -------------------------------------------------- */

  /* "v1|63|14|3-.i..o.......m;7-..i..........."  then base64url in the hash.
   * Positions are indexes into GAMES and PLAYERS, so the counts let us bail
   * out politely if the roster or schedule changed since the link was made. */
  function encodeState() {
    var chunks = [];
    GAMES.forEach(function (game, gi) {
      var row = state[gameKey(game)];
      if (!row) return;
      var chars = PLAYERS.map(function (p) {
        return STATUS_CHAR[row[p.name] || ""] || ".";
      }).join("");
      if (/^\.+$/.test(chars)) return;
      chunks.push(gi + "-" + chars);
    });
    if (!chunks.length) return "";
    var raw = ["v1", GAMES.length, PLAYERS.length, chunks.join(";")].join("|");
    return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeState(token) {
    var raw;
    try {
      raw = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    } catch (err) {
      return null;
    }
    var parts = raw.split("|");
    if (parts[0] !== "v1") return null;
    if (+parts[1] !== GAMES.length || +parts[2] !== PLAYERS.length) return null;

    var next = {};
    (parts[3] || "").split(";").forEach(function (chunk) {
      var split = chunk.indexOf("-");
      if (split < 0) return;
      var game = GAMES[+chunk.slice(0, split)];
      var chars = chunk.slice(split + 1);
      if (!game) return;
      PLAYERS.forEach(function (p, pi) {
        var status = CHAR_STATUS[chars[pi]] || "";
        if (!status) return;
        var key = gameKey(game);
        if (!next[key]) next[key] = {};
        next[key][p.name] = status;
      });
    });
    return next;
  }

  function readSharedState() {
    var hash = location.hash.replace(/^#/, "");
    if (!hash.startsWith("s=")) return;
    var incoming = decodeState(hash.slice(2));
    history.replaceState(null, "", location.pathname + location.search);
    if (!incoming) {
      toast("That share link doesn't match the current roster/schedule.");
      return;
    }
    var hasLocal = Object.keys(state).length > 0;
    if (hasLocal && !confirm("Load the shared availability? This replaces what's in this browser.")) {
      return;
    }
    state = incoming;
    save();
    toast("Loaded shared availability.");
  }

  /* ------------------------------------------------------------------ */
  /* what to show                                                        */
  /* ------------------------------------------------------------------ */

  function visibleGames() {
    var today = todayISO();
    if (prefs.scope === "all") return GAMES;
    if (prefs.scope === "benders") return GAMES.filter(isMarkable);
    return GAMES.filter(function (g) { return isMarkable(g) && g.date >= today; });
  }

  function visiblePlayers() {
    var query = el.filter.value.trim().toLowerCase();
    return PLAYERS.filter(function (p) {
      if (prefs.onlyMine && prefs.me) return p.name === prefs.me;
      if (!query) return true;
      return p.name.toLowerCase().includes(query);
    });
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                           */
  /* ------------------------------------------------------------------ */

  function makeCell(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function renderHead(players) {
    var thead = makeCell("thead");
    var tr = makeCell("tr");
    tr.appendChild(makeCell("th", "col-date corner", "Game"));

    players.forEach(function (p) {
      var th = makeCell("th", "player-head" + (p.name === prefs.me ? " is-me" : ""));
      th.scope = "col";
      th.title = p.name;
      var tag = p.role === "goalie" ? " <span class=\"tag\">(G)</span>"
        : p.role === "captain" ? " <span class=\"tag\">(C)</span>" : "";
      th.appendChild(makeCell("span", "name", p.first + " " + p.last + tag));
      tr.appendChild(th);
    });

    tr.appendChild(makeCell("th", "col-total corner", "In"));
    thead.appendChild(tr);
    return thead;
  }

  function renderDateCell(game, isNext) {
    var td = makeCell("td", "col-date date-cell");
    var opponent = opponentOf(game);
    var headline = game.playoff
      ? "Playoff " + (game.label || "") + " — " + (game.home || "TBD") + (game.away ? " vs " + game.away : "")
      : opponent ? "vs " + opponent
        : game.home + " vs " + game.away;

    td.appendChild(makeCell("span", "d1", formatDate(game.date)));
    td.appendChild(makeCell("span", "d2", headline));
    var detail = game.weekday + " · " + game.time + " · " + game.rink;
    td.appendChild(makeCell("span", "d3", detail));
    /* The three lines are clipped to keep row heights uniform. */
    td.title = formatDate(game.date) + " — " + headline + "\n" + detail +
      (isNext ? "\n(next game)" : "");
    return td;
  }

  function renderRowTotal(game, players) {
    var td = makeCell("td", "col-total");
    if (!isMarkable(game)) {
      td.appendChild(makeCell("span", "count", "—"));
      return td;
    }

    var key = gameKey(game);
    var skatersIn = 0;
    var goalieIn = false;
    var goalieExists = false;

    players.forEach(function (p) {
      var status = getStatus(key, p.name);
      if (p.role === "goalie") {
        goalieExists = true;
        if (status === "in") goalieIn = true;
      } else if (status === "in") {
        skatersIn += 1;
      }
    });

    var count = makeCell("span", "count", String(skatersIn) + "<small>skaters</small>");
    if (skatersIn > 0 && skatersIn < 8) count.classList.add("thin");
    td.appendChild(count);
    if (goalieIn) td.appendChild(makeCell("span", "count", "<small>+ goalie</small>"));
    else if (goalieExists && skatersIn > 0) td.appendChild(makeCell("span", "no-goalie", "no G"));
    return td;
  }

  function renderBody(games, players, nextKey) {
    var tbody = makeCell("tbody");
    var today = todayISO();

    games.forEach(function (game) {
      var key = gameKey(game);
      var tr = makeCell("tr");
      if (game.date < today) tr.classList.add("is-past");
      if (key === nextKey) tr.classList.add("is-next");
      if (!isMarkable(game)) tr.classList.add("is-other");

      tr.appendChild(renderDateCell(game, key === nextKey));

      players.forEach(function (p) {
        var td = makeCell("td", "cell");
        if (p.name === prefs.me) td.classList.add("is-me-col");

        if (!isMarkable(game)) {
          td.classList.remove("cell");
          td.className = "cell is-locked";
          td.style.cursor = "default";
          tr.appendChild(td);
          return;
        }

        var status = getStatus(key, p.name);
        td.dataset.status = status;
        td.dataset.key = key;
        td.dataset.player = p.name;
        td.textContent = GLYPH[status] || "";
        td.title = p.name + " — " + formatDate(game.date);
        tr.appendChild(td);
      });

      tr.appendChild(renderRowTotal(game, players));
      tbody.appendChild(tr);
    });

    return tbody;
  }

  function renderFoot(games, players) {
    var markable = games.filter(isMarkable);
    var tfoot = makeCell("tfoot");
    var tr = makeCell("tr");
    tr.appendChild(makeCell("th", "col-date", "In / " + markable.length + " games"));

    players.forEach(function (p) {
      var count = 0;
      markable.forEach(function (game) {
        if (getStatus(gameKey(game), p.name) === "in") count += 1;
      });
      var pct = markable.length ? Math.round((count / markable.length) * 100) : 0;
      var td = makeCell("td");
      td.innerHTML = "<b>" + count + "</b><span class=\"pct\">" + pct + "%</span>";
      tr.appendChild(td);
    });

    tr.appendChild(makeCell("td", "col-total", ""));
    tfoot.appendChild(tr);
    return tfoot;
  }

  function render() {
    var games = visibleGames();
    var players = visiblePlayers();
    var today = todayISO();
    var next = GAMES.find(function (g) { return isMarkable(g) && g.date >= today; });
    var nextKey = next ? gameKey(next) : null;

    el.grid.innerHTML = "";
    document.body.classList.toggle("compact", prefs.compact);

    if (!games.length || !players.length) {
      el.gridWrap.hidden = true;
      el.empty.hidden = false;
      el.empty.textContent = !players.length
        ? "No players match that filter."
        : "No games to show — try a different Games option.";
    } else {
      el.gridWrap.hidden = false;
      el.empty.hidden = true;
      el.grid.appendChild(renderHead(players));
      el.grid.appendChild(renderBody(games, players, nextKey));
      el.grid.appendChild(renderFoot(games, players));
    }

    renderFooterStats(next);
  }

  function renderFooterStats(next) {
    if (!next) {
      el.footerStats.textContent = "Season complete.";
      return;
    }
    var key = gameKey(next);
    var skaters = 0;
    var goalie = false;
    PLAYERS.forEach(function (p) {
      if (getStatus(key, p.name) !== "in") return;
      if (p.role === "goalie") goalie = true;
      else skaters += 1;
    });
    var opponent = opponentOf(next);
    el.footerStats.textContent =
      "Next: " + formatDate(next.date) + " " + next.time +
      (opponent ? " vs " + opponent : "") +
      " — " + skaters + " skaters" + (goalie ? " + goalie" : ", no goalie yet") + " confirmed.";
  }

  /* ------------------------------------------------------------------ */
  /* interaction                                                         */
  /* ------------------------------------------------------------------ */

  function onGridClick(event) {
    var td = event.target.closest("td.cell");
    if (!td || !td.dataset.key) return;
    var current = td.dataset.status || "";
    var next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];

    setStatus(td.dataset.key, td.dataset.player, next);
    save();

    td.dataset.status = next;
    td.textContent = GLYPH[next] || "";
    refreshTotals();
  }

  /* Cheaper than a full re-render on every click. */
  function refreshTotals() {
    var games = visibleGames();
    var players = visiblePlayers();
    var rows = el.grid.querySelectorAll("tbody tr");
    games.forEach(function (game, i) {
      var row = rows[i];
      if (!row) return;
      row.replaceChild(renderRowTotal(game, players), row.lastElementChild);
    });
    var tfoot = el.grid.querySelector("tfoot");
    if (tfoot) el.grid.replaceChild(renderFoot(games, players), tfoot);
    renderFooterStats(GAMES.find(function (g) {
      return isMarkable(g) && g.date >= todayISO();
    }));
  }

  function exportJSON() {
    var payload = {
      exported: new Date().toISOString(),
      season: SCHEDULE.title,
      team: TEAM,
      availability: state
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "benders-availability-" + todayISO() + ".json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        toast("That file isn't valid JSON.");
        return;
      }
      var incoming = parsed && parsed.availability;
      if (!incoming || typeof incoming !== "object") {
        toast("No availability data in that file.");
        return;
      }
      state = incoming;
      save();
      render();
      toast("Imported.");
    };
    reader.readAsText(file);
  }

  function copyShareLink() {
    var token = encodeState();
    if (!token) {
      toast("Nothing marked yet — fill in some cells first.");
      return;
    }
    var url = location.origin + location.pathname + location.search + "#s=" + token;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { toast("Share link copied."); },
        function () { window.prompt("Copy this link:", url); }
      );
    } else {
      window.prompt("Copy this link:", url);
    }
  }

  /* ------------------------------------------------------------------ */
  /* wiring                                                              */
  /* ------------------------------------------------------------------ */

  function wire() {
    el.grid.addEventListener("click", onGridClick);

    el.filter.addEventListener("input", render);

    PLAYERS.forEach(function (p) {
      var option = document.createElement("option");
      option.value = p.name;
      option.textContent = p.name;
      el.me.appendChild(option);
    });

    el.me.value = prefs.me;
    el.scope.value = prefs.scope;
    el.onlyMine.checked = prefs.onlyMine;
    el.compact.checked = prefs.compact;

    el.me.addEventListener("change", function () {
      prefs.me = el.me.value;
      if (!prefs.me) { prefs.onlyMine = false; el.onlyMine.checked = false; }
      savePrefs();
      render();
    });

    el.scope.addEventListener("change", function () {
      prefs.scope = el.scope.value;
      savePrefs();
      render();
    });

    el.onlyMine.addEventListener("change", function () {
      if (el.onlyMine.checked && !prefs.me) {
        el.onlyMine.checked = false;
        toast("Pick your name in “I am” first.");
        return;
      }
      prefs.onlyMine = el.onlyMine.checked;
      savePrefs();
      render();
    });

    el.compact.addEventListener("change", function () {
      prefs.compact = el.compact.checked;
      savePrefs();
      render();
    });

    document.getElementById("btn-export").addEventListener("click", exportJSON);
    document.getElementById("btn-share").addEventListener("click", copyShareLink);

    var fileInput = document.getElementById("file-import");
    document.getElementById("btn-import").addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      if (fileInput.files[0]) importJSON(fileInput.files[0]);
      fileInput.value = "";
    });

    document.getElementById("btn-reset").addEventListener("click", function () {
      if (!confirm("Clear every mark in this browser? Export first if you want a copy.")) return;
      state = {};
      save();
      render();
      toast("Cleared.");
    });
  }

  function init() {
    if (!PLAYERS.length || !GAMES.length) {
      el.empty.hidden = false;
      el.empty.textContent = "Couldn't load the roster or schedule — re-run scripts/parse_excel.py.";
      el.gridWrap.hidden = true;
      return;
    }
    load();
    loadPrefs();
    readSharedState();
    el.seasonLine.textContent = SCHEDULE.title + " · " + TEAM;
    document.title = TEAM + " Availability — " + SCHEDULE.title;
    wire();
    render();
  }

  init();
})();
