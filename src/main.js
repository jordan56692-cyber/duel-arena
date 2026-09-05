import createCore, { OcgDuelMode, OcgProcessResult, ocgMessageTypeStrings, OcgPosition, OcgLocation, OcgResponseType, SelectIdleCMDAction, SelectBattleCMDAction } from "@n1xx1/ocgcore-wasm";
import { initCardDatabase, queryCard } from "./cardDb.js";

const output = document.getElementById("output");

// Shared root/utility scripts every duel needs, regardless of which cards are in play.
const UTILITY_SCRIPT_FILES = [
  "constant.lua", "utility.lua", "card_counter_constants.lua", "archetype_setcode_constants.lua",
  "debug_utility.lua", "chain.lua", "cards_specific_functions.lua", "proc_fusion.lua",
  "proc_fusion_spell.lua", "proc_ritual.lua", "proc_synchro.lua", "proc_union.lua", "proc_xyz.lua",
  "proc_pendulum.lua", "proc_link.lua", "proc_equip.lua", "proc_persistent.lua", "proc_workaround.lua",
  "proc_normal.lua", "proc_skill.lua", "proc_rush.lua", "proc_maximum.lua", "proc_gemini.lua",
  "proc_spirit.lua", "proc_unofficial.lua", "deprecated_functions.lua",
];

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

function log(msg) { output.textContent += msg + "\n"; }
function stringifySafe(obj) {
  return JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() + "n" : v));
}

// field_mask is a single 32-bit value covering EVERY zone type at once — different
// bit ranges are "available" depending on which kind of zone is actually being asked
// about. We detect which range has free bits, rather than assuming based on context.
function detectZoneLocation(fieldMask) {
  for (let i = 0; i < 7; i++) {
    if ((fieldMask & (1 << i)) === 0) return OcgLocation.MZONE;
  }
  for (let i = 8; i <= 12; i++) {
    if ((fieldMask & (1 << i)) === 0) return OcgLocation.SZONE;
  }
  if ((fieldMask & (1 << 7)) === 0) return OcgLocation.FZONE;
  return OcgLocation.MZONE;
}
function firstEmptyZone(fieldMask, offset, count) {
  for (let i = 0; i < count; i++) {
    if ((fieldMask & (1 << (offset + i))) === 0) return i;
  }
  return 0;
}
function selectIndices(msg, RTYPE, field) {
  if (msg.can_cancel && (msg.min || 0) === 0) return { type: RTYPE, [field]: null };
  const count = Math.max(1, msg.min || 1);
  const list = [];
  for (let i = 0; i < count && i < (msg.selects ? msg.selects.length : 0); i++) list.push(i);
  return { type: RTYPE, [field]: list };
}

