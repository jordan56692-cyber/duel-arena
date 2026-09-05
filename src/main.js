import createCore, { OcgDuelMode, OcgProcessResult, ocgMessageTypeStrings, OcgPosition, OcgLocation, OcgResponseType, SelectIdleCMDAction, SelectBattleCMDAction } from "@n1xx1/ocgcore-wasm";
import { initCardDatabase, queryCard } from "./cardDb.js";

const output = document.getElementById("output");

// Only the shared root/utility scripts need to be pre-loaded by name.
// Per-card scripts are now fetched dynamically based on whatever's in the decks.
const UTILITY_SCRIPT_FILES = [
  "constant.lua", "utility.lua", "card_counter_constants.lua", "archetype_setcode_constants.lua",
  "debug_utility.lua", "chain.lua", "cards_specific_functions.lua", "proc_fusion.lua",
  "proc_fusion_spell.lua", "proc_ritual.lua", "proc_synchro.lua", "proc_union.lua", "proc_xyz.lua",
  "proc_pendulum.lua", "proc_link.lua", "proc_equip.lua", "proc_persistent.lua", "proc_workaround.lua",
  "proc_normal.lua", "proc_skill.lua", "proc_rush.lua", "proc_maximum.lua", "proc_gemini.lua",
  "proc_spirit.lua", "proc_unofficial.lua", "deprecated_functions.lua",
];

// Example decks — any real card code works now, not just the three we've
// hand-verified before. Man-Eater Bug and Kuriboh have never been touched by
// us directly; they're here to prove the dynamic pipeline for real.
const DECK_P0 = [
  { code: 99785935, qty: 14 }, // Alpha the Magnet Warrior
  { code: 26202165, qty: 3 },  // Sangan
  { code: 54652250, qty: 3 },  // Man-Eater Bug (flip effect — new code path)
];
const DECK_P1 = [
  { code: 64428736, qty: 17 }, // Alligator's Sword
  { code: 40640057, qty: 3 },  // Kuriboh (hand-activated effect — new code path)
];

function log(msg) { output.textContent += msg + "\n"; }
function stringifySafe(obj) {
  return JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() + "n" : v));
}
function firstEmptyZone(fieldMask, maxZones = 7) {
  for (let i = 0; i < maxZones; i++) {
    if ((fieldMask & (1 << i)) === 0) return i;
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
    case "select_idlecmd":
      if (msg.summons && msg.summons.length > 0) {
        log("-> Normal Summoning " + msg.summons[0].code + " (player " + msg.player + ")");
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 0 });
      } else if (msg.to_bp) {
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null });
      } else {
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null });
      }
      return true;
    case "select_battlecmd":
      if (msg.attacks && msg.attacks.length > 0) {
        log("-> Declaring attack with attacker index 0 (player " + msg.player + ")");
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 });
      } else if (msg.to_m2) {
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null });
      } else {
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null });
      }
      return true;
    case "select_place":
    case "select_disfield": {
      const zone = firstEmptyZone(msg.field_mask);
      log("-> Placing in Main Monster Zone " + zone + " for player " + msg.player);
      const rt = typeName === "select_place" ? OcgResponseType.SELECT_PLACE : OcgResponseType.SELECT_DISFIELD;
      lib.duelSetResponse(handle, { type: rt, places: [{ player: msg.player, location: OcgLocation.MZONE, sequence: zone }] });
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
    // Vite serves index.html (status 200) for unmatched paths instead of a real
    // 404 for unusual extensions like .lua — treat that the same as "no script."
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
  const MAX_ITER = 5000;
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