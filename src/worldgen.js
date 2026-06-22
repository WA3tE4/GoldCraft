import { TILE_IDS, WALL_IDS } from "./tiles.js";

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

// Returns { seed, spawnX, surfaceY, surface:Int32Array, npcs:[{home,role,gang,childOf}...], castle, bossLair }.
export function generate(world, seed = (Math.random() * 1e9) | 0) {
  const noise = makeNoise1D(seed);
  const caveNoise = makeNoise1D(seed ^ 0x9e3779b9);
  const biomeNoise = makeNoise1D(seed ^ 0x1b873593);
  const W = world.w, H = world.h;
  const baseHeight = Math.floor(H * 0.40);
  const surface = new Int32Array(W);
  const rng = mulberry32(seed ^ 0x55aa55aa);

  // --- 0. Biome map: broad bands of forest / desert / tundra across the world.
  // Low-frequency noise keeps each biome wide (dozens of tiles) so they read as
  // distinct regions you travel between, not a speckled checkerboard.
  const biome = new Array(W);
  for (let x = 0; x < W; x++) {
    const n = biomeNoise(x * 0.012) * 0.7 + biomeNoise(x * 0.03) * 0.3;
    biome[x] = n < 0.40 ? "tundra" : n > 0.62 ? "desert" : "forest";
  }

  // --- 1. Heightmap + base layers + caves ---
  for (let x = 0; x < W; x++) {
    // Deserts roll into low dunes; tundra is gently rounded; forest is hilly.
    const relief = biome[x] === "desert" ? 0.6 : biome[x] === "tundra" ? 0.85 : 1;
    const hill = (noise(x * 0.05) * 18 + noise(x * 0.015) * 34 + noise(x * 0.2) * 5) * relief;
    const surfaceY = Math.floor(baseHeight - hill);
    surface[x] = surfaceY;

    for (let y = surfaceY; y < H; y++) {
      let id;
      if (y === surfaceY) {
        id = biome[x] === "desert" ? TILE_IDS.SAND
           : biome[x] === "tundra" ? TILE_IDS.SNOW
           : TILE_IDS.GRASS;
      } else if (y < surfaceY + 4) {
        // Deserts keep a sandy crust before hitting stone.
        id = biome[x] === "desert" ? TILE_IDS.SAND : TILE_IDS.DIRT;
      } else id = TILE_IDS.STONE;

      if (y > surfaceY + 6) {
        const c = caveNoise(x * 0.1 + y * 0.13) + caveNoise(x * 0.05 - y * 0.07);
        if (c > 1.15 && c < 1.42) id = TILE_IDS.AIR;
      }
      world.set(x, y, id);
    }
  }

  // --- 1b. Plains: level a few wide spans into flat building ground ---
  flattenPlains(world, rng, surface, biome);

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

  // --- 3. Lava lakes deep down, larger water pools mid-depth ---
  scatterPools(world, rng, surface, TILE_IDS.LAVA, H - 30, H - 4, 6, 0.6);
  scatterPools(world, rng, surface, TILE_IDS.WATER, baseHeight + 10, H - 50, 7, 0.6);

  // --- 3b. Surface lakes: sunken water basins with sandy shores (home to fish) ---
  carveLakes(world, rng, surface, biome);

  // --- 4. Surface decoration: beaches, biome flora, and cave mushrooms ---
  for (let x = 1; x < W - 1; x++) {
    const sy = surface[x];
    if (biome[x] === "forest" && rng() < 0.02) { // small sand beaches in forest
      for (let dx = 0; dx < 4 + (rng() * 4 | 0) && x + dx < W; dx++) {
        const s = surface[x + dx];
        world.set(x + dx, s, TILE_IDS.SAND);
        world.set(x + dx, s + 1, TILE_IDS.SAND);
      }
      x += 6;
    }
  }
  decorateSurface(world, rng, surface, biome);
  scatterCaveMushrooms(world, rng, surface);

  // --- 5. Settlements: a grand stone castle, farmsteads, and family cottages.
  // Each entry describes an NPC to spawn: { home, role, gang, childOf }.
  const npcs = [];
  const castle = buildCastle(world, surface, rng);
  if (castle) npcs.push(...castle.npcs);

  // More settlements & structures for wider worlds (counts scale with width).
  const wScale = W / 560;
  const want = (base) => Math.round(base * wScale);

  // Farmsteads: tilled fields of crops + a farmer family, kept clear of the castle.
  let farms = 0, fAtt = 0;
  while (farms < want(4) && fAtt < 200) {
    fAtt++;
    const x = 14 + (rng() * (W - 40) | 0);
    if (isFlatEnough(surface, x, 13) && (!castle || Math.abs(x - castle.cx) > 44)) {
      npcs.push(...buildFarm(world, surface, rng, x).npcs);
      farms++;
    }
  }

  // Family cottages: a couple and a trailing baby, some sworn to a local gang.
  let placed = 0, attempts = 0;
  while (placed < want(7) && attempts < 280) {
    attempts++;
    const x = 12 + (rng() * (W - 30) | 0);
    if (isFlatEnough(surface, x, 9) && (!castle || Math.abs(x - castle.cx) > 30)) {
      addFamily(npcs, buildHouse(world, surface, x), rng);
      placed++;
    }
  }

  // Roaming wanderers between settlements — lone travellers and gang scouts that
  // make the world feel populated (and give your spells plenty of targets).
  let wand = 0, wAtt = 0;
  while (wand < want(8) && wAtt < 200) {
    wAtt++;
    const x = 10 + (rng() * (W - 20) | 0);
    if (isFlatEnough(surface, x, 3)) {
      const gang = rng() < 0.4 ? (rng() < 0.5 ? "fangs" : "mud") : null;
      npcs.push({ home: { x, y: surface[x] }, role: rng() < 0.25 ? "guard" : "villager", gang });
      wand++;
    }
  }

  // --- 5b. Loot structures: cabins, pyramids, sky islands & crypts, each with
  // a treasure chest. Their contents are returned so the game can fill them. ---
  const chests = [];
  const farFromCastle = (x, d) => !castle || Math.abs(x - castle.cx) > d;

  let cab = 0, cAtt = 0;
  while (cab < want(3) && cAtt < 200) {
    cAtt++; const x = 14 + (rng() * (W - 30) | 0);
    if (isFlatEnough(surface, x, 7) && farFromCastle(x, 40)) { chests.push(buildCabin(world, surface, rng, x)); cab++; }
  }
  let pyr = 0, pAtt = 0;
  while (pyr < want(2) && pAtt < 260) {
    pAtt++; const x = 20 + (rng() * (W - 50) | 0);
    if (biome[x] === "desert" && isFlatEnough(surface, x, 14) && farFromCastle(x, 40)) {
      const c = buildPyramid(world, surface, rng, x); if (c) { chests.push(c); pyr++; }
    }
  }
  let sky = 0, sAtt = 0;
  while (sky < want(2) && sAtt < 140) {
    sAtt++; const x = 20 + (rng() * (W - 40) | 0);
    const c = buildSkyIsland(world, rng, x, surface[x]); if (c) { chests.push(c); sky++; }
  }
  let cr = 0, crAtt = 0;
  while (cr < want(3) && crAtt < 260) {
    crAtt++; const x = 12 + (rng() * (W - 24) | 0);
    const c = buildCrypt(world, rng, surface, x); if (c) { chests.push(c); cr++; }
  }

  // --- 6. Boss lair: a bricked-out cavern deep in the caves ---
  const bossLair = carveBossLair(world, rng, surface);

  world.recomputeSkyTop();
  const spawnX = Math.floor(W / 2);
  return { seed, spawnX, surfaceY: surface[spawnX], surface, npcs, castle, bossLair, chests };
}

