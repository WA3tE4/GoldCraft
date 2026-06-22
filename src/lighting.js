import { isOpaque, emissionOf } from "./tiles.js";

export const MAX_LIGHT = 15;

// BFS flood-fill lighting over a rectangular window of the world.
// Two seed sources:
//   - skylight: columns open to the sky get `skyLevel` (scaled by day/night),
//     which then propagates sideways into caves with attenuation.
//   - emissive tiles (lava, torch, furnace) seed their own light.
// Light falls off by 1 per air step, more through solids, so caves stay dark.
//
// Returns { light: Uint8Array, x0, y0, w, h }. Index a cell with (ty-y0)*w+(tx-x0).
export class LightMap {
  constructor() {
    this.light = new Uint8Array(0);
    this.x0 = 0; this.y0 = 0; this.w = 0; this.h = 0;
    this.sources = [];
    this._queue = new Int32Array(0);
  }

  ensure(w, h) {
    const n = w * h;
    if (this.light.length < n) {
      this.light = new Uint8Array(n);
      // Cells can be re-enqueued as their light rises, so give the queue headroom.
      this._queue = new Int32Array(n * 4);
    }
  }

  // skyLevel: 0..15 current daylight at an open-air tile.
  compute(world, x0, y0, x1, y1, skyLevel) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(world.w - 1, x1); y1 = Math.min(world.h - 1, y1);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    this.ensure(w, h);
    this.x0 = x0; this.y0 = y0; this.w = w; this.h = h;

    const light = this.light;
    const queue = this._queue;
    light.fill(0, 0, w * h);
    let qn = 0;
    this.sources = []; // emissive tiles in view, for the warm-glow render pass

    // Seed skylight + emissive sources.
    //
    // Skylight is walked DOWNWARD through each column rather than being a hard
    // on/off at the surface. It fades only a little through open air but drops
    // fast through solid tiles, so:
    //   - open sky and the surface a player stands on stay fully lit,
    //   - caves a few tiles under solid ground still go dark,
    //   - but a lone block floating in the sky only *dims* the space beneath it
    //     instead of casting a pitch-black column all the way down.
    const SKY_AIR_ATTEN = 1;   // daylight barely fades through open air
    const SKY_SOLID_ATTEN = 3; // ...but dies quickly through solid rock
    for (let tx = x0; tx <= x1; tx++) {
      const top = world.skyTop[tx];
      // How much daylight survives down to the top of the window. If the window
      // starts below the surface, attenuate from the surface down to it first
      // (bounded — sky hits 0 after a few solid tiles, so this is cheap).
      let sky = skyLevel;
      if (top < y0) {
        for (let ty = top; ty < y0 && sky > 0; ty++) {
          sky -= isOpaque(world.get(tx, ty)) ? SKY_SOLID_ATTEN : SKY_AIR_ATTEN;
        }
        if (sky < 0) sky = 0;
      }
      for (let ty = y0; ty <= y1; ty++) {
        const li = (ty - y0) * w + (tx - x0);
        // Open sky AND the first solid tile (the surface) get full daylight, so
        // the ground a player walks on is lit rather than sitting in shadow.
        let lv = (ty <= top) ? skyLevel : sky;
        if (ty <= top) sky = skyLevel;
        const id = world.get(tx, ty);
        const e = emissionOf(id);
        if (e > 0) this.sources.push({ tx, ty, e, id });
        if (e > lv) lv = e;
        if (lv > 0) { light[li] = lv; queue[qn++] = li; }
        // Attenuate skylight for the tile directly below.
        sky -= isOpaque(id) ? SKY_SOLID_ATTEN : SKY_AIR_ATTEN;
        if (sky < 0) sky = 0;
      }
    }

    // Breadth-first propagation. Reusing the seed array as a growing queue.
    let head = 0;
    while (head < qn) {
      const li = queue[head++];
      const lv = light[li];
      if (lv <= 1) continue;
      const cx = x0 + (li % w);
      const cy = y0 + ((li / w) | 0);

      // 4-neighbourhood propagation
      qn = this._push(world, light, queue, qn, w, x0, y0, x1, y1, cx - 1, cy, lv);
      qn = this._push(world, light, queue, qn, w, x0, y0, x1, y1, cx + 1, cy, lv);
      qn = this._push(world, light, queue, qn, w, x0, y0, x1, y1, cx, cy - 1, lv);
      qn = this._push(world, light, queue, qn, w, x0, y0, x1, y1, cx, cy + 1, lv);
    }
    return this;
  }

  _push(world, light, queue, qn, w, x0, y0, x1, y1, nx, ny, lv) {
    if (nx < x0 || ny < y0 || nx > x1 || ny > y1) return qn;
    const atten = isOpaque(world.get(nx, ny)) ? 2 : 1;
    const nl = lv - atten;
    if (nl <= 0) return qn;
    const ni = (ny - y0) * w + (nx - x0);
    if (nl > light[ni]) {
      light[ni] = nl;
      if (qn < queue.length) queue[qn++] = ni;
    }
    return qn;
  }

  at(tx, ty) {
    if (tx < this.x0 || ty < this.y0 || tx >= this.x0 + this.w || ty >= this.y0 + this.h) return 0;
    return this.light[(ty - this.y0) * this.w + (tx - this.x0)];
  }
}
