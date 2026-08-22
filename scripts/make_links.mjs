#!/usr/bin/env node
/* Prints (or saves) each player's personal link — the one they open once to
 * claim their own column. Codes are derived from the team secret, so this can
 * regenerate them at any time without storing a list anywhere.
 *
 *   node scripts/make_links.mjs
 *   node scripts/make_links.mjs --out ~/Desktop/benders-player-links.txt
 *   node scripts/make_links.mjs https://some-other-site/ --out links.txt
 *
 * Prompts for the team secret with the echo off, so it stays out of shell
 * history. Set TEAM_SECRET in the environment to skip the prompt.
 *
 * The links are credentials: each one grants write access to that player's
 * row, and the captain link grants write access to everything. --out refuses
 * to write inside this repository, which is public.
 *
 * codeFor() must stay identical to the one in worker/src/worker.js.
 */

import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const CODE_LENGTH = 6;
const CAPTAIN_KEY = "*";
const DEFAULT_SITE = "https://bengrier.github.io/benders-scheduler/";

/* Resolved from this file, so the script runs from any directory. */
const root = dirname(dirname(fileURLToPath(import.meta.url)));

/* ---- arguments ---------------------------------------------------- */

const args = process.argv.slice(2);
let site = DEFAULT_SITE;
let outPath = null;
let force = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--out" || arg === "-o") outPath = args[++i];
  else if (arg === "--force") force = true;
  else if (!arg.startsWith("-")) site = arg;
}
site = site.replace(/#.*$/, "").replace(/\/?$/, "/");

if (outPath) {
  if (outPath.startsWith("~")) outPath = join(homedir(), outPath.slice(1));
  outPath = isAbsolute(outPath) ? outPath : resolve(process.cwd(), outPath);

  const inside = relative(root, outPath);
  if (!force && inside && !inside.startsWith("..") && !isAbsolute(inside)) {
    console.error(
      "\nRefusing to write inside the project folder — this repo is public, and\n" +
      "these links are credentials (the captain link can wipe the whole grid).\n\n" +
      "Try somewhere outside it, for example:\n" +
      "  --out ~/Desktop/benders-player-links.txt\n\n" +
      "Use --force if you really mean it (the .gitignore covers *-links.txt).\n"
    );
    process.exit(1);
  }
}

/* ---- secret ------------------------------------------------------- */

/* Prompt on stderr so `> file` redirection still works. */
function askSecret() {
  return new Promise((resolvePrompt, reject) => {
    if (!process.stdin.isTTY) {
      let piped = "";
      process.stdin.on("data", (chunk) => { piped += chunk; });
      process.stdin.on("end", () => resolvePrompt(piped.trim()));
      process.stdin.on("error", reject);
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    let muted = false;
    rl._writeToOutput = (str) => { if (!muted) rl.output.write(str); };
    rl.question("Team secret (hidden): ", (answer) => {
      rl.output.write("\n");
      rl.close();
      resolvePrompt(answer.trim());
    });
    muted = true;
  });
}

const secret = process.env.TEAM_SECRET || await askSecret();
if (!secret) {
  console.error("No secret given — nothing to generate.");
  process.exit(1);
}

/* ---- build -------------------------------------------------------- */

const players = JSON.parse(readFileSync(join(root, "data", "players.json"), "utf8"));

function codeFor(playerKey) {
  const bytes = createHmac("sha256", secret).update(playerKey).digest();
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

const pad = Math.max(...players.map((p) => p.name.length)) + 4;
const lines = [];

lines.push("BENDERS AVAILABILITY — PERSONAL ACCESS LINKS");
lines.push("Generated " + new Date().toLocaleString());
lines.push("Site: " + site);
lines.push("");
lines.push("Treat these like passwords. Each link lets that person mark their own");
lines.push("row; the captain link can mark anyone and can reset the whole grid.");
lines.push("Text each player only their own link. Opening it once claims their");
lines.push("column — after that the plain site URL remembers who they are.");
lines.push("");
lines.push("Lost this file? Re-run scripts/make_links.mjs with the same team");
lines.push("secret and you get the same links back. Changed the secret? Every");
lines.push("link below stops working and everyone needs a new one.");
lines.push("");
lines.push("-".repeat(78));
lines.push("");

for (const player of players) {
  const role = player.role === "goalie" ? " (G)" : player.role === "captain" ? " (C)" : "";
  lines.push((player.name + role).padEnd(pad) + `${site}#me=${player.key}&k=${codeFor(player.key)}`);
}

lines.push("");
lines.push("-".repeat(78));
lines.push("");
lines.push("CAPTAIN LINK — edits every row, plus Import and Reset. Keep this one to");
lines.push("yourself.");
lines.push(`${site}#me=&k=${codeFor(CAPTAIN_KEY)}`);
lines.push("");
lines.push("Anyone without a link can still read the grid, just not change it.");
lines.push("");

const output = lines.join("\n");

if (outPath) {
  writeFileSync(outPath, output, { mode: 0o600 });
  try { chmodSync(outPath, 0o600); } catch (err) { /* best effort */ }
  console.error(`\nSaved ${players.length} player links + captain link to:\n  ${outPath}\n`);
  console.error("File permissions set to owner-only. Treat it like a password file.\n");
} else {
  console.log(output);
}