// Hollow out a wide, bricked chamber low in the world and light it with torches.
// Returns { x, y } at the chamber floor's centre for spawning the boss.
function carveBossLair(world, rng, surface) {
  const W = world.w, H = world.h;
  const halfW = 22, halfH = 8;
  // Sit it off to one side, well away from the spawn, near the lava layer.
  const cx = Math.floor(W * (0.72 + rng() * 0.12));
  const cy = H - 24;
  const floor = cy + halfH;

  for (let y = cy - halfH - 2; y <= floor + 2; y++) {
    for (let x = cx - halfW - 2; x <= cx + halfW + 2; x++) {
      if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) continue;
      const inside = x > cx - halfW && x < cx + halfW && y > cy - halfH && y < floor;
      const shell = x >= cx - halfW - 1 && x <= cx + halfW + 1 && y >= cy - halfH - 1 && y <= floor + 1;
      if (inside) {
        world.set(x, y, TILE_IDS.AIR);
        world.setWall(x, y, WALL_IDS.STONE); // backed so the arena reads as a room
      } else if (shell) {
        world.set(x, y, TILE_IDS.BRICK);     // hard brick wall around the chamber
      }
    }
  }
  // Solid brick floor to stand and fight on.
  for (let x = cx - halfW; x <= cx + halfW; x++) world.set(x, floor, TILE_IDS.BRICK);
  // Torches along the back wall for ambience + light.
  for (let x = cx - halfW + 3; x <= cx + halfW - 3; x += 6) {
    world.set(x, cy - halfH + 1, TILE_IDS.TORCH);
  }
  // Glowstone braziers in the corners.
  world.set(cx - halfW + 1, floor - 1, TILE_IDS.GLOWSTONE);
  world.set(cx + halfW - 1, floor - 1, TILE_IDS.GLOWSTONE);

  return { x: cx, y: floor - 1 };
}

