/* Benders availability grid.
 *
 * Rows are game dates, columns are players, cells are one of four states.
 *
 * With SYNC_URL unset (see config.js) everything lives in localStorage and the
 * share link / export buttons are how state moves between people.
 *
 * With it set, the whole team shares one live grid served by the Cloudflare
 * Worker in worker/. Each player opens a personal link once, which claims
 * their column: from then on they can only change their own row, so a mis-tap
 * on a crowded phone screen can't land on somebody else's availability. The
 * Worker enforces that, not just the interface.
 */

(function () {
  "use strict";

  var PLAYERS = window.PLAYERS || [];
  var SCHEDULE = window.SCHEDULE || { games: [], title: "", team: "Benders" };
  var GAMES = SCHEDULE.games;
  /* Every date row in the league sheet, including the ones nobody plays, so
   * the grid lines up with a calendar instead of jumping over the gaps. */
  var DATES = SCHEDULE.dates || [];
  var TEAM = SCHEDULE.team || "Benders";

  var NOTE_LABEL = {
    bye: "Bye week — no " + TEAM + " game",
    off: "No games — league off"
  };

  var STORAGE_KEY = "benders-availability-v1";
  var PREFS_KEY = "benders-prefs-v1";
  var IDENTITY_KEY = "benders-identity-v1";
  var CYCLE = ["", "in", "out", "maybe"];
  var GLYPH = { in: "✓", out: "✗", maybe: "?" };
  var STATUS_CHAR = { "": ".", in: "i", out: "o", maybe: "m" };
  var CHAR_STATUS = { ".": "", i: "in", o: "out", m: "maybe" };
  var VALID_STATUS = { in: 1, out: 1, maybe: 1 };

  /* state[gameKey][playerName] = "in" | "out" | "maybe" */
  var state = {};
  var prefs = { me: "", scope: "upcoming", onlyMine: false };

  var nameByKey = {};
  var keyByName = {};
  PLAYERS.forEach(function (p) {
    nameByKey[p.key] = p.name;
    keyByName[p.name] = p.key;
  });

  var el = {
    grid: document.getElementById("grid"),
    gridWrap: document.getElementById("grid-wrap"),
    empty: document.getElementById("empty-msg"),
    filter: document.getElementById("filter-players"),
    me: document.getElementById("me-select"),
    scope: document.getElementById("game-scope"),
    onlyMine: document.getElementById("toggle-mine"),
    seasonLine: document.getElementById("season-line"),
    footerStats: document.getElementById("footer-stats"),
    footerNote: document.getElementById("footer-note"),
    hintStorage: document.getElementById("hint-storage"),
    syncPill: document.getElementById("sync-pill"),
    syncText: document.getElementById("sync-text"),
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
    toast.timer = setTimeout(function () { el.toast.hidden = true; }, 3200);
  }

  /* ------------------------------------------------------------------ */
  /* local persistence                                                   */
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

  /* ------------------------------------------------------------------ */
  /* identity                                                            */
  /* ------------------------------------------------------------------ */

  /* Who this browser is allowed to mark for. Claimed by opening a personal
   * link once (#me=<key>&k=<code>) and remembered from then on. */
  var Identity = (function () {
    var current = { player: "", code: "", captain: false };

    function persist() {
      try {
        localStorage.setItem(IDENTITY_KEY, JSON.stringify(current));
      } catch (err) { /* nothing we can do */ }
    }

    return {
      load: function () {
        try {
          var saved = JSON.parse(localStorage.getItem(IDENTITY_KEY));
          if (saved && saved.code) Object.assign(current, saved);
        } catch (err) { /* keep the empty identity */ }
      },

      /* Personal links look like  .../#me=ben-grier&k=ab3d9  */
      claimFromHash: function () {
        var hash = location.hash.replace(/^#/, "");
        if (!/(^|&)k=/.test(hash)) return false;
        var params = new URLSearchParams(hash);
        var code = params.get("k") || "";
        if (!code) return false;

        current.player = params.get("me") || "";
        current.code = code;
        current.captain = false;
        persist();
        history.replaceState(null, "", location.pathname + location.search);
        return true;
      },

      /* The server is the authority; it tells us what the code really is. */
      confirm: function (you) {
        if (!you) {
          if (current.code) {
            current.code = "";
            current.player = "";
            current.captain = false;
            persist();
            toast("That personal link is no longer valid — ask for a new one.");
          }
          return;
        }
        current.player = you.player || current.player;
        current.captain = !!you.captain;
        persist();
      },

      get: function () { return current; },
      name: function () { return nameByKey[current.player] || ""; },
      clear: function () {
        current = { player: "", code: "", captain: false };
        persist();
      }
    };
  })();

  /* ------------------------------------------------------------------ */
  /* team sync — Cloudflare Worker + Durable Object                      */
  /* ------------------------------------------------------------------ */

  var Sync = (function () {
    var base = String(window.SYNC_URL || "").trim().replace(/\/+$/, "");
    var enabled = /^https?:\/\/[^\s]+$/.test(base);
    var socket = null;
    var retry = 0;
    var retryTimer = null;
    var seenFirstPayload = false;
    var recentWrites = {};
    /* Marks this browser has that the server does not: made before the first
     * connection, or while offline. Re-sent whenever a full payload arrives,
     * which is also what shows up after a reconnect -- otherwise that payload
     * would look like a mass deletion and wipe them. */
    var pending = {};
    var handlers = {};

    function setStatusPill(nextState, text) {
      el.syncPill.dataset.state = nextState;
      el.syncText.textContent = text;
    }

    function auth() {
      var id = Identity.get();
      return "player=" + encodeURIComponent(id.player || "") +
        "&k=" + encodeURIComponent(id.code || "");
    }

    function markOwnWrite(gk, name) {
      var id = gk + "|" + name;
      recentWrites[id] = Date.now();
      setTimeout(function () { delete recentWrites[id]; }, 6000);
    }

    function isOwnWrite(gk, name) {
      return Object.prototype.hasOwnProperty.call(recentWrites, gk + "|" + name);
    }

    function queuePending(gk, name, status) {
      pending[gk + "|" + name] = { gameKey: gk, name: name, status: status };
    }

    function applyCell(gk, playerKey, value, changes) {
      var name = nameByKey[playerKey];
      if (!name) return;
      var status = VALID_STATUS[value] ? value : "";
      if (getStatus(gk, name) === status) return;
      setStatus(gk, name, status);
      changes.push({ gameKey: gk, name: name, foreign: !isOwnWrite(gk, name) });
    }

    function applyTree(tree, changes) {
      var incoming = tree || {};
      /* Anything the server no longer lists has been cleared. */
      Object.keys(state).forEach(function (gk) {
        var remote = incoming[gk] || {};
        Object.keys(state[gk]).forEach(function (name) {
          var key = keyByName[name];
          if (!key || !Object.prototype.hasOwnProperty.call(remote, key)) {
            applyCell(gk, key, null, changes);
          }
        });
      });
      Object.keys(incoming).forEach(function (gk) {
        Object.keys(incoming[gk] || {}).forEach(function (key) {
          applyCell(gk, key, incoming[gk][key], changes);
        });
      });
    }

    function queueUnsyncedMarks(snapshot, tree) {
      Object.keys(snapshot).forEach(function (gk) {
        var remote = (tree || {})[gk] || {};
        Object.keys(snapshot[gk]).forEach(function (name) {
          var key = keyByName[name];
          if (!key) return;
          if (Object.prototype.hasOwnProperty.call(remote, key)) return;
          queuePending(gk, name, snapshot[gk][name]);
        });
      });
    }

    /* Put queued marks back in the grid and re-send them in one request. */
    function flushPending() {
      var ids = Object.keys(pending);
      if (!ids.length) return;

      var id = Identity.get();
      if (!id.code) { pending = {}; return; }

      var cells = [];
      var restored = [];
      ids.forEach(function (entryId) {
        var entry = pending[entryId];
        var key = keyByName[entry.name];
        if (!key) return;
        if (!id.captain && key !== id.player) return;
        cells.push({ game: entry.gameKey, player: key, status: entry.status || null });
        markOwnWrite(entry.gameKey, entry.name);
        if (getStatus(entry.gameKey, entry.name) !== entry.status) {
          setStatus(entry.gameKey, entry.name, entry.status);
          restored.push({ gameKey: entry.gameKey, name: entry.name, foreign: false });
        }
      });

      if (!cells.length) { pending = {}; return; }
      if (restored.length) {
        save();
        handlers.onChange(restored);
      }

      request("POST", "/bulk", { cells: cells }).then(function () {
        ids.forEach(function (entryId) { delete pending[entryId]; });
        toast("Synced " + cells.length + " of your mark" +
          (cells.length === 1 ? "" : "s") + " to the team grid.");
      }, function () {
        toast("Couldn't sync your offline marks yet — they're still saved here.");
      });
    }

    function request(method, path, body) {
      var url = base + path + (path.indexOf("?") < 0 ? "?" : "&") + auth();
      return fetch(url, {
        method: method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      }).then(function (response) {
        if (response.status === 401 || response.status === 403) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            throw new Error(data.error || "not allowed");
          });
        }
        if (!response.ok) throw new Error(method + " " + response.status);
        return response.json().catch(function () { return {}; });
      });
    }

    function handleMessage(event) {
      var message;
      try {
        message = JSON.parse(event.data);
      } catch (err) {
        return;
      }

      if (message.type === "init") {
        Identity.confirm(message.you);
        var snapshot = seenFirstPayload ? null : JSON.parse(JSON.stringify(state));
        var changes = [];
        applyTree(message.availability, changes);
        if (changes.length) { save(); handlers.onChange(changes); }
        if (snapshot) {
          seenFirstPayload = true;
          queueUnsyncedMarks(snapshot, message.availability);
        }
        handlers.onIdentity();
        flushPending();
        return;
      }

      if (message.type === "cells") {
        var edits = [];
        (message.cells || []).forEach(function (cell) {
          applyCell(cell.game, cell.player, cell.status, edits);
        });
        if (edits.length) { save(); handlers.onChange(edits); }
        return;
      }

      if (message.type === "reset") {
        var cleared = [];
        applyTree({}, cleared);
        pending = {};
        if (cleared.length) { save(); handlers.onChange(cleared); }
        toast("The grid was cleared for everyone.");
      }
    }

    function connect() {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      setStatusPill("connecting", "Connecting…");

      var url = base.replace(/^http/, "ws") + "/ws?" + auth();
      try {
        socket = new WebSocket(url);
      } catch (err) {
        scheduleReconnect();
        return;
      }

      socket.addEventListener("open", function () {
        retry = 0;
        setStatusPill("live", pillText());
      });
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("close", scheduleReconnect);
      socket.addEventListener("error", function () {
        try { socket.close(); } catch (err) { /* already closing */ }
      });
    }

    /* Backs off to 30s so a long-dead connection isn't hammered, but the
     * first few retries are quick because the usual cause is a phone briefly
     * losing signal at the rink. */
    function scheduleReconnect() {
      if (retryTimer) return;
      setStatusPill("error", "Reconnecting…");
      var delay = Math.min(30000, 1000 * Math.pow(2, retry));
      retry += 1;
      retryTimer = setTimeout(function () {
        retryTimer = null;
        connect();
      }, delay);
    }

    function pillText() {
      var id = Identity.get();
      if (id.captain) return "Captain — can edit any row";
      if (id.player && nameByKey[id.player]) return nameByKey[id.player] + " — your row";
      return "Viewing only";
    }

    return {
      get enabled() { return enabled; },

      /* Whole-grid operations (import, reset, loading a share link) belong to
       * the captain once the team is sharing one grid. */
      canWriteAll: function () {
        return !enabled || Identity.get().captain;
      },

      canEdit: function (name) {
        if (!enabled) return true;
        var id = Identity.get();
        if (id.captain) return true;
        return !!id.player && keyByName[name] === id.player;
      },

      pillText: pillText,

      start: function (opts) {
        handlers = opts;
        if (!enabled) {
          setStatusPill("off", "This browser only");
          el.syncPill.title = "Team sync is off. See the README to switch it on.";
          return;
        }
        connect();
      },

      reconnect: function () {
        if (!enabled) return;
        seenFirstPayload = false;
        if (socket) {
          socket.removeEventListener("close", scheduleReconnect);
          try { socket.close(); } catch (err) { /* already closed */ }
        }
        retry = 0;
        connect();
      },

      push: function (gk, name, status) {
        if (!enabled) return;
        var key = keyByName[name];
        if (!key) return;
        markOwnWrite(gk, name);
        request("POST", "/mark", { game: gk, player: key, status: status || null })
          .then(function () {
            delete pending[gk + "|" + name];
          }, function (err) {
            queuePending(gk, name, status);
            toast(/allowed|own row|code/.test(String(err.message))
              ? "That change wasn't allowed — this link only marks its own row."
              : "Offline — saved here and queued for the team grid.");
          });
      },

      replaceAll: function (nextState) {
        if (!enabled) return Promise.resolve();
        pending = {};
        var cells = [];
        Object.keys(nextState).forEach(function (gk) {
          Object.keys(nextState[gk]).forEach(function (name) {
            var key = keyByName[name];
            if (key) cells.push({ game: gk, player: key, status: nextState[gk][name] });
          });
        });
        return request("DELETE", "/state").then(function () {
          return cells.length ? request("POST", "/bulk", { cells: cells }) : null;
        }).catch(function () {
          toast("Couldn't write to the team grid.");
        });
      },

      clearAll: function () {
        if (!enabled) return Promise.resolve();
        pending = {};
        return request("DELETE", "/state").catch(function () {
          toast("Couldn't clear the team grid.");
        });
      }
    };
  })();

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
    if (!Sync.canWriteAll()) {
      toast("Only the captain's link can load a whole grid over the team's.");
      return;
    }
    var question = Sync.enabled
      ? "Load this shared availability? It replaces the whole team grid."
      : "Load the shared availability? This replaces what's in this browser.";
    if (Object.keys(state).length && !confirm(question)) return;

    state = incoming;
    save();
    Sync.replaceAll(state);
    toast("Loaded shared availability.");
  }

  /* ------------------------------------------------------------------ */
  /* what to show                                                        */
  /* ------------------------------------------------------------------ */

  /* One list of everything the grid draws: game rows, plus slim marker rows
   * for bye weeks and weeks with no hockey at all. */
  function visibleRows() {
    var rows = [];
    var showAll = prefs.scope === "all";

    GAMES.forEach(function (game) {
      if (!showAll && !isMarkable(game)) return;
      rows.push({ type: "game", game: game, date: game.date, slot: game.slot });
    });

    DATES.forEach(function (entry) {
      if (entry.kind === "play") return;
      /* In the whole-division view a bye week already shows the other teams'
       * games, so only the truly empty weeks need a marker. */
      if (showAll && entry.kind !== "off") return;
      rows.push({ type: "note", note: entry, date: entry.date, slot: -1 });
    });

    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.slot - b.slot;
    });

    if (prefs.scope === "upcoming") {
      var today = todayISO();
      rows = rows.filter(function (row) { return row.date >= today; });
    }
    return rows;
  }

  function gamesIn(rows) {
    return rows.filter(function (row) { return row.type === "game"; })
      .map(function (row) { return row.game; });
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
      var mine = Sync.enabled ? Sync.canEdit(p.name) && !Identity.get().captain
        : p.name === prefs.me;
      var th = makeCell("th", "player-head" + (mine ? " is-me" : ""));
      th.scope = "col";
      th.title = p.name + (p.role === "goalie" ? " (goalie)" : p.role === "captain" ? " (captain)" : "");
      var tag = p.role === "goalie" ? " <span class=\"tag\">(G)</span>"
        : p.role === "captain" ? " <span class=\"tag\">(C)</span>" : "";
      th.appendChild(makeCell("span", "name", p.first + " " + p.last + tag));
      tr.appendChild(th);
    });

    tr.appendChild(makeCell("th", "col-total corner", "In"));
    thead.appendChild(tr);
    return thead;
  }

  function renderNoteRow(entry, players, isPast) {
    var tr = makeCell("tr", "note-row" + (isPast ? " is-past" : ""));
    tr.dataset.kind = entry.kind;

    var day = entry.weekday === "Saturday" ? "" : entry.weekday.slice(0, 3) + " ";
    var td = makeCell("td", "col-date date-cell");
    td.appendChild(makeCell("span", "d1", day + formatDate(entry.date)));
    tr.appendChild(td);

    var fill = makeCell("td", "note-fill", NOTE_LABEL[entry.kind] || "");
    fill.colSpan = players.length + 1;
    tr.appendChild(fill);
    return tr;
  }

  function renderDateCell(game, isNext) {
    var td = makeCell("td", "col-date date-cell");
    var opponent = opponentOf(game);
    var matchup = game.playoff
      ? "Playoff " + (game.label || "") + " — " + (game.home || "TBD") + (game.away ? " vs " + game.away : "")
      : opponent ? "vs " + opponent
        : game.home + " vs " + game.away;

    /* Nearly every game is a Saturday, so only call out the exceptions. */
    var day = game.weekday === "Saturday" ? "" : game.weekday.slice(0, 3) + " ";

    /* The time shares the second line with the matchup because two different
     * games can fall on the same date -- without it those rows look identical
     * in the "Every C2 game" view. */
    td.appendChild(makeCell("span", "d1", day + formatDate(game.date)));
    td.appendChild(makeCell("span", "d2", "<b>" + game.time + "</b> · " + matchup));

    td.title = game.weekday + " " + formatDate(game.date) + "\n" +
      game.time + " · " + game.rink + "\n" + matchup +
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

    var count = makeCell("span", "count",
      String(skatersIn) + "<small>" + (skatersIn === 1 ? "skater" : "skaters") + "</small>");
    if (skatersIn > 0 && skatersIn < 8) count.classList.add("thin");
    td.appendChild(count);
    if (goalieIn) td.appendChild(makeCell("span", "count", "<small>+ goalie</small>"));
    else if (goalieExists && skatersIn > 0) td.appendChild(makeCell("span", "no-goalie", "no G"));
    return td;
  }

  function renderBody(rows, players, nextKey) {
    var tbody = makeCell("tbody");
    var today = todayISO();

    rows.forEach(function (row) {
      if (row.type === "note") {
        tbody.appendChild(renderNoteRow(row.note, players, row.date < today));
        return;
      }

      var game = row.game;
      var key = gameKey(game);
      var tr = makeCell("tr");
      tr.dataset.game = key;
      if (game.date < today) tr.classList.add("is-past");
      if (key === nextKey) tr.classList.add("is-next");
      if (!isMarkable(game)) tr.classList.add("is-other");

      tr.appendChild(renderDateCell(game, key === nextKey));

      players.forEach(function (p) {
        var td = makeCell("td", "cell");

        if (!isMarkable(game)) {
          td.className = "cell is-locked";
          tr.appendChild(td);
          return;
        }

        var status = getStatus(key, p.name);
        td.dataset.status = status;
        td.dataset.key = key;
        td.dataset.player = p.name;
        td.textContent = GLYPH[status] || "";

        if (Sync.canEdit(p.name)) {
          if (Sync.enabled && !Identity.get().captain) td.classList.add("is-me-col");
          else if (!Sync.enabled && p.name === prefs.me) td.classList.add("is-me-col");
          td.title = p.name + " — " + formatDate(game.date);
        } else {
          /* Not yours to change: no pointer, no hover, no click handler. */
          td.classList.add("is-readonly");
          td.title = p.name + " — only " + p.first + "'s own link can change this";
        }
        tr.appendChild(td);
      });

      tr.appendChild(renderRowTotal(game, players));
      tbody.appendChild(tr);
    });

    return tbody;
  }

  function renderFoot(rows, players) {
    var markable = gamesIn(rows).filter(isMarkable);
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

  function nextGame() {
    var today = todayISO();
    return GAMES.find(function (g) { return isMarkable(g) && g.date >= today; });
  }

  function render() {
    var rows = visibleRows();
    var players = visiblePlayers();
    var next = nextGame();
    var nextKey = next ? gameKey(next) : null;

    el.grid.innerHTML = "";

    if (!rows.length || !players.length) {
      el.gridWrap.hidden = true;
      el.empty.hidden = false;
      el.empty.textContent = !players.length
        ? "No players match that filter."
        : "No games to show — try a different Games option.";
    } else {
      el.gridWrap.hidden = false;
      el.empty.hidden = true;
      el.grid.appendChild(renderHead(players));
      el.grid.appendChild(renderBody(rows, players, nextKey));
      el.grid.appendChild(renderFoot(rows, players));
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
      " — " + skaters + (skaters === 1 ? " skater" : " skaters") +
      (goalie ? " + goalie" : ", no goalie yet") + " confirmed.";
  }

  /* ------------------------------------------------------------------ */
  /* interaction                                                         */
  /* ------------------------------------------------------------------ */

  function onGridClick(event) {
    var td = event.target.closest("td.cell");
    if (!td || !td.dataset.key) return;

    if (!Sync.canEdit(td.dataset.player)) {
      var id = Identity.get();
      toast(id.code
        ? "That's " + td.dataset.player + "'s row — your link only marks your own."
        : "Open your personal link to mark your availability.");
      return;
    }

    var current = td.dataset.status || "";
    var next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];

    setStatus(td.dataset.key, td.dataset.player, next);
    save();
    Sync.push(td.dataset.key, td.dataset.player, next);

    td.dataset.status = next;
    td.textContent = GLYPH[next] || "";
    refreshTotals();
  }

  /* Repaint just the cells a remote change touched, so nobody loses their
   * scroll position mid-edit. */
  function applyRemoteChanges(changes) {
    changes.forEach(function (change) {
      var row = el.grid.querySelector('tbody tr[data-game="' + change.gameKey + '"]');
      if (!row) return;
      var td = row.querySelector('td.cell[data-player="' + CSS.escape(change.name) + '"]');
      if (!td) return;
      var status = getStatus(change.gameKey, change.name);
      td.dataset.status = status;
      td.textContent = GLYPH[status] || "";
      if (change.foreign) {
        td.classList.remove("just-synced");
        void td.offsetWidth;
        td.classList.add("just-synced");
      }
    });
    if (changes.length) refreshTotals();
  }

  /* Cheaper than a full re-render on every click. */
  function refreshTotals() {
    var rows = visibleRows();
    var players = visiblePlayers();
    rows.forEach(function (row) {
      if (row.type !== "game") return;
      var tr = el.grid.querySelector('tbody tr[data-game="' + gameKey(row.game) + '"]');
      if (!tr) return;
      tr.replaceChild(renderRowTotal(row.game, players), tr.lastElementChild);
    });
    var tfoot = el.grid.querySelector("tfoot");
    if (tfoot) el.grid.replaceChild(renderFoot(rows, players), tfoot);
    renderFooterStats(nextGame());
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
      if (Sync.enabled &&
        !confirm("Import replaces the whole team grid, for everyone. Continue?")) {
        return;
      }
      state = incoming;
      save();
      Sync.replaceAll(state);
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

  /* Whole-grid buttons only make sense for whoever is allowed to use them. */
  function syncControlAccess() {
    var allowed = Sync.canWriteAll();
    ["btn-import", "btn-reset"].forEach(function (id) {
      var button = document.getElementById(id);
      button.hidden = !allowed;
    });

    if (!Sync.enabled) return;
    var id = Identity.get();
    el.me.disabled = true;
    el.me.value = id.captain ? "" : (nameByKey[id.player] || "");
    prefs.me = el.me.value;
    el.syncPill.title = id.captain
      ? "Captain link — you can change anyone's row."
      : id.player
        ? "You can change your own row. Everyone else's is read-only."
        : "Read-only. Open your personal link to mark availability.";
  }

  function describeStorage() {
    var link = "<a href=\"https://github.com/bengrier/benders-scheduler\">source</a>";
    if (!Sync.enabled) {
      el.hintStorage.textContent = "Everything saves in this browser.";
      el.footerNote.innerHTML = "Saved locally in this browser · " + link;
      return;
    }
    var id = Identity.get();
    el.hintStorage.textContent = id.captain
      ? "You're on the captain link — you can mark any row."
      : id.player
        ? "You can mark your own row; everyone else's is read-only."
        : "Read-only — open your personal link to mark your availability.";
    el.footerNote.innerHTML = "Shared team grid · " + link;
  }

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
        toast(Sync.enabled
          ? "Open your personal link first."
          : "Pick your name in “I am” first.");
        return;
      }
      prefs.onlyMine = el.onlyMine.checked;
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

    /* Tapping a personal link while the page is already open only changes the
     * hash -- the browser doesn't reload -- so claim it here too. */
    window.addEventListener("hashchange", function () {
      if (!Identity.claimFromHash()) return;
      Sync.reconnect();
      toast("Personal link accepted.");
    });

    document.getElementById("btn-reset").addEventListener("click", function () {
      var question = Sync.enabled
        ? "Clear every mark for the whole team? Export first if you want a copy."
        : "Clear every mark in this browser? Export first if you want a copy.";
      if (!confirm(question)) return;
      state = {};
      save();
      Sync.clearAll();
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
    Identity.load();
    Identity.claimFromHash();
    readSharedState();

    el.seasonLine.textContent = SCHEDULE.title + " · " + TEAM;
    document.title = TEAM + " Availability — " + SCHEDULE.title;

    wire();
    syncControlAccess();
    describeStorage();
    render();

    Sync.start({
      onChange: applyRemoteChanges,
      onIdentity: function () {
        syncControlAccess();
        describeStorage();
        el.syncText.textContent = Sync.pillText();
        render();
      }
    });
  }

  init();
})();
