const db = require('./db');

let cache = {};
let lastLoaded = 0;
const TTL = 60_000; // reload every 60s

async function load() {
  const { rows } = await db.query('SELECT key, value FROM bizplan.settings');
  cache = {};
  for (const r of rows) cache[r.key] = r.value;
  lastLoaded = Date.now();
  return cache;
}

async function getAll() {
  if (Date.now() - lastLoaded > TTL) await load();
  return { ...cache };
}

async function get(key) {
  if (Date.now() - lastLoaded > TTL) await load();
  return cache[key];
}

async function set(key, value, updatedBy) {
  await db.query(
    `INSERT INTO bizplan.settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3`,
    [key, String(value), updatedBy || null]
  );
  cache[key] = String(value);
}

async function setMany(entries, updatedBy) {
  for (const [key, value] of Object.entries(entries)) {
    await set(key, value, updatedBy);
  }
}

function invalidate() {
  lastLoaded = 0;
}

module.exports = { load, getAll, get, set, setMany, invalidate };
