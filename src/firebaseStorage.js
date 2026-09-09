// firebaseStorage.js — drop-in replacement for Claude Artifact's window.storage,
// so duel-arena.html's existing get/set calls work unchanged once ported into
// a real deployed site (window.storage only exists inside Claude.ai artifacts).
//
// Same call shape as before: safeGet(key, shared) -> {value: string} | null,
// safeSet(key, value, shared) -> boolean. Values are still stored as raw JSON
// strings, exactly like before, so every JSON.parse(await safeGet(...)) call
// in the app keeps working with zero changes elsewhere.
//
// "shared" vs "private" split: shared:true data (the duel room itself) lives
// under /shared/, shared:false data (each player's hand, face-down cards,
// personal Collection, personal Decks) lives under /private/. NOTE: unlike
// window.storage, this is NOT actually hidden from anyone who knows the path —
// there's no auth layer here. That's an acceptable match for this project's
// existing honor-system design (manual mode already trusts players not to
// peek at each other's screens), but it's worth knowing if this ever needs
// real hidden-hand security later.

import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBTzrrthJkYoEIRjXjYprLhNaXtN9V0sIs",
  authDomain: "duel-arena-7dc3c.firebaseapp.com",
  databaseURL: "https://duel-arena-7dc3c-default-rtdb.firebaseio.com",
  projectId: "duel-arena-7dc3c",
  storageBucket: "duel-arena-7dc3c.firebasestorage.app",
  messagingSenderId: "143882364953",
  appId: "1:143882364953:web:bd2db396b4a8d5e9d36288",
  measurementId: "G-XL3NEXF1D1",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Firebase RTDB keys can't contain '.', '#', '$', '[', ']', or control chars.
// The app's existing keys (e.g. "duel:ABCDE:hand:p1") only use letters,
// digits, and colons/dashes, so this is a safety net, not a normal path.
function sanitize(key) {
  return String(key).replace(/[.#$\[\]]/g, "_");
}
function pathFor(key, shared) {
  return (shared ? "shared/" : "private/") + sanitize(key);
}

export async function safeGet(key, shared) {
  try {
    const snap = await get(ref(db, pathFor(key, shared)));
    if (!snap.exists()) return null;
    return { value: snap.val() };
  } catch (e) {
    console.error("firebase get failed for", key, e);
    return null;
  }
}

export async function safeSet(key, value, shared) {
  try {
    await set(ref(db, pathFor(key, shared)), value);
    return true;
  } catch (e) {
    console.error("firebase set failed for", key, e);
    return false;
  }
}
