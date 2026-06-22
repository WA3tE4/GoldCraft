// Named-world saves + persisted menu settings, stored in localStorage.
// The tile grid is the bulk of the data; we base64-encode the Uint8Array so it
// stays small and JSON-safe. Each world lives under its own key; an index key
// lists their metadata for the load menu.

const INDEX_KEY = "goldcraft.worlds";
const SETTINGS_KEY = "goldcraft.settings";
const worldKey = (name) => "goldcraft.world." + name;

// ----- world index -----
export function listWorlds() {
  try {
    const arr = JSON.parse(localStorage.getItem(INDEX_KEY)) || [];
    return arr.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } catch { return []; }
}
function writeIndex(arr) { localStorage.setItem(INDEX_KEY, JSON.stringify(arr)); }
export function worldExists(name) { return listWorlds().some((w) => w.name === name); }

export function saveWorld(name, mode, { world, player, inventory, time, npcs, bossLair, bossDefeated, tvUrls }) {
  const savedAt = Date.now();
  const data = {
    v: 5, name, mode, savedAt,
    bossLair: bossLair || null,
    bossDefeated: !!bossDefeated,
    w: world.w,
    h: world.h,
    tiles: bytesToBase64(world.tiles),
    walls: bytesToBase64(world.walls),
    player: { x: player.x, y: player.y, vx: player.vx, vy: player.vy, hp: player.hp, maxHp: player.maxHp, buffs: player.buffs },
    inventory: inventory.toJSON(),
    time,
    npcs: npcs || [],
    tvUrls: tvUrls || {},
  };
  localStorage.setItem(worldKey(name), JSON.stringify(data));
  const idx = listWorlds().filter((w) => w.name !== name);
  idx.push({ name, mode, savedAt, w: world.w, h: world.h });
  writeIndex(idx);
  return true;
}

// Returns the parsed world object (tiles/walls decoded), or null if missing.
export function loadWorld(name) {
  const raw = localStorage.getItem(worldKey(name));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    data.tiles = base64ToBytes(data.tiles);
    data.walls = data.walls ? base64ToBytes(data.walls) : null;
    return data;
  } catch (e) {
    console.warn("Failed to load world:", e);
    return null;
  }
}

export function deleteWorld(name) {
  localStorage.removeItem(worldKey(name));
  writeIndex(listWorlds().filter((w) => w.name !== name));
}

// ----- menu settings -----
export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}
export function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