// Level several wide spans of surface to a constant height, clearing the air
// above and packing solid ground below — flat, inviting spots to build a base.
// Scales its count with world width so big worlds get more plains.
function flattenPlains(world, rng, surface, biome) {
  const W = world.w;
  const n = 4 + (rng() * 4 | 0) + Math.floor(W / 320);
  for (let i = 0; i < n; i++) {
    const width = 22 + (rng() * 22 | 0);
    const x = 6 + (rng() * (W - width - 12) | 0);
    let sum = 0;
    for (let k = 0; k < width; k++) sum += surface[x + k];
    const lvl = Math.round(sum / width);
    for (let k = 0; k < width; k++) {
      const tx = x + k;
      const surfId = biome[tx] === "desert" ? TILE_IDS.SAND
        : biome[tx] === "tundra" ? TILE_IDS.SNOW : TILE_IDS.GRASS;
      const subId = biome[tx] === "desert" ? TILE_IDS.SAND : TILE_IDS.DIRT;
      for (let y = lvl - 7; y < lvl; y++) world.set(tx, y, TILE_IDS.AIR); // clear airspace
      world.set(tx, lvl, surfId);
      for (let y = lvl + 1; y < lvl + 4; y++) world.set(tx, y, subId);    // solid footing
      surface[tx] = lvl;
    }
  }
}

function growVein(world, rng, x, y, id, size) {
  let cx = x, cy = y;
  for (let i = 0; i < size; i++) {
    if (world.get(cx, cy) === TILE_IDS.STONE) world.set(cx, cy, id);
    cx += (rng() * 3 | 0) - 1;
    cy += (rng() * 3 | 0) - 1;
  }
}

// Carve a handful of surface ponds: a parabolic bowl dug into the ground and
// filled with water up to the original ground line, with sandy banks and floor.
function carveLakes(world, rng, surface, biome) {
  const W = world.w;
  let made = 0, x = 8;
  while (x < W - 8 && made < 6) {
    if (rng() < 0.05 && isFlatEnough(surface, x, 6)) {
      const r = 5 + (rng() * 8 | 0);      // half-width in tiles
      const depth = 3 + (rng() * 5 | 0);  // max depth at the centre
      const cx = x + r;
      const frozen = biome[cx] === "tundra"; // tundra ponds ice over
      const bank = frozen ? TILE_IDS.SNOW : TILE_IDS.SAND;
      for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx;
        if (tx < 1 || tx >= W - 1) continue;
        const top = surface[tx];
        const t = 1 - (dx * dx) / (r * r); // 1 at centre -> 0 at the rim
        const d = Math.round(depth * t);
        if (d <= 0) { world.set(tx, top, bank); continue; } // beach rim
        for (let dy = 0; dy < d; dy++) world.set(tx, top + dy, TILE_IDS.WATER);
        if (frozen) world.set(tx, top, TILE_IDS.ICE);  // ice cap over the water
        world.set(tx, top + d, bank);              // sandy/snowy bottom
        if (world.get(tx, top - 1) !== TILE_IDS.AIR) world.set(tx, top - 1, TILE_IDS.AIR);
      }
      made++;
      x = cx + r + 8;
    } else x += 3;
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
  // Vines occasionally trail down from the canopy's underside.
  if (rng() < 0.6) {
    const vx = x + (rng() < 0.5 ? -2 : 2);
    let vy = topY + 2;
    if (world.get(vx, vy) === TILE_IDS.AIR) {
      const len = 1 + (rng() * 3 | 0);
      for (let i = 0; i < len && world.get(vx, vy) === TILE_IDS.AIR; i++, vy++)
        world.set(vx, vy, TILE_IDS.VINE);
    }
  }
}

