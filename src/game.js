import {
  TILE, REACH, SAFE_FALL_TILES, FALL_DMG_PER_TILE, LAVA_DPS, SLIME_TOUCH_DMG,
} from "./config.js";
import { World } from "./world.js";
import { generate } from "./worldgen.js";
import { Player } from "./player.js";
import { Inventory } from "./inventory.js";
import { Input } from "./input.js";
import { Renderer } from "./renderer.js";
import { Slime } from "./enemy.js";
import { Villager } from "./npc.js";
import { DroppedItem } from "./drop.js";
import { Particles } from "./particles.js";
import { Sound } from "./sound.js";
import { saveGame, loadGame, hasSave } from "./save.js";
import { tileDef, ITEMS, TILE_IDS, TILE_DROPS } from "./tiles.js";
import { RECIPES, craft } from "./crafting.js";
import { doTrade } from "./trade.js";

class Game {
  constructor() {
    this.canvas = document.getElementById("game");
    this.input = new Input(this.canvas);
    this.renderer = new Renderer(this.canvas);

    this.world = new World();
    this.time = 0.25;
    this.dayLength = 180;
    this.showDebug = false;
    this.enemies = [];
    this.villagers = [];
    this.drops = [];
    this.particles = new Particles();
    this.toastMsg = null;
    this.toastUntil = 0;

    this.ui = "play";          // "play" | "inv" | "trade"
    this.tradeVillager = null;
    this.craftScroll = 0;

    this.spawn = { x: 0, y: 0 };
    this.attackCd = 0;
    this.nightSpawnCd = 6;
    this._pickHintCd = 0;

    this._frames = 0; this._fpsTime = 0; this._fps = 0;
    this.mining = { tile: null, progress: 0 };
    this.tNow = 0;

    this.newOrLoad();
    this.bindKeys();

    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  newOrLoad() {
    if (hasSave()) {
      const data = loadGame();
      if (data && this.applySave(data)) { this.flash("Loaded saved world"); return; }
    }
    this.newWorld();
  }

  newWorld() {
    this.world = new World();
    const info = generate(this.world);
    this.spawn = { x: info.spawnX, y: info.surfaceY - 3 };
    this.player = new Player(this.spawn.x, this.spawn.y);
    this.inventory = new Inventory(30, 5); // start with nothing
    this.drops = [];
    this.spawnEnemies();
    this.villagers = info.villages.map((b, i) => new Villager(b, (i + 1) / (info.villages.length + 1)));
    this.time = 0.25;
  }

  applySave(data) {
    if (!data || !data.tiles) return false;
    this.world = new World(data.w, data.h);
    this.world.tiles.set(data.tiles);
    this.world.recomputeSkyTop();
    this.player = new Player(0, 0);
    Object.assign(this.player, data.player);
    if (this.player.hp == null) this.player.hp = this.player.maxHp;
    this.player._peakY = this.player.y;
    const sx = Math.floor(this.player.x / TILE);
    this.spawn = { x: sx, y: this.findSurface(sx) - 3 };
    this.inventory = Inventory.fromJSON(data.inventory, 30, 5);
    this.time = data.time ?? 0.25;
    this.drops = [];
    this.spawnEnemies();
    this.villagers = (data.npcs || []).map((n) => {
      const v = new Villager({ x: n.hx, y: n.hy });
      Object.assign(v, { x: n.x, y: n.y, food: n.food, name: n.name, color: n.color });
      if (n.trades) v.trades = n.trades;
      return v;
    });
    return true;
  }

  spawnEnemies() {
    this.enemies = [];
    for (let i = 0; i < 3; i++) {
      const tx = Math.floor((this.player ? this.player.x / TILE : this.world.w / 2)) + (i - 1) * 6;
      this.enemies.push(new Slime(tx, this.findSurface(tx) - 1));
    }
  }

  findSurface(tx) {
    for (let ty = 0; ty < this.world.h; ty++) if (this.world.isSolidAt(tx, ty)) return ty;
    return Math.floor(this.world.h / 2);
  }

  bindKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.code === "F3") { this.showDebug = !this.showDebug; e.preventDefault(); }
      if (e.code === "F5") { this.doSave(); e.preventDefault(); }
      if (e.code === "F9") { this.doLoad(); e.preventDefault(); }
      if (e.code === "KeyM") { Sound.enabled = !Sound.enabled; this.flash(Sound.enabled ? "Sound on" : "Sound muted"); }
    });
  }

  doSave() {
    const npcs = this.villagers.map((v) => ({
      hx: v.home.x, hy: v.home.y, x: v.x, y: v.y, food: v.food, name: v.name, color: v.color, trades: v.trades,
    }));
    saveGame({ world: this.world, player: this.player, inventory: this.inventory, time: this.time, npcs });
    this.flash("World saved (F5)");
  }
  doLoad() {
    const data = loadGame();
    if (data && this.applySave(data)) { this.ui = "play"; this.flash("World loaded (F9)"); }
    else this.flash("No save found");
  }
  flash(msg) { this.toastMsg = msg; this.toastUntil = performance.now() + 1600; }

  loop(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    this.tNow = now / 1000;
    if (dt > 0.05) dt = 0.05;
    this.update(dt);
    this.render(dt);
    this.input.endFrame();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ----- menus -----
  toggleInventory() {
    if (this.ui === "inv") this.closeMenus();
    else { this.tradeVillager = null; this.ui = "inv"; this.mining.tile = null; this.mining.progress = 0; Sound.play("open"); }
  }
  openTrade(v) {
    this.ui = "trade"; this.tradeVillager = v;
    this.mining.tile = null; this.mining.progress = 0;
    Sound.play("open");
  }
  closeMenus() {
    // Return any held stack to the inventory (or drop it if full).
    if (this.inventory.held) {
      const left = this.inventory.add(this.inventory.held.item, this.inventory.held.count);
      if (left > 0) this.spawnDrop(this.player.cx, this.player.cy, this.inventory.held.item, left);
      this.inventory.held = null;
    }
    this.ui = "play"; this.tradeVillager = null;
  }

  update(dt) {
    const input = this.input;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this._pickHintCd = Math.max(0, this._pickHintCd - dt);

    if (input.pressed("KeyE") || input.pressed("KeyC")) this.toggleInventory();
    if (input.pressed("Escape")) this.closeMenus();

    // Hotbar selection is always available.
    for (let i = 0; i < this.inventory.hotbarSize; i++)
      if (input.pressed("Digit" + (i + 1))) this.inventory.select(i);
    const wheel = input.consumeWheel();
    if (wheel) {
      if (this.ui === "inv") {
        const maxScroll = Math.max(0, RECIPES.length - 9);
        this.craftScroll = Math.max(0, Math.min(maxScroll, this.craftScroll + wheel));
      } else this.inventory.scroll(wheel);
    }

    const liquid = this.liquidAtBody(this.player);
    const intent = {
      left: input.down("KeyA") || input.down("ArrowLeft"),
      right: input.down("KeyD") || input.down("ArrowRight"),
      jumpPressed: input.pressed("Space") || input.pressed("KeyW") || input.pressed("ArrowUp"),
      jumpHeld: input.down("Space") || input.down("KeyW") || input.down("ArrowUp"),
      inWater: liquid === "water", inLava: liquid === "lava",
    };
    this.player.update(this.world, dt, intent);
    this.player.defense = this.inventory.totalDefense();
    if (this.player.justJumped) Sound.play("jump");
    this.onPlayerLanded();

    if (this.ui === "play") this.handleInteraction(dt);
    else this.handleMenuMouse();

    this.applyEnvironmentDamage(dt, liquid);
    this.updateEnemies(dt);
    this.updateVillagers(dt);
    this.updateDrops(dt);
    this.ambientFx(dt);
    this.particles.update(dt);
    if (this.player.dead) this.respawn();

    this.time = (this.time + dt / this.dayLength) % 1;
    this.renderer.centerOn(this.player.cx, this.player.cy, this.world, dt, this.player.vx);
  }

  // Dust + screen shake when the player lands from a fall.
  onPlayerLanded() {
    const p = this.player;
    if (!p.justLanded || p.landFall < 1.2) return;
    const n = Math.min(14, 3 + (p.landFall | 0));
    this.particles.burst(p.cx, p.y + p.h, "#caa978", n, { speed: 70, up: 30, life: 0.45, gravity: 500 });
    Sound.play("land");
    if (p.landFall > 4) this.renderer.addShake(Math.min(10, p.landFall * 0.8));
  }

  // Rising embers from lava in view, occasional cosmetic sparkle.
  ambientFx(dt) {
    const sources = this.renderer.lightMap.sources || [];
    for (const s of sources) {
      if (s.id !== TILE_IDS.LAVA) continue;
      if (Math.random() < dt * 1.2) {
        this.particles.spawn({
          x: s.tx * TILE + Math.random() * TILE, y: s.ty * TILE + 4,
          vx: (Math.random() * 2 - 1) * 10, vy: -30 - Math.random() * 30,
          life: 0.8, size: 2, color: "#ffb24d", gravity: -20, drag: 0.99, glow: true,
        });
      }
    }
  }

  handleMenuMouse() {
    const m = this.input.mouse;
    if (this.ui === "inv") {
      if (this.input.leftClicked()) {
        const recipe = this.renderer.recipeHitTest(RECIPES, m.x, m.y, this.craftScroll);
        if (recipe >= 0) { this.tryCraft(RECIPES[recipe]); return; }
        const hit = this.renderer.invHitTest(this.inventory, m.x, m.y);
        if (hit && hit.type === "slot") this.inventory.clickSlot(hit.index);
        else if (hit && hit.type === "armor") this.inventory.clickArmor(hit.slot);
      }
    } else if (this.ui === "trade" && this.tradeVillager) {
      if (this.input.leftClicked()) {
        const i = this.renderer.tradeHitTest(this.tradeVillager, m.x, m.y);
        if (i >= 0) {
          const t = this.tradeVillager.trades[i];
          if (doTrade(this.inventory, t)) { Sound.play("trade"); this.flash(`Traded for ${t.get.count} ${ITEMS[t.get.item].name}`); }
          else this.flash(`Need ${t.give.count} ${ITEMS[t.give.item].name}`);
        }
      }
    }
  }

  tryCraft(recipe) {
    if (craft(this.inventory, recipe, (st) => this.stationNear(st))) {
      Sound.play("craft");
      this.flash(`Crafted ${ITEMS[recipe.out.item].name} x${recipe.out.count}`);
    }
    else this.flash(recipe.station && !this.stationNear(recipe.station)
      ? `Need a ${recipe.station} nearby` : "Missing materials");
  }

  liquidAtBody(b) {
    const id = this.world.get(Math.floor(b.cx / TILE), Math.floor(b.cy / TILE));
    if (id === TILE_IDS.LAVA) return "lava";
    if (id === TILE_IDS.WATER) return "water";
    return null;
  }

  applyEnvironmentDamage(dt, liquid) {
    if (this.player.fallTiles > SAFE_FALL_TILES) {
      const dmg = Math.round((this.player.fallTiles - SAFE_FALL_TILES) * FALL_DMG_PER_TILE);
      this.player.hurt(dmg, 0, 0, { bypassIframes: true });
      this.particles.float(this.player.cx, this.player.y - 4, `-${dmg}`, "#ff7a7a");
      this.renderer.addShake(Math.min(10, dmg * 0.2));
      Sound.play("hurt");
    }
    if (liquid === "lava")
      this.player.hurt(LAVA_DPS * dt, 0, -40, { bypassIframes: true, useArmor: false, clampMin: false });
  }

  updateEnemies(dt) {
    const isNight = this.time < 0.24 || this.time > 0.78;
    this.nightSpawnCd -= dt;
    if (isNight && this.enemies.length < 8 && this.nightSpawnCd <= 0) {
      this.nightSpawnCd = 5 + Math.random() * 4;
      const tx = Math.floor(this.player.x / TILE) + (Math.random() < 0.5 ? -1 : 1) * (14 + (Math.random() * 6 | 0));
      this.enemies.push(new Slime(tx, this.findSurface(tx) - 1));
    }
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.update(this.world, dt, this.player);
      if (this.liquidAtBody(e) === "lava") e.hurt(40);
      if (this.aabbOverlap(e, this.player)) {
        const dir = Math.sign(this.player.cx - e.cx) || 1;
        if (this.player.hurt(SLIME_TOUCH_DMG, dir * 160, -160)) {
          const taken = Math.max(1, SLIME_TOUCH_DMG - this.player.defense);
          this.particles.float(this.player.cx, this.player.y - 4, `-${taken}`, "#ff7a7a");
          this.particles.burst(this.player.cx, this.player.cy, "#c0392b", 8, { speed: 110, life: 0.45 });
          this.renderer.addShake(4);
          Sound.play("hurt");
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  updateVillagers(dt) {
    for (const v of this.villagers) {
      v.update(this.world, dt, this.time);
      if (this.liquidAtBody(v) === "lava") v.hurt(50);
      if (v.dead) {
        this.flash(`${v.name} has died`);
        if (this.tradeVillager === v) this.closeMenus();
      }
    }
    this.villagers = this.villagers.filter((v) => !v.dead);
  }

  updateDrops(dt) {
    for (const d of this.drops) {
      d.update(this.world, dt, this.player);
      if (d.canPickup(this.player)) {
        const before = d.count;
        const left = this.inventory.add(d.item, d.count);
        if (left < before) {
          this.particles.float(this.player.cx, this.player.y - 6, `+${before - left} ${ITEMS[d.item].name}`, "#bfe6a0");
          Sound.play("pickup");
        }
        d.count = left;
        if (left <= 0) d.picked = true;
      }
    }
    this.drops = this.drops.filter((d) => !d.picked);
    if (this.drops.length > 300) this.drops.splice(0, this.drops.length - 300);
  }

  aabbOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  respawn() {
    this.flash("You died — respawning");
    this.particles.burst(this.player.cx, this.player.cy, "#c75b3a", 22, { speed: 170, life: 0.8 });
    this.renderer.addShake(10);
    Sound.play("death");
    this.player.x = this.spawn.x * TILE;
    this.player.y = this.spawn.y * TILE;
    this.player.vx = 0; this.player.vy = 0;
    this.player.hp = this.player.maxHp;
    this.player.invuln = 2;
    this.player._peakY = this.player.y;
  }

  cursorTile() {
    const w = this.renderer.screenToWorld(this.input.mouse.x, this.input.mouse.y);
    const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
    const dx = (tx + 0.5) - this.player.cx / TILE;
    const dy = (ty + 0.5) - this.player.cy / TILE;
    return { tx, ty, inReach: Math.hypot(dx, dy) <= REACH, wx: w.x, wy: w.y };
  }

  villagerUnderCursor(wx, wy) {
    return this.villagers.find((v) => wx >= v.x - 2 && wx <= v.x + v.w + 2 && wy >= v.y - 2 && wy <= v.y + v.h + 2);
  }

  handleInteraction(dt) {
    const cur = this.cursorTile();
    this.hoverTile = cur;

    // Right-click: trade with a villager, else eat selected food, else place.
    if (this.input.rightClicked()) {
      const v = this.villagerUnderCursor(cur.wx, cur.wy);
      if (v && cur.inReach) { this.openTrade(v); return; }
      const s = this.inventory.selectedSlot();
      if (s && ITEMS[s.item] && ITEMS[s.item].kind === "food") { this.eatSelected(); return; }
    }
    if (this.input.mouse.right && cur.inReach && !this.villagerUnderCursor(cur.wx, cur.wy))
      this.placeBlock(cur.tx, cur.ty);

    // Left-click: attack a slime under the cursor, else mine.
    if (this.input.mouse.left && cur.inReach && this.attackCd <= 0) {
      const target = this.enemies.find((e) =>
        cur.wx >= e.x - 4 && cur.wx <= e.x + e.w + 4 && cur.wy >= e.y - 4 && cur.wy <= e.y + e.h + 4);
      if (target) {
        const dir = Math.sign(target.cx - this.player.cx) || this.player.facing;
        const dmg = Math.round(this.weaponDamage());
        target.hurt(dmg, dir * 180);
        this.particles.float(target.cx, target.y - 4, `${dmg}`, "#ffe08a");
        this.particles.burst(target.cx, target.cy, "#4fb36b", 6, { speed: 90, life: 0.4 });
        this.renderer.addShake(2);
        Sound.play("hit");
        if (target.dead) {
          this.particles.burst(target.cx, target.cy, "#4fb36b", 18, { speed: 150, life: 0.7 });
          Sound.play("slay");
        }
        this.player.swing = 1; this.player.facing = dir;
        this.attackCd = 0.35; this.mining.tile = null; this.mining.progress = 0;
        return;
      }
    }

    if (this.input.mouse.left && cur.inReach) {
      const id = this.world.get(cur.tx, cur.ty);
      const def = tileDef(id);
      const canMine = def.mineable && id !== TILE_IDS.AIR && (!def.needsPick || this.holdingPickaxe());
      if (canMine) {
        if (!this.mining.tile || this.mining.tile.tx !== cur.tx || this.mining.tile.ty !== cur.ty) {
          this.mining.tile = { tx: cur.tx, ty: cur.ty };
          this.mining.progress = 0;
        }
        this.player.swing = 1;
        if (Math.random() < dt * 18) { // chip debris + dig tick while mining
          this.particles.burst(cur.tx * TILE + TILE / 2, cur.ty * TILE + TILE / 2, def.color || "#999", 2, { speed: 60, life: 0.3 });
          Sound.play("mine");
        }
        this.mining.progress += (dt * this.toolPower()) / def.hardness;
        if (this.mining.progress >= 1) {
          this.breakTile(cur.tx, cur.ty, id);
          this.mining.tile = null; this.mining.progress = 0;
        }
      } else {
        if (def.needsPick && !this.holdingPickaxe() && this._pickHintCd <= 0) {
          this.flash(`Need a pickaxe to mine ${def.name}`); this._pickHintCd = 1.5;
        }
        this.mining.tile = null; this.mining.progress = 0;
      }
    } else { this.mining.tile = null; this.mining.progress = 0; }
  }

  holdingPickaxe() {
    const s = this.inventory.selectedSlot();
    return !!(s && ITEMS[s.item] && ITEMS[s.item].kind === "tool");
  }
  toolPower() {
    const s = this.inventory.selectedSlot();
    if (s && ITEMS[s.item] && ITEMS[s.item].kind === "tool") return ITEMS[s.item].power;
    return 1.0;
  }
  weaponDamage() {
    const s = this.inventory.selectedSlot();
    if (s && ITEMS[s.item]) {
      if (ITEMS[s.item].kind === "weapon") return ITEMS[s.item].damage;
      if (ITEMS[s.item].kind === "tool") return ITEMS[s.item].power * 1.2;
    }
    return 3; // bare fists
  }

  eatSelected() {
    const s = this.inventory.selectedSlot();
    const def = ITEMS[s.item];
    if (this.player.hp >= this.player.maxHp) { this.flash("Already at full health"); return; }
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + def.heal);
    this.inventory.decrementSelected();
    Sound.play("eat");
    this.flash(`Ate ${def.name} (+${def.heal})`);
  }

  spawnDrop(px, py, item, count) {
    this.drops.push(new DroppedItem(px - 4, py - 4, item, count));
  }

  breakTile(tx, ty, id) {
    this.world.set(tx, ty, TILE_IDS.AIR);
    const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
    const col = tileDef(id).color || "#999";
    this.particles.burst(cx, cy, col, 12, { speed: 110, life: 0.5, gravity: 700 });
    this.renderer.addShake(1.5);
    Sound.play("break");
    const drop = TILE_DROPS[id];
    if (drop) this.spawnDrop(cx, cy, drop, 1);
    if (id === TILE_IDS.LEAVES && Math.random() < 0.12) this.spawnDrop(cx, cy, "apple", 1);
  }

  placeBlock(tx, ty) {
    const s = this.inventory.selectedSlot();
    if (!s) return;
    const def = ITEMS[s.item];
    if (!def || def.kind !== "block") return;
    if (this.world.get(tx, ty) !== TILE_IDS.AIR) return;
    if (tileDef(def.tile).solid && this.overlapsPlayer(tx, ty)) return;
    if (this.inventory.consumeSelected()) {
      this.world.set(tx, ty, def.tile);
      this.particles.burst(tx * TILE + TILE / 2, ty * TILE + TILE / 2, def.color || "#fff", 6, { speed: 50, life: 0.3 });
      Sound.play("place");
    }
  }

  overlapsPlayer(tx, ty) {
    const p = this.player, bx = tx * TILE, by = ty * TILE;
    return bx < p.x + p.w && bx + TILE > p.x && by < p.y + p.h && by + TILE > p.y;
  }

  render(dt) {
    const r = this.renderer, t = this.tNow;
    r.drawSky(this.time);
    r.drawBackground(this.time, t);
    r.computeLight(this.world, this.time);

    // World, entities, particles — all inside the screen-shake transform.
    r.beginShake();
    r.drawWorld(this.world, t);
    r.drawDrops(this.drops);
    for (const e of this.enemies) r.drawSlime(e);
    for (const v of this.villagers) r.drawVillager(v);
    r.drawPlayer(this.player, this.inventory.selectedSlot());
    r.drawParticles(this.particles);
    r.drawLightOverlay(this.world); // smooth dark veil
    r.drawGlow(t);                  // warm glow over the veil
    if (this.ui === "play") {
      if (this.mining.tile) r.drawMiningOverlay(this.mining.tile, this.mining.progress);
      if (this.hoverTile) r.drawCursor(this.hoverTile, this.hoverTile.inReach);
    }
    r.drawFloatingTexts(this.particles); // damage/pickup numbers, readable over the veil
    r.endShake();

    r.drawNightVignette(this.time);
    r.drawLowHealth(this.player);
    r.drawHotbar(this.inventory);
    r.drawHealth(this.player);

    if (this.ui === "inv") r.drawInventory(this.inventory, RECIPES, (st) => this.stationNear(st), this.input.mouse, this.craftScroll);
    else if (this.ui === "trade" && this.tradeVillager) r.drawTrade(this.tradeVillager, this.inventory, this.input.mouse);

    if (this.toastMsg && performance.now() < this.toastUntil) r.toast(this.toastMsg);

    this._frames++; this._fpsTime += dt;
    if (this._fpsTime >= 0.5) { this._fps = Math.round(this._frames / this._fpsTime); this._frames = 0; this._fpsTime = 0; }
    if (this.showDebug) {
      const p = this.player, hour = Math.floor(this.time * 24);
      r.drawDebug([
        `FPS: ${this._fps}`,
        `pos: ${(p.x / TILE).toFixed(1)}, ${(p.y / TILE).toFixed(1)}  hp: ${p.hp.toFixed(0)}/${p.maxHp}  def: ${p.defense || 0}`,
        `onGround: ${p.onGround}  drops: ${this.drops.length}`,
        `time: ${String(hour).padStart(2, "0")}:00  slimes: ${this.enemies.length}  villagers: ${this.villagers.length}`,
        `workbench: ${this.stationNear("workbench")}  furnace: ${this.stationNear("furnace")}`,
      ]);
    }
  }

  stationNear(name) {
    const id = name === "workbench" ? TILE_IDS.WORKBENCH : TILE_IDS.FURNACE;
    const ptx = Math.floor(this.player.cx / TILE), pty = Math.floor(this.player.cy / TILE);
    const R = 4;
    for (let y = pty - R; y <= pty + R; y++)
      for (let x = ptx - R; x <= ptx + R; x++)
        if (this.world.get(x, y) === id) return true;
    return false;
  }
}

window.addEventListener("DOMContentLoaded", () => new Game());
