import { WORLD_W, WORLD_H, TILE } from "./config.js";
import { TILE_IDS, isSolid, isOpaque } from "./tiles.js";

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
    this.skyTop = new Int32Array(w).fill(h); // h = nothing blocks sky
  }

  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  idx(tx, ty) { return ty * this.w + tx; }

  get(tx, ty) {
    if (!this.inBounds(tx, ty)) return TILE_IDS.STONE; // OOB reads as solid wall
    return this.tiles[this.idx(tx, ty)];
  }

  set(tx, ty, id) {
    if (!this.inBounds(tx, ty)) return false;
    this.tiles[this.idx(tx, ty)] = id;
    this.updateSkyTop(tx, ty, id);
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

  isSolidAt(tx, ty) { return isSolid(this.get(tx, ty)); }
  worldToTile(px, py) { return { tx: Math.floor(px / TILE), ty: Math.floor(py / TILE) }; }
  tileUnderPoint(px, py) { return this.worldToTile(px, py); }
}
