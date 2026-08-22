#!/usr/bin/env node
/* Prints each player's personal link — the one they open once to claim their
 * own column. Codes are derived from the team secret, so this can regenerate
 * them at any time without storing a list anywhere.
 *
 *   node scripts/make_links.mjs
 *
 * Prompts for the team secret (hidden, and so kept out of shell history).
 * Pass a different site URL as the first argument, or set TEAM_SECRET in the
 * environment to skip the prompt.
 *
 * codeFor() must stay identical to the one in worker/src/worker.js.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const CODE_LENGTH = 6;
const CAPTAIN_KEY = "*";
const DEFAULT_SITE = "https://bengrier.github.io/benders-scheduler/";

/* Read the secret without echoing it to the screen. */
function askSecret() {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      let piped = "";
      process.stdin.on("data", (chunk) => { piped += chunk; });
      process.stdin.on("end", () => resolve(piped.trim()));
      process.stdin.on("error", reject);
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (str) => { if (!muted) rl.output.write(str); };
    rl.question("Team secret (hidden): ", (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer.trim());
    });
    muted = true;
  });
}

const secret = process.env.TEAM_SECRET || await askSecret();
if (!secret) {
  console.error("No secret given — nothing to generate.");
  process.exit(1);
}

const site = (process.argv[2] || DEFAULT_SITE).replace(/#.*$/, "").replace(/\/?$/, "/");

/* Resolved from this file, so the script runs from any directory. */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const players = JSON.parse(readFileSync(join(root, "data", "players.json"), "utf8"));

function codeFor(playerKey) {
  const bytes = createHmac("sha256", secret).update(playerKey).digest();
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

const pad = Math.max(...players.map((p) => p.name.length)) + 4;

console.log(`\nSite: ${site}`);
console.log("Send each player their own link. Opening it once claims that column.\n");
for (const player of players) {
  const role = player.role === "goalie" ? " (G)" : player.role === "captain" ? " (C)" : "";
  console.log(`${(player.name + role).padEnd(pad)}${site}#me=${player.key}&k=${codeFor(player.key)}`);
}

console.log(`\nCaptain link — can edit every row, for filling people in:\n${site}#me=&k=${codeFor(CAPTAIN_KEY)}`);
console.log("\nAnyone without a link can still read the grid, just not change it.");
