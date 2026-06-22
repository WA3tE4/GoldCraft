import {
  TILE, PLAYER_W, PLAYER_H, MOVE_SPEED, JUMP_SPEED,
  COYOTE_TIME, JUMP_BUFFER, MAX_HP, IFRAMES, REGEN_DELAY, REGEN_RATE, SWIM_SPEED,
  MOVE_ACCEL_GROUND, MOVE_ACCEL_AIR, CLIMB_SPEED, FLY_SPEED,
  SPEED_BUFF_MULT, JUMP_BUFF_MULT, COKE_SPEED_MULT, CRACK_SPEED_MULT,
  MAX_MANA, MANA_REGEN, MANA_REGEN_DELAY,
  MAX_FOOD, HUNGER_DRAIN, HUNGER_DRAIN_MOVE, STARVE_DPS, REGEN_FOOD_MIN,
} from "./config.js";

// Buffs that the all-in-one "Godhood Elixir" grants simultaneously.
const GODHOOD_GRANTS = ["god", "fly", "speed", "strength", "regen", "haste", "feather"];
// Buffs from liquor & smoking: dizzy visual + a small attack-damage bonus.
const INTOX_BUFFS = ["drunk", "buzzed", "high"];
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
    this.creative = false;  // Creative mode: invincible + double-jump flight (set by game)
    this.flying = false;    // Creative flight toggle (double-tap jump)
    this._jumpTapWindow = 0;// time left to register a second jump tap

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

    this.buffs = {};        // active power-up timers: name -> seconds remaining

    this.maxMana = MAX_MANA;  // spell energy
    this.mana = MAX_MANA;
    this._noCast = MANA_REGEN_DELAY; // time since last spell, gates mana regen

    this.maxFood = MAX_FOOD;  // hunger meter (survival): drains over time, refilled by eating
    this.food = MAX_FOOD;
  }

  // Spend mana if there's enough; returns true if the spell may proceed.
  // Godhood waives all mana costs (pure power fantasy).
  spendMana(cost) {
    if (this.hasBuff("godhood")) { this._noCast = 0; return true; }
    if (this.mana < cost) return false;
    this.mana -= cost;
    this._noCast = 0;
    return true;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  // --- Power-up buffs ---
  addBuff(name, dur) { this.buffs[name] = Math.max(this.buffs[name] || 0, dur); }
  buffTime(name) { return this.buffs[name] || 0; }
  hasBuff(name) {
    if ((this.buffs[name] || 0) > 0) return true;
    // The Godhood Elixir lights up a whole bundle of buffs at once.
    if (name !== "godhood" && (this.buffs.godhood || 0) > 0 && GODHOOD_GRANTS.includes(name)) return true;
    return false;
  }
  // True while any liquor/smoking buff is active (drives the dizzy overlay + damage bonus).
  isIntoxicated() { return INTOX_BUFFS.some((b) => (this.buffs[b] || 0) > 0); }
  // True while on a hard stimulant (cocaine/crack) — drives the jittery overlay.
  isStimmed() { return (this.buffs.wired || 0) > 0 || (this.buffs.cracked || 0) > 0; }
  // Extra horizontal speed multiplier from stimulants (crack beats cocaine).
  stimSpeedMult() {
    if ((this.buffs.cracked || 0) > 0) return CRACK_SPEED_MULT;
    if ((this.buffs.wired || 0) > 0) return COKE_SPEED_MULT;
    return 1;
  }

  // intent: { left, right, jumpPressed, jumpHeld }
  update(world, dt, intent) {
    // Horizontal intent — accelerate toward target speed for a bit of weight.
    let dir = 0;
    if (intent.left) dir -= 1;
    if (intent.right) dir += 1;
    const speedMult = (this.hasBuff("speed") ? SPEED_BUFF_MULT : 1)
      * (this.hasBuff("flash") ? 2.6 : 1) * this.stimSpeedMult()
      * (this.hasBuff("chilled") ? 0.55 : 1); // frost slimes & blizzards bog you down
    const target = dir * MOVE_SPEED * speedMult;
    // The Flash accelerates near-instantly — no sluggish wind-up.
    const accel = (this.hasBuff("flash") ? 6000 : (this.onGround ? MOVE_ACCEL_GROUND : MOVE_ACCEL_AIR)) * dt;
    if (this.vx < target) this.vx = Math.min(target, this.vx + accel);
    else if (this.vx > target) this.vx = Math.max(target, this.vx - accel);
    if (dir !== 0) this.facing = dir;

    // Creative: a quick double-tap of jump toggles free flight on/off.
    if (this.creative && intent.jumpPressed) {
      if (this._jumpTapWindow > 0) { this.flying = !this.flying; this._jumpTapWindow = 0; }
      else this._jumpTapWindow = 0.30;
    }
    this._jumpTapWindow = Math.max(0, this._jumpTapWindow - dt);

    // Jump with coyote-time + input buffering for a forgiving feel.
    if (intent.jumpPressed) this._jumpBuffer = JUMP_BUFFER;
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    this._coyote = this.onGround ? COYOTE_TIME : Math.max(0, this._coyote - dt);

    this.justJumped = false;
    if (this._jumpBuffer > 0 && this._coyote > 0 && !intent.onLadder) {
      this.vy = -JUMP_SPEED * (this.hasBuff("jump") ? JUMP_BUFF_MULT : 1);
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
      const boat = intent.inWater && this.hasBuff("boat");
      if (!boat) this.vx *= 0.65;                  // a boat skims at full speed
      if (intent.jumpHeld) this.vy = -SWIM_SPEED;
      else if (boat) this.vy = Math.min(this.vy, -10); // ride the surface
      opts = { gravityScale: boat ? 0.04 : 0.28, maxFall: 140 };
      this._peakY = this.y; // no fall damage out of a liquid
    }

    // Ladder climbing overrides gravity entirely (hold up/down to move along it).
    if (intent.onLadder) {
      this.vy = intent.jumpHeld ? -CLIMB_SPEED : intent.down ? CLIMB_SPEED : 0;
      opts = { gravityScale: 0, maxFall: CLIMB_SPEED + 10 };
      this._peakY = this.y;
    } else if (this.hasBuff("fly") || (this.creative && this.flying)) {
      // Angel Wings / Rocket Boots / Creative flight: ascend, descend, or hover.
      if (intent.jumpHeld) this.vy = -FLY_SPEED;
      else if (intent.down) this.vy = FLY_SPEED * 0.7;
      else this.vy *= 0.8;
      opts = { gravityScale: 0, maxFall: FLY_SPEED + 50 };
      this._peakY = this.y;
    } else if (this.hasBuff("feather") && this.vy > 0) {
      // Feather Fall: drift down gently (and never take fall damage).
      opts = { gravityScale: 0.28, maxFall: 95 };
      this._peakY = this.y;
    }

    // Timers.
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    for (const k in this.buffs) { this.buffs[k] -= dt; if (this.buffs[k] <= 0) delete this.buffs[k]; }
    this._noDamage += dt;
    // Mana refills after a brief beat following the last cast (faster on godhood).
    this._noCast += dt;
    if (this._noCast >= MANA_REGEN_DELAY && this.mana < this.maxMana) {
      const rate = this.hasBuff("godhood") ? MANA_REGEN * 4 : MANA_REGEN;
      this.mana = Math.min(this.maxMana, this.mana + rate * dt);
    }
    // Hunger (survival): drains over time, faster while exerting yourself. An
    // empty belly stops natural regen and slowly saps health (down to a floor of
    // 1 HP — starvation alone won't kill you, but it leaves you helpless).
    if (!this.creative) {
      const exerting = !this.onGround || (this.onGround && Math.abs(this.vx) > 5);
      this.food = Math.max(0, this.food - (exerting ? HUNGER_DRAIN_MOVE : HUNGER_DRAIN) * dt);
      if (this.food <= 0) this.hp = Math.max(1, this.hp - STARVE_DPS * dt);
    }
    const fed = this.creative || this.food >= REGEN_FOOD_MIN;
    const regenBuff = this.hasBuff("regen");
    if ((regenBuff || (fed && this._noDamage > REGEN_DELAY)) && this.hp < this.maxHp)
      this.hp = Math.min(this.maxHp, this.hp + (regenBuff ? 30 : REGEN_RATE) * dt);

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
    if (this.creative) return false;       // Creative mode: invincible
    if (this.hasBuff("god")) return false; // Invincibility Star / Godhood
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