// A snow-laden conifer: a slim trunk under a tall triangular crown.
function placePineTree(world, rng, x, sy) {
  const trunk = 4 + (rng() * 3 | 0);
  for (let i = 1; i <= trunk; i++) world.set(x, sy - i, TILE_IDS.WOOD);
  const topY = sy - trunk;
  for (let tier = 0; tier < 4; tier++) {
    const r = 3 - tier;
    const ly = topY - tier * 2;
    for (let lx = -r; lx <= r; lx++) {
      for (let dy = 0; dy <= 1; dy++) {
        if (world.get(x + lx, ly + dy) === TILE_IDS.AIR)
          world.set(x + lx, ly + dy, TILE_IDS.LEAVES);
      }
    }
  }
  world.set(x, topY - 8, TILE_IDS.SNOW); // a dab of snow on the very tip
}

// A prickly desert column, 2–4 tiles tall, sometimes with a side arm.
function placeCactus(world, rng, x, sy) {
  const h = 2 + (rng() * 3 | 0);
  for (let i = 1; i <= h && world.get(x, sy - i) === TILE_IDS.AIR; i++)
    world.set(x, sy - i, TILE_IDS.CACTUS);
  if (h >= 3 && rng() < 0.5) {
    const ax = x + (rng() < 0.5 ? -1 : 1), ay = sy - (1 + (rng() * (h - 1) | 0));
    if (world.get(ax, ay) === TILE_IDS.AIR) {
      world.set(ax, ay, TILE_IDS.CACTUS);
      if (world.get(ax, ay - 1) === TILE_IDS.AIR) world.set(ax, ay - 1, TILE_IDS.CACTUS);
    }
  }
}

// Scatter biome-appropriate surface flora: trees, grass, flowers, bushes,
// cacti, and pines, planted one tile above solid, unobstructed ground.
function decorateSurface(world, rng, surface, biome) {
  const W = world.w;
  const plant = (x, id) => {
    const top = surface[x], above = top - 1;
    if (world.get(x, above) !== TILE_IDS.AIR) return false;
    if (!isGround(world.get(x, top))) return false;
    world.set(x, above, id);
    return true;
  };

  for (let x = 4; x < W - 6; x++) {
    const b = biome[x];
    const top = surface[x];
    if (b === "forest") {
      if (rng() < 0.05 && world.get(x, top) === TILE_IDS.GRASS) { placeTree(world, rng, x, top); x += 3; continue; }
      const r = rng();
      if (r < 0.14) plant(x, TILE_IDS.TALL_GRASS);
      else if (r < 0.20) plant(x, TILE_IDS.FLOWER);
      else if (r < 0.235) plant(x, TILE_IDS.BERRY_BUSH);
      else if (r < 0.25) plant(x, TILE_IDS.MUSHROOM);
    } else if (b === "desert") {
      if (rng() < 0.045) { placeCactus(world, rng, x, top); x += 2; continue; }
      if (rng() < 0.03) plant(x, TILE_IDS.TALL_GRASS); // dry tufts
    } else { // tundra
      if (rng() < 0.045 && world.get(x, top) === TILE_IDS.SNOW) { placePineTree(world, rng, x, top); x += 3; continue; }
      if (rng() < 0.05) plant(x, TILE_IDS.TALL_GRASS);
      else if (rng() < 0.02) plant(x, TILE_IDS.FLOWER); // hardy alpine bloom
    }
  }
}

