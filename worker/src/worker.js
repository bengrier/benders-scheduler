/* Benders availability — Cloudflare Worker + Durable Object.
 *
 * One Durable Object holds the whole season's grid. Because a DO handles its
 * requests one at a time, read-modify-write is atomic without any locking, and
 * it can push changes straight down to every connected browser.
 *
 * Routes:
 *   GET    /state            current grid
 *   GET    /ws?player=&k=    live connection; identifies the player
 *   POST   /mark             set one cell        {game, player, status}
 *   POST   /bulk             set many cells      {cells:[{game,player,status}]}
 *   DELETE /state            clear the season    (captain only)
 *
 * Writes carry a per-player code so a mis-tap can't land on someone else's
 * row: the code for player X only ever authorises writes to X.
 */

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // no look-alike characters
const CODE_LENGTH = 6;
const CAPTAIN_KEY = "*";

/* ------------------------------------------------------------------ */
/* codes                                                               */
/* ------------------------------------------------------------------ */

/* Codes are derived from the team secret rather than stored, so there is no
 * code list to keep anywhere and scripts/make_links.mjs can regenerate them
 * offline. Must stay identical to codeFor() in that script. */
async function codeFor(secret, playerKey) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(playerKey));
  const bytes = new Uint8Array(signature);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* Returns who the caller is allowed to write as, or null for read-only. */
async function identify(secret, playerKey, code) {
  if (!secret || !code) return null;
  if (constantTimeEqual(code, await codeFor(secret, CAPTAIN_KEY))) {
    return { player: playerKey || null, captain: true };
  }
  if (!playerKey) return null;
  if (constantTimeEqual(code, await codeFor(secret, playerKey))) {
    return { player: playerKey, captain: false };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

const SAFE_KEY = /^[A-Za-z0-9._#-]{1,64}$/;

function validCell(cell) {
  return cell
    && SAFE_KEY.test(String(cell.game || ""))
    && SAFE_KEY.test(String(cell.player || ""))
    && (!cell.status || ["in", "out", "maybe"].includes(cell.status));
}

/* ------------------------------------------------------------------ */
/* durable object                                                      */
/* ------------------------------------------------------------------ */

export class SeasonRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  /* Read straight from storage every time rather than caching on `this`:
   * the object can hibernate between requests and come back with empty
   * instance state. */
  async read() {
    const [availability, version] = await Promise.all([
      this.ctx.storage.get("availability"),
      this.ctx.storage.get("version"),
    ]);
    return { availability: availability || {}, version: version || 0 };
  }

  async write(availability, version) {
    await this.ctx.storage.put({ availability, version });
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch (err) {
        /* a dead socket is cleaned up by the runtime */
      }
    }
  }

  applyCells(availability, cells) {
    for (const cell of cells) {
      const { game, player, status } = cell;
      if (status) {
        if (!availability[game]) availability[game] = {};
        availability[game][player] = status;
      } else if (availability[game]) {
        delete availability[game][player];
        if (!Object.keys(availability[game]).length) delete availability[game];
      }
    }
    return availability;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      /* Hibernation: the runtime parks the object between messages instead of
       * billing for an idle connection. */
      this.ctx.acceptWebSocket(server);

      const { availability, version } = await this.read();
      const you = request.headers.get("X-Identity");
      server.send(JSON.stringify({
        type: "init",
        version,
        availability,
        you: you ? JSON.parse(you) : null,
      }));

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/state" && request.method === "GET") {
      return json(await this.read());
    }

    if (url.pathname === "/state" && request.method === "DELETE") {
      const { version } = await this.read();
      const next = version + 1;
      await this.write({}, next);
      this.broadcast({ type: "reset", version: next });
      return json({ ok: true, version: next });
    }

    if (url.pathname === "/mark" || url.pathname === "/bulk") {
      const body = await request.json().catch(() => null);
      const cells = url.pathname === "/mark" ? [body] : (body && body.cells);
      if (!Array.isArray(cells) || !cells.length || !cells.every(validCell)) {
        return json({ error: "bad request" }, 400);
      }

      const identity = JSON.parse(request.headers.get("X-Identity") || "null");
      if (!identity) return json({ error: "no code" }, 401);
      if (!identity.captain && cells.some((c) => c.player !== identity.player)) {
        return json({ error: "that code can only mark its own row" }, 403);
      }

      const state = await this.read();
      const availability = this.applyCells(state.availability, cells);
      const version = state.version + 1;
      await this.write(availability, version);

      this.broadcast({
        type: "cells",
        version,
        cells: cells.map((c) => ({
          game: c.game, player: c.player, status: c.status || null,
        })),
      });
      return json({ ok: true, version });
    }

    return json({ error: "not found" }, 404);
  }

  /* Client heartbeats; nothing else is accepted over the socket. Writes go
   * through the authenticated HTTP routes so there is one enforcement path. */
  webSocketMessage(socket, message) {
    if (message === "ping") socket.send("pong");
  }

  webSocketClose(socket, code) {
    try {
      socket.close(code >= 1000 && code < 5000 ? code : 1000);
    } catch (err) {
      /* already gone */
    }
  }
}

/* ------------------------------------------------------------------ */
/* worker                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "benders-availability" });
    }

    /* Identity is resolved here, at the edge, and handed to the Durable
     * Object as a header. The DO is only reachable through this Worker, so it
     * can trust it. */
    const player = url.searchParams.get("player") || "";
    const code = url.searchParams.get("k") || "";
    const identity = await identify(env.TEAM_SECRET, player, code);

    const headers = new Headers(request.headers);
    if (identity) headers.set("X-Identity", JSON.stringify(identity));
    else headers.delete("X-Identity");

    const id = env.SEASON.idFromName("season");
    const stub = env.SEASON.get(id);

    return stub.fetch(new Request(request, { headers }));
  },
};
