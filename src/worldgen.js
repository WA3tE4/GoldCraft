import { TILE_IDS } from "./tiles.js";

// Tiny seeded value-noise so terrain is deterministic per seed (no deps).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise1D(seed) {
  const rng = mulberry32(seed);
  const grad = new Float32Array(2048);
  for (let i = 0; i < grad.length; i++) grad[i] = rng();
  return function (x) {
    const xi = Math.floor(x);
    const f = x - xi;
    const a = grad[((xi % grad.length) + grad.length) % grad.length];
    const b = grad[(((xi + 1) % grad.length) + grad.length) % grad.length];
    const t = (1 - Math.cos(f * Math.PI)) * 0.5;
    return a * (1 - t) + b * t;
  };
}

// Returns { seed, spawnX, surfaceY, surface:Int32Array, villages:[{x,y}...] }.
export function generate(world, seed = (Math.random() * 1e9) | 0) {
  const noise = makeNoise1D(seed);
  const caveNoise = makeNoise1D(seed ^ 0x9e3779b9);
  const W = world.w, H = world.h;
  const baseHeight = Math.floor(H * 0.40);
  const surface = new Int32Array(W);
  const rng = mulberry32(seed ^ 0x55aa55aa);

  // --- 1. Heightmap + base layers + caves ---
  for (let x = 0; x < W; x++) {
    const hill = noise(x * 0.05) * 18 + noise(x * 0.015) * 34 + noise(x * 0.2) * 5;
    const surfaceY = Math.floor(baseHeight - hill);
    surface[x] = surfaceY;

    for (let y = surfaceY; y < H; y++) {
      let id;
      if (y === surfaceY) id = TILE_IDS.GRASS;
      else if (y < surfaceY + 4) id = TILE_IDS.DIRT;
      else id = TILE_IDS.STONE;

      if (y > surfaceY + 6) {
        const c = caveNoise(x * 0.1 + y * 0.13) + caveNoise(x * 0.05 - y * 0.07);
        if (c > 1.15 && c < 1.42) id = TILE_IDS.AIR;
      }
      world.set(x, y, id);
    }
  }

  // --- 2. Ore veins (deeper = rarer + richer) ---
  // Each entry: id, minDepth below surface, frequency, vein size.
  const ores = [
    { id: TILE_IDS.COAL_ORE,    depth: 5,  freq: 0.012, size: 6 },
    { id: TILE_IDS.IRON_ORE,    depth: 12, freq: 0.009, size: 5 },
    { id: TILE_IDS.GOLD_ORE,    depth: 40, freq: 0.004, size: 4 },
    { id: TILE_IDS.DIAMOND_ORE, depth: 70, freq: 0.0022, size: 3 },
  ];
  for (let x = 0; x < W; x++) {
    for (let y = surface[x] + 4; y < H; y++) {
      if (world.get(x, y) !== TILE_IDS.STONE) continue;
      const depth = y - surface[x];
      for (const ore of ores) {
        if (depth < ore.depth) continue;
        if (rng() < ore.freq) { growVein(world, rng, x, y, ore.id, ore.size); break; }
      }
    }
  }

  // --- 3. Lava lakes deep down, water pools mid-depth ---
  scatterPools(world, rng, surface, TILE_IDS.LAVA, H - 30, H - 4, 6, 0.6);
  scatterPools(world, rng, surface, TILE_IDS.WATER, baseHeight + 10, H - 50, 4, 0.4);

  // --- 4. Surface decoration: sand patches + trees ---
  for (let x = 1; x < W - 1; x++) {
    const sy = surface[x];
    if (rng() < 0.02) { // small sand beaches
      for (let dx = 0; dx < 4 + (rng() * 4 | 0) && x + dx < W; dx++) {
        const s = surface[x + dx];
        world.set(x + dx, s, TILE_IDS.SAND);
        world.set(x + dx, s + 1, TILE_IDS.SAND);
      }
      x += 6;
    }
  }
  const villages = [];
  for (let x = 4; x < W - 6; x++) {
    if (rng() < 0.055 && world.get(x, surface[x]) === TILE_IDS.GRASS) {
      placeTree(world, rng, x, surface[x]); x += 3;
    }
  }

  // --- 5. Villages: a few flat houses with a workbench + torches ---
  let attempts = 0, placed = 0;
  while (placed < 3 && attempts < 60) {
    attempts++;
    const x = 12 + (rng() * (W - 30) | 0);
    if (isFlatEnough(surface, x, 9)) {
      villages.push(buildHouse(world, surface, x));
      placed++;
      x; // advance handled by flatness gaps
    }
  }

  world.recomputeSkyTop();
  const spawnX = Math.floor(W / 2);
  return { seed, spawnX, surfaceY: surface[spawnX], surface, villages };
}

