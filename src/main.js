import createCore from "@n1xx1/ocgcore-wasm";

const output = document.getElementById("output");

async function testEngineLoads() {
  try {
    const lib = await createCore({ sync: true });
    const hasCreateDuel = typeof lib.createDuel === "function";

    output.textContent =
      "✅ Engine loaded successfully.\n\n" +
      "createDuel() available: " + (hasCreateDuel ? "yes" : "no — check exports below") + "\n\n" +
      "Full list of what the engine exposes:\n" + Object.keys(lib).join(", ");

    console.log("ocgcore-wasm loaded:", lib);
  } catch (err) {
    output.textContent =
      "❌ Engine failed to load.\n\n" +
      (err && err.stack ? err.stack : String(err));
    console.error(err);
  }
}

testEngineLoads();