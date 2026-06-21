import {
  TILE, PLAYER_W, PLAYER_H, MOVE_SPEED, JUMP_SPEED,
  COYOTE_TIME, JUMP_BUFFER, MAX_HP, IFRAMES, REGEN_DELAY, REGEN_RATE, SWIM_SPEED,
  MOVE_ACCEL_GROUND, MOVE_ACCEL_AIR,
} from "./config.js";
import { stepBody } from "./physics.js";

export class Player {
  constructor(tx, ty) {
    this.x = tx * TILE;
    this.y = ty * TILE;
    this.vx = 0;
    this.vy = 0;
    this.w = PLAYER_W;
    this.h = PLAYER_H;
    this.onGround = false;
    this.facing = 1;        // 1 right, -1 left

    this.animTime = 0;      // walk-cycle phase
    this.swing = 0;         // mining arm swing (0..1, set by game)
    this.squashY = 1;       // jump-stretch / land-squash (eases back to 1)
    this.justLanded = false;// true the frame the player touches ground
    this.justJumped = false;// true the frame a jump fires
    this.landFall = 0;      // fall distance of that landing (tiles)

    this.maxHp = MAX_HP;
    this.hp = MAX_HP;
    this.defense = 0;       // summed from equipped armor by the game each frame
    this.invuln = 0;        // i-frame timer after a hit
    this.hurtFlash = 0;     // visual flash timer
    this.fallTiles = 0;     // distance of the fall that just ended (this frame)

    this._coyote = 0;       // time since last grounded
    this._jumpBuffer = 0;   // time since jump pressed
    this._noDamage = 0;     // seconds since last damage (for regen)
    this._peakY = this.y;   // highest point reached while airborne
    this._wasGround = true;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  // intent: { left, right, jumpPressed, jumpHeld }
  update(world, dt, intent) {
    // Horizontal intent — accelerate toward target speed for a bit of weight.
    let dir = 0;
    if (intent.left) dir -= 1;
    if (intent.right) dir += 1;
    const target = dir * MOVE_SPEED;
    const accel = (this.onGround ? MOVE_ACCEL_GROUND : MOVE_ACCEL_AIR) * dt;
    if (this.vx < target) this.vx = Math.min(target, this.vx + accel);
    else if (this.vx > target) this.vx = Math.max(target, this.vx - accel);
    if (dir !== 0) this.facing = dir;

    // Jump with coyote-time + input buffering for a forgiving feel.
    if (intent.jumpPressed) this._jumpBuffer = JUMP_BUFFER;
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    this._coyote = this.onGround ? COYOTE_TIME : Math.max(0, this._coyote - dt);

    this.justJumped = false;
    if (this._jumpBuffer > 0 && this._coyote > 0) {
      this.vy = -JUMP_SPEED;
      this._jumpBuffer = 0;
      this._coyote = 0;
      this.squashY = 1.18; // stretch upward on takeoff
      this.justJumped = true;
    }
    // Variable jump height: release early to cut the rise short.
    if (!intent.jumpHeld && this.vy < 0) this.vy *= 0.5;

    // Liquid handling: buoyant, draggy, and swimmable.
    const inLiquid = intent.inWater || intent.inLava;
    let opts;
    if (inLiquid) {
      this.vx *= 0.65;
      if (intent.jumpHeld) this.vy = -SWIM_SPEED;
      opts = { gravityScale: 0.28, maxFall: 140 };
      this._peakY = this.y; // no fall damage out of a liquid
    }

    // Timers.
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    this._noDamage += dt;
    if (this._noDamage > REGEN_DELAY && this.hp < this.maxHp)
      this.hp = Math.min(this.maxHp, this.hp + REGEN_RATE * dt);

    // Walk animation only while actually moving on the ground.
    if (this.onGround && Math.abs(this.vx) > 5) this.animTime += dt * 11;
    else if (this.onGround) this.animTime = 0;
    this.swing = Math.max(0, this.swing - dt * 4);
    this.squashY += (1 - this.squashY) * Math.min(1, dt * 13); // ease back to 1

    const wasGround = this.onGround;
    stepBody(this, world, dt, opts);

    // Fall-distance tracking: peak = highest point while airborne; measure on land.
    this.fallTiles = 0;
    this.justLanded = false;
    if (this.onGround) {
      if (!wasGround) {
        this.fallTiles = Math.max(0, (this.y - this._peakY) / TILE);
        this.justLanded = true;
        this.landFall = this.fallTiles;
        this.squashY = Math.max(0.66, 1 - Math.min(0.34, this.fallTiles * 0.04)); // squash on impact
      }
      this._peakY = this.y;
    } else {
      this._peakY = Math.min(this._peakY, this.y);
    }
    this._wasGround = this.onGround;
  }

  // Returns true if the hit landed (not blocked by i-frames).
  // opts: { bypassIframes, useArmor=true, clampMin=true }
  hurt(dmg, kx = 0, ky = 0, opts = {}) {
    const { bypassIframes = false, useArmor = true, clampMin = true } = opts;
    if (this.invuln > 0 && !bypassIframes) return false;
    let d = dmg;
    if (useArmor && this.defense > 0) {
      d = d - this.defense;
      d = clampMin ? Math.max(1, d) : Math.max(0, d);
    }
    this.hp -= d;
    this._noDamage = 0;
    this.hurtFlash = 0.3;
    if (!bypassIframes) this.invuln = IFRAMES;
    this.vx += kx;
    this.vy += ky;
    return true;
  }

  get dead() { return this.hp <= 0; }
}