// Mushrooms sprouting on shadowed cave floors: a solid stone/dirt tile with open
// air above, a few tiles below the surface so they read as cavern growth.
function scatterCaveMushrooms(world, rng, surface) {
  const W = world.w, H = world.h;
  for (let x = 2; x < W - 2; x++) {
    for (let y = surface[x] + 8; y < H - 2; y++) {
      if (rng() > 0.004) continue;
      const floor = world.get(x, y);
      if ((floor === TILE_IDS.STONE || floor === TILE_IDS.DIRT) && world.get(x, y - 1) === TILE_IDS.AIR) {
        world.set(x, y - 1, TILE_IDS.MUSHROOM);
      }
    }
  }
}

function isGround(id) {
  return id === TILE_IDS.GRASS || id === TILE_IDS.DIRT ||
         id === TILE_IDS.SAND  || id === TILE_IDS.SNOW;
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
        if (door) world.setWall(tx, ty, WALL_IDS.WOOD); // wall behind the doorway
      } else {
        world.set(tx, ty, TILE_IDS.AIR);
        world.setWall(tx, ty, WALL_IDS.WOOD); // backed interior so it reads as indoors
      }
    }
  }
  // furnishings: a workbench and a torch inside
  world.set(x + 1, floor - 1, TILE_IDS.WORKBENCH);
  world.set(x + 3, top + 1, TILE_IDS.TORCH);
  return { x: x + (w >> 1), y: floor - 1 };
}

// A couple plus a trailing baby; some clans sworn to a local gang.
function addFamily(npcs, home, rng) {
  const gang = rng() < 0.5 ? (rng() < 0.5 ? "fangs" : "mud") : null;
  const dad = { home, role: "villager", gang };
  const mom = { home: { x: home.x + 1, y: home.y }, role: "villager", gang };
  const baby = { home, role: "child", gang, childOf: dad };
  npcs.push(dad, mom, baby);
}

// A tilled field of crops with a fence + scarecrow, a cottage, and a farmer family.
function buildFarm(world, surface, rng, x) {
  const span = 11;
  let fy = surface[x];
  for (let i = 0; i < span; i++) fy = Math.max(fy, surface[x + i]);
  // Level the plot down to tilled dirt.
  for (let i = 0; i < span; i++) {
    const tx = x + i;
    for (let y = fy - 6; y < fy; y++) world.set(tx, y, TILE_IDS.AIR);
    world.set(tx, fy, TILE_IDS.DIRT);
    surface[tx] = fy;
  }
  // Fence posts at each end, crops planted in the rows between.
  world.set(x, fy - 1, TILE_IDS.WOOD);
  world.set(x + span - 1, fy - 1, TILE_IDS.WOOD);
  for (let i = 1; i < span - 1; i++) world.set(x + i, fy - 1, TILE_IDS.CROP);
  // A straw scarecrow watching over the field.
  const sc = x + (span >> 1);
  world.set(sc, fy - 1, TILE_IDS.WOOD);
  world.set(sc, fy - 2, TILE_IDS.WOOD);
  world.set(sc - 1, fy - 2, TILE_IDS.WOOD);
  world.set(sc + 1, fy - 2, TILE_IDS.WOOD);
  world.set(sc, fy - 3, TILE_IDS.LEAVES);

  const home = buildHouse(world, surface, x + span + 1);
  const dad = { home, role: "farmer", gang: "mud" };
  const mom = { home: { x: home.x + 1, y: home.y }, role: "farmer", gang: "mud" };
  const kid = { home, role: "child", gang: "mud", childOf: dad };
  return { npcs: [dad, mom, kid], home };
}

