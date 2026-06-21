import { TILE } from "./config.js";
import { stepBody } from "./physics.js";

// An item lying in the world after being mined or dropped. It falls with gravity,
// is magnetised toward a nearby player, and is collected on contact.
export class DroppedItem {
  constructor(px, py, item, count) {
    this.x = px; this.y = py;
    this.vx = (Math.random() * 2 - 1) * 40;
    this.vy = -90;
    this.w = 8; this.h = 8;
    this.onGround = false;
    this.item = item;
    this.count = count;
    this.age = 0;
    this.bob = Math.random() * Math.PI * 2;
    this.picked = false;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  update(world, dt, player) {
    this.age += dt;
    this.bob += dt * 4;
    // Magnet toward the player once it has settled a moment.
    const dx = player.cx - this.cx, dy = player.cy - this.cy;
    const dist = Math.hypot(dx, dy) || 1;
    if (this.age > 0.4 && dist < TILE * 3.5) {
      this.vx += (dx / dist) * 700 * dt;
      this.vy += (dy / dist) * 700 * dt;
    }
    this.vx *= 0.9;
    stepBody(this, world, dt);
  }

  canPickup(player) {
    return this.age > 0.4 &&
      Math.hypot(player.cx - this.cx, player.cy - this.cy) < TILE * 1.1;
  }
}
