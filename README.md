# Duel Arena — Automated Engine, Milestone 1

This is the first real step toward the automated (non-manual) duel mode:
just proving that the actual ocgcore rules engine — compiled to
WebAssembly by the `@n1xx1/ocgcore-wasm` project — can load inside a
browser page built with Vite.

It does **not** run a duel yet. No card scripts or card database are
wired up at this stage. This step exists purely to test the single
riskiest unknown in the whole plan before we invest time in sourcing
thousands of card scripts and a full card database.

## Setup

1. Drop these files into your `duel-arena` repo folder (the one you
   already cloned).
2. `npm install`
   This installs Vite. Already confirmed working from Claude's side.
3. `npx jsr add @n1xx1/ocgcore-wasm`
   This installs the actual engine package. **This could not be tested
   from Claude's side** — the sandbox Claude runs in can't reach JSR's
   registry (`npm.jsr.io`), so this is the first genuinely untested step
   in the whole project. Whatever happens here, screenshot it.
4. `npm run dev`
   Starts a local dev server and prints a URL, usually
   `http://localhost:5173`.
5. Open that URL in your browser.

## What you should see

Either:
- **"✅ Engine loaded successfully."** plus a list of what the engine
  exposes — this means the hardest part of this whole project just
  cleared, and we can move on to sourcing card scripts and the card
  database next.
- **"❌ Engine failed to load."** plus an error and stack trace — this
  is expected to be a real possibility on a first attempt. Send me the
  exact text and we'll debug from there.

## What to send back either way

- What the browser page shows (copy the text, or a screenshot)
- Anything printed in the browser's dev console (F12 → Console tab) —
  there may be extra detail there even on success
- The exact output of the `npx jsr add` command from your terminal