// Build a detailed stone-age castle: crenellated curtain wall, corner towers,
// a tall central keep, a gate, a torch-lit throne hall, and banners flying on top.
// Returns { cx, npcs } — the king, queen, prince, and royal guards to spawn.
function buildCastle(world, surface, rng) {
  const W = world.w;
  const cx = Math.floor(W * (rng() < 0.5 ? 0.26 : 0.72));
  const half = 16, L = cx - half, R = cx + half;
  if (L < 4 || R > W - 4) return null;

  const S = TILE_IDS.STONE, B = TILE_IDS.BRICK, AIR = TILE_IDS.AIR;
  const wallH = 8, towerH = 13, keepH = 16;

  // Level the footprint: clear the airspace, lay a stone plinth + foundation.
  let fy = surface[L];
  for (let x = L; x <= R; x++) fy = Math.max(fy, surface[x]);
  for (let x = L; x <= R; x++) {
    for (let y = fy - keepH - 4; y < fy; y++) world.set(x, y, AIR);
    for (let y = fy; y <= fy + 3; y++) world.set(x, y, S);
    surface[x] = fy;
  }

  const isTower = (x) => x <= L + 1 || x >= R - 1;
  const isKeep = (x) => x >= cx - 1 && x <= cx + 1;

  for (let x = L; x <= R; x++) {
    if (isTower(x)) {
      // Solid corner tower, full height, with merlons + an arrow-slit window.
      for (let y = fy - 1; y >= fy - towerH; y--) world.set(x, y, S);
      if ((x - L) % 2 === 0) world.set(x, fy - towerH - 1, B);
      world.set(x, fy - 5, AIR);
    } else {
      // Hollow, stone-backed hall capped by a walkable rampart.
      for (let y = fy - 1; y >= fy - wallH + 1; y--) {
        world.set(x, y, AIR);
        world.setWall(x, y, WALL_IDS.STONE);
      }
      world.set(x, fy - wallH, S);                              // rampart walkway
      if (isKeep(x)) {
        // The central keep rises above the rampart as a tall gatehouse.
        for (let y = fy - wallH - 1; y >= fy - keepH; y--) world.set(x, y, S);
        if ((x - L) % 2 === 0) world.set(x, fy - keepH - 1, B);
      } else if ((x - L) % 2 === 0) {
        world.set(x, fy - wallH - 1, B);                        // battlement merlons
      }
    }
  }

  // Grand gate punched through the curtain just left of centre, with a wood backing
  // and a brick arch over it (a stone-age portcullis).
  const gate = cx - 6;
  for (let dx = 0; dx < 3; dx++)
    for (let dy = 1; dy <= 4; dy++) {
      world.set(gate + dx, fy - dy, AIR);
      world.setWall(gate + dx, fy - dy, WALL_IDS.WOOD);
    }
  for (let dx = -1; dx <= 3; dx++) world.set(gate + dx, fy - 5, B); // arch lintel

  // Throne: a raised brick seat flanked by glowstone braziers, in the hall centre.
  world.set(cx, fy - 1, B);
  world.set(cx, fy - 2, B);
  world.set(cx - 2, fy - 1, TILE_IDS.GLOWSTONE);
  world.set(cx + 2, fy - 1, TILE_IDS.GLOWSTONE);
  // Torches along the hall back wall for light.
  for (let x = L + 3; x <= R - 3; x += 5) world.set(x, fy - 4, TILE_IDS.TORCH);

  // Banners flying on flagpoles atop each tower and the keep.
  raiseBanner(world, L, fy - towerH - 2);
  raiseBanner(world, R, fy - towerH - 2);
  raiseBanner(world, cx, fy - keepH - 2);

  // Royal household + guards.
  const gp = "royal";
  const npcs = [
    { home: { x: cx - 2, y: fy }, role: "king",  gang: gp },
    { home: { x: cx + 2, y: fy }, role: "queen", gang: gp },
    { home: { x: L + 4,  y: fy }, role: "guard", gang: gp },
    { home: { x: R - 4,  y: fy }, role: "guard", gang: gp },
    { home: { x: cx - 5, y: fy - wallH }, role: "guard", gang: gp }, // sentry on the wall
  ];
  // A young prince trailing the queen.
  npcs.push({ home: { x: cx + 2, y: fy }, role: "child", gang: gp, childOf: npcs[1] });
  return { cx, npcs };
}

// ---------------------------------------------------------------------------
// LOOT STRUCTURES — each builds some geometry, plants a CHEST tile, and returns
// { tx, ty, loot } describing the chest's contents for the game to populate.
// ---------------------------------------------------------------------------

