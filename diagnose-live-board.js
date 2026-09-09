// ===== Duel Arena — live board / position diagnostic =====
// Run this any time during an active "Play vs NPC" duel (paste into the
// browser console, F12 -> Console, press Enter). No setup needed — it reads
// the board state that's already exposed as window.__liveDuelState.

(function () {
  console.log("%c--- Live board diagnostic ---", "font-weight:bold;color:#e4c976;");

  const state = window.__liveDuelState;
  if (!state) {
    console.log("No __liveDuelState found — is a 'Play vs NPC' duel actually running right now?");
    return;
  }

  console.log("LP:", state.lp, " | Turn player:", state.turnPlayer, " | Phase:", state.phase);

  [0, 1].forEach(seat => {
    console.log(`\n--- Player ${seat} (${seat === 0 ? "You" : "NPC"}) ---`);
    console.log("Hand:", state.zones[seat].hand.length, "card(s) —", state.zones[seat].hand.map(c => c.code));
    console.log("Deck:", state.zones[seat].deck, " Extra:", state.zones[seat].extra,
      " GY:", state.zones[seat].grave.length, " Banished:", state.zones[seat].removed.length);

    console.log("Monster Zones (index 0-4 main, 5-6 EMZ):");
    state.zones[seat].mzone.forEach((c, i) => {
      if (!c) return;
      console.log(`  [${i}] code=${c.code} position=${c.position} (binary: ${c.position.toString(2).padStart(4,'0')})`,
        "-> FACEUP_ATK:"+!!(c.position&1), "FACEDOWN_ATK:"+!!(c.position&2), "FACEUP_DEF:"+!!(c.position&4), "FACEDOWN_DEF:"+!!(c.position&8));
    });

    console.log("Spell/Trap Zones:");
    state.zones[seat].szone.forEach((c, i) => {
      if (!c) return;
      console.log(`  [${i}] code=${c.code} position=${c.position} (binary: ${c.position.toString(2).padStart(4,'0')})`,
        "-> FACEUP_ATK:"+!!(c.position&1), "FACEDOWN_ATK:"+!!(c.position&2), "FACEUP_DEF:"+!!(c.position&4), "FACEDOWN_DEF:"+!!(c.position&8));
    });

    if (state.zones[seat].field) {
      const c = state.zones[seat].field;
      console.log("Field Zone: code="+c.code+" position="+c.position);
    }
  });

  console.log("\n%c--- end diagnostic ---", "font-weight:bold;color:#e4c976;");
  console.log("Position bit reference: 1=face-up ATK, 2=face-down ATK, 4=face-up DEF, 8=face-down DEF.");
  console.log("A value like 10 (8+2) or 3 (1+2) means the engine reported a COMBINED flag for that card.");
})();
