import { TILE } from "./config.js";
import { stepBody } from "./physics.js";

// Passive farm animals that wander the surface. They flee briefly when struck and
// drop meat (+ hides/feathers) when slain. Chickens are light, flutter-fall, and
// periodically lay an egg. Modelled like the villager: a body for `stepBody`.
//
// Each type: w,h (px), hp, speed (px/s), drop + dropN range, optional `extra`
// drop, body `color`, optional `spot` (cow), `light` (chicken fall), `lays`.
export const ANIMAL_TYPES = {
  cow:     { w: 22, h: 16, hp: 25, speed: 26, drop: "raw_beef",    dropN: [1, 2], extra: { item: "leather", n: [0, 1] }, color: "#d8cdbe", spot: "#4a3a2c" },
  pig:     { w: 20, h: 14, hp: 20, speed: 32, drop: "raw_pork",    dropN: [1, 2], color: "#e6a6b0" },
  chicken: { w: 12, h: 12, hp: 8,  speed: 30, drop: "raw_chicken", dropN: [1, 1], extra: { item: "feather", n: [1, 2] }, color: "#f4f4f4", light: true, lays: "egg" },
};

export const ANIMAL_KINDS = Object.keys(ANIMAL_TYPES);

export class Animal {
  constructor(type, tx, ty) {
    const def = ANIMAL_TYPES[type] || ANIMAL_TYPES.cow;
    this.type = type;
    this.def = def;
    this.x = tx * TILE;
    this.y = ty * TILE;
    this.vx = 0; this.vy = 0;
    this.w = def.w; this.h = def.h;
    this.onGround = false;
    this.facing = Math.random() < 0.5 ? -1 : 1;
    this.maxHp = def.hp; this.hp = def.hp;
    this.hurtFlash = 0;
    this.dead = false;
    this.state = "idle";
    this.target = this.x;
    this._think = Math.random() * 2;
    this._stuck = 0;
    this._lastX = this.x;
    this.animTime = Math.random() * 6;
    this._layCd = 12 + Math.random() * 24;
    this.layEgg = false; // true for the one frame an egg should be dropped
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  hurt(dmg, kx = 0) {
    this.hp -= dmg;
    this.hurtFlash = 0.25;
    this.vx += kx;
    this.vy -= 110;
    if (this.hp <= 0) this.dead = true;
  }

  update(world, dt, player) {
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    this.layEgg = false;

    // Spooked right after a hit: bolt away from the player for a moment.
    if (this.hurtFlash > 0) {
      this.state = "flee";
      this.target = this.cx + Math.sign(this.cx - player.cx || 1) * TILE * 12;
    } else {
      this._think -= dt;
      if (this._think <= 0) {
        this._think = 1.5 + Math.random() * 3;
        if (Math.random() < 0.4) { this.state = "idle"; this.target = this.cx; }
        else { this.state = "wander"; this.target = this.cx + (Math.random() * 2 - 1) * TILE * 8; }
      }
    }

    const dx = this.target - this.cx;
    if (Math.abs(dx) > 4 && this.state !== "idle") {
      const dir = Math.sign(dx);
      this.vx = dir * this.def.speed * (this.state === "flee" ? 2.2 : 1);
      this.facing = dir;
      // Hop over a small ledge if grounded and wedged against it.
      if (this.onGround && Math.abs(this.x - this._lastX) < 0.3) {
        this._stuck += dt;
        if (this._stuck > 0.25) { this.vy = -290; this._stuck = 0; }
      } else this._stuck = 0;
    } else {
      this.vx *= 0.6;
    }
    this._lastX = this.x;

    if (this.onGround && Math.abs(this.vx) > 5) this.animTime += dt * 9;

    if (this.def.lays) {
      this._layCd -= dt;
      if (this._layCd <= 0 && this.onGround) { this._layCd = 24 + Math.random() * 36; this.layEgg = true; }
    }

    // Chickens flutter, so they fall slowly; quadrupeds fall normally.
    stepBody(this, world, dt, this.def.light ? { maxFall: 90 } : undefined);
  }
}