// Per-structure loot tables: each entry rolls independently by `chance`, with a
// random count in n:[min,max]. rollLoot guarantees at least one item.
const CABIN_LOOT = [
  { item: "wood", n: [6, 15], chance: 0.8 },
  { item: "plank", n: [4, 10], chance: 0.6 },
  { item: "torch", n: [2, 6], chance: 0.6 },
  { item: "apple", n: [1, 3], chance: 0.5 },
  { item: "bread", n: [1, 2], chance: 0.3 },
  { item: "coal", n: [2, 6], chance: 0.5 },
  { item: "iron_ore", n: [1, 4], chance: 0.35 },
  { item: "stone_pickaxe", n: [1, 1], chance: 0.2 },
  { item: "speed_potion", n: [1, 1], chance: 0.12 },
];
const PYRAMID_LOOT = [
  { item: "gold_ore", n: [2, 6], chance: 0.7 },
  { item: "gold_ingot", n: [1, 4], chance: 0.5 },
  { item: "glass", n: [2, 6], chance: 0.4 },
  { item: "diamond", n: [1, 2], chance: 0.25 },
  { item: "magic_essence", n: [1, 2], chance: 0.3 },
  { item: "pistol", n: [1, 1], chance: 0.18 },
  { item: "gold_helmet", n: [1, 1], chance: 0.12 },
  { item: "golden_apple", n: [1, 1], chance: 0.1 },
];
const SKY_LOOT = [
  { item: "feather", n: [2, 6], chance: 0.7 },
  { item: "cloud", n: [6, 16], chance: 0.6 },
  { item: "magic_essence", n: [1, 3], chance: 0.4 },
  { item: "diamond", n: [1, 3], chance: 0.3 },
  { item: "feather_potion", n: [1, 1], chance: 0.3 },
  { item: "jump_potion", n: [1, 1], chance: 0.25 },
  { item: "angel_wings", n: [1, 1], chance: 0.08 },
  { item: "golden_apple", n: [1, 1], chance: 0.12 },
];
const CRYPT_LOOT = [
  { item: "bone", n: [2, 6], chance: 0.7 },
  { item: "rotten_flesh", n: [1, 4], chance: 0.5 },
  { item: "iron_ingot", n: [2, 6], chance: 0.5 },
  { item: "coal", n: [2, 8], chance: 0.5 },
  { item: "gunpowder", n: [1, 4], chance: 0.35 },
  { item: "iron_sword", n: [1, 1], chance: 0.18 },
  { item: "iron_chest", n: [1, 1], chance: 0.12 },
  { item: "magic_essence", n: [1, 2], chance: 0.2 },
  { item: "diamond", n: [1, 2], chance: 0.15 },
];

function rollLoot(rng, table) {
  const out = [];
  for (const e of table) {
    if (rng() < e.chance) {
      const n = e.n[0] + (rng() * (e.n[1] - e.n[0] + 1) | 0);
      if (n > 0) out.push({ item: e.item, count: n });
    }
  }
  if (!out.length) { const e = table[rng() * table.length | 0]; out.push({ item: e.item, count: e.n[0] || 1 }); }
  return out;
}

// A weathered, roof-broken wood cabin with a torch and a loot chest inside.
function buildCabin(world, surface, rng, x) {
  const w = 7, h = 4;
  let floor = surface[x];
  for (let i = 0; i < w; i++) floor = Math.max(floor, surface[x + i]);
  const top = floor - h;
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy <= h; dy++) {
      const tx = x + dx, ty = top + dy;
      const edge = dx === 0 || dx === w - 1 || dy === 0 || dy === h;
      if (edge) {
        if (dy === 0 && rng() < 0.4) { world.set(tx, ty, TILE_IDS.AIR); continue; } // missing roof planks
        const door = dx === w - 1 && (dy === h - 1 || dy === h - 2);
        world.set(tx, ty, door ? TILE_IDS.AIR : TILE_IDS.PLANK);
        if (door) world.setWall(tx, ty, WALL_IDS.WOOD);
      } else {
        world.set(tx, ty, TILE_IDS.AIR);
        world.setWall(tx, ty, WALL_IDS.WOOD);
      }
    }
  }
  world.set(x + 1, top + 1, TILE_IDS.TORCH);
  const ctx = x + w - 2, cty = floor - 1;
  world.set(ctx, cty, TILE_IDS.CHEST);
  return { tx: ctx, ty: cty, loot: rollLoot(rng, CABIN_LOOT) };
}