function respond(lib, handle, typeName, msg) {
  switch (typeName) {
    case "select_idlecmd": {
      if (msg.activates && msg.activates.length > 0) {
        log("-> Activating " + msg.activates[0].code + " (player " + msg.player + ")");
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: 0 });
      } else if (msg.summons && msg.summons.length > 0) {
        log("-> Normal Summoning " + msg.summons[0].code + " (player " + msg.player + ")");
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 0 });
      } else if (msg.special_summons && msg.special_summons.length > 0) {
        log("-> Special Summoning " + msg.special_summons[0].code + " (player " + msg.player + ")");
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index: 0 });
      } else if (msg.spell_sets && msg.spell_sets.length > 0) {
        log("-> Setting " + msg.spell_sets[0].code + " face-down (player " + msg.player + ")");
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPELL_SET, index: 0 });
      } else if (msg.to_bp) {
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null });
      } else {
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null });
      }
      return true;
    }
    case "select_battlecmd": {
      if (msg.attacks && msg.attacks.length > 0) {
        log("-> Declaring attack with attacker index 0 (player " + msg.player + ")");
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 });
      } else if (msg.to_m2) {
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null });
      } else {
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null });
      }
      return true;
    }
    case "select_place":
    case "select_disfield": {
      const location = detectZoneLocation(msg.field_mask);
      let offset = 0, count = 7;
      if (location === OcgLocation.SZONE) { offset = 8; count = 5; }
      else if (location === OcgLocation.FZONE) { offset = 7; count = 1; }
      const zone = firstEmptyZone(msg.field_mask, offset, count);
      log("-> Placing in zone " + zone + " (location " + location + ") for player " + msg.player);
      const rt = typeName === "select_place" ? OcgResponseType.SELECT_PLACE : OcgResponseType.SELECT_DISFIELD;
      lib.duelSetResponse(handle, { type: rt, places: [{ player: msg.player, location, sequence: zone }] });
      return true;
    }
    case "select_position":
      lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_ATTACK });
      return true;
    case "select_chain":
      lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_CHAIN, index: msg.forced && msg.selects && msg.selects.length > 0 ? 0 : null });
      return true;
    case "select_effectyn":
      lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_EFFECTYN, yes: false });
      return true;
    case "select_yesno":
      lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_YESNO, yes: false });
      return true;
    case "select_option":
      lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_OPTION, index: 0 });
      return true;
    case "select_card":
      log("-> Selecting card(s) from a forced choice");
      lib.duelSetResponse(handle, selectIndices(msg, OcgResponseType.SELECT_CARD, "indicies"));
      return true;
    case "select_unselect_card":
      lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_UNSELECT_CARD, index: msg.can_cancel ? null : 0 });
      return true;
    case "select_card_codes":
      lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_CARD_CODES, codes: null });
      return true;
    case "select_tribute":
      lib.duelSetResponse(handle, selectIndices(msg, OcgResponseType.SELECT_TRIBUTE, "indicies"));
      return true;
    case "select_counter":
      lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_COUNTER, counters: [] });
      return true;
    case "select_sum":
      lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_SUM, indicies: [] });
      return true;
    case "sort_card":
      lib.duelSetResponse(handle, { type: OcgResponseType.SORT_CARD, order: null });
      return true;
    case "announce_race":
      lib.duelSetResponse(handle, { type: OcgResponseType.ANNOUNCE_RACE, races: [] });
      return true;
    case "announce_attrib":
      lib.duelSetResponse(handle, { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: [] });
      return true;
    case "announce_card":
      lib.duelSetResponse(handle, { type: OcgResponseType.ANNOUNCE_CARD, card: 0 });
      return true;
    case "announce_number":
      lib.duelSetResponse(handle, { type: OcgResponseType.ANNOUNCE_NUMBER, value: 0 });
      return true;
    case "rock_paper_scissors":
      lib.duelSetResponse(handle, { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 1 });
      return true;
    default:
      return false;
  }
}

async function fetchUtilityScripts() {
  const scripts = {};
  for (const name of UTILITY_SCRIPT_FILES) {
    const res = await fetch("/scripts/" + name);
    if (!res.ok) throw new Error("Failed to fetch /scripts/" + name);
    scripts[name] = await res.text();
  }
  return scripts;
}

async function fetchCardScript(code) {
  try {
    const res = await fetch("/scripts/official/c" + code + ".lua");
    if (!res.ok) return null;
    const text = await res.text();
    // Vite serves index.html (HTTP 200) for unmatched paths instead of a real 404 —
    // treat that the same as "no script needed for this card."
    if (text.trim().startsWith("<")) return null;
    return text;
  } catch (e) {
    console.warn("Could not fetch script for", code, e);
    return null;
  }
}

