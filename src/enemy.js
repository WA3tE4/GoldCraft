import { TILE } from "./config.js";
import { stepBody } from "./physics.js";

// Minimal hostile placeholder: a slime that hops toward the player.
export class Slime {
  constructor(tx, ty) {
    this.x = tx * TILE;
    this.y = ty * TILE;
    this.vx = 0;
    this.vy = 0;
    this.w = 14;
    this.h = 12;
    this.onGround = false;
    this._hopTimer = Math.random() * 1.5;
    this.squash = 0; // 0..1 visual squash on landing
    this.maxHp = 30;
    this.hp = 30;
    this.hurtFlash = 0;
    this.dead = false;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  hurt(dmg, kx = 0) {
    this.hp -= dmg;
    this.hurtFlash = 0.2;
    this.vx += kx;
    this.vy -= 120; // knocked up a bit
    if (this.hp <= 0) this.dead = true;
  }

  update(world, dt, player) {
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    this._hopTimer -= dt;
    if (this.onGround) {
      this.vx *= 0.6; // friction while grounded
      if (this._hopTimer <= 0) {
        const dir = Math.sign(player.cx - (this.x + this.w / 2)) || 1;
        this.vx = dir * 60;
        this.vy = -260;
        this._hopTimer = 1.2 + Math.random();
        this.squash = 1;
      }
    }
    this.squash = Math.max(0, this.squash - dt * 3);
    stepBody(this, world, dt);
  }
}
