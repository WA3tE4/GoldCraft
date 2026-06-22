// Cellular-automaton liquids: water & lava that obey gravity, seek their own
// level, fill containers, and spread sideways — instead of sitting as static
// tiles. Each cell carries a fractional `mass` (0..~1) in a parallel array; the
// tile id (WATER/LAVA) is just the *type* marker, derived from the masses each
// step. Mass is conserved, so a pool never magics itself into infinite water.
//
// This is the classic mass-transfer model (down with compression, then sideways
// equalisation, then a little upward pressure). Lava reuses the same rules but
// flows on fewer ticks, so it creeps. Where water and lava meet, the lava is
// chilled to stone with a hiss of steam.
import { TILE_IDS, isSolid } from "./tiles.js";

const MAX_MASS = 1.0;        // a "full" cell
const MAX_COMPRESS = 0.02;   // extra mass a deep cell accepts (pressure)
const MIN_MASS = 0.0001;     // below this a cell is considered empty
const MIN_FLOW = 0.01;       // smoothing threshold for nicer-looking flow
const MAX_SPEED = 1.0;       // most mass a cell can shed downward per step
const SETTLE_EPS = 0.06;     // total movement below which the sim goes to sleep
const LAVA_EVERY = 3;        // lava only flows on every Nth step (viscosity)

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// How much mass the *lower* of two stacked cells should hold so the pair is at
// rest: a full cell below, plus a share of any compression from above.
function stableState(total) {
  if (total <= MAX_MASS) return MAX_MASS;
  if (total < 2 * MAX_MASS + MAX_COMPRESS)
    return (MAX_MASS * MAX_MASS + total * MAX_COMPRESS) / (MAX_MASS + MAX_COMPRESS);
  return (total + MAX_COMPRESS) / 2;
}

// One redistribution pass for a single liquid. Reads `mass`, writes the next
// state into `nm` (a reused scratch buffer), then copies back. Returns the total
// amount of mass that moved — used to decide when the whole sim has settled.
function flowPass(world, mass, nm) {
  const { w, h, tiles } = world;
  nm.set(mass);
  let moved = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (isSolid(tiles[i])) continue; // solid tiles block flow; liquids/air pass
      let remaining = mass[i];
      if (remaining <= MIN_MASS) continue;

      // --- down (with compression) ---
      if (y + 1 < h) {
        const bi = i + w;
        if (!isSolid(tiles[bi])) {
          let flow = stableState(remaining + mass[bi]) - mass[bi];
          if (flow > MIN_FLOW) flow *= 0.5;
          flow = clamp(flow, 0, Math.min(MAX_SPEED, remaining));
          nm[i] -= flow; nm[bi] += flow; remaining -= flow; moved += flow;
        }
      }
      if (remaining <= MIN_MASS) continue;

      // --- left ---
      if (x > 0) {
        const li = i - 1;
        if (!isSolid(tiles[li])) {
          let flow = (mass[i] - mass[li]) / 4;
          if (flow > MIN_FLOW) flow *= 0.5;
          flow = clamp(flow, 0, remaining);
          nm[i] -= flow; nm[li] += flow; remaining -= flow; moved += flow;
        }
      }
      if (remaining <= MIN_MASS) continue;

      // --- right ---
      if (x + 1 < w) {
        const ri = i + 1;
        if (!isSolid(tiles[ri])) {
          let flow = (mass[i] - mass[ri]) / 4;
          if (flow > MIN_FLOW) flow *= 0.5;
          flow = clamp(flow, 0, remaining);
          nm[i] -= flow; nm[ri] += flow; remaining -= flow; moved += flow;
        }
      }
      if (remaining <= MIN_MASS) continue;

      // --- up (pressure pushes excess into the cell above) ---
      if (y > 0) {
        const ui = i - w;
        if (!isSolid(tiles[ui])) {
          let flow = remaining - stableState(remaining + mass[ui]);
          if (flow > MIN_FLOW) flow *= 0.5;
          flow = clamp(flow, 0, Math.min(MAX_SPEED, remaining));
          nm[i] -= flow; nm[ui] += flow; remaining -= flow; moved += flow;
        }
      }
    }
  }

  mass.set(nm);
  return moved;
}

// After the flow passes, turn masses back into tile ids and resolve any cell
// that now holds both liquids (water + lava -> stone, emitting steam).
function reconcile(world) {
  const { w, tiles, water, lava } = world;
  const steam = world._steam;
  for (let i = 0; i < tiles.length; i++) {
    const id = tiles[i];
    if (isSolid(id)) { // a genuine solid can't carry liquid
      if (water[i] || lava[i]) { water[i] = 0; lava[i] = 0; }
      continue;
    }
    if (water[i] > MIN_MASS && lava[i] > MIN_MASS) {
      const tx = i % w, ty = (i / w) | 0;
      water[i] = 0; lava[i] = 0;
      world.set(tx, ty, TILE_IDS.STONE); // chilled to rock
      steam.push(tx, ty);
      continue;
    }
    if (water[i] <= MIN_MASS) water[i] = 0;
    if (lava[i] <= MIN_MASS) lava[i] = 0;
    const newId = lava[i] > MIN_MASS ? TILE_IDS.LAVA
                : water[i] > MIN_MASS ? TILE_IDS.WATER
                : TILE_IDS.AIR;
    // liquids & air are all non-opaque, so a swap here never affects skyTop.
    if (newId !== id) tiles[i] = newId;
  }
}

// Advance the simulation one step. Cheap to call: returns immediately while the
// world is at rest, and puts itself back to sleep once movement dies down.
export function stepLiquids(world) {
  if (!world.liquidActive) return;
  world._liqTick = (world._liqTick + 1) | 0;
  let moved = flowPass(world, world.water, world._nw);
  if (world._liqTick % LAVA_EVERY === 0) moved += flowPass(world, world.lava, world._nl);
  reconcile(world);
  if (moved < SETTLE_EPS) world.liquidActive = false;
}
