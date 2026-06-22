import { TILE } from "./config.js";
import { stepBody } from "./physics.js";
import { pickTrades } from "./trade.js";

const NAMES = ["Bilo", "Marn", "Tessa", "Odo", "Pim", "Wren", "Gale", "Hob", "Juni", "Sable"];
const ROYAL_NAMES = ["Aldric", "Brann", "Cyric", "Doran", "Edmund", "Garrick"];
const QUEEN_NAMES = ["Isolde", "Mara", "Rowena", "Sera", "Wynne", "Lyra"];
const GUARD_NAMES = ["Bron", "Gunnar", "Rok", "Stig", "Vald", "Thork", "Haln"];
const FARMER_NAMES = ["Bram", "Cob", "Dill", "Hodge", "Marl", "Pell", "Roon"];
const BABY_NAMES = ["Pip", "Tot", "Bub", "Nim", "Wee", "Dot", "Bean"];

// Gang / faction definitions — a colored sash + name shown over members.
export const GANGS = {
  royal:  { name: "Royal Guard", color: "#e8c349" },
  fangs:  { name: "Iron Fangs",  color: "#c23a3a" },
  mud:    { name: "Mudfoot Clan", color: "#7aa83c" },
};

// Per-role tuning: base color, body size, hp, movement and how far they roam.
const ROLES = {
  villager: { hp: 50,  w: 12, h: 26, speed: 45, roam: 7,  names: NAMES },
  king:     { hp: 140, w: 14, h: 28, speed: 38, roam: 3,  names: ROYAL_NAMES, color: "#6a3d9a", royal: true },
  queen:    { hp: 120, w: 13, h: 27, speed: 38, roam: 3,  names: QUEEN_NAMES, color: "#b1306a", royal: true },
  guard:    { hp: 160, w: 13, h: 28, speed: 70, roam: 10, names: GUARD_NAMES, color: "#4a5560", patrol: true },
  farmer:   { hp: 60,  w: 12, h: 26, speed: 48, roam: 9,  names: FARMER_NAMES, color: "#6e7a3a", farmer: true },
  child:    { hp: 25,  w: 8,  h: 16, speed: 55, roam: 4,  names: BABY_NAMES, child: true },
};

// Farmers trade produce; royals deal in luxury; everyone else uses the shared pool.
const FARMER_TRADES = [
  { give: { item: "wheat", count: 3 },  get: { item: "bread", count: 1 } },
  { give: { item: "wheat", count: 6 },  get: { item: "apple", count: 3 } },
  { give: { item: "wood", count: 6 },   get: { item: "wheat", count: 4 } },
  { give: { item: "egg", count: 4 },    get: { item: "cooked_chicken", count: 1 } },
];
const ROYAL_TRADES = [
  { give: { item: "gold_ingot", count: 4 }, get: { item: "gold_helmet", count: 1 } },
  { give: { item: "diamond", count: 2 },     get: { item: "diamond_sword", count: 1 } },
  { give: { item: "gold_ingot", count: 10 }, get: { item: "golden_apple", count: 2 } },
  { give: { item: "diamond", count: 3 },     get: { item: "heart_container", count: 1 } },
];

