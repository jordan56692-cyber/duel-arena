// main.js — the original Milestone-1-through-5 test page. Unchanged behavior:
// loads the engine, runs one hardcoded Blue-Eyes vs Dark World duel, dumps a
// full text log to the page. Now just a thin wrapper around duelEngine.js so
// the same test harness stays available for debugging the engine in
// isolation, separate from the real app UI.

import { initEngine, startDuel } from "./duelEngine.js";

const output = document.getElementById("output");
function log(msg) { output.textContent += msg + "\n"; }

// Real decks, real cards — Blue-Eyes support vs Dark World.
const DECK_P0 = [
  { code: 89631133, qty: 3 }, // Blue-Eyes White Dragon
  { code: 79814787, qty: 3 }, // The White Stone of Legend
  { code: 8240199,  qty: 2 }, // Sage with Eyes of Blue
  { code: 88241506, qty: 2 }, // Maiden with Eyes of Blue
  { code: 45467446, qty: 2 }, // Dragon Spirit of White
  { code: 38120068, qty: 2 }, // Trade-In
  { code: 39701395, qty: 2 }, // Cards of Consonance
  { code: 48800175, qty: 2 }, // The Melody of Awakening Dragon
  { code: 6853254,  qty: 2 }, // Return of the Dragon Lords
];
const DECK_P1 = [
  { code: 79126789, qty: 2 }, // Broww, Huntsman of Dark World
  { code: 32619583, qty: 2 }, // Sillva, Warlord of Dark World
  { code: 78004197, qty: 2 }, // Goldd, Wu-Lord of Dark World
  { code: 33731070, qty: 2 }, // Beiige, Vanguard of Dark World
  { code: 60228941, qty: 2 }, // Snoww, Unlight of Dark World
  { code: 34230233, qty: 2 }, // Grapha, Dragon Lord of Dark World
  { code: 33017655, qty: 2 }, // The Gates of Dark World
  { code: 74117290, qty: 2 }, // Dark World Dealings
  { code: 93554166, qty: 2 }, // Dark World Lightning
  { code: 31550470, qty: 2 }, // Escape from the Dark Dimension
];

async function main() {
  output.textContent = "";
  await initEngine({ onLog: log });
  await startDuel({ deckP0: DECK_P0, deckP1: DECK_P1, onLog: log });
}

main().catch((err) => {
  log("\n❌ Unhandled error:\n" + (err && err.stack ? err.stack : String(err)));
  console.error(err);
});