function growVein(world, rng, x, y, id, size) {
  let cx = x, cy = y;
  for (let i = 0; i < size; i++) {
    if (world.get(cx, cy) === TILE_IDS.STONE) world.set(cx, cy, id);
    cx += (rng() * 3 | 0) - 1;
    cy += (rng() * 3 | 0) - 1;
  }
}

function scatterPools(world, rng, surface, liquid, yMin, yMax, radius, fill) {
  const W = world.w;
  for (let x = radius; x < W - radius; x++) {
    if (rng() > 0.006) continue;
    const y = yMin + (rng() * (yMax - yMin) | 0);
    const r = 2 + (rng() * radius | 0);
    for (let dy = -1; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const tx = x + dx, ty = y + dy;
        if (ty <= surface[tx] + 3) continue; // keep liquids underground
        if (world.get(tx, ty) !== TILE_IDS.AIR && rng() < fill) world.set(tx, ty, liquid);
        else if (world.get(tx, ty) === TILE_IDS.AIR && dy >= 0) world.set(tx, ty, liquid);
      }
    }
    x += radius * 2;
  }
}

function placeTree(world, rng, x, sy) {
  const trunk = 3 + (rng() * 3 | 0);
  for (let i = 1; i <= trunk; i++) world.set(x, sy - i, TILE_IDS.WOOD);
  const topY = sy - trunk;
  for (let lx = -2; lx <= 2; lx++)
    for (let ly = -2; ly <= 1; ly++)
      if (Math.abs(lx) + Math.abs(ly) <= 3 && world.get(x + lx, topY + ly) === TILE_IDS.AIR)
        world.set(x + lx, topY + ly, TILE_IDS.LEAVES);
}

function isFlatEnough(surface, x, width) {
  let min = surface[x], max = surface[x];
  for (let i = 0; i < width; i++) {
    min = Math.min(min, surface[x + i]);
    max = Math.max(max, surface[x + i]);
  }
  return max - min <= 2;
}

// Build a simple plank house and return its center (used to home a villager).
function buildHouse(world, surface, x) {
  const w = 7, h = 4;
  let floor = surface[x];
  for (let i = 0; i < w; i++) floor = Math.max(floor, surface[x + i]);
  const top = floor - h;
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy <= h; dy++) {
      const tx = x + dx, ty = top + dy;
      const edge = dx === 0 || dx === w - 1 || dy === 0 || dy === h;
      if (edge) {
        // leave a door gap on the right wall
        const door = dx === w - 1 && (dy === h - 1 || dy === h - 2);
        world.set(tx, ty, door ? TILE_IDS.AIR : TILE_IDS.PLANK);
      } else {
        world.set(tx, ty, TILE_IDS.AIR);
      }
    }
  }
  // furnishings: a workbench and a torch inside
  world.set(x + 1, floor - 1, TILE_IDS.WORKBENCH);
  world.set(x + 3, top + 1, TILE_IDS.TORCH);
  return { x: x + (w >> 1), y: floor - 1 };
}