// A townsperson bound to a home base. Wanders nearby by day, heads home at night,
// and eats (refills food) while at home. Role changes look, stats, and behaviour.
export class Villager {
  constructor(home, seed = Math.random(), opts = {}) {
    const role = opts.role || "villager";
    const cfg = ROLES[role] || ROLES.villager;
    this.role = role;
    this.home = home;                 // {x,y} in tiles
    this.x = home.x * TILE;
    this.y = (home.y - 2) * TILE;
    this.vx = 0; this.vy = 0;
    this.w = cfg.w; this.h = cfg.h;
    this.onGround = false;
    this.facing = 1;
    this.name = opts.name || cfg.names[(seed * cfg.names.length) | 0];
    this.color = cfg.color || `hsl(${(seed * 360) | 0} 45% 55%)`;
    this.gang = opts.gang || null;    // gang key into GANGS, or null
    this.speed = cfg.speed;
    this.roam = cfg.roam;
    this.royal = !!cfg.royal;         // stays put near the throne
    this.patrol = !!cfg.patrol;       // marches back and forth on guard
    this.farmer = !!cfg.farmer;
    this.isChild = !!cfg.child;
    this.follow = null;               // a parent Villager this child trails (set by game)
    this.partner = null;              // spouse, for flavour
    // Trades: children don't trade; pick a role-appropriate set otherwise.
    if (this.isChild) this.trades = [];
    else if (this.royal) this.trades = pickFrom(ROYAL_TRADES, 3);
    else if (this.farmer) this.trades = pickFrom(FARMER_TRADES, 3);
    else this.trades = pickTrades(Math.random, 4);
    this.food = 0.6 + seed * 0.4;     // 0..1
    this.maxHp = cfg.hp;
    this.hp = cfg.hp;
    this.hurtFlash = 0;
    this.dead = false;
    this.state = "wander";
    this.target = this.x;
    this._think = 0;
    this._stuck = 0;
    this._lastX = this.x;
    this._patrolDir = seed > 0.5 ? 1 : -1;
    this.animTime = 0;

    // --- Combat / mental-manipulation state (driven by wizard spells) ---
    // Guards & royals brawl hardest; farmers & children barely scratch.
    this.atkPower = this.patrol ? 26 : this.royal ? 22 : this.farmer ? 12 : this.isChild ? 4 : 15;
    this.atkCd = 0;            // melee swing cooldown
    this.charmed = false;      // Mind Control: fights enemies at your side
    this.rage = 0;             // Incite Madness: timer; attacks fellow townsfolk
    this.combatTarget = null;  // entity (enemy or villager) the game tells it to attack
    this.charmGlow = 0;        // spell aura pulse for the renderer
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
    // Starving townsfolk slowly lose health; well-fed ones heal.
    if (this.food <= 0) this.hp -= dt * 3;
    else if (this.food > 0.5 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + dt * 2);
    if (this.hp <= 0) { this.dead = true; return; }

    const homePx = this.home.x * TILE;
    const atHome = Math.abs(this.cx - homePx) < TILE * 1.5;

    this._think -= dt;
    if (this.atkCd > 0) this.atkCd -= dt;
    if (this.rage > 0) this.rage -= dt;
    if (this.charmGlow > 0) this.charmGlow -= dt;

    // Under a charm or a maddening rage, abandon daily life and hunt the target
    // the game has assigned (an enemy when charmed, a fellow villager when mad).
    if ((this.charmed || this.rage > 0) && this.combatTarget && !this.combatTarget.dead) {
      this.state = "fight";
      this.target = this.combatTarget.cx + (this.combatTarget.cx > this.cx ? -6 : 6);
      this.charmGlow = 0.4;
      this._walkTo(world, dt);
      return;
    }

    if (this.isChild && this.follow && !this.follow.dead) {
      // Toddlers trail a parent, hanging just behind them.
      this.state = "follow";
      this.food = Math.min(1, this.food + dt * 0.04); // looked after, rarely starve
      this.target = this.follow.cx - this.follow.facing * TILE * 1.2;
    } else if (atHome && (isNight || this.food < 0.25)) {
      this.state = "eat";
      this.food = Math.min(1, this.food + dt * 0.25); // eating at home
      this.target = this.cx;                          // stand still
    } else if (this.royal) {
      // Royals pace their throne room and never wander off.
      if (this._think <= 0) {
        this.target = homePx + (Math.random() * 2 - 1) * TILE * this.roam;
        this._think = 2 + Math.random() * 3;
      }
      this.food = Math.min(1, this.food + dt * 0.05); // fed by servants
      this.state = "rule";
    } else if (this.patrol) {
      // Guards march along the battlements/gate, turning at the roam edge.
      if (this.cx > homePx + TILE * this.roam) this._patrolDir = -1;
      else if (this.cx < homePx - TILE * this.roam) this._patrolDir = 1;
      this.target = this.cx + this._patrolDir * TILE * 3;
      this.state = "patrol";
    } else if (isNight || this.food < 0.25) {
      this.state = "home";
      this.target = homePx;
    } else if (this._think <= 0) {
      this.state = "wander";
      this.target = homePx + (Math.random() * 2 - 1) * TILE * this.roam;
      this._think = 1.5 + Math.random() * 2.5;
    }

    this._walkTo(world, dt);
  }

  // Steer toward this.target, hopping small obstacles, then advance physics.
  _walkTo(world, dt) {
    const dx = this.target - this.cx;
    const dead = this.state === "eat" ? 4 : 6;
    // Maddened/charmed fighters close right up to their target; sprint a touch.
    const fighting = this.state === "fight";
    const spd = fighting ? this.speed * 1.25 : this.speed;
    if (Math.abs(dx) > dead && this.state !== "eat") {
      const dir = Math.sign(dx);
      this.vx = dir * spd;
      this.facing = dir;
      if (this.onGround && Math.abs(this.x - this._lastX) < 0.3) {
        this._stuck += dt;
        if (this._stuck > 0.2) { this.vy = -300; this._stuck = 0; }
      } else this._stuck = 0;
    } else {
      this.vx *= 0.5;
      if (fighting && this.combatTarget) this.facing = Math.sign(this.combatTarget.cx - this.cx) || this.facing;
    }
    this._lastX = this.x;

    if (this.onGround && Math.abs(this.vx) > 5) this.animTime += dt * 9;
    stepBody(this, world, dt);
  }
}

function pickFrom(pool, n) {
  const p = pool.slice(), out = [];
  while (out.length < n && p.length) out.push(p.splice((Math.random() * p.length) | 0, 1)[0]);
  return out;
}