// A solid sand pyramid with a hollow burial chamber + chest at its base.
function buildPyramid(world, surface, rng, x) {
  const hw = 7 + (rng() * 3 | 0);
  const cx = x + hw;
  if (cx - hw < 2 || cx + hw >= world.w - 2) return null;
  let base = surface[cx];
  for (let i = -hw; i <= hw; i++) base = Math.max(base, surface[cx + i]);
  for (let level = 0; level <= hw; level++) {
    const halfw = hw - level, ty = base - level;
    for (let dx = -halfw; dx <= halfw; dx++) world.set(cx + dx, ty, TILE_IDS.SAND);
  }
  // Hollow chamber + brick floor, torches and the chest.
  for (let dy = 1; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) world.set(cx + dx, base - dy, TILE_IDS.AIR);
  for (let dx = -2; dx <= 2; dx++) world.set(cx + dx, base, TILE_IDS.BRICK);
  world.set(cx - 2, base - 1, TILE_IDS.TORCH);
  world.set(cx + 2, base - 1, TILE_IDS.TORCH);
  world.set(cx, base - 1, TILE_IDS.CHEST);
  return { tx: cx, ty: base - 1, loot: rollLoot(rng, PYRAMID_LOOT) };
}

// A grassy floating island ringed with cloud, topped by a tree and a chest.
function buildSkyIsland(world, rng, x, baseSurfaceY) {
  const r = 5 + (rng() * 3 | 0);
  const cx = x;
  if (cx - r < 2 || cx + r >= world.w - 2) return null;
  const iy = Math.max(8, baseSurfaceY - 30 - (rng() * 14 | 0));
  for (let dx = -r; dx <= r; dx++) {
    const colH = Math.round(Math.sqrt(Math.max(0, r * r - dx * dx)));
    for (let dy = 0; dy <= colH + 1; dy++) {
      const tx = cx + dx, ty = iy + dy;
      const id = dy === 0 ? TILE_IDS.GRASS : (dy >= colH ? TILE_IDS.CLOUD : TILE_IDS.DIRT);
      world.set(tx, ty, id);
    }
  }
  if (world.get(cx - 1, iy) === TILE_IDS.GRASS) placeTree(world, rng, cx - 1, iy);
  world.set(cx + 2, iy - 1, TILE_IDS.CHEST);
  return { tx: cx + 2, ty: iy - 1, loot: rollLoot(rng, SKY_LOOT) };
}

// A brick crypt chamber buried in the stone, lit by torches, holding a chest.
function buildCrypt(world, rng, surface, x) {
  const w = 9, h = 5;
  if (x + w >= world.w - 2) return null;
  const top = surface[x] + 12 + (rng() * 30 | 0);
  if (top + h >= world.h - 2) return null;
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      const tx = x + dx, ty = top + dy;
      const edge = dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1;
      if (edge) world.set(tx, ty, TILE_IDS.BRICK);
      else { world.set(tx, ty, TILE_IDS.AIR); world.setWall(tx, ty, WALL_IDS.STONE); }
    }
  }
  world.set(x + 2, top + 1, TILE_IDS.TORCH);
  world.set(x + w - 3, top + 1, TILE_IDS.TORCH);
  const ctx = x + (w >> 1), cty = top + h - 2;
  world.set(ctx, cty, TILE_IDS.CHEST);
  return { tx: ctx, ty: cty, loot: rollLoot(rng, CRYPT_LOOT) };
}

// Plant a flagpole topped with a waving banner at (x, top).
function raiseBanner(world, x, top) {
  world.set(x, top, TILE_IDS.WOOD);
  world.set(x, top - 1, TILE_IDS.WOOD);
  world.set(x, top - 2, TILE_IDS.WOOD);
  world.set(x + 1, top - 2, TILE_IDS.BANNER);
}
