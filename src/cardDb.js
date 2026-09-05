import initSqlJs from "sql.js";

// Real ocgcore type bit flags (confirmed earlier from the engine's own exports).
const TYPE_PENDULUM = 16777216;
const TYPE_LINK = 67108864;

let db = null;

export async function initCardDatabase() {
  if (db) return;
  const SQL = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
  const res = await fetch("/cards.cdb");
  if (!res.ok) throw new Error("Failed to fetch /cards.cdb (HTTP " + res.status + ")");
  const buf = await res.arrayBuffer();
  db = new SQL.Database(new Uint8Array(buf));
}

function unpackSetcodes(raw) {
  let big;
  try { big = BigInt(raw || 0); } catch (e) { big = 0n; }
  const codes = [];
  for (let i = 0; i < 4; i++) {
    const chunk = Number((big >> BigInt(16 * i)) & 0xffffn); // plain number, not BigInt
    if (chunk !== 0) codes.push(chunk);
  }
  return codes;
}

export function queryCard(code) {
  if (!db) throw new Error("Card database not initialized — call initCardDatabase() first.");
  const stmt = db.prepare("SELECT id, alias, setcode, type, atk, def, level, race, attribute FROM datas WHERE id = ?");
  stmt.bind([code]);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  if (!row) return null;

  const isPendulum = (row.type & TYPE_PENDULUM) !== 0;
  const isLink = (row.type & TYPE_LINK) !== 0;

  // Pendulum scales are packed into the raw level field; Link Rating monsters
  // repurpose the def field to store the link-marker bitmask instead of a
  // real DEF stat. Standard, documented ocgcore convention — not independently
  // re-verified against a live Pendulum/Link card in this project yet.
  const level = row.level & 0xff;
  const lscale = isPendulum ? (row.level >> 24) & 0xff : 0;
  const rscale = isPendulum ? (row.level >> 16) & 0xff : 0;

  return {
    code: row.id,
    alias: row.alias,
    setcodes: unpackSetcodes(row.setcode),
    type: row.type,
    level,
    race: BigInt(row.race),
    attribute: row.attribute,
    attack: row.atk,
    defense: isLink ? 0 : row.def,
    lscale,
    rscale,
    link_marker: isLink ? row.def : 0,
  };
}