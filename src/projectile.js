import { TILE } from "./config.js";

// A bullet/rocket/energy bolt fired by a gun. Flies in a straight (optionally
// gravity-arced) line, leaving a short trail. It dies on hitting a solid tile or
// when its life runs out; the game checks entity overlaps and triggers explosions
// for `explosive` rounds. Position is the top-left in world px.
export class Projectile {
  constructor(x, y, vx, vy, opts = {}) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.w = opts.w || 4; this.h = opts.h || 4;
    this.damage = opts.damage || 10;
    this.explosive = !!opts.explosive;
    this.frost = !!opts.frost; // chills + slows the foe it strikes
    this.fire = !!opts.fire;   // dragon breath: ignites tiles, leaves embers
    this.blast = opts.blast || 3;
    this.color = opts.color || "#ffe07a";
    this.glow = !!opts.glow;
    this.gravity = opts.gravity || 0;
    this.life = opts.life || 1.8;
    this.pierce = opts.pierce || 0;   // foes the shot passes through before dying
    this.spin = !!opts.spin;          // draw as a spinning disc (shield/batarang)
    this.hitList = [];                // entities already struck (no double-hits)
    this.dead = false;
    this.hitTile = false;
    this.trail = [];
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  update(world, dt) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.trail.push({ x: this.cx, y: this.cy });
    if (this.trail.length > 6) this.trail.shift();
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
    if (world.isSolidAt(tx, ty)) { this.dead = true; this.hitTile = true; }
  }
}
