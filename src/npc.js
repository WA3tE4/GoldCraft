import { TILE } from "./config.js";
import { stepBody } from "./physics.js";
import { pickTrades } from "./trade.js";

const NAMES = ["Bilo", "Marn", "Tessa", "Odo", "Pim", "Wren", "Gale", "Hob", "Juni", "Sable"];

// A villager bound to a home base. Wanders nearby by day, heads home at night,
// and eats (refills food) while at home. Food slowly drains over time.
export class Villager {
  constructor(home, seed = Math.random()) {
    this.home = home;                 // {x,y} in tiles
    this.x = home.x * TILE;
    this.y = (home.y - 2) * TILE;
    this.vx = 0; this.vy = 0;
    this.w = 12; this.h = 26;
    this.onGround = false;
    this.facing = 1;
    this.name = NAMES[(seed * NAMES.length) | 0];
    this.color = `hsl(${(seed * 360) | 0} 45% 55%)`;
    this.trades = pickTrades(Math.random, 4);
    this.food = 0.6 + seed * 0.4;     // 0..1
    this.maxHp = 50;
    this.hp = 50;
    this.hurtFlash = 0;
    this.dead = false;
    this.state = "wander";
    this.target = this.x;
    this._think = 0;
    this._stuck = 0;
    this._lastX = this.x;
    this.animTime = 0;
  }

  hurt(dmg) {
    this.hp -= dmg;
    this.hurtFlash = 0.2;
    if (this.hp <= 0) this.dead = true;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  update(world, dt, dayT) {
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    const isNight = dayT < 0.25 || dayT > 0.78;
    this.food = Math.max(0, this.food - dt * 0.012);
    // Starving villagers slowly lose health; well-fed ones heal.
    if (this.food <= 0) this.hp -= dt * 3;
    else if (this.food > 0.5 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + dt * 2);
    if (this.hp <= 0) { this.dead = true; return; }

    const homePx = this.home.x * TILE;
    const atHome = Math.abs(this.cx - homePx) < TILE * 1.5;

    // Decide where to go.
    this._think -= dt;
    if (atHome && (isNight || this.food < 0.25)) {
      this.state = "eat";
      this.food = Math.min(1, this.food + dt * 0.25); // eating at home
      this.target = this.cx;                          // stand still
    } else if (isNight || this.food < 0.25) {
      this.state = "home";
      this.target = homePx;
    } else if (this._think <= 0) {
      this.state = "wander";
      this.target = homePx + (Math.random() * 2 - 1) * TILE * 7;
      this._think = 1.5 + Math.random() * 2.5;
    }

    // Walk toward target.
    const dx = this.target - this.cx;
    if (Math.abs(dx) > 4 && this.state !== "eat") {
      const dir = Math.sign(dx);
      this.vx = dir * 45;
      this.facing = dir;
      // Hop over small obstacles when grounded and stuck against a wall.
      if (this.onGround && Math.abs(this.x - this._lastX) < 0.3) {
        this._stuck += dt;
        if (this._stuck > 0.2) { this.vy = -300; this._stuck = 0; }
      } else this._stuck = 0;
    } else {
      this.vx *= 0.5;
    }
    this._lastX = this.x;

    if (this.onGround && Math.abs(this.vx) > 5) this.animTime += dt * 9;
    stepBody(this, world, dt);
  }
}
