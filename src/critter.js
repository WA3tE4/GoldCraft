import { TILE } from "./config.js";

// Purely cosmetic surface wildlife that makes the world feel alive:
//   • birds      — drift across the daytime sky in lazy sine arcs
//   • butterflies — flutter near the ground by day, around grass & flowers
//   • fireflies  — glow and bob through the dusk/night air
// No collision, no gameplay. Spawned just outside the camera and culled when far
// away or when the time of day no longer suits them. The Game owns one instance
// and the Renderer draws `this.list`.
export class Critters {
  constructor() { this.list = []; }

  _count(kind) {
    let n = 0;
    for (const o of this.list) if (o.kind === kind) n++;
    return n;
  }

  // view: { camX, camY, vw, vh }; daylight: 0 (night) .. 1 (noon);
  // surfaceFn(tx) -> surface tile row; t: seconds.
  update(world, dt, view, daylight, surfaceFn, t) {
    const { camX, camY, vw, vh } = view;
    if (camX == null) return; // camera not initialised yet

    const targets = {
      bird:      daylight > 0.5  ? 3  : 0,
      butterfly: daylight > 0.55 ? 5  : 0,
      firefly:   daylight < 0.45 ? 10 : 0,
    };
    // Ease populations toward their targets — at most a trickle of new spawns.
    for (const kind in targets) {
      if (this._count(kind) < targets[kind] && Math.random() < dt * 1.5)
        this._spawn(kind, camX, camY, vw, vh, surfaceFn);
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.t += dt;
      if (o.kind === "bird") {
        o.x += o.vx * dt;
        o.y = o.baseY + Math.sin(o.t * 2 + o.ph) * 6;
        o.flap += dt * 14;
      } else if (o.kind === "butterfly") {
        o.x += (o.vx + Math.sin(o.t * 3 + o.ph) * 18) * dt;
        o.y += (Math.sin(o.t * 5 + o.ph) * 22 - 3) * dt; // bob, drifting gently upward
        o.flap += dt * 20;
      } else { // firefly
        o.x += Math.sin(o.t * 0.8 + o.ph) * 10 * dt;
        o.y += Math.cos(o.t * 0.7 + o.ph) * 8 * dt;
        o.glow = 0.35 + 0.65 * Math.abs(Math.sin(o.t * 1.5 + o.ph));
      }
      // Cull when it wanders well past the view, or its time of day has passed.
      const off = o.x < camX - 140 || o.x > camX + vw + 140
        || o.y < camY - 180 || o.y > camY + vh + 200;
      if (off || (targets[o.kind] === 0 && Math.random() < dt * 0.6))
        this.list.splice(i, 1);
    }
  }

  _spawn(kind, camX, camY, vw, vh, surfaceFn) {
    if (kind === "bird") {
      const fromLeft = Math.random() < 0.5;
      const x = fromLeft ? camX - 30 : camX + vw + 30;
      const baseY = camY + 16 + Math.random() * vh * 0.3;
      this.list.push({
        kind, x, y: baseY, baseY, vx: (fromLeft ? 1 : -1) * (32 + Math.random() * 24),
        ph: Math.random() * 6.28, flap: 0, t: 0, seed: Math.random(),
      });
      return;
    }
    // Butterflies & fireflies appear near the surface somewhere across the view.
    const tx = Math.floor((camX + Math.random() * vw) / TILE);
    const sy = surfaceFn(tx) * TILE;
    this.list.push({
      kind, x: tx * TILE + Math.random() * TILE, y: sy - 8 - Math.random() * 40,
      vx: (Math.random() * 2 - 1) * 10, ph: Math.random() * 6.28,
      flap: 0, t: 0, glow: 0, seed: Math.random(),
    });
  }
}
