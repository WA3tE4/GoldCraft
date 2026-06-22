import { TILE } from "./config.js";
import { stepBody } from "./physics.js";

// Minimal hostile placeholder: a slime that hops toward the player.
export class Slime {
  constructor(tx, ty) {
    this.kind = "slime";
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
    this.touchDmg = 8;
    this.loot = [{ item: "gel", n: [1, 3] }];
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

// Shared ground-walker: paces toward the player and hops over obstacles/ledges.
// Subclasses set stats in the constructor (speed, hp, touchDmg, jump, etc.).
class Walker {
  constructor(tx, ty) {
    this.x = tx * TILE;
    this.y = ty * TILE;
    this.vx = 0;
    this.vy = 0;
    this.w = 12;
    this.h = 24;
    this.onGround = false;
    this.speed = 60;
    this.jump = 330;
    this.maxHp = 40;
    this.hp = 40;
    this.touchDmg = 10;
    this.loot = [];
    this.hurtFlash = 0;
    this.animTime = 0;
    this.facing = 1;
    this.dead = false;
    this.aggroRange = 9999; // tiles before it starts chasing
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  hurt(dmg, kx = 0) {
    this.hp -= dmg;
    this.hurtFlash = 0.2;
    this.vx += kx;
    this.vy -= 90;
    if (this.hp <= 0) this.dead = true;
  }

  // True if a solid tile blocks the body's path at the given horizontal dir.
  _blockedAhead(world, dir) {
    const aheadX = dir > 0 ? this.x + this.w + 1 : this.x - 1;
    const tx = Math.floor(aheadX / TILE);
    const tyFeet = Math.floor((this.y + this.h - 2) / TILE);
    const tyMid = Math.floor((this.y + this.h / 2) / TILE);
    return world.isSolidAt(tx, tyFeet) || world.isSolidAt(tx, tyMid);
  }

  update(world, dt, player) {
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    const dist = Math.abs(player.cx - this.cx) / TILE;
    const dir = Math.sign(player.cx - this.cx) || this.facing;
    if (dist <= this.aggroRange) {
      this.facing = dir;
      const target = dir * this.speed;
      // accelerate toward target speed
      this.vx += (target - this.vx) * Math.min(1, dt * 6);
      if (this.onGround && this._blockedAhead(world, dir)) this.vy = -this.jump; // hop the ledge/wall
    } else if (this.onGround) {
      this.vx *= 0.7;
    }
    if (Math.abs(this.vx) > 4) this.animTime += dt * 10;
    stepBody(this, world, dt);
  }
}

// Basic undead: steady walker, moderate health, leaves rotten flesh.
export class Zombie extends Walker {
  constructor(tx, ty, variant = "normal") {
    super(tx, ty);
    this.kind = "zombie";
    this.variant = variant;
    if (variant === "fast") {
      // Lean sprinter — quick and jumpy but fragile.
      this.speed = 118;
      this.jump = 360;
      this.maxHp = this.hp = 28;
      this.touchDmg = 9;
      this.tint = "#7fae6a";
      this.loot = [{ item: "rotten_flesh", n: [1, 2] }];
    } else if (variant === "brute") {
      // Hulking bruiser — slow, tanky, hits hard.
      this.w = 16; this.h = 26;
      this.speed = 42;
      this.jump = 300;
      this.maxHp = this.hp = 110;
      this.touchDmg = 20;
      this.tint = "#4d6b46";
      this.loot = [{ item: "rotten_flesh", n: [1, 3] }, { item: "iron_ingot", n: [0, 1] }];
    } else {
      this.speed = 64;
      this.maxHp = this.hp = 50;
      this.touchDmg = 12;
      this.tint = "#5f8a52";
      this.loot = [{ item: "rotten_flesh", n: [1, 2] }];
    }
  }
}

// Skeleton archer: keeps its distance and flooses arrows at the player.
export class SkeletonArcher extends Walker {
  constructor(tx, ty) {
    super(tx, ty);
    this.kind = "skeleton";
    this.w = 12; this.h = 24;
    this.speed = 70;
    this.jump = 330;
    this.maxHp = this.hp = 38;
    this.touchDmg = 7;
    this.range = 11;        // tiles: will shoot from within this
    this.keepDist = 5;      // tiles: backs away if the player gets closer
    this.shootCd = 1 + Math.random();
    this.pendingShots = []; // drained by the game each frame
    this.loot = [{ item: "bone", n: [1, 3] }, { item: "arrow", n: [0, 2] }];
  }

  update(world, dt, player) {
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    const dx = player.cx - this.cx;
    const dist = Math.abs(dx) / TILE;
    const dir = Math.sign(dx) || this.facing;
    this.facing = dir;

    // Kite: approach if too far, back off if too close, otherwise hold ground.
    let move = 0;
    if (dist > this.range) move = dir;
    else if (dist < this.keepDist) move = -dir;
    const target = move * this.speed;
    this.vx += (target - this.vx) * Math.min(1, dt * 6);
    if (move !== 0 && this.onGround && this._blockedAhead(world, Math.sign(move))) this.vy = -this.jump;
    if (Math.abs(this.vx) > 4) this.animTime += dt * 10;

    // Fire when in range and roughly level with the player.
    this.shootCd -= dt;
    if (this.shootCd <= 0 && dist <= this.range && Math.abs(player.cy - this.cy) < TILE * 6) {
      this.shootCd = 1.6 + Math.random() * 0.8;
      const px = player.cx, py = player.cy - 4;
      const ang = Math.atan2(py - this.cy, px - this.cx);
      const spd = 300;
      this.pendingShots.push({
        x: this.cx, y: this.cy - 4,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 40, // slight lob
      });
    }
    stepBody(this, world, dt);
  }
}

// A great winged Dragon, always present in the world. It alternates between two
// macro-modes: GROUND (lands near the player to rest/prowl, walking slowly with
// gravity) and AIR (takes off and wreaks havoc — orbiting high then folding its
// wings into strafing fire-breathing dives). Its fire breath is queued in
// `pendingFire` and drained by the game each frame.
export class Dragon {
  constructor(tx, ty) {
    this.kind = "dragon";
    this.flying = true;
    this.x = tx * TILE;
    this.y = ty * TILE;
    this.vx = 0; this.vy = 0;
    this.w = 56; this.h = 28;
    this.maxHp = this.hp = 620;
    this.touchDmg = 22;
    this.facing = 1;
    this.onGround = false;
    this.hurtFlash = 0;
    this.dead = false;
    this.animTime = Math.random() * 6;
    this.flap = 0;
    this.bossBar = true;        // shows a dedicated health bar (not THE Warden)
    this.name = "Ancient Dragon";
    this.mode = "air";          // "air" (flying havoc) | "ground" (landed/prowling)
    this.modeT = 8 + Math.random() * 6; // seconds left in this macro-mode
    this.state = "cruise";      // air substate: "cruise" (orbit high) | "swoop" (dive)
    this.stateT = 3 + Math.random() * 2;
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.fireCd = 1.5;
    this.enraged = false;       // flips true below 35% HP — faster, fiercer
    this.justEnraged = false;
    this.pendingFire = [];      // queued fire-breath shots, drained by the game
    this.loot = [
      { item: "dragon_scale", n: [3, 6] },
      { item: "gold_ingot", n: [2, 5] },
      { item: "diamond", n: [1, 2] },
    ];
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  hurt(dmg, kx = 0) {
    this.hp -= dmg;
    this.hurtFlash = 0.2;
    this.vx += kx * 0.12; // huge: shrugs off most knockback
    // Getting hurt while resting startles it back into the air.
    if (this.mode === "ground") { this.mode = "air"; this.modeT = 10 + Math.random() * 6; this.vy = -260; }
    if (this.hp <= 0) this.dead = true;
  }

  update(world, dt, player) {
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    this.animTime += dt;
    this.modeT -= dt;

    // Enrage: once below 35% HP the dragon turns red-hot and fights desperately.
    // `justEnraged` flags the single frame it flips, so the game can play fanfare.
    this.justEnraged = false;
    if (!this.enraged && this.hp < this.maxHp * 0.35) {
      this.enraged = true; this.justEnraged = true;
      if (this.mode === "ground") { this.mode = "air"; this.modeT = 12; this.vy = -300; } // leaps up enraged
    }

    if (this.mode === "ground") this._updateGround(world, dt, player);
    else this._updateAir(world, dt, player);

    // Breathe fire toward the player when reasonably close (a rapid stream mid-dive).
    // Enraged, it spits faster and in a spreading cone of several embers at once.
    this.fireCd -= dt;
    const bdx = player.cx - this.cx, bdy = player.cy - this.cy;
    const canBreathe = this.mode === "air" || Math.abs(bdx) < TILE * 12;
    if (canBreathe && this.fireCd <= 0 && Math.hypot(bdx, bdy) < TILE * 18) {
      const baseCd = this.state === "swoop" ? 0.11 : (this.mode === "ground" ? 0.9 : 1.3);
      this.fireCd = this.enraged ? baseCd * 0.6 : baseCd;
      this.facing = Math.sign(bdx) || this.facing;
      const baseAng = Math.atan2(bdy, bdx);
      const mx = this.cx + this.facing * this.w * 0.42, my = this.cy - 2;
      const pellets = this.enraged ? 3 : 1;
      const cone = this.enraged ? 0.42 : 0.2; // wider fire cone when enraged
      for (let i = 0; i < pellets; i++) {
        const t = pellets === 1 ? 0 : (i / (pellets - 1)) * 2 - 1; // -1..1 across the cone
        const ang = baseAng + t * cone * 0.5 + (Math.random() * 2 - 1) * 0.12;
        const spd = (this.enraged ? 270 : 230) + Math.random() * 70;
        this.pendingFire.push({ x: mx, y: my, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd });
      }
    }
  }

  // GROUND: settle onto terrain under gravity and prowl slowly toward the player.
  _updateGround(world, dt, player) {
    this.flap += dt * 2; // mostly folded; the odd shuffle
    this.vy += 900 * dt;
    const dir = Math.sign(player.cx - this.cx) || this.facing;
    // Stay near the player but don't crowd him; pace back and forth.
    const want = Math.abs(player.cx - this.cx) > TILE * 4 ? dir * 40 : 0;
    this.vx += (want - this.vx) * Math.min(1, dt * 3);
    if (Math.abs(this.vx) > 6) this.facing = Math.sign(this.vx);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Land on the surface: snap feet to the top of the first solid tile below.
    const ftx = Math.floor(this.cx / TILE), fty = Math.floor((this.y + this.h) / TILE);
    if (world.isSolidAt(ftx, fty)) {
      this.y = fty * TILE - this.h;
      this.vy = 0; this.onGround = true;
    } else this.onGround = false;

    if (this.modeT <= 0) { // take off again and resume aerial havoc
      this.mode = "air"; this.modeT = 10 + Math.random() * 8;
      this.state = "cruise"; this.stateT = 2.5 + Math.random() * 2;
      this.onGround = false; this.vy = -320;
    }
  }

  // AIR: free flight. Orbit high, then swoop across the player in a strafing dive.
  // When the macro-timer expires, glide down to land near the player.
  _updateAir(world, dt, player) {
    this.flap += dt * (this.state === "swoop" ? 14 : 7);
    this.stateT -= dt;
    this.onGround = false;

    let tx, ty, maxSpd;
    if (this.modeT <= 0) { // descend to land near the player
      tx = player.cx + this.side * TILE * 3;
      ty = player.cy;
      maxSpd = 130;
      // Once we're close to settling, hand off to ground mode.
      const fty = Math.floor((this.y + this.h + 4) / TILE);
      if (world.isSolidAt(Math.floor(this.cx / TILE), fty)) {
        this.mode = "ground"; this.modeT = 5 + Math.random() * 5;
      }
    } else if (this.state === "swoop") {
      tx = player.cx + this.side * TILE * 6; // strafe across the player
      ty = player.cy - TILE * 1.5;
      maxSpd = 300;
      // Enraged: shorter recovery between dives so it keeps pressing the attack.
      if (this.stateT <= 0) { this.state = "cruise"; this.stateT = (this.enraged ? 1.2 : 3) + Math.random() * 2; this.side = -this.side; }
    } else { // cruise: orbit high to one side of the player
      tx = player.cx + this.side * TILE * 13;
      ty = player.cy - TILE * 8 + Math.sin(this.animTime * 0.9) * TILE * 1.5;
      maxSpd = 150;
      if (this.stateT <= 0) { this.state = "swoop"; this.stateT = 2.2; }
    }

    if (this.enraged) maxSpd *= 1.35; // hotter blood, faster wings

    const dx = tx - this.cx, dy = ty - this.cy, len = Math.hypot(dx, dy) || 1;
    this.vx += ((dx / len) * maxSpd - this.vx) * Math.min(1, dt * 2.4);
    this.vy += ((dy / len) * maxSpd - this.vy) * Math.min(1, dt * 2.4);
    if (Math.abs(this.vx) > 8) this.facing = Math.sign(this.vx);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Don't clip through ground while airborne (unless deliberately descending).
    const ftx = Math.floor(this.cx / TILE), fty = Math.floor((this.y + this.h) / TILE);
    if (this.modeT > 0 && world.isSolidAt(ftx, fty)) { this.y -= TILE * 0.6; if (this.vy > 0) this.vy = -120; }
  }
}

// The Cave Warden: a hulking boss that lurks in its deep lair. Chases hard,
// leaps at the player, and periodically summons a pack of slimes. Big health
// pool drives a dedicated boss bar (see renderer/game).
export class CaveBoss extends Walker {
  constructor(tx, ty) {
    super(tx, ty);
    this.kind = "boss";
    this.boss = true;
    this.name = "The Cave Warden";
    this.w = 30; this.h = 44;
    this.speed = 95;
    this.jump = 430;
    this.maxHp = this.hp = 1200;
    this.touchDmg = 26;
    this.home = { x: this.x, y: this.y }; // lair anchor; the Warden won't stray far
    this.leashRange = 30 * TILE;          // px from home before it turns back
    this.leapCd = 3 + Math.random() * 2;
    this.summonCd = 8;
    this.wantSummon = 0;     // count of minions the game should spawn this frame
    this.glowPulse = 0;
    this.loot = [
      { item: "warden_heart", n: [1, 1] },
      { item: "gold_ingot", n: [3, 6] },
      { item: "diamond", n: [1, 3] },
    ];
  }

  hurt(dmg, kx = 0) {
    this.hp -= dmg;
    this.hurtFlash = 0.2;
    this.vx += kx * 0.25; // heavy: resists knockback
    if (this.hp <= 0) this.dead = true;
  }

  update(world, dt, player) {
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    this.glowPulse += dt;

    // Leash: if dragged too far from the lair, ignore the player and stalk home
    // so the Warden always stays loaded in its arena instead of wandering off.
    const farFromHome = Math.abs(this.cx - this.home.x) > this.leashRange;
    const chaseX = farFromHome ? this.home.x : player.cx;
    const dir = Math.sign(chaseX - this.cx) || this.facing;
    this.facing = dir;
    const enraged = !farFromHome && this.hp < this.maxHp * 0.4; // speeds up below 40% HP
    const spd = enraged ? this.speed * 1.4 : this.speed;
    this.vx += (dir * spd - this.vx) * Math.min(1, dt * 5);
    if (this.onGround && this._blockedAhead(world, dir)) this.vy = -this.jump;

    // Leap toward the player to close gaps.
    this.leapCd -= dt;
    if (this.onGround && this.leapCd <= 0) {
      this.leapCd = (enraged ? 1.8 : 3) + Math.random() * 1.5;
      this.vy = -this.jump * 1.05;
      this.vx = dir * spd * 1.8;
    }

    // Summon a little swarm now and then.
    this.summonCd -= dt;
    if (this.summonCd <= 0) {
      this.summonCd = enraged ? 6 : 10;
      this.wantSummon = enraged ? 3 : 2;
    }

    if (Math.abs(this.vx) > 4) this.animTime += dt * 8;
    stepBody(this, world, dt);
  }
}
