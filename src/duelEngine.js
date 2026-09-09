// duelEngine.js — the real ocgcore engine, wrapped so any UI can drive it.
//
// This is a straight extraction of the working Milestone 5 logic from main.js,
// split into two phases so a real app only pays the ~10s init cost ONCE:
//
//   initEngine()                      — call once, when the app opens
//   startDuel({ deckP0, deckP1, ... }) — call per duel, with whatever decks
//                                        the player actually picked
//
// Nothing about the engine mechanics has changed from the version that ran
// Blue-Eyes vs Dark World cleanly to completion — this is a reshuffle of
// where the code lives, not a rewrite of how it behaves.

import createCore, {
  OcgDuelMode, OcgProcessResult, ocgMessageTypeStrings, OcgPosition,
  OcgLocation, OcgResponseType, SelectIdleCMDAction, SelectBattleCMDAction,
} from "@n1xx1/ocgcore-wasm";
import { initCardDatabase, queryCard } from "./cardDb.js";

// Shared root/utility scripts every duel needs, regardless of which cards are in play.
const UTILITY_SCRIPT_FILES = [
  "constant.lua", "utility.lua", "card_counter_constants.lua", "archetype_setcode_constants.lua",
  "debug_utility.lua", "chain.lua", "cards_specific_functions.lua", "proc_fusion.lua",
  "proc_fusion_spell.lua", "proc_ritual.lua", "proc_synchro.lua", "proc_union.lua", "proc_xyz.lua",
  "proc_pendulum.lua", "proc_link.lua", "proc_equip.lua", "proc_persistent.lua", "proc_workaround.lua",
  "proc_normal.lua", "proc_skill.lua", "proc_rush.lua", "proc_maximum.lua", "proc_gemini.lua",
  "proc_spirit.lua", "proc_unofficial.lua", "deprecated_functions.lua",
];

// ---- module-level state, populated once by initEngine() ----
let lib = null;
let utilityScripts = null; // { "constant.lua": "...", ... } — same object reused/extended per duel

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

// The naive "always plays something, never declines, always index 0" bot.
// This is what makes duels run to completion unattended — fine for testing
// and for a future NPC opponent, but a real human player needs their choices
// routed through the UI instead of through this function (that's a
// separate, later piece of work — see README notes on respondFn below).
export function getLib(){ return lib; }

export function defaultRespond(handle, typeName, msg, onLog) {
  const log = onLog || (() => {});
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
    case "select_unselect_card": {
      // index semantics, straight from the package's own index.d.ts:
      //   null                          -> cancel/finish with current selection
      //   0..select_cards.length-1      -> select that card from select_cards
      //   select_cards.length and above -> unselect that card from unselect_cards
      // Bug this replaced: always sending null ("cancel") whenever can_cancel
      // was true meant min:1 never got satisfied, the engine reverted the
      // attempt, and the same special-summon offer came right back on the
      // next select_idlecmd -> genuine infinite loop (this is what caused
      // the Grapha special-summon loop, not the iteration cap being too low).
      if (msg.select_cards && msg.select_cards.length > 0 && !msg.can_finish) {
        log("-> Selecting card 0 of " + msg.select_cards.length + " offered (toward min " + msg.min + ")");
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 });
      } else {
        log("-> Finishing select/unselect (can_finish=" + msg.can_finish + ")");
        lib.duelSetResponse(handle, { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null });
      }
      return true;
    }
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

/**
 * Call once when the app opens. Loads the card database, the 26 shared
 * utility scripts, and the WASM engine itself. Safe to call more than once —
 * later calls are a no-op if already initialized.
 */
export async function initEngine({ onLog } = {}) {
  const log = onLog || (() => {});
  if (lib && utilityScripts) { log("Engine already initialized."); return; }

  log("Initializing the real card database (cards.cdb via sql.js)...");
  await initCardDatabase();
  log("Card database ready.");

  log("Fetching the real utility scripts from /scripts/ ...");
  utilityScripts = await fetchUtilityScripts();
  log("All " + UTILITY_SCRIPT_FILES.length + " utility scripts loaded.");

  log("Loading engine...");
  lib = await createCore({ sync: true });
  log("Engine loaded and ready.");
}

/**
 * Call once per duel, after initEngine() has resolved.
 *
 * deckP0 / deckP1: arrays of { code, qty } — real YGOPRODeck passcodes.
 * onMessage(m, typeName): fired for every raw engine message (for rendering
 *   a real board — hook into "move", "summoning", "damage", "new_phase", etc.).
 * onLog(str): fired for human-readable progress lines (optional, for a debug
 *   console alongside the real board).
 * respondFn(handle, typeName, msg): optional override for how idle/battle/etc.
 *   commands get answered. Defaults to the naive always-play-something bot
 *   (defaultRespond) if omitted — pass your own here once human input or a
 *   dedicated NPC AI is wired into the UI.
 *
 * Returns { winner, reason } when the duel ends naturally, or throws if it
 * stops early on an unhandled message type.
 */
// Three of the four seed words used to be hardcoded constants (1n, 1n, 1n),
// with only a timestamp varying — that's very likely why opening draws
// looked repetitive across duels. All four words are now independently
// randomized every call.
function randomSeedWord(){
  return (BigInt(Math.floor(Math.random() * 0xFFFFFFFF)) << 32n) | BigInt(Math.floor(Math.random() * 0xFFFFFFFF));
}

