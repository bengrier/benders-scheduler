#!/usr/bin/env node
/* Prints each player's personal link — the one they open once to claim their
 * own column. Codes are derived from the team secret, so this can regenerate
 * them at any time without storing a list anywhere.
 *
 *   TEAM_SECRET=... node scripts/make_links.mjs https://your-site/
 *
 * Must stay identical to codeFor() in worker/src/worker.js.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const CODE_LENGTH = 6;
const CAPTAIN_KEY = "*";

const secret = process.env.TEAM_SECRET;
if (!secret) {
  console.error("Set TEAM_SECRET first, e.g.\n  TEAM_SECRET=your-secret node scripts/make_links.mjs <site-url>");
  process.exit(1);
}

const site = (process.argv[2] || "https://bengrier.github.io/benders-scheduler/")
  .replace(/#.*$/, "")
  .replace(/\/?$/, "/");

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const players = JSON.parse(readFileSync(join(root, "data", "players.json"), "utf8"));

function codeFor(playerKey) {
  const bytes = createHmac("sha256", secret).update(playerKey).digest();
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

const link = (key, code) => `${site}#me=${key}&k=${code}`;
const pad = Math.max(...players.map((p) => p.name.length));

console.log("Send each player their own link. Opening it once claims that column.\n");
for (const player of players) {
  const role = player.role === "goalie" ? " (G)" : player.role === "captain" ? " (C)" : "";
  console.log(`${(player.name + role).padEnd(pad + 4)}  ${link(player.key, codeFor(player.key))}`);
}

console.log(`\nCaptain link — can edit every row, for filling people in:\n${site}#me=&k=${codeFor(CAPTAIN_KEY)}`);
console.log("\nAnyone without a link can still read the grid, just not change it.");