async function run() {
  output.textContent = "";
  log("Initializing the real card database (cards.cdb via sql.js)...");
  await initCardDatabase();
  log("Card database ready.\n");

  log("Fetching the real utility scripts from /scripts/ ...");
  const scripts = await fetchUtilityScripts();
  log("All " + UTILITY_SCRIPT_FILES.length + " utility scripts loaded.\n");

  const allCodes = [...new Set([...DECK_P0, ...DECK_P1].map((c) => c.code))];
  log("Looking up real card data for " + allCodes.length + " unique cards...");
  const cardCache = {};
  for (const code of allCodes) {
    const data = queryCard(code);
    if (data) cardCache[code] = data;
    else log("⚠️ No database entry found for card code " + code);
  }
  log("Card data loaded.\n");

  log("Fetching card-specific scripts for cards that have effects...");
  for (const code of allCodes) {
    const text = await fetchCardScript(code);
    if (text) {
      scripts["c" + code + ".lua"] = text;
      log("-> Script found for " + code);
    }
  }
  log("Card scripts loaded.\n");

  log("Loading engine...");
  const lib = await createCore({ sync: true });
  log("Engine loaded. Creating duel...\n");

  const handle = lib.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed: [1n, 1n, 1n, 1n],
    team1: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
    team2: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
    cardReader: (code) => cardCache[code] ?? null,
    scriptReader: (name) => (scripts[name] !== undefined ? scripts[name] : null),
    errorHandler: (type, text) => log("⚠️ engine error [" + type + "]: " + text),
  });

  if (!handle) { log("❌ createDuel returned null."); return; }
  log("Duel handle created. Priming shared utility scripts...");
  lib.loadScript(handle, "constant.lua", scripts["constant.lua"]);
  lib.loadScript(handle, "utility.lua", scripts["utility.lua"]);
  log("Adding cards to each deck...\n");

  for (const { code, qty } of DECK_P0) {
    for (let i = 0; i < qty; i++) {
      lib.duelNewCard(handle, { code, controller: 0, duelist: 0, team: 0, location: OcgLocation.DECK, position: OcgPosition.FACEDOWN_DEFENSE, sequence: 2 });
    }
  }
  for (const { code, qty } of DECK_P1) {
    for (let i = 0; i < qty; i++) {
      lib.duelNewCard(handle, { code, controller: 1, duelist: 0, team: 1, location: OcgLocation.DECK, position: OcgPosition.FACEDOWN_DEFENSE, sequence: 2 });
    }
  }
  log("40 cards added. Starting the duel...\n");

  lib.startDuel(handle);

  let iterations = 0;
  const MAX_ITER = 1000;
  let lastRealTypeName = null, lastRealMsg = null;
  let duelOver = false;

  while (iterations < MAX_ITER && !duelOver) {
    iterations++;
    const status = lib.duelProcess(handle);
    const messages = lib.duelGetMessage(handle);
    for (const m of messages) {
      const typeName = ocgMessageTypeStrings.get(m.type) ?? ("unknown(" + m.type + ")");
      log("[" + typeName + "] " + stringifySafe(m));
      if (typeName === "win") {
        const reasonMap = { 1: "LP reached 0", 2: "deck-out (opponent had no cards left to draw)" };
        log("\n🏆 GAME OVER — player " + m.player + " wins (" + (reasonMap[m.reason] || "reason code " + m.reason) + ").");
        duelOver = true;
        break;
      }
      if (typeName === "retry") {
        log("   (engine rejected the previous response — retrying)");
      } else {
        lastRealTypeName = typeName;
        lastRealMsg = m;
      }
    }
    if (duelOver) break;
    if (status === OcgProcessResult.END) { log("\n--- duel signaled END ---"); break; }
    if (status === OcgProcessResult.WAITING) {
      const handled = lastRealMsg ? respond(lib, handle, lastRealTypeName, lastRealMsg) : false;
      if (!handled) {
        log("\n--- stopped: don't yet know how to answer [" + lastRealTypeName + "] ---");
        break;
      }
    }
  }
  if (iterations >= MAX_ITER && !duelOver) log("\n--- stopped after " + MAX_ITER + " iterations (safety cap) ---");

  lib.destroyDuel(handle);
}

run().catch((err) => {
  log("\n❌ Unhandled error:\n" + (err && err.stack ? err.stack : String(err)));
  console.error(err);
});