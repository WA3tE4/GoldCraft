import { SAVE_KEY } from "./config.js";

// Serialize world + player + inventory to a compact JSON blob in localStorage.
// The tile grid is the bulk of the data; we base64-encode the Uint8Array so it
// stays small and JSON-safe. Easy to swap for a download/file later.
export function saveGame({ world, player, inventory, time, npcs }) {
  const data = {
    v: 2,
    w: world.w,
    h: world.h,
    tiles: bytesToBase64(world.tiles),
    player: { x: player.x, y: player.y, vx: player.vx, vy: player.vy, hp: player.hp },
    inventory: inventory.toJSON(),
    time,
    npcs: npcs || [],
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  return true;
}

export function hasSave() {
  return localStorage.getItem(SAVE_KEY) != null;
}

// Returns the parsed save object, or null if none / invalid.
export function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    data.tiles = base64ToBytes(data.tiles);
    return data;
  } catch (e) {
    console.warn("Failed to load save:", e);
    return null;
  }
}

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