export async function startDuel({
  deckP0,
  deckP1,
  onMessage,
  onLog,
  respondFn,
  maxIterations = 1000,
} = {}) {
  if (!lib || !utilityScripts) throw new Error("startDuel() called before initEngine() finished.");
  const log = onLog || (() => {});
  const emit = onMessage || (() => {});
  const respond = respondFn || ((handle, typeName, msg) => defaultRespond(handle, typeName, msg, log));

  // Per-duel copy of scripts — utility scripts are shared/reused, card-specific
  // scripts get added fresh since different decks need different cards.
  const scripts = { ...utilityScripts };

  const allCodes = [...new Set([...deckP0, ...deckP1].map((c) => c.code))];
  log("Looking up real card data for " + allCodes.length + " unique cards...");
  const cardCache = {};
  for (const code of allCodes) {
    const data = queryCard(code);
    if (data) cardCache[code] = data;
    else log("⚠️ No database entry found for card code " + code);
  }

  log("Fetching card-specific scripts for cards that have effects...");
  for (const code of allCodes) {
    const text = await fetchCardScript(code);
    if (text) scripts["c" + code + ".lua"] = text;
  }

  log("Creating duel...");
  const seed = [randomSeedWord(), randomSeedWord(), randomSeedWord(), randomSeedWord()];
  // PSEUDO_SHUFFLE is a real, literally-named engine flag documented as
  // "Disable decks shuffling." If MODE_MR5's bundled preset happens to
  // include that bit, shuffling would never actually happen regardless of
  // seed — which would exactly explain identical draw order every duel.
  // Clearing it defensively costs nothing even if it turns out not to be
  // the cause. console.log (not .debug) so this isn't hidden by a
  // "Verbose" console filter, which console.debug output can be by default.
  const flags = OcgDuelMode.MODE_MR5 & ~OcgDuelMode.PSEUDO_SHUFFLE;
  console.log("[duel setup] seed:", seed.map(String), "| MODE_MR5:", OcgDuelMode.MODE_MR5.toString(), "| PSEUDO_SHUFFLE bit was set:", (OcgDuelMode.MODE_MR5 & OcgDuelMode.PSEUDO_SHUFFLE) !== 0n, "| final flags:", flags.toString());
  const handle = lib.createDuel({
    flags,
    seed,
    team1: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
    team2: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
    cardReader: (code) => cardCache[code] ?? null,
    scriptReader: (name) => (scripts[name] !== undefined ? scripts[name] : null),
    errorHandler: (type, text) => log("⚠️ engine error [" + type + "]: " + text),
  });
  if (!handle) throw new Error("createDuel returned null.");

  log("Duel handle created. Priming shared utility scripts...");
  lib.loadScript(handle, "constant.lua", scripts["constant.lua"]);
  lib.loadScript(handle, "utility.lua", scripts["utility.lua"]);

  // duelNewCard returns a Promise and was never being awaited here — every
  // insert fires "fire and forget," meaning all 40 deck insertions (each of
  // which is documented to shuffle whatever's currently in the deck at that
  // moment) could race against each other with no guaranteed ordering. That
  // would make the resulting order depend on scheduling/timing rather than
  // the RNG seed, which would exactly explain a deterministic result
  // regardless of a genuinely-varying seed. Properly sequencing them is the
  // real fix, not another seed change.
  for (const { code, qty } of deckP0) {
    for (let i = 0; i < qty; i++) {
      await lib.duelNewCard(handle, { code, controller: 0, duelist: 0, team: 0, location: OcgLocation.DECK, position: OcgPosition.FACEDOWN_DEFENSE, sequence: 2 });
    }
  }
  for (const { code, qty } of deckP1) {
    for (let i = 0; i < qty; i++) {
      await lib.duelNewCard(handle, { code, controller: 1, duelist: 0, team: 1, location: OcgLocation.DECK, position: OcgPosition.FACEDOWN_DEFENSE, sequence: 2 });
    }
  }
  log("Cards added. Starting the duel...");
  lib.startDuel(handle);

  let iterations = 0;
  let lastRealTypeName = null, lastRealMsg = null;
  let result = null;

  while (iterations < maxIterations && !result) {
    iterations++;
    const status = lib.duelProcess(handle);
    const messages = lib.duelGetMessage(handle);
    for (const m of messages) {
      const typeName = ocgMessageTypeStrings.get(m.type) ?? ("unknown(" + m.type + ")");
      emit(m, typeName);
      log("[" + typeName + "] " + stringifySafe(m));
      if (typeName === "win") {
        const reasonMap = { 1: "LP reached 0", 2: "deck-out" };
        result = { winner: m.player, reason: reasonMap[m.reason] || ("reason code " + m.reason) };
        log("🏆 GAME OVER — player " + m.player + " wins (" + result.reason + ").");
        break;
      }
      if (typeName === "retry") {
        log("   (engine rejected the previous response — retrying)");
      } else {
        lastRealTypeName = typeName;
        lastRealMsg = m;
      }
    }
    if (result) break;
    if (status === OcgProcessResult.END) { log("--- duel signaled END ---"); break; }
    if (status === OcgProcessResult.WAITING) {
      // Wrapped in Promise.resolve so respondFn can be either synchronous
      // (the bot — answers immediately) or asynchronous (a real human —
      // this await pauses the whole duel loop until they actually click
      // something in the UI). Both work through the exact same code path.
      const handled = lastRealMsg ? await Promise.resolve(respond(handle, lastRealTypeName, lastRealMsg)) : false;
      if (!handled) {
        lib.destroyDuel(handle);
        throw new Error("Don't yet know how to answer [" + lastRealTypeName + "]");
      }
    }
  }
  if (iterations >= maxIterations && !result) {
    log("--- stopped after " + maxIterations + " iterations (safety cap) ---");
  }

  lib.destroyDuel(handle);
  return result;
}
