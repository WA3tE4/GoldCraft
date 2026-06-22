import { TILE } from "./config.js";
import { TILE_IDS } from "./tiles.js";

const FISH_COLORS = ["#e0883a", "#6fd0e0", "#d04f5a", "#8ad08a", "#e6c84b"];

// A fish that swims freely inside water (no tile collision — it steers to stay in
// the liquid). Knocked out of water it flops, falls, and soon expires. Drops a
// raw fish when caught or struck.
export class Fish {
  constructor(tx, ty, seed = Math.random()) {
    this.x = tx * TILE;
    this.y = ty * TILE;
    this.w = 10; this.h = 6;
    this.vx = (seed < 0.5 ? -1 : 1) * (18 + Math.random() * 22);
    this.vy = 0;
    this.facing = Math.sign(this.vx) || 1;
    this.maxHp = 6; this.hp = 6;
    this.hurtFlash = 0;
    this.dead = false;
    this.color = FISH_COLORS[(seed * FISH_COLORS.length) | 0];
    this._turn = Math.random() * 2;
    this._wob = Math.random() * 6;
    this.outOfWater = 0;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  hurt(dmg) {
    this.hp -= dmg;
    this.hurtFlash = 0.2;
    if (this.hp <= 0) this.dead = true;
  }

  _wet(world, x, y) {
    return world.get(Math.floor(x / TILE), Math.floor(y / TILE)) === TILE_IDS.WATER;
  }

  update(world, dt, _player) {
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    this._wob += dt * 6;

    if (this._wet(world, this.cx, this.cy)) {
      this.outOfWater = 0;
      // Occasionally pick a new heading; otherwise cruise with a gentle bob.
      this._turn -= dt;
      if (this._turn <= 0) {
        this._turn = 1.5 + Math.random() * 2.5;
        if (Math.random() < 0.5) this.vx = -this.vx + (Math.random() * 16 - 8);
      }
      this.vy = Math.sin(this._wob) * 12;
      // Steer back toward water at the edges of the body.
      if (!this._wet(world, this.cx + Math.sign(this.vx) * (this.w * 0.7), this.cy)) this.vx = -this.vx;
      if (!this._wet(world, this.cx, this.cy - this.h)) this.vy = Math.abs(this.vy) + 8;
      if (!this._wet(world, this.cx, this.cy + this.h)) this.vy = -Math.abs(this.vy) - 8;
      this.facing = Math.sign(this.vx) || this.facing;
    } else {
      // Out of water: flop and sink, then expire.
      this.outOfWater += dt;
      this.vy += 700 * dt;
      this.vx *= 0.88;
      if (this.outOfWater > 6) this.dead = true;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
}
