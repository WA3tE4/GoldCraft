import { WORLD_W, WORLD_H, TILE } from "./config.js";
import { TILE_IDS, isSolid, isOpaque } from "./tiles.js";

const MAX_MASS = 1.0; // a "full" liquid cell (matches liquid.js)

// The world is a flat Uint8Array grid of tile ids. Simple, cache-friendly, and
// trivial to (de)serialize. Chunk-based streaming isn't needed at this scale.
//
// `skyTop[x]` caches the y of the highest sky-blocking tile in each column, so the
// lighting engine can compute skylight without rescanning whole columns each frame.
export class World {
  constructor(w = WORLD_W, h = WORLD_H) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h); // defaults to AIR (0)
    this.walls = new Uint8Array(w * h); // background wall layer, defaults to NONE (0)
    this.skyTop = new Int32Array(w).fill(h); // h = nothing blocks sky

    // Liquid simulation state (see liquid.js). `water`/`lava` hold the fractional
    // mass per cell; `_nw`/`_nl` are reused scratch buffers for a flow pass.
    this.water = new Float32Array(w * h);
    this.lava = new Float32Array(w * h);
    this._nw = new Float32Array(w * h);
    this._nl = new Float32Array(w * h);
    this.liquidActive = false; // true while liquids are still moving
    this._liqTick = 0;
    this._steam = [];          // [tx,ty,...] reaction cells, drained by the game for FX
  }

  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  idx(tx, ty) { return ty * this.w + tx; }

  get(tx, ty) {
    if (!this.inBounds(tx, ty)) return TILE_IDS.STONE; // OOB reads as solid wall
    return this.tiles[this.idx(tx, ty)];
  }

  set(tx, ty, id) {
    if (!this.inBounds(tx, ty)) return false;
    const k = this.idx(tx, ty);
    this.tiles[k] = id;
    // Keep liquid mass consistent: a liquid tile is a full cell, anything else
    // (solid or air) carries none. Any change re-wakes the flow simulation.
    if (id === TILE_IDS.WATER) { this.water[k] = MAX_MASS; this.lava[k] = 0; this.liquidActive = true; }
    else if (id === TILE_IDS.LAVA) { this.lava[k] = MAX_MASS; this.water[k] = 0; this.liquidActive = true; }
    else {
      if (this.water[k] || this.lava[k]) this.liquidActive = true;
      this.water[k] = 0; this.lava[k] = 0;
    }
    this.updateSkyTop(tx, ty, id);
    return true;
  }

  // Seed liquid masses from the current tile grid (after worldgen or a load that
  // bulk-copies `tiles`), then wake the sim so pools settle to their level.
  seedLiquid() {
    for (let i = 0; i < this.tiles.length; i++) {
      const id = this.tiles[i];
      this.water[i] = id === TILE_IDS.WATER ? MAX_MASS : 0;
      this.lava[i] = id === TILE_IDS.LAVA ? MAX_MASS : 0;
    }
    this.liquidActive = true;
  }

  // Fill level (0..1) of a cell, for rendering partial surface tiles.
  liquidLevel(tx, ty) {
    if (!this.inBounds(tx, ty)) return 0;
    const k = this.idx(tx, ty);
    return Math.min(1, this.water[k] + this.lava[k]);
  }

  // Pour `amt` of a liquid into a cell (used by buckets). Won't fill solids.
  addLiquid(tx, ty, id, amt = MAX_MASS) {
    if (!this.inBounds(tx, ty)) return false;
    if (this.isSolidAt(tx, ty)) return false;
    const k = this.idx(tx, ty);
    if (id === TILE_IDS.WATER) this.water[k] = Math.min(MAX_MASS, this.water[k] + amt);
    else if (id === TILE_IDS.LAVA) this.lava[k] = Math.min(MAX_MASS, this.lava[k] + amt);
    else return false;
    if (this.tiles[k] === TILE_IDS.AIR) this.tiles[k] = id;
    this.liquidActive = true;
    return true;
  }

  // Keep skyTop[tx] = highest opaque tile after a change at (tx,ty).
  updateSkyTop(tx, ty, id) {
    if (isOpaque(id)) {
      if (ty < this.skyTop[tx]) this.skyTop[tx] = ty;
    } else if (ty === this.skyTop[tx]) {
      // We just cleared the blocker — find the next one below.
      let y = ty + 1;
      while (y < this.h && !isOpaque(this.get(tx, y))) y++;
      this.skyTop[tx] = y;
    }
  }

  // Scan every column once (after worldgen / load) to seed skyTop.
  recomputeSkyTop() {
    for (let x = 0; x < this.w; x++) {
      let y = 0;
      while (y < this.h && !isOpaque(this.tiles[this.idx(x, y)])) y++;
      this.skyTop[x] = y;
    }
  }

  // Background wall accessors (separate grid; walls never collide or block sky).
  wallAt(tx, ty) {
    if (!this.inBounds(tx, ty)) return 0;
    return this.walls[this.idx(tx, ty)];
  }
  setWall(tx, ty, id) {
    if (!this.inBounds(tx, ty)) return false;
    this.walls[this.idx(tx, ty)] = id;
    return true;
  }

  isSolidAt(tx, ty) { return isSolid(this.get(tx, ty)); }
  worldToTile(px, py) { return { tx: Math.floor(px / TILE), ty: Math.floor(py / TILE) }; }
  tileUnderPoint(px, py) { return this.worldToTile(px, py); }
}
