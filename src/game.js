import {
  TILE, REACH, SAFE_FALL_TILES, FALL_DMG_PER_TILE, LAVA_DPS, SLIME_TOUCH_DMG,
  STRENGTH_BUFF_MULT, HASTE_BUFF_MULT, DRUNK_DAMAGE_MULT,
  COKE_DAMAGE_MULT, COKE_ATTACK_SCALE, CRACK_DAMAGE_MULT, CRACK_ATTACK_SCALE,
  MAX_FOOD,
} from "./config.js";
import { World } from "./world.js";
import { stepLiquids } from "./liquid.js";
import { generate } from "./worldgen.js";
import { Player } from "./player.js";
import { Inventory } from "./inventory.js";
import { Input } from "./input.js";
import { Renderer } from "./renderer.js";
import { Slime, Zombie, SkeletonArcher, CaveBoss, Dragon } from "./enemy.js";
import { Villager } from "./npc.js";
import { Animal, ANIMAL_KINDS } from "./animal.js";
import { Fish } from "./fish.js";
import { DroppedItem } from "./drop.js";
import { Projectile } from "./projectile.js";
import { Particles } from "./particles.js";
import { Critters } from "./critter.js";
import { Weather } from "./weather.js";
import { Sound } from "./sound.js";
import { saveWorld, loadWorld } from "./save.js";
import { tileDef, wallDef, ITEMS, TILE_IDS, TILE_DROPS, WALL_DROPS, isClimbable, maxStack } from "./tiles.js";
import { RECIPES, craft } from "./crafting.js";
import { doTrade } from "./trade.js";
import { TV } from "./tv.js";

const CHEST_SIZE = 20; // storage slots per chest (5×4 grid)

export class Game {
  // opts: { worldName, mode: "survival"|"creative", loadData? }
  constructor(opts = {}) {
    this.canvas = document.getElementById("game");
    this.input = new Input(this.canvas);
    this.renderer = new Renderer(this.canvas);

    // Native search field for touch devices (see updateSearchBox).
    this.searchBox = document.getElementById("searchBox");
    if (this.searchBox) this.searchBox.addEventListener("input", () => {
      this.craftSearch = this.searchBox.value;
      this.craftScroll = 0;
    });

    this.worldName = opts.worldName || "World";
    this.mode = opts.mode || "survival";
    this.creative = this.mode === "creative";
    this.dragonEnabled = opts.dragon !== false; // resident dragon boss (off = calm skies)

    this.world = new World();
    this.time = 0.25;
    this.dayLength = 180;
    this.showDebug = false;
    this.enemies = [];
    this.villagers = [];
    this.animals = [];
    this.fish = [];
    this.fishing = null;       // active cast: { tx, ty, bx, by, biteAt, hooked, hookedAt, dip }
    this.drops = [];
    this.projectiles = [];     // bullets/rockets in flight
    this.enemyShots = [];      // arrows fired by skeleton archers
    this.bossLair = null;      // { x, y } of the deep boss arena
    this.boss = null;          // active boss entity, if any
    this.bossDefeated = false; // once slain, don't respawn it
    this.tnts = [];            // primed TNT: { tx, ty, fuse }
    this.fires = [];           // burning tiles set alight by dragon-fire: { tx, ty, life, max }
    this.dragonSpawnCd = 30 + Math.random() * 40; // seconds until the next dragon may appear
    this.shootCd = 0;          // gun fire cooldown
    this.bolts = [];           // active lightning-bolt visuals {x, top, y, life}
    this.particles = new Particles();
    this.critters = new Critters(); // ambient birds/butterflies/fireflies
    this.weather = new Weather();   // drifting rain / storm / fog over the day clock
    this.toastMsg = null;
    this.toastUntil = 0;

    this.ui = "play";          // "play" | "inv" | "trade" | "pause"
    this.tradeVillager = null;
    this.craftScroll = 0;
    this.craftTab = "all";     // active crafting/creative category tab
    this.craftSearch = "";     // search box text
    this.searchFocused = false;
    this.itemPopup = null;     // { text, until } name pill shown over the hotbar on switch
    this._lastSel = 0;         // last hotbar index, to detect a switch
    this.tvUrls = {};          // "tx,ty" -> tuned YouTube URL, so each TV keeps its channel
    this.chests = {};          // "tx,ty" -> { slots: [...] } storage contents
    this.openChest = null;     // the chest currently being viewed (in "chest" UI)

    this.spawn = { x: 0, y: 0 };
    this.attackCd = 0;
    this.nightSpawnCd = 6;
    this._pickHintCd = 0;

    this._frames = 0; this._fpsTime = 0; this._fps = 0;
    this.mining = { tile: null, progress: 0 };
    this.tNow = 0;

    if (opts.loadData) {
      if (!this.applySave(opts.loadData)) this.newWorld();
      else this.flash(`Loaded "${this.worldName}"`);
    } else {
      this.newWorld();
    }
    this.bindKeys();

    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  newWorld() {
    this.world = new World();
    const info = generate(this.world);
    this.world.seedLiquid(); // settle worldgen pools to their level
    this.spawn = { x: info.spawnX, y: info.surfaceY - 3 };
    this.bossLair = info.bossLair || null;
    // Loot chests placed by worldgen (cabins, pyramids, sky islands, crypts).
    this.chests = {};
    this.openChest = null;
    for (const c of (info.chests || []))
      this.chests[c.tx + "," + c.ty] = { slots: this.lootToSlots(c.loot) };
    this.boss = null; this.bossDefeated = false; this.enemyShots = [];
    this.player = new Player(this.spawn.x, this.spawn.y);
    this.player.creative = this.creative;
    this.inventory = new Inventory(30, 5); // creative starts empty too — add items via the palette
    this.drops = [];
    this.fires = [];
    this.spawnEnemies();
    this.spawnBossInLair(); // Warden is loaded in his lair from the start
    this.spawnDragon();     // the resident dragon is always aloft
    this.spawnAnimals();
    this.spawnFish();
    this.fishing = null;
    this.villagers = this.buildNpcs(info.npcs);
    this.time = 0.25;
  }

  // All item keys, shown in the Creative inventory palette (click to grab any).
  get creativeItems() {
    return (this._creativeItems ||= Object.keys(ITEMS));
  }

  // Map an item's `kind` to one of the inventory category tabs.
  categoryOf(key) {
    switch (ITEMS[key] && ITEMS[key].kind) {
      case "tool": case "fishing": return "tools";
      case "weapon": case "gun": return "weapons";
      case "armor": return "armor";
      case "block": case "wall": return "blocks";
      case "food": return "food";
      case "spell": case "power": return "magic";
      case "material": return "material";
      default: return "material";
    }
  }

  // Whether an item key passes the active tab + search-box filter.
  _matchesFilter(key) {
    if (this.craftTab !== "all" && this.categoryOf(key) !== this.craftTab) return false;
    if (this.craftSearch) {
      const def = ITEMS[key];
      const name = (def ? def.name : key).toLowerCase();
      if (!name.includes(this.craftSearch.toLowerCase())) return false;
    }
    return true;
  }

  // The recipe list filtered by the current tab + search.
  filteredRecipes() { return RECIPES.filter((r) => this._matchesFilter(r.out.item)); }
  // The creative palette keys filtered by the current tab + search.
  filteredCreative() { return this.creativeItems.filter((k) => this._matchesFilter(k)); }
  // Whatever list the inventory panel is currently showing (for scroll bounds).
  currentCraftList() { return this.creative ? this.filteredCreative() : this.filteredRecipes(); }

  // Creative: drop a full stack of the chosen item straight into the backpack.
  giveCreativeItem(key) {
    if (!ITEMS[key]) return;
    const n = maxStack(key);
    const left = this.inventory.add(key, n);
    if (left < n) { Sound.play("pickup"); this.flash(`+${ITEMS[key].name}`); }
    else this.flash("Inventory full");
  }

  applySave(data) {
    if (!data || !data.tiles) return false;
    if (data.mode) { this.mode = data.mode; this.creative = data.mode === "creative"; }
    this.world = new World(data.w, data.h);
    this.world.tiles.set(data.tiles);
    if (data.walls && data.walls.length === this.world.walls.length) this.world.walls.set(data.walls);
    this.world.recomputeSkyTop();
    this.world.seedLiquid(); // rebuild liquid mass from the loaded tile grid
    this.player = new Player(0, 0);
    Object.assign(this.player, data.player);
    this.player.creative = this.creative;
    if (this.player.hp == null) this.player.hp = this.player.maxHp;
    if (this.player.maxFood == null) this.player.maxFood = MAX_FOOD;
    if (this.player.food == null) this.player.food = this.player.maxFood;
    this.player._peakY = this.player.y;
    const sx = Math.floor(this.player.x / TILE);
    this.spawn = { x: sx, y: this.findSurface(sx) - 3 };
    this.inventory = Inventory.fromJSON(data.inventory, 30, 5);
    this.time = data.time ?? 0.25;
    this.bossLair = data.bossLair || null;
    this.bossDefeated = !!data.bossDefeated;
    this.tvUrls = data.tvUrls || {};
    this.chests = data.chests || {};
    this.openChest = null;
    this.dragonEnabled = data.dragonEnabled !== false; // default on for older saves
    this.boss = null; this.enemyShots = [];
    this.drops = [];
    this.fires = [];
    this.spawnEnemies();
    this.spawnBossInLair(); // restore the Warden into his lair on load
    this.spawnDragon();     // the resident dragon is always aloft
    this.spawnAnimals();
    this.spawnFish();
    this.fishing = null;
    const saved = data.npcs || [];
    this.villagers = saved.map((n) => {
      const v = new Villager({ x: n.hx, y: n.hy }, Math.random(), { role: n.role, gang: n.gang });
      Object.assign(v, { x: n.x, y: n.y, food: n.food, name: n.name, color: n.color });
      if (n.trades) v.trades = n.trades;
      return v;
    });
    // Re-link trailing children to their parents by saved index.
    saved.forEach((n, i) => { if (n.childOf != null && this.villagers[n.childOf]) this.villagers[i].follow = this.villagers[n.childOf]; });
    return true;
  }

  spawnEnemies() {
    this.enemies = [];
    if (this.creative) return; // peaceful: no hostiles in Creative
    for (let i = 0; i < 3; i++) {
      const tx = Math.floor((this.player ? this.player.x / TILE : this.world.w / 2)) + (i - 1) * 6;
      this.enemies.push(new Slime(tx, this.findSurface(tx) - 1));
    }
  }

  // Which biome a surface column belongs to, read from its top tile.
  biomeAtX(tx) {
    const id = this.world.get(tx, this.findSurface(tx));
    if (id === TILE_IDS.SAND) return "desert";
    if (id === TILE_IDS.SNOW || id === TILE_IDS.ICE) return "tundra";
    return "forest";
  }

  // Build a surface hostile, with a biome-flavored roster: tundra fields frost
  // slimes, deserts lean on skeletons & sprinters, forests keep the classic mix.
  makeNightMob(tx) {
    const ty = this.findSurface(tx) - 1;
    const biome = this.biomeAtX(tx);
    const r = Math.random();
    if (biome === "tundra") {
      if (r < 0.55) return new Slime(tx, ty, "frost");
      if (r < 0.8) return new Zombie(tx, ty, "normal");
      return new SkeletonArcher(tx, ty);
    }
    if (biome === "desert") {
      if (r < 0.3) return new Slime(tx, ty, "sand");
      if (r < 0.58) return new SkeletonArcher(tx, ty);
      if (r < 0.82) return new Zombie(tx, ty, "fast");
      return new Zombie(tx, ty, "normal");
    }
    if (r < 0.45) return new Slime(tx, ty);
    if (r < 0.7) return new Zombie(tx, ty, "normal");
    if (r < 0.82) return new Zombie(tx, ty, "fast");
    return new SkeletonArcher(tx, ty);
  }

  // Find an open underground tile near (tx) to drop a cave mob onto.
  caveSpawnY(tx) {
    const surf = this.findSurface(tx);
    for (let ty = surf + 8; ty < this.world.h - 2; ty++) {
      if (!this.world.isSolidAt(tx, ty) && !this.world.isSolidAt(tx, ty - 1) && this.world.isSolidAt(tx, ty + 1))
        return ty - 1;
    }
    return -1;
  }

  findSurface(tx) {
    for (let ty = 0; ty < this.world.h; ty++) if (this.world.isSolidAt(tx, ty)) return ty;
    return Math.floor(this.world.h / 2);
  }

  // Scatter passive animals across grassy surface tiles.
  spawnAnimals() {
    this.animals = [];
    const W = this.world.w;
    let count = 0, tries = 0;
    while (count < 12 && tries < 240) {
      tries++;
      const tx = 4 + (Math.random() * (W - 8) | 0);
      const gy = this.findSurface(tx);
      if (this.world.get(tx, gy) !== TILE_IDS.GRASS) continue; // grass only, not sand/water
      const type = ANIMAL_KINDS[Math.random() * ANIMAL_KINDS.length | 0];
      this.animals.push(new Animal(type, tx, gy - 3)); // drop in from just above the ground
      count++;
    }
  }

  // Populate water bodies with fish: pick interior water tiles (water above them).
  spawnFish() {
    this.fish = [];
    const W = this.world.w, H = this.world.h;
    const cells = [];
    for (let y = 1; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (this.world.get(x, y) === TILE_IDS.WATER && this.world.get(x, y - 1) === TILE_IDS.WATER)
          cells.push((y * W + x));
      }
    }
    const n = Math.min(16, Math.floor(cells.length / 12));
    for (let i = 0; i < n && cells.length; i++) {
      const k = Math.random() * cells.length | 0;
      const c = cells[k]; cells.splice(k, 1);
      this.fish.push(new Fish(c % W, (c / W) | 0));
    }
  }

  bindKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.code === "F3") { this.showDebug = !this.showDebug; e.preventDefault(); }
      if (e.code === "F5") { this.doSave(); e.preventDefault(); }
      if (e.code === "F9") { this.doLoad(); e.preventDefault(); }
      if (e.code === "F10") { this.quitToMenu(); e.preventDefault(); }
      if (e.code === "KeyM") { Sound.enabled = !Sound.enabled; this.flash(Sound.enabled ? "Sound on" : "Sound muted"); }
    });
  }

  doSave() {
    const npcs = this.villagers.map((v) => ({
      hx: v.home.x, hy: v.home.y, x: v.x, y: v.y, food: v.food, name: v.name, color: v.color, trades: v.trades,
      role: v.role, gang: v.gang, childOf: v.follow ? this.villagers.indexOf(v.follow) : null,
    }));
    saveWorld(this.worldName, this.mode, { world: this.world, player: this.player, inventory: this.inventory, time: this.time, npcs, bossLair: this.bossLair, bossDefeated: this.bossDefeated, tvUrls: this.tvUrls, chests: this.chests, dragonEnabled: this.dragonEnabled });
    this.flash(`Saved "${this.worldName}" (F5)`);
  }
  doLoad() {
    const data = loadWorld(this.worldName);
    if (data && this.applySave(data)) { this.ui = "play"; this.flash("World reloaded (F9)"); }
    else this.flash("No save found");
  }
  // Save the world, then reload the page back to the start menu.
  quitToMenu() {
    this.doSave();
    location.reload();
  }

  // Apply persisted menu settings to the live game.
  applySettings(s = {}) {
    if (s.sound !== undefined) Sound.enabled = s.sound;
    if (s.debug !== undefined) this.showDebug = s.debug;
    if (s.shake !== undefined) this.renderer.shakeEnabled = s.shake;
  }
  flash(msg) { this.toastMsg = msg; this.toastUntil = performance.now() + 1600; }

  // Append/erase characters in the crafting search box and reset its scroll.
  applySearchInput(typed) {
    if (!typed) return;
    let s = this.craftSearch;
    for (const ch of typed) {
      if (ch === "\b") s = s.slice(0, -1);
      else if (ch !== "\n" && ch !== "\r" && s.length < 24) s += ch;
    }
    if (s !== this.craftSearch) { this.craftSearch = s; this.craftScroll = 0; }
  }

  // On touch devices, overlay a real <input> on the canvas search box so the
  // phone keyboard works. It tracks the search box's on-screen position and
  // feeds craftSearch via its "input" listener (wired in the constructor).
  updateSearchBox() {
    const el = this.searchBox;
    if (!el) return;
    const touch = document.body.classList.contains("touch");
    if (touch && this.ui === "inv") {
      const L = this.renderer.invLayout();
      const r = this.renderer.searchRect(L);
      const c = this.canvas.getBoundingClientRect();
      const s = c.width / this.canvas.width; // CSS px per canvas px (usually 1)
      el.style.display = "block";
      el.style.left = `${c.left + r.x * s}px`;
      el.style.top = `${c.top + r.y * s}px`;
      el.style.width = `${r.w * s}px`;
      el.style.height = `${r.h * s}px`;
      if (el.value !== this.craftSearch) el.value = this.craftSearch;
    } else if (el.style.display !== "none") {
      el.style.display = "none";
      el.blur();
    }
  }

  // If the selected hotbar slot changed since last frame, pop the item's name
  // up just above the hotbar for ~2.2s so the player sees what they switched to.
  updateItemSwitch() {
    if (this.inventory.selected === this._lastSel) return;
    this._lastSel = this.inventory.selected;
    const s = this.inventory.selectedSlot();
    const text = s && ITEMS[s.item] ? ITEMS[s.item].name : "Empty";
    this.itemPopup = { text, until: performance.now() + 2200 };
  }

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
  // Open/close the pause menu. Only toggles between active play and pause.
  togglePause() {
    if (this.ui === "pause") { this.ui = "play"; return; }
    if (this.ui !== "play") return;
    this.ui = "pause";
    this.mining.tile = null; this.mining.progress = 0;
    Sound.play("open");
  }
  toggleInventory() {
    if (this.ui === "inv" || this.ui === "chest" || this.ui === "trade") this.closeMenus();
    else if (this.ui === "play") {
      this.tradeVillager = null; this.ui = "inv";
      this.mining.tile = null; this.mining.progress = 0;
      this.craftScroll = 0; this.searchFocused = false;
      Sound.play("open");
    }
  }
  openTrade(v) {
    this.ui = "trade"; this.tradeVillager = v;
    this.mining.tile = null; this.mining.progress = 0;
    Sound.play("open");
  }
  // Pop up the TV "set" overlay for the block at (tx,ty); it remembers its channel.
  openTv(tx, ty) {
    const key = tx + "," + ty;
    this.mining.tile = null; this.mining.progress = 0;
    Sound.play("open");
    TV.open({
      url: this.tvUrls[key] || "",
      onSetUrl: (url) => { this.tvUrls[key] = url; },
    });
  }
  // Right-click a bed: make it your respawn point, take a restful top-up of
  // health & a full belly, then save the world (so the new spawn persists).
  sleepInBed(tx, ty) {
    this.spawn = { x: tx, y: ty - 1 };
    const p = this.player;
    if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 20);
    if (p.maxFood != null) p.food = p.maxFood; // a good rest leaves you well-fed
    this.particles.burst(tx * TILE + TILE / 2, ty * TILE + TILE / 2, "#ffd98a", 14, { speed: 70, life: 0.6, glow: true });
    Sound.play("power");
    this.flash("Spawn set — resting…");
    this.doSave();
  }

  // Fetch (creating if needed) the chest container at a tile.
  getChest(tx, ty) {
    const key = tx + "," + ty;
    return (this.chests[key] ||= { slots: new Array(CHEST_SIZE).fill(null) });
  }

  // Build a chest's slot array from a worldgen loot list, padded to full size.
  lootToSlots(loot) {
    const slots = new Array(CHEST_SIZE).fill(null);
    (loot || []).forEach((l, i) => { if (i < CHEST_SIZE) slots[i] = { item: l.item, count: l.count }; });
    return slots;
  }

  // Right-click a chest tile to view & rummage its contents.
  openChestAt(tx, ty) {
    this.openChest = { key: tx + "," + ty, chest: this.getChest(tx, ty) };
    this.ui = "chest"; this.tradeVillager = null;
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
    this.ui = "play"; this.tradeVillager = null; this.searchFocused = false;
    this.openChest = null;
  }

  update(dt) {
    const input = this.input;
    // Tell Input the current UI so touch taps route correctly, and mark the
    // hotbar + pause button as UI zones (a finger there shouldn't dig the world).
    input.setUi(this.ui);
    if (this.ui === "play") {
      const hb = this.renderer.hotbarRect();
      input.uiZones = [
        { x: hb.x0, y: hb.y0, w: hb.totalW, h: hb.slot },
        this.renderer.pauseBtnRect(),
      ];
    } else {
      input.uiZones = [];
    }
    // The crafting/creative list scrolls with a vertical drag in this column.
    if (this.ui === "inv") {
      const L = this.renderer.invLayout();
      input.scrollZone = { x: L.craftX, y: L.y0, w: L.craftW, h: L.gridH + 30 };
    } else {
      input.scrollZone = null;
    }
    this.updateSearchBox();
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.shootCd = Math.max(0, this.shootCd - dt);
    this._pickHintCd = Math.max(0, this._pickHintCd - dt);
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);

    // While the TV overlay is up, the world keeps ticking but the player is
    // parked — keyboard/mouse goes to the DOM player, not the game.
    const watching = TV.isOpen;

    // When the inventory search box is focused, keystrokes feed the search
    // rather than driving the player or the hotbar.
    const typing = this.ui === "inv" && this.searchFocused;
    const typed = input.consumeTyped();
    if (typing) this.applySearchInput(typed);

    // Esc: drop search focus, close an open sub-menu, else toggle the pause menu.
    if (!watching && input.pressed("Escape")) {
      if (typing) this.searchFocused = false;
      else if (this.ui === "inv" || this.ui === "trade" || this.ui === "chest") this.closeMenus();
      else this.togglePause();
    }
    // The on-screen ⏸ button also pauses (only consumes the click if it's on it).
    if (this.ui === "play" && this.renderer.pauseBtnHit(input.mouse.x, input.mouse.y) && input.leftClicked())
      this.togglePause();
    // Tapping/clicking a hotbar slot selects it (handy with no keyboard).
    if (this.ui === "play") {
      const hb = this.renderer.hotbarHitTest(this.inventory, input.mouse.x, input.mouse.y);
      if (hb >= 0 && input.leftClicked()) this.inventory.select(hb);
    }
    // While paused the world is frozen — only the pause menu takes input.
    if (this.ui === "pause") { this.handleMenuMouse(); return; }

    if (!watching && (input.pressed("KeyE") || input.pressed("KeyC")) && !typing) this.toggleInventory();
    // Q drops the selected item (hold Shift to toss the whole stack).
    if (!watching && input.pressed("KeyQ") && this.ui === "play")
      this.dropSelected(input.down("ShiftLeft") || input.down("ShiftRight"));

    // Hotbar selection is always available (unless typing in the search box).
    if (!watching && !typing) for (let i = 0; i < this.inventory.hotbarSize; i++)
      if (input.pressed("Digit" + (i + 1))) this.inventory.select(i);
    const wheel = watching ? 0 : input.consumeWheel();
    if (wheel) {
      if (this.ui === "inv") {
        const rows = this.currentCraftList().length;
        const maxScroll = Math.max(0, rows - Renderer.CRAFT_ROWS);
        this.craftScroll = Math.max(0, Math.min(maxScroll, this.craftScroll + wheel));
      } else this.inventory.scroll(wheel);
    }
    this.updateItemSwitch();

    const liquid = this.liquidAtBody(this.player);
    const intent = (watching || typing) ? {
      left: false, right: false, down: false, jumpPressed: false, jumpHeld: false,
      inWater: liquid === "water", inLava: liquid === "lava", onLadder: this.onLadder(this.player),
    } : {
      left: input.down("KeyA") || input.down("ArrowLeft"),
      right: input.down("KeyD") || input.down("ArrowRight"),
      down: input.down("KeyS") || input.down("ArrowDown"),
      jumpPressed: input.pressed("Space") || input.pressed("KeyW") || input.pressed("ArrowUp"),
      jumpHeld: input.down("Space") || input.down("KeyW") || input.down("ArrowUp"),
      inWater: liquid === "water", inLava: liquid === "lava",
      onLadder: this.onLadder(this.player),
    };
    this.player.update(this.world, dt, intent);
    this.player.defense = this.inventory.totalDefense();
    if (this.player.justJumped) Sound.play("jump");
    this.onPlayerLanded();
    this.updateHeroSuits(dt);

    if (watching) { /* TV up: no world interaction */ }
    else if (this.ui === "play") this.handleInteraction(dt);
    else this.handleMenuMouse();

    this.applyEnvironmentDamage(dt, liquid);
    this.updateEnemies(dt);
    this.updateEnemyShots(dt);
    this.updateVillagers(dt);
    this.updateAnimals(dt);
    this.updateFish(dt);
    this.updateFishing(dt);
    this.updateDrops(dt);
    this.updateProjectiles(dt);
    this.updateTnts(dt);
    this.updateFires(dt);
    this.updateLiquids(dt);
    this.ambientFx(dt);
    this.updateWeather(dt);
    this.updateCritters(dt);
    this.regrowFlora(dt);
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

  // Advance the liquid flow sim on a fixed 20Hz tick (decoupled from frame rate
  // for stable behaviour), then turn any water+lava reactions into puffs of steam.
  updateLiquids(dt) {
    const STEP = 1 / 20;
    this.liquidAccum = (this.liquidAccum || 0) + dt;
    let steps = 0;
    while (this.liquidAccum >= STEP && steps < 4) {
      stepLiquids(this.world);
      this.liquidAccum -= STEP;
      steps++;
    }
    if (this.liquidAccum > STEP) this.liquidAccum = 0; // drop backlog, never spiral

    const steam = this.world._steam;
    if (steam.length) {
      for (let k = 0; k < steam.length; k += 2) {
        const cx = steam[k] * TILE + TILE / 2, cy = steam[k + 1] * TILE + TILE / 2;
        this.particles.burst(cx, cy, "#e6eef2", 7, { speed: 35, up: 55, life: 0.8, gravity: -40 });
      }
      if (steam.length) Sound.play("break");
      steam.length = 0;
    }
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

  // Advance the weather and apply its world effects: storms hurl lightning,
  // and rain both douses fires and quickens the surface's regrowth.
  updateWeather(dt) {
    this.weather.update(dt);
    if (this.weather.struck) this.stormStrike();
    if (this.weather.raining) {
      if (this.fires.length) for (const f of this.fires) f.life -= dt * 2; // rain snuffs flames faster
      // A tundra storm is a biting blizzard — it keeps the player chilled & slow.
      if (this.biomeAtX(Math.floor(this.player.cx / TILE)) === "tundra")
        this.player.addBuff("chilled", 0.5);
    }
  }

  // A dramatic thunderbolt onto a random surface point near the player (visual
  // only — a bright flash + thunder + shake, no damage to the player).
  stormStrike() {
    const ptx = Math.floor(this.player.x / TILE);
    const tx = ptx + ((Math.random() * 40 - 20) | 0);
    const ty = this.findSurface(tx);
    this.bolts.push({ x: tx * TILE + TILE / 2, top: ty * TILE - TILE * 22, y: ty * TILE, life: 0.18 });
    this.renderer.addShake(4);
    Sound.play("explosion"); // thunderclap
  }

  // Advance the cosmetic surface wildlife, sized to the current view & time of day.
  updateCritters(dt) {
    const r = this.renderer;
    const view = { camX: r.camX, camY: r.camY, vw: r.vw, vh: r.vh };
    this.critters.update(this.world, dt, view, r.daylight(this.time), (tx) => this.findSurface(tx), this.tNow);
  }

  // Slowly re-green the surface: grass tiles in view sprout tufts, flowers, and
  // berry bushes over time, replenishing what's grazed or harvested. Day-biased.
  regrowFlora(dt) {
    this._floraCd = (this._floraCd || 0) - dt;
    if (this._floraCd > 0) return;
    this._floraCd = 0.5;
    const r = this.renderer;
    if (r.camX == null) return;
    if (r.daylight(this.time) < 0.35) return; // plants grow in daylight
    const x0 = Math.floor(r.camX / TILE), x1 = Math.floor((r.camX + r.vw) / TILE);
    const isFlora = (id) => id === TILE_IDS.TALL_GRASS || id === TILE_IDS.FLOWER || id === TILE_IDS.BERRY_BUSH;
    const tries = this.weather.raining ? 8 : 4; // rain makes things grow twice as fast
    for (let k = 0; k < tries; k++) {
      const tx = x0 + (Math.random() * Math.max(1, x1 - x0) | 0);
      const ty = this.findSurface(tx);
      if (this.world.get(tx, ty) !== TILE_IDS.GRASS) continue;
      if (this.world.get(tx, ty - 1) !== TILE_IDS.AIR) continue;
      // Keep it sparse: don't sprout between two existing flora tiles.
      if (isFlora(this.world.get(tx - 1, ty - 1)) && isFlora(this.world.get(tx + 1, ty - 1))) continue;
      const roll = Math.random();
      const id = roll < 0.7 ? TILE_IDS.TALL_GRASS : roll < 0.92 ? TILE_IDS.FLOWER : TILE_IDS.BERRY_BUSH;
      this.world.set(tx, ty - 1, id);
    }
  }

  handleMenuMouse() {
    const m = this.input.mouse;
    if (this.ui === "pause") {
      if (this.input.leftClicked()) {
        const a = this.renderer.pauseHitTest(m.x, m.y);
        if (a === "resume") this.togglePause();
        else if (a === "save") this.quitToMenu();              // saves, then back to menu
        else if (a === "exit" &&
          confirm("Exit without saving? Unsaved progress will be lost.")) location.reload();
      }
      return;
    }
    if (this.ui === "inv") {
      if (this.input.leftClicked()) {
        // Search box + category tabs take priority over the lists below them.
        if (this.renderer.searchHitTest(m.x, m.y)) { this.searchFocused = true; return; }
        const tab = this.renderer.tabHitTest(m.x, m.y);
        if (tab) { this.craftTab = tab; this.craftScroll = 0; this.searchFocused = false; return; }
        this.searchFocused = false;
        if (this.creative) {
          const list = this.filteredCreative();
          const ci = this.renderer.recipeHitTest(list, m.x, m.y, this.craftScroll);
          if (ci >= 0) { this.giveCreativeItem(list[ci]); return; }
        } else {
          const list = this.filteredRecipes();
          const recipe = this.renderer.recipeHitTest(list, m.x, m.y, this.craftScroll);
          if (recipe >= 0) { this.tryCraft(list[recipe]); return; }
        }
        const hit = this.renderer.invHitTest(this.inventory, m.x, m.y);
        if (hit && hit.type === "slot") this.inventory.clickSlot(hit.index);
        else if (hit && hit.type === "armor") this.inventory.clickArmor(hit.slot);
      }
    } else if (this.ui === "chest" && this.openChest) {
      if (this.input.leftClicked()) {
        const ci = this.renderer.chestHitTest(this.openChest.chest, m.x, m.y);
        if (ci >= 0) { this.inventory.clickContainerSlot(this.openChest.chest.slots, ci); return; }
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

  // True when the player's body overlaps a ladder tile (center or feet).
  onLadder(p) {
    const tx = Math.floor(p.cx / TILE);
    return isClimbable(this.world.get(tx, Math.floor(p.cy / TILE)))
      || isClimbable(this.world.get(tx, Math.floor((p.y + p.h - 1) / TILE)));
  }

  applyEnvironmentDamage(dt, liquid) {
    if (this.creative) return; // no fall/lava damage in Creative
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
    if (!this.creative) {
      const isNight = this.time < 0.24 || this.time > 0.78;
      const deep = this.player.y / TILE > this.findSurface(Math.floor(this.player.x / TILE)) + 18;
      this.nightSpawnCd -= dt;
      if (this.nightSpawnCd <= 0 && this.enemies.length < 10) {
        this.nightSpawnCd = 5 + Math.random() * 4;
        if (deep) {
          // Underground: drop a zombie or skeleton into a nearby cave pocket.
          const tx = Math.floor(this.player.x / TILE) + (Math.random() < 0.5 ? -1 : 1) * (10 + (Math.random() * 6 | 0));
          const ty = this.caveSpawnY(tx);
          if (ty > 0) this.enemies.push(Math.random() < 0.4 ? new SkeletonArcher(tx, ty) : new Zombie(tx, ty, Math.random() < 0.25 ? "brute" : "normal"));
        } else if (isNight) {
          const tx = Math.floor(this.player.x / TILE) + (Math.random() < 0.5 ? -1 : 1) * (14 + (Math.random() * 6 | 0));
          this.enemies.push(this.makeNightMob(tx));
        }
      }
      this.maybeSpawnBoss();
      this.maybeSpawnDragon(dt);
    }

    const toAdd = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.freeze > 0) e.freeze -= dt;

      // Mind-controlled enemies fight FOR you: point them at the nearest hostile
      // (or let them idle in place if the area is clear).
      const aimAt = e.friendly ? (this._nearestHostile(e) || { cx: e.cx, cy: e.cy }) : this.player;
      e.update(this.world, dt, aimAt);
      if (e.freeze > 0) e.vx *= 0.18;           // frozen foes can barely move
      if (this.liquidAtBody(e) === "lava") e.hurt(e.boss ? 8 : 40);

      // A thrall enemy: it claws other hostiles and never harms you.
      if (e.friendly) {
        e.charmGlow = (e.charmGlow || 0) > 0 ? e.charmGlow - dt : 0.4;
        for (const o of this.enemies) {
          if (o === e || o.dead || o.friendly) continue;
          if (this.aabbOverlap(e, o)) {
            o.hurt(e.touchDmg || 8, Math.sign(o.cx - e.cx) * 150);
            this.particles.burst(o.cx, o.cy, "#c084fc", 5, { speed: 90, life: 0.35, glow: true });
            if (o.dead) Sound.play("slay");
          }
        }
        if (e.pendingShots) e.pendingShots.length = 0; // don't fire on the player
        continue; // skip hostile player-contact & summon logic below
      }

      // Skeleton archers queue up arrows; turn them into hostile projectiles.
      if (e.pendingShots && e.pendingShots.length) {
        for (const s of e.pendingShots)
          this.enemyShots.push(new Projectile(s.x, s.y, s.vx, s.vy, { damage: 11, color: "#d9c98a", gravity: 130, life: 3, w: 5, h: 2 }));
        e.pendingShots.length = 0;
        Sound.play("hit");
      }
      // Dragon hits its enrage phase: roar, shake, and a burst of embers.
      if (e.justEnraged) {
        this.flash(`${e.name} roars in fury!`);
        this.renderer.addShake(9);
        this.particles.burst(e.cx, e.cy, "#ff5a2a", 28, { speed: 200, life: 0.7, gravity: -40, glow: true });
        Sound.play("explosion");
      }
      // Dragon fire-breath: turn queued breaths into burning, gravity-light shots.
      if (e.pendingFire && e.pendingFire.length) {
        for (const s of e.pendingFire)
          this.enemyShots.push(new Projectile(s.x, s.y, s.vx, s.vy, { damage: 14, color: "#ff7a2a", glow: true, gravity: 60, life: 2.2, w: 6, h: 6, fire: true }));
        e.pendingFire.length = 0;
      }
      // Boss summons a small swarm of slimes.
      if (e.wantSummon) {
        for (let i = 0; i < e.wantSummon; i++) {
          const tx = Math.floor(e.cx / TILE) + (i - 1) * 2;
          toAdd.push(new Slime(tx, Math.floor(e.cy / TILE) - 1));
        }
        e.wantSummon = 0;
        this.particles.burst(e.cx, e.cy, "#6f3fb0", 14, { speed: 140, life: 0.5, glow: true });
      }

      const touch = e.touchDmg || SLIME_TOUCH_DMG;
      if (this.aabbOverlap(e, this.player)) {
        if (e.chill) this.player.addBuff("chilled", 1.5); // frost slime numbs you
        const dir = Math.sign(this.player.cx - e.cx) || 1;
        if (this.player.hurt(touch, dir * (e.boss ? 240 : 160), -160)) {
          const taken = Math.max(1, touch - this.player.defense);
          this.particles.float(this.player.cx, this.player.y - 4, `-${taken}`, "#ff7a7a");
          this.particles.burst(this.player.cx, this.player.cy, "#c0392b", 8, { speed: 110, life: 0.45 });
          this.renderer.addShake(e.boss ? 7 : 4);
          Sound.play("hurt");
        }
      }
    }
    if (toAdd.length) this.enemies.push(...toAdd);

    // Drop loot + fanfare for anything that died this frame, then cull.
    for (const e of this.enemies) {
      if (e.dead && !e._looted) {
        e._looted = true;
        this.dropLoot(e);
        if (e.boss) this.onBossDefeated(e);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  // Pre-load the Cave Warden into his lair so he's always lurking there, ready.
  spawnBossInLair() {
    if (this.bossDefeated || this.boss || !this.bossLair) return;
    this.boss = new CaveBoss(this.bossLair.x, this.bossLair.y - 3);
    this._bossSeen = false;
    this.enemies.push(this.boss);
  }

  // Dramatic one-time "awakens!" when the player first descends into the lair.
  maybeSpawnBoss() {
    if (this.bossDefeated || !this.bossLair) return;
    if (!this.boss) this.spawnBossInLair(); // safety net for legacy saves
    if (!this.boss || this._bossSeen) return;
    const px = this.player.x / TILE, py = this.player.y / TILE;
    if (Math.abs(px - this.bossLair.x) < 26 && Math.abs(py - this.bossLair.y) < 12) {
      this._bossSeen = true;
      this.flash(`${this.boss.name} awakens!`);
      this.renderer.addShake(10);
      Sound.play("explosion");
    }
  }

  onBossDefeated(e) {
    this.bossDefeated = true;
    this.boss = null;
    this.flash(`${e.name || "The boss"} has been slain!`);
    this.particles.burst(e.cx, e.cy, "#ffd86a", 40, { speed: 220, life: 1.0, glow: true });
    this.renderer.addShake(12);
    Sound.play("slay");
  }

  // Spawn the world's resident dragon, aloft just above and beside the player so
  // it's immediately in view. Present in every mode (Creative included).
  spawnDragon(announce = true) {
    if (!this.dragonEnabled) return; // dragon disabled for this world
    if (this.enemies.some((e) => e.kind === "dragon" && !e.dead)) return;
    if (!this.player) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    const ptx = Math.floor(this.player.x / TILE);
    const tx = ptx + side * 6;               // close by, not way off-screen
    const ty = Math.floor(this.player.y / TILE) - 9; // up in the air, on screen
    const dragon = new Dragon(tx, ty);
    this.enemies.push(dragon);
    if (announce) {
      this.flash("A dragon descends from the sky!");
      this.renderer.addShake(6);
      Sound.play("explosion");
    }
  }

  // The dragon is always around — if it's been slain, bring a new one back after
  // a cooldown so the skies are never empty for long.
  maybeSpawnDragon(dt) {
    if (this.enemies.some((e) => e.kind === "dragon" && !e.dead)) return;
    this.dragonSpawnCd -= dt;
    if (this.dragonSpawnCd > 0) return;
    this.dragonSpawnCd = 45 + Math.random() * 40;
    this.spawnDragon(true);
  }

  // ----- Fire spread (started by dragon breath) -----
  // Flammable tiles that fire can catch and consume.
  static get FLAMMABLE() {
    return this._FLAMMABLE ||= new Set([
      TILE_IDS.WOOD, TILE_IDS.LEAVES, TILE_IDS.GRASS, TILE_IDS.PLANK,
      TILE_IDS.TALL_GRASS, TILE_IDS.FLOWER, TILE_IDS.BERRY_BUSH, TILE_IDS.VINE,
    ]);
  }
  isFlammable(id) { return Game.FLAMMABLE.has(id); }

  // Set a single tile alight (if flammable and not already burning).
  igniteTile(tx, ty) {
    if (this.creative) return;
    if (this.fires.length > 160) return;
    if (!this.isFlammable(this.world.get(tx, ty))) return;
    if (this.fires.some((f) => f.tx === tx && f.ty === ty)) return;
    this.fires.push({ tx, ty, life: 2.5 + Math.random() * 2, max: 4.5 });
  }

  // A dragon-fire splash: scorch the impact tile and any flammable neighbours,
  // and throw up a gout of flame particles even on bare rock.
  igniteBurst(px, py) {
    const ctx = Math.floor(px / TILE), cty = Math.floor(py / TILE);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (Math.random() < 0.7) this.igniteTile(ctx + dx, cty + dy);
    this.particles.burst(px, py, "#ff7a2a", 10, { speed: 120, up: 40, life: 0.5, gravity: -60, glow: true });
    this.particles.burst(px, py, "#ffd24d", 6, { speed: 90, up: 30, life: 0.4, gravity: -40, glow: true });
    Sound.play("hit");
  }

  // Advance burning tiles: flames lick out particles, hurt anything standing in
  // them, sometimes spread to neighbours, and finally consume the tile.
  updateFires(dt) {
    if (!this.fires.length) return;
    const dead = [];
    for (const f of this.fires) {
      f.life -= dt;
      const cx = f.tx * TILE + TILE / 2, cy = f.ty * TILE + TILE / 2;
      if (Math.random() < dt * 22)
        this.particles.spawn({ x: cx + (Math.random() * TILE - TILE / 2), y: cy + 2, vx: (Math.random() * 2 - 1) * 12, vy: -40 - Math.random() * 50, life: 0.5 + Math.random() * 0.3, size: 3, color: Math.random() < 0.5 ? "#ff6a2a" : "#ffce4d", gravity: -50, glow: true });

      // Spread to a random flammable neighbour now and then.
      if (Math.random() < dt * 0.5) {
        const nx = f.tx + (Math.random() < 0.5 ? -1 : 1), ny = f.ty + (Math.random() < 0.6 ? 0 : (Math.random() < 0.5 ? -1 : 1));
        this.igniteTile(nx, ny);
      }

      // Burn entities standing in the flames.
      this.burnEntitiesAt(f, dt);

      if (f.life <= 0) {
        dead.push(f);
        const id = this.world.get(f.tx, f.ty);
        // Grass scorches down to dirt; everything else burns away to nothing.
        this.world.set(f.tx, f.ty, id === TILE_IDS.GRASS ? TILE_IDS.DIRT : TILE_IDS.AIR);
        this.particles.burst(cx, cy, "#3a3a3a", 6, { speed: 50, up: 30, life: 0.6, gravity: 200 });
      }
    }
    if (dead.length) {
      this.fires = this.fires.filter((f) => !dead.includes(f));
      this.world.recomputeSkyTop();
    }
  }

  // Apply fire damage to the player, enemies, and animals overlapping a burning tile.
  burnEntitiesAt(f, dt) {
    const x0 = f.tx * TILE, y0 = f.ty * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
    const inFire = (b) => b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
    const DPS = 12;
    if (inFire(this.player))
      this.player.hurt(DPS * dt, 0, 0, { bypassIframes: true, useArmor: false, clampMin: false });
    for (const e of this.enemies)
      if (!e.dead && e.kind !== "dragon" && inFire(e)) e.hurt(DPS * dt);
    for (const a of this.animals) if (!a.dead && inFire(a)) a.hurt(DPS * dt);
  }

  // Scatter an entity's loot table as dropped items.
  dropLoot(e) {
    if (!e.loot) return;
    for (const l of e.loot) {
      const lo = l.n[0], hi = l.n[1];
      const n = lo + (Math.random() * (hi - lo + 1) | 0);
      for (let i = 0; i < n; i++) this.spawnDrop(e.cx, e.cy, l.item, 1);
    }
  }

  // Move skeleton arrows; they hurt the player and die on tiles/contact.
  updateEnemyShots(dt) {
    for (const p of this.enemyShots) {
      p.update(this.world, dt);
      // Fire breath sheds embers and ignites whatever it splashes against.
      if (p.fire) {
        if (Math.random() < dt * 30)
          this.particles.spawn({ x: p.cx, y: p.cy, vx: (Math.random() * 2 - 1) * 20, vy: -20 - Math.random() * 30, life: 0.5, size: 3, color: Math.random() < 0.5 ? "#ffd24d" : "#ff6a2a", gravity: -30, glow: true });
        if (p.dead && p.hitTile) this.igniteBurst(p.cx, p.cy);
      }
      if (!p.dead && this.aabbOverlap(p, this.player)) {
        const dir = Math.sign(p.vx) || 1;
        if (this.player.hurt(p.damage, dir * 120, -80)) {
          const taken = Math.max(1, p.damage - this.player.defense);
          this.particles.float(this.player.cx, this.player.y - 4, `-${taken}`, "#ff7a7a");
          this.renderer.addShake(3);
          Sound.play("hurt");
        }
        p.dead = true;
      }
    }
    this.enemyShots = this.enemyShots.filter((p) => !p.dead);
    if (this.enemyShots.length > 120) this.enemyShots.splice(0, this.enemyShots.length - 120);
  }

  // Build villagers from worldgen descriptors, linking babies to the parent they trail.
  buildNpcs(descs) {
    descs = descs || [];
    const n = descs.length || 1;
    const list = descs.map((d, i) => new Villager(d.home, (i + 1) / (n + 1), { role: d.role, gang: d.gang }));
    const byDesc = new Map();
    descs.forEach((d, i) => byDesc.set(d, list[i]));
    descs.forEach((d, i) => { if (d.childOf) list[i].follow = byDesc.get(d.childOf) || null; });
    return list;
  }

  updateVillagers(dt) {
    for (const v of this.villagers) {
      // Mental manipulation: assign a victim/foe before the NPC thinks.
      //  • charmed → bodyguards you, hunting the nearest enemy
      //  • maddened → turns on the nearest fellow townsperson (murder!)
      if (v.charmed) v.combatTarget = this._nearestHostile(v);
      else if (v.rage > 0) v.combatTarget = this._nearestVillagerOther(v);
      else v.combatTarget = null;

      v.update(this.world, dt, this.time);
      if (this.liquidAtBody(v) === "lava") v.hurt(50);

      // Resolve a melee swing when in reach of the assigned target.
      const tgt = v.combatTarget;
      if (tgt && !tgt.dead && v.atkCd <= 0 && Math.hypot(tgt.cx - v.cx, tgt.cy - v.cy) < TILE * 1.4) {
        tgt.hurt(v.atkPower, Math.sign(tgt.cx - v.cx) * 130);
        v.atkCd = 0.7;
        this.particles.float(tgt.cx, tgt.y - 4, `${v.atkPower}`, "#ff9a6a");
        this.particles.burst(tgt.cx, tgt.cy, "#c0392b", 6, { speed: 100, life: 0.4 });
        Sound.play("hit");
        if (tgt.dead) {
          Sound.play("slay");
          this.flash(`${v.name} ${v.rage > 0 ? "murdered" : "slew"} ${tgt.name || "a foe"}!`);
        }
      }

      if (v.dead) {
        this.flash(`${v.name} has died`);
        if (this.tradeVillager === v) this.closeMenus();
      }
    }
    this.villagers = this.villagers.filter((v) => !v.dead);
  }

  // Nearest living hostile enemy to an entity (skips your charmed thralls).
  _nearestHostile(from) {
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      if (e.dead || e.friendly || e === from) continue;
      const d = Math.hypot(e.cx - from.cx, e.cy - from.cy);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // Nearest other villager — a maddened NPC's murder victim.
  _nearestVillagerOther(from) {
    let best = null, bd = Infinity;
    for (const v of this.villagers) {
      if (v === from || v.dead) continue;
      const d = Math.hypot(v.cx - from.cx, v.cy - from.cy);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  updateAnimals(dt) {
    for (const a of this.animals) {
      if (a.dead) continue;
      a.update(this.world, dt, this.player);
      if (this.liquidAtBody(a) === "lava") a.hurt(40);
      if (a.layEgg) { this.spawnDrop(a.cx, a.cy + 4, "egg", 1); Sound.play("pickup"); }
      if (a.grazed) // little spray of clippings when an animal nibbles flora
        this.particles.burst(a.cx, a.cy + a.h / 2, "#5bbf4a", 4, { speed: 50, up: 20, life: 0.4, gravity: 200 });
    }
    if (this.animals.length < 18) this.tryBreed(); // herd grows up to a cap
    this.animals = this.animals.filter((a) => !a.dead);
  }

  // Two grown, willing animals of the same type standing close together produce
  // a baby (one birth per check). Grazing/feeding shortens the wait.
  tryBreed() {
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];
      if (!a.readyToBreed) continue;
      for (let j = i + 1; j < this.animals.length; j++) {
        const b = this.animals[j];
        if (b.type !== a.type || !b.readyToBreed) continue;
        if (Math.abs(a.cx - b.cx) > TILE * 2.5 || Math.abs(a.cy - b.cy) > TILE * 2) continue;
        const baby = new Animal(a.type, 0, 0, { baby: true });
        baby.x = (a.cx + b.cx) / 2 - baby.w / 2;
        baby.y = Math.min(a.y, b.y);
        this.animals.push(baby);
        a.breedCd = 45 + Math.random() * 30;
        b.breedCd = 45 + Math.random() * 30;
        this.particles.burst((a.cx + b.cx) / 2, (a.cy + b.cy) / 2 - 6, "#ff8ab0", 10, { speed: 70, up: 40, life: 0.7, gravity: -30, glow: true });
        Sound.play("pickup");
        this.flash(`A baby ${a.type} is born!`);
        return;
      }
    }
  }

  // Right-click a nearby animal while holding food to feed it: heals a touch and
  // makes adults eager to breed (or helps a baby grow up faster).
  feedAnimal(a) {
    this.inventory.decrementSelected();
    a.hp = Math.min(a.maxHp, a.hp + 5);
    if (a.baby) a.growth = Math.max(0, a.growth - 15);
    else a.breedCd = 0;
    this.particles.burst(a.cx, a.cy - 4, "#ff8ab0", 8, { speed: 60, up: 30, life: 0.6, gravity: -20, glow: true });
    Sound.play("eat");
    this.flash(a.baby ? "The baby eats happily" : `Fed the ${a.type}`);
  }

  animalUnderCursor(wx, wy) {
    return this.animals.find((a) => !a.dead && wx >= a.x - 2 && wx <= a.x + a.w + 2 && wy >= a.y - 2 && wy <= a.y + a.h + 2);
  }

  // Drop an animal's loot, play the slay fx (called when a melee/blast kills it).
  killAnimal(a) {
    // Babies yield no meat — raise them to adulthood first.
    if (a.baby) {
      this.particles.burst(a.cx, a.cy, "#c0392b", 10, { speed: 120, life: 0.5 });
      Sound.play("slay");
      return;
    }
    const d = a.def;
    const n = d.dropN[0] + (Math.random() * (d.dropN[1] - d.dropN[0] + 1) | 0);
    for (let i = 0; i < n; i++) this.spawnDrop(a.cx, a.cy, d.drop, 1);
    if (d.extra) {
      const m = d.extra.n[0] + (Math.random() * (d.extra.n[1] - d.extra.n[0] + 1) | 0);
      for (let i = 0; i < m; i++) this.spawnDrop(a.cx, a.cy, d.extra.item, 1);
    }
    this.particles.burst(a.cx, a.cy, "#c0392b", 16, { speed: 150, life: 0.7 });
    Sound.play("slay");
  }

  updateFish(dt) {
    for (const f of this.fish) {
      if (f.dead) continue;
      f.update(this.world, dt, this.player);
    }
    this.fish = this.fish.filter((f) => !f.dead);
  }

  // Fishing: a left-click cast/reel cycle handled in handleFishing; this advances
  // the bite timer, draws ripples, and times out a missed bite.
  updateFishing(dt) {
    const fz = this.fishing;
    if (!fz) return;
    const sel = this.inventory.selectedSlot();
    if (!sel || !ITEMS[sel.item] || ITEMS[sel.item].kind !== "fishing") { this.fishing = null; return; }
    if (Math.hypot(this.player.cx - fz.bx, this.player.cy - fz.by) > REACH * TILE * 1.7) {
      this.fishing = null; this.flash("Line snapped");
      return;
    }
    if (!fz.hooked && this.tNow >= fz.biteAt) {
      fz.hooked = true; fz.hookedAt = this.tNow;
      Sound.play("pickup");
      this.particles.burst(fz.bx, fz.by, "#bfe6ff", 6, { speed: 55, life: 0.4 });
    }
    if (fz.hooked) {
      fz.dip = Math.abs(Math.sin((this.tNow - fz.hookedAt) * 12)) * 3;
      if (this.tNow - fz.hookedAt > 2.2) { this.fishing = null; this.flash("The fish got away…"); return; }
      if (Math.random() < dt * 8)
        this.particles.spawn({ x: fz.bx + (Math.random() * 8 - 4), y: fz.by, vx: 0, vy: -10, life: 0.3, size: 1, color: "#cfeeff" });
    } else if (Math.random() < dt * 1.5) {
      this.particles.spawn({ x: fz.bx, y: fz.by, vx: 0, vy: -6, life: 0.4, size: 1, color: "#bcdcf0" });
    }
  }

  updateDrops(dt) {
    for (const d of this.drops) {
      d.update(this.world, dt, this.player);
      if (d.canPickup(this.player)) {
        const before = d.count;
        let left;
        if (d.dur != null) left = this.inventory.addSingleWithMeta(d.item, { dur: d.dur }); // keep tool wear
        else left = this.inventory.add(d.item, d.count);
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
    if (this.player.maxFood != null) this.player.food = Math.max(this.player.food, this.player.maxFood * 0.5);
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

    // Guns: aim with the cursor anywhere on screen and hold left-mouse to fire.
    const sel = this.inventory.selectedSlot();
    const selDef = sel ? ITEMS[sel.item] : null;
    if (selDef && selDef.kind === "spell") {
      if (this.input.mouse.left) this.castSpell(selDef);
      this.mining.tile = null; this.mining.progress = 0;
      return;
    }
    if (selDef && selDef.kind === "gun") {
      if (this.input.mouse.left) this.tryFire(selDef);
      this.mining.tile = null; this.mining.progress = 0;
      return;
    }

    // Fishing pole: left-click casts at water, then reels / lands the catch.
    if (selDef && selDef.kind === "fishing") {
      this.handleFishing(cur);
      this.mining.tile = null; this.mining.progress = 0;
      return;
    }

    // Right-click: turn on a TV, else trade with a villager, else use a power-up,
    // else eat food, else place.
    if (this.input.rightClicked()) {
      if (cur.inReach && this.world.get(cur.tx, cur.ty) === TILE_IDS.TV) { this.openTv(cur.tx, cur.ty); return; }
      if (cur.inReach && this.world.get(cur.tx, cur.ty) === TILE_IDS.BED) { this.sleepInBed(cur.tx, cur.ty); return; }
      if (cur.inReach && this.world.get(cur.tx, cur.ty) === TILE_IDS.CHEST) { this.openChestAt(cur.tx, cur.ty); return; }
      const v = this.villagerUnderCursor(cur.wx, cur.wy);
      if (v && cur.inReach) { this.openTrade(v); return; }
      const s = this.inventory.selectedSlot();
      // Holding edible food + right-clicking an animal feeds it (breeding/taming).
      if (s && ITEMS[s.item] && ITEMS[s.item].kind === "food" && ITEMS[s.item].heal > 0) {
        const a = this.animalUnderCursor(cur.wx, cur.wy);
        if (a && cur.inReach) { this.feedAnimal(a); return; }
      }
      if (s && ITEMS[s.item] && ITEMS[s.item].kind === "power") { this.usePower(ITEMS[s.item]); return; }
      if (s && ITEMS[s.item] && ITEMS[s.item].kind === "food") { this.eatSelected(); return; }
    }
    if (this.input.mouse.right && cur.inReach && !this.villagerUnderCursor(cur.wx, cur.wy))
      this.placeBlock(cur.tx, cur.ty);

    // Left-click: attack a slime under the cursor, else mine.
    if (this.input.mouse.left && cur.inReach && this.attackCd <= 0) {
      const target = this.enemies.find((e) => !e.friendly &&
        cur.wx >= e.x - 4 && cur.wx <= e.x + e.w + 4 && cur.wy >= e.y - 4 && cur.wy <= e.y + e.h + 4);
      if (target) {
        const dir = Math.sign(target.cx - this.player.cx) || this.player.facing;
        const dmg = Math.round(this.weaponDamage());
        target.hurt(dmg, dir * 180);
        this.particles.float(target.cx, target.y - 4, `${dmg}`, "#ffe08a");
        this.particles.burst(target.cx, target.cy, "#4fb36b", 6, { speed: 90, life: 0.4 });
        this.renderer.addShake(2);
        Sound.play("hit");
        // Mjölnir: calls down lightning that chains to nearby foes.
        const wpn = this.inventory.selectedSlot();
        if (wpn && ITEMS[wpn.item] && ITEMS[wpn.item].lightning) this.lightningStrike(target);
        if (target.dead) {
          this.particles.burst(target.cx, target.cy, "#4fb36b", 18, { speed: 150, life: 0.7 });
          Sound.play("slay");
        }
        this.player.swing = 1; this.player.facing = dir;
        this.attackCd = this.attackCooldown(); this.mining.tile = null; this.mining.progress = 0;
        this.damageSelectedTool(1); // weapons wear with each swing that connects
        return;
      }

      // Animals & fish: same click-to-hit, but they drop food when slain.
      const critter = this.animals.find((a) =>
        cur.wx >= a.x - 4 && cur.wx <= a.x + a.w + 4 && cur.wy >= a.y - 4 && cur.wy <= a.y + a.h + 4);
      if (critter) { this.hitCritter(critter, false); return; }
      const fishT = this.fish.find((f) =>
        cur.wx >= f.x - 4 && cur.wx <= f.x + f.w + 4 && cur.wy >= f.y - 4 && cur.wy <= f.y + f.h + 4);
      if (fishT) { this.hitCritter(fishT, true); return; }
    }

    if (this.input.mouse.left && cur.inReach) {
      const id = this.world.get(cur.tx, cur.ty);
      const def = tileDef(id);
      // With no block to mine, a left-click on a bare wall removes the wall.
      const wall = id === TILE_IDS.AIR ? this.world.wallAt(cur.tx, cur.ty) : 0;
      const canMine = def.mineable && id !== TILE_IDS.AIR && (!def.needsPick || this.holdingPickaxe());
      if (!canMine && wall) {
        if (!this.mining.tile || this.mining.tile.tx !== cur.tx || this.mining.tile.ty !== cur.ty) {
          this.mining.tile = { tx: cur.tx, ty: cur.ty };
          this.mining.progress = 0;
        }
        this.player.swing = 1;
        this.mining.progress += (dt * this.toolPower()) / 0.5;
        if (this.creative) this.mining.progress = 1; // instant break in Creative
        if (this.mining.progress >= 1) {
          this.breakWall(cur.tx, cur.ty, wall);
          this.mining.tile = null; this.mining.progress = 0;
        }
      } else if (canMine) {
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
        if (this.creative) this.mining.progress = 1; // instant break in Creative
        if (this.mining.progress >= 1) {
          this.breakTile(cur.tx, cur.ty, id);
          if (this.holdingPickaxe()) this.damageSelectedTool(1); // picks wear from digging
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
    const haste = this.player.hasBuff("haste") ? HASTE_BUFF_MULT : 1;
    const s = this.inventory.selectedSlot();
    if (s && ITEMS[s.item] && ITEMS[s.item].kind === "tool") return ITEMS[s.item].power * haste;
    return 1.0 * haste;
  }
  weaponDamage() {
    let mult = this.player.hasBuff("strength") ? STRENGTH_BUFF_MULT : 1;
    if (this.player.isIntoxicated()) mult *= DRUNK_DAMAGE_MULT; // liquid courage: +5%
    if (this.player.buffTime("cracked") > 0) mult *= CRACK_DAMAGE_MULT;
    else if (this.player.buffTime("wired") > 0) mult *= COKE_DAMAGE_MULT;
    const s = this.inventory.selectedSlot();
    if (s && ITEMS[s.item]) {
      if (ITEMS[s.item].kind === "weapon") return ITEMS[s.item].damage * mult;
      if (ITEMS[s.item].kind === "tool") return ITEMS[s.item].power * 1.2 * mult;
    }
    return 3 * mult; // bare fists
  }
  // Seconds between melee swings — stimulants speed it up (crack the most).
  attackCooldown() {
    if (this.player.buffTime("cracked") > 0) return 0.35 * CRACK_ATTACK_SCALE;
    if (this.player.buffTime("wired") > 0) return 0.35 * COKE_ATTACK_SCALE;
    return 0.35;
  }

  // Mjölnir's thunder: a bolt on the struck foe + a chained zap to nearby enemies.
  lightningStrike(origin) {
    const RANGE = TILE * 5, BOLT_DMG = 28;
    this.bolts.push({ x: origin.cx, top: origin.cy - TILE * 18, y: origin.cy, life: 0.18 });
    this.particles.burst(origin.cx, origin.cy, "#bfe0ff", 16, { speed: 200, life: 0.4, glow: true });
    for (const e of this.enemies) {
      if (e === origin || e.dead) continue;
      if (Math.hypot(e.cx - origin.cx, e.cy - origin.cy) > RANGE) continue;
      e.hurt(BOLT_DMG, Math.sign(e.cx - origin.cx) * 120);
      this.bolts.push({ x: e.cx, top: e.cy - TILE * 18, y: e.cy, life: 0.18, chainFrom: { x: origin.cx, y: origin.cy } });
      this.particles.float(e.cx, e.y - 4, `${BOLT_DMG}`, "#bfe0ff");
      this.particles.burst(e.cx, e.cy, "#bfe0ff", 8, { speed: 160, life: 0.35, glow: true });
    }
    this.renderer.addShake(7);
    Sound.play("laser");
  }

  // Melee a passive critter; on kill, animals drop loot and fish drop raw fish.
  hitCritter(e, isFish) {
    const dir = Math.sign(e.cx - this.player.cx) || this.player.facing;
    const dmg = Math.round(this.weaponDamage());
    e.hurt(dmg, dir * 180);
    this.particles.float(e.cx, e.y - 4, `${dmg}`, "#ffe08a");
    this.particles.burst(e.cx, e.cy, isFish ? "#9fd8e6" : "#c0392b", 6, { speed: 90, life: 0.4 });
    this.renderer.addShake(2);
    Sound.play("hit");
    if (e.dead) {
      if (isFish) { this.spawnDrop(e.cx, e.cy, "raw_fish", 1); Sound.play("slay"); }
      else this.killAnimal(e);
    }
    this.player.swing = 1; this.player.facing = dir;
    this.attackCd = this.attackCooldown(); this.mining.tile = null; this.mining.progress = 0;
    this.damageSelectedTool(1);
  }

  // One left-click cycle of the fishing pole: cast → reel/cancel → land the catch.
  handleFishing(cur) {
    if (!this.input.leftClicked()) return;
    if (!this.fishing) {
      if (this.world.get(cur.tx, cur.ty) === TILE_IDS.WATER && cur.inReach) {
        this.fishing = {
          tx: cur.tx, ty: cur.ty,
          bx: cur.tx * TILE + TILE / 2, by: cur.ty * TILE + 4,
          biteAt: this.tNow + 2 + Math.random() * 4, hooked: false, dip: 0,
        };
        this.player.swing = 1;
        this.player.facing = Math.sign(cur.wx - this.player.cx) || this.player.facing;
        Sound.play("place");
        this.flash("Line cast — wait for a bite");
      } else this.flash("Cast at water within reach");
    } else if (this.fishing.hooked) {
      this.catchFish();
    } else {
      this.fishing = null;
      this.flash("Reeled in — nothing yet");
    }
  }

  catchFish() {
    const n = 1 + (Math.random() < 0.25 ? 1 : 0);
    this.inventory.add("raw_fish", n);
    this.particles.float(this.player.cx, this.player.y - 6, `+${n} Raw Fish`, "#bfe6ff");
    this.particles.burst(this.fishing.bx, this.fishing.by, "#bfe6ff", 12, { speed: 120, life: 0.5 });
    Sound.play("trade");
    this.flash(`Caught ${n} fish!`);
    this.player.swing = 1;
    this.fishing = null;
  }

  eatSelected() {
    const s = this.inventory.selectedSlot();
    const def = ITEMS[s.item];
    // Raw food (negative heal) makes you sick — eat it anytime, but it hurts.
    if (def.heal < 0) {
      this.inventory.decrementSelected();
      this.player.hurt(-def.heal, 0, 0, { bypassIframes: true, useArmor: false });
      this.particles.float(this.player.cx, this.player.y - 4, `${def.heal}`, "#9fd86b");
      Sound.play("hurt");
      this.flash(`Ate ${def.name} raw (${def.heal} HP) — cook it!`);
      return;
    }
    const p = this.player;
    const bellyFull = p.maxFood == null || p.food >= p.maxFood;
    if (p.hp >= p.maxHp && bellyFull) { this.flash("Already full"); return; }
    p.hp = Math.min(p.maxHp, p.hp + def.heal);
    if (p.maxFood != null) p.food = Math.min(p.maxFood, p.food + def.heal); // food value mirrors heal
    this.inventory.decrementSelected();
    Sound.play("eat");
    this.flash(`Ate ${def.name} (+${def.heal})`);
  }

  // --- Guns & power-ups ---
  tryFire(def) {
    if (this.shootCd > 0) return;
    if (def.ammo && this.inventory.count(def.ammo) <= 0) {
      if (this._pickHintCd <= 0) { this.flash(`Out of ${ITEMS[def.ammo].name}`); this._pickHintCd = 1; }
      return;
    }
    if (def.ammo) this.inventory.remove(def.ammo, 1);
    this.shootCd = def.fireRate || 0.25;

    const ox = this.player.cx, oy = this.player.cy - 3;
    const w = this.renderer.screenToWorld(this.input.mouse.x, this.input.mouse.y);
    const baseAng = Math.atan2(w.y - oy, w.x - ox);
    this.player.facing = w.x >= ox ? 1 : -1;
    this.player.swing = 0.5;

    // Iron Man fires a homing-ish missile every 5th repulsor shot.
    let missile = false;
    if (def.repulsor) { this._repulsorShot = (this._repulsorShot || 0) + 1; missile = this._repulsorShot % 5 === 0; }

    const pellets = def.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const ang = baseAng + (Math.random() * 2 - 1) * (def.spread || 0);
      const spd = def.bulletSpeed || 520;
      this.projectiles.push(new Projectile(ox - 2, oy - 2, Math.cos(ang) * spd, Math.sin(ang) * spd, {
        damage: missile ? def.damage * 2.2 : def.damage,
        explosive: def.explosive || missile, blast: missile ? 3 : def.blast,
        color: missile ? "#ff8a3a" : def.bulletColor, glow: def.glow || missile,
        gravity: def.bulletGravity,
        pierce: def.pierce, spin: def.shield || def.batarang,
        w: def.shield ? 7 : missile ? 6 : 4, h: def.shield ? 7 : missile ? 6 : 4,
      }));
    }
    // Batman's belt puffs a smoke pellet at the throw point.
    if (def.batarang)
      this.particles.burst(ox, oy, "#9aa0ad", 10, { speed: 40, up: 20, life: 0.7, gravity: -30 });
    this.particles.burst(ox + this.player.facing * 6, oy, missile ? "#ff8a3a" : def.bulletColor || "#ffd86a", 4, { speed: 90, life: 0.18, glow: true });
    this.renderer.addShake(missile || def.explosive ? 4 : 1.2);
    Sound.play(def.glow ? "laser" : "shoot");
  }

  // --- WIZARD SPELLS ---
  // Cast the selected spell toward the cursor. `reach:"far"` spells reach the
  // whole screen; mana-gated and on a shared cast cooldown (this.shootCd).
  castSpell(def) {
    if (this.shootCd > 0) return;
    if (!this.player.spendMana(def.mana || 0)) {
      if (this._pickHintCd <= 0) { this.flash("Out of mana"); this._pickHintCd = 0.6; }
      return;
    }
    this.shootCd = def.cd || 0.3;
    const ox = this.player.cx, oy = this.player.cy - 3;
    const w = this.renderer.screenToWorld(this.input.mouse.x, this.input.mouse.y);
    this.player.facing = w.x >= ox ? 1 : -1;
    this.player.swing = 0.6;

    switch (def.spell) {
      case "firebolt":    this._spellBolt(def, ox, oy, w, { speed: 640, gravity: 0,  explosive: false }); break;
      case "fireball":    this._spellBolt(def, ox, oy, w, { speed: 470, gravity: 90, explosive: true, blast: def.blast }); break;
      case "frost":       this._spellBolt(def, ox, oy, w, { speed: 560, gravity: 0,  explosive: false, frost: true }); break;
      case "lightning":   this._spellLightning(def, w); break;
      case "water":       this._spellWater(def, w); break;
      case "meteor":      this._spellMeteor(def, w); break;
      case "telekinesis": this._spellTelekinesis(def, w); break;
      case "mindcontrol": this._spellMindControl(def, w); break;
      case "madness":     this._spellMadness(def, w); break;
      case "heal":        this._spellHeal(def); break;
    }
  }

  _spellBolt(def, ox, oy, w, o) {
    const ang = Math.atan2(w.y - oy, w.x - ox);
    const spd = o.speed;
    this.projectiles.push(new Projectile(ox - 3, oy - 3, Math.cos(ang) * spd, Math.sin(ang) * spd, {
      damage: def.damage, explosive: o.explosive, blast: o.blast || 3, frost: o.frost,
      color: def.color, glow: true, gravity: o.gravity, w: o.explosive ? 8 : 6, h: o.explosive ? 8 : 6, life: 2.2,
    }));
    this.particles.burst(ox + this.player.facing * 6, oy, def.color, 6, { speed: 90, life: 0.2, glow: true });
    this.renderer.addShake(o.explosive ? 4 : 1.2);
    Sound.play("laser");
  }

  // Unlimited-reach bolt: strikes the foe nearest the cursor and forks to others.
  _spellLightning(def, w) {
    const target = this._nearestEnemyTo(w.x, w.y, TILE * 4, true);
    if (!target) {
      this.bolts.push({ x: w.x, top: w.y - TILE * 22, y: w.y, life: 0.18 });
      this.particles.burst(w.x, w.y, def.color, 12, { speed: 160, life: 0.4, glow: true });
      this.renderer.addShake(3); Sound.play("laser"); return;
    }
    this.bolts.push({ x: target.cx, top: target.cy - TILE * 22, y: target.cy, life: 0.18 });
    target.hurt(def.damage, 0);
    this.particles.float(target.cx, target.y - 4, `${def.damage}`, "#bfe0ff");
    this.particles.burst(target.cx, target.cy, "#bfe0ff", 8, { speed: 160, life: 0.35, glow: true });
    const chainDmg = Math.round(def.damage * 0.6);
    for (const e of this.enemies) {
      if (e === target || e.dead || e.friendly) continue;
      if (Math.hypot(e.cx - target.cx, e.cy - target.cy) > TILE * 6) continue;
      e.hurt(chainDmg, Math.sign(e.cx - target.cx) * 100);
      this.bolts.push({ x: e.cx, top: e.cy - TILE * 22, y: e.cy, life: 0.18, chainFrom: { x: target.cx, y: target.cy } });
      this.particles.float(e.cx, e.y - 4, `${chainDmg}`, "#bfe0ff");
    }
    if (target.dead) Sound.play("slay");
    this.renderer.addShake(6); Sound.play("laser");
  }

  // Unlimited reach: a geyser of water erupts at the target, flinging foes back.
  _spellWater(def, w) {
    const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (this.world.get(x, y) === TILE_IDS.AIR) this.world.set(x, y, TILE_IDS.WATER);
    }
    for (const e of this.enemies) {
      if (e.dead || e.friendly) continue;
      if (Math.hypot(e.cx - w.x, e.cy - w.y) < TILE * 4) { e.hurt(def.damage, Math.sign(e.cx - w.x) * 280); e.vy -= 220; }
    }
    this.particles.burst(w.x, w.y, def.color, 22, { speed: 200, life: 0.6, glow: true });
    this.renderer.addShake(3); Sound.play("place");
  }

  // Unlimited reach: a volley of meteors rains down onto the target point.
  _spellMeteor(def, w) {
    for (let i = 0; i < 4; i++) {
      const sx = w.x + (Math.random() * 2 - 1) * TILE * 3;
      const sy = w.y - TILE * (15 + Math.random() * 7);
      const ang = Math.atan2(w.y - sy, w.x - sx) + (Math.random() * 2 - 1) * 0.12;
      const spd = 380;
      this.projectiles.push(new Projectile(sx, sy, Math.cos(ang) * spd, Math.sin(ang) * spd, {
        damage: def.damage, explosive: true, blast: def.blast || 3,
        color: def.color, glow: true, gravity: 220, w: 8, h: 8, life: 3,
      }));
    }
    this.flash("☄ Meteor Storm! ☄");
    this.renderer.addShake(5); Sound.play("explosion");
  }

  // Unlimited reach: rip nearby foes off their feet and hurl them away.
  _spellTelekinesis(def, w) {
    let hit = 0;
    const fling = (list, friendlyKey) => {
      for (const e of list) {
        if (e.dead || (friendlyKey && e.friendly) || e.boss) continue;
        if (Math.hypot(e.cx - w.x, e.cy - w.y) > TILE * 4) continue;
        const dir = Math.sign(e.cx - this.player.cx) || (Math.random() < 0.5 ? -1 : 1);
        e.hurt(def.damage, dir * 460); e.vy = -480;
        this.particles.burst(e.cx, e.cy, def.color, 10, { speed: 170, life: 0.5, glow: true });
        hit++;
      }
    };
    fling(this.enemies, true);
    fling(this.animals, false);
    this.particles.burst(w.x, w.y, def.color, 16, { speed: 150, life: 0.5, glow: true });
    this.renderer.addShake(4); Sound.play(hit ? "hit" : "power");
  }

  // Unlimited reach: seize a mind — an enemy becomes your thrall, or a townsperson
  // becomes a loyal bodyguard who fights at your side.
  _spellMindControl(def, w) {
    const e = this._nearestEnemyTo(w.x, w.y, TILE * 4, true);
    if (e && !e.boss) {
      e.friendly = true; e.charmGlow = 1;
      this.flash(`The ${e.kind} bows to your will!`);
      this.particles.burst(e.cx, e.cy, def.color, 20, { speed: 150, life: 0.8, glow: true });
      this.renderer.addShake(3); Sound.play("power"); return;
    }
    const v = this._nearestVillagerTo(w.x, w.y, TILE * 4);
    if (v) {
      v.charmed = true; v.rage = 0; v.charmGlow = 1;
      this.flash(`${v.name} is now your thrall!`);
      this.particles.burst(v.cx, v.cy, def.color, 20, { speed: 150, life: 0.8, glow: true });
      Sound.play("power"); return;
    }
    this.flash("No mind to seize there");
  }

  // Unlimited reach: drive a townsperson into a murderous frenzy against their neighbours.
  _spellMadness(def, w) {
    const v = this._nearestVillagerTo(w.x, w.y, TILE * 4);
    if (!v) { this.flash("No one to madden there"); return; }
    v.rage = 16; v.charmed = false; v.charmGlow = 1;
    this.flash(`${v.name} is seized by murderous rage!`);
    this.particles.burst(v.cx, v.cy, def.color, 20, { speed: 160, life: 0.8, glow: true });
    Sound.play("power");
  }

  _spellHeal(def) {
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + def.heal);
    this.player._noDamage = 0;
    this.particles.burst(this.player.cx, this.player.cy, def.color, 20, { speed: 130, life: 0.8, glow: true });
    this.particles.float(this.player.cx, this.player.y - 6, `+${def.heal}`, "#9affb0");
    Sound.play("power");
  }

  _nearestEnemyTo(wx, wy, maxDist, hostileOnly) {
    let best = null, bd = maxDist;
    for (const e of this.enemies) {
      if (e.dead || (hostileOnly && e.friendly)) continue;
      const d = Math.hypot(e.cx - wx, e.cy - wy);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  _nearestVillagerTo(wx, wy, maxDist) {
    let best = null, bd = maxDist;
    for (const v of this.villagers) {
      if (v.dead) continue;
      const d = Math.hypot(v.cx - wx, v.cy - wy);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  usePower(def) {
    if (def.special === "maxhp") {
      this.player.maxHp += def.amount;
      this.player.hp += def.amount;
      this.inventory.decrementSelected();
      Sound.play("power");
      this.flash(`Max HP +${def.amount}!  (${this.player.maxHp})`);
      this.particles.burst(this.player.cx, this.player.cy, def.color, 16, { speed: 130, life: 0.7, glow: true });
      return;
    }
    this.player.addBuff(def.buff, def.dur);
    this.inventory.decrementSelected();
    Sound.play("power");
    this.flash(`${def.name}!  (${def.dur}s)`);
    this.particles.burst(this.player.cx, this.player.cy, def.color, 18, { speed: 140, life: 0.8, glow: true });
  }

  // Iron Man suit: while held, refresh flight and trail jet thrust. The Flash
  // buff: lay down a red-lightning afterimage as the player blurs along.
  updateHeroSuits(dt) {
    const p = this.player;
    const sel = this.inventory.selectedSlot();
    if (sel && ITEMS[sel.item] && ITEMS[sel.item].suit === "ironman") {
      p.addBuff("fly", 0.25);
      if ((p.flying || p.hasBuff("fly")) && Math.abs(p.vy) > 8)
        this.particles.burst(p.cx, p.y + p.h, "#7fe9ff", 2, { speed: 60, up: -40, life: 0.3, glow: true });
    }
    if (p.hasBuff("flash") && (Math.abs(p.vx) > 30 || Math.abs(p.vy) > 30)) {
      this.particles.burst(p.cx, p.cy, "#ffd23a", 2, { speed: 30, life: 0.22, glow: true });
      if (Math.random() < 0.5)
        this.particles.burst(p.cx - Math.sign(p.vx) * 6, p.cy, "#d12a2a", 1, { speed: 10, life: 0.3 });
    }
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      p.update(this.world, dt);
      if (!p.dead) {
        for (const e of this.enemies) {
          if (e.dead || e.friendly || p.hitList.includes(e)) continue;
          if (this.aabbOverlap(p, e)) {
            e.hurt(p.damage, Math.sign(p.vx) * 150);
            this.particles.float(e.cx, e.y - 4, `${Math.round(p.damage)}`, "#ffe08a");
            this.particles.burst(p.cx, p.cy, "#4fb36b", 6, { speed: 90, life: 0.4 });
            Sound.play("hit");
            if (p.frost) { e.freeze = 2.6; this.particles.burst(e.cx, e.cy, "#bfeaff", 8, { speed: 70, life: 0.5, glow: true }); }
            if (e.dead) { this.particles.burst(e.cx, e.cy, "#4fb36b", 16, { speed: 150, life: 0.7 }); Sound.play("slay"); }
            p.hitList.push(e);
            if (p.pierce > 0) p.pierce--; else p.dead = true;
            break;
          }
        }
      }
      if (!p.dead) {
        for (const a of this.animals) {
          if (a.dead) continue;
          if (this.aabbOverlap(p, a)) {
            a.hurt(p.damage, Math.sign(p.vx) * 150);
            this.particles.float(a.cx, a.y - 4, `${Math.round(p.damage)}`, "#ffe08a");
            Sound.play("hit");
            if (a.dead) this.killAnimal(a);
            p.dead = true;
            break;
          }
        }
      }
      if (!p.dead) {
        for (const f of this.fish) {
          if (f.dead) continue;
          if (this.aabbOverlap(p, f)) {
            f.hurt(p.damage);
            if (f.dead) { this.spawnDrop(f.cx, f.cy, "raw_fish", 1); Sound.play("slay"); }
            p.dead = true;
            break;
          }
        }
      }
      if (p.dead) {
        if (p.explosive) this.explode(Math.floor(p.cx / TILE), Math.floor(p.cy / TILE), p.blast || 3);
        else this.particles.burst(p.cx, p.cy, p.color, 4, { speed: 70, life: 0.25, glow: p.glow });
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    if (this.projectiles.length > 200) this.projectiles.splice(0, this.projectiles.length - 200);
  }

  updateTnts(dt) {
    for (const t of this.tnts) {
      if (t.done) continue;
      t.fuse -= dt;
      if (Math.random() < dt * 14) {
        this.particles.spawn({
          x: t.tx * TILE + 4 + Math.random() * 8, y: t.ty * TILE + 2,
          vx: (Math.random() * 2 - 1) * 20, vy: -40 - Math.random() * 30,
          life: 0.4, size: 2, color: "#ffd86a", gravity: -10, glow: true,
        });
        Sound.play("fuse");
      }
      if (t.fuse <= 0) {
        t.done = true;
        if (this.world.get(t.tx, t.ty) === TILE_IDS.TNT) this.world.set(t.tx, t.ty, TILE_IDS.AIR);
        this.explode(t.tx, t.ty, 4);
      }
    }
    this.tnts = this.tnts.filter((t) => !t.done);
  }

  // Destroy mineable tiles in a radius, chain other TNT, and damage nearby
  // creatures (and you, unless invincible). Used by TNT and rockets/BFG.
  explode(ctx, cty, radius) {
    Sound.play("explosion");
    this.renderer.addShake(Math.min(14, 6 + radius));
    const cwx = ctx * TILE + TILE / 2, cwy = cty * TILE + TILE / 2;
    this.particles.burst(cwx, cwy, "#ffce6a", 30, { speed: 220, life: 0.6, glow: true });
    this.particles.burst(cwx, cwy, "#7a3a20", 18, { speed: 140, life: 0.8, gravity: 400 });

    for (let y = cty - radius; y <= cty + radius; y++) {
      for (let x = ctx - radius; x <= ctx + radius; x++) {
        if (Math.hypot(x - ctx, y - cty) > radius) continue;
        const id = this.world.get(x, y);
        if (id === TILE_IDS.AIR) { if (this.world.wallAt(x, y)) this.world.setWall(x, y, 0); continue; }
        if (id === TILE_IDS.TNT) { this.primeTnt(x, y, 0.06); continue; } // chain reaction
        const def = tileDef(id);
        if (!def.mineable) continue;
        this.world.set(x, y, TILE_IDS.AIR);
        const drop = TILE_DROPS[id];
        if (drop && Math.random() < 0.35) this.spawnDrop(x * TILE + TILE / 2, y * TILE + TILE / 2, drop, 1);
      }
    }

    const rpx = radius * TILE;
    for (const e of this.enemies) {
      if (e.dead || e.friendly) continue;
      const d = Math.hypot(e.cx - cwx, e.cy - cwy);
      if (d <= rpx) { e.hurt(70, Math.sign(e.cx - cwx) * 220); if (e.dead) Sound.play("slay"); }
    }
    for (const v of this.villagers) {
      if (Math.hypot(v.cx - cwx, v.cy - cwy) <= rpx) v.hurt(60);
    }
    for (const a of this.animals) {
      if (a.dead) continue;
      if (Math.hypot(a.cx - cwx, a.cy - cwy) <= rpx) { a.hurt(80, Math.sign(a.cx - cwx) * 200); if (a.dead) this.killAnimal(a); }
    }
    for (const f of this.fish) {
      if (!f.dead && Math.hypot(f.cx - cwx, f.cy - cwy) <= rpx) { f.hurt(80); if (f.dead) this.spawnDrop(f.cx, f.cy, "raw_fish", 1); }
    }
    const pd = Math.hypot(this.player.cx - cwx, this.player.cy - cwy);
    if (pd <= rpx + 6) {
      const dir = Math.sign(this.player.cx - cwx) || 1;
      const dmg = Math.round(45 * (1 - pd / (rpx + 6)) + 10);
      if (this.player.hurt(dmg, dir * 240, -200, { bypassIframes: true })) {
        this.particles.float(this.player.cx, this.player.y - 4, `-${dmg}`, "#ff7a7a");
        Sound.play("hurt");
      }
    }
  }

  primeTnt(tx, ty, fuse = 1.4) {
    if (this.tnts.some((t) => t.tx === tx && t.ty === ty)) return;
    this.tnts.push({ tx, ty, fuse });
  }

  spawnDrop(px, py, item, count) {
    this.drops.push(new DroppedItem(px - 4, py - 4, item, count));
  }

  // Toss the selected item out in front of the player so it can be picked back
  // up (durability and counts are preserved). Shift drops the whole stack.
  dropSelected(all) {
    const i = this.inventory.selected;
    const s = this.inventory.slots[i];
    if (!s) return;
    const n = all ? s.count : 1;
    const dir = this.player.facing || 1;
    const d = new DroppedItem(this.player.cx - 4, this.player.cy - 10, s.item, n);
    d.vx = dir * 150; d.vy = -130; d.age = -0.7; // delay magnet so it actually flies away
    if (s.dur != null) d.dur = s.dur;
    this.drops.push(d);
    s.count -= n;
    if (s.count <= 0) this.inventory.slots[i] = null;
    Sound.play("pickup");
  }

  // Chip away at the selected tool/weapon's durability; it shatters at 0.
  damageSelectedTool(amount = 1) {
    if (this.creative) return;
    const i = this.inventory.selected;
    const s = this.inventory.slots[i];
    if (!s) return;
    const def = ITEMS[s.item];
    if (!def || !def.dur) return; // unbreakable (legendary) or not a tool/weapon
    if (s.dur == null) s.dur = def.dur;
    s.dur -= amount;
    if (s.dur <= 0) {
      this.inventory.slots[i] = null;
      Sound.play("break");
      this.flash(`${def.name} broke!`);
      this.particles.burst(this.player.cx, this.player.cy - 8, def.color, 12, { speed: 100, life: 0.5 });
    }
  }

  breakTile(tx, ty, id) {
    if (id === TILE_IDS.TV) delete this.tvUrls[tx + "," + ty];
    if (id === TILE_IDS.CHEST) this.spillChest(tx, ty);
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

  // Breaking a chest tosses everything it held out into the world, then forgets it.
  spillChest(tx, ty) {
    const key = tx + "," + ty;
    const chest = this.chests[key];
    if (chest) {
      const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
      for (const s of chest.slots) if (s) this.spawnDrop(cx, cy, s.item, s.count);
      delete this.chests[key];
    }
    if (this.openChest && this.openChest.key === key) this.closeMenus();
  }

  breakWall(tx, ty, wallId) {
    this.world.setWall(tx, ty, 0);
    const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
    const def = wallDef(wallId);
    this.particles.burst(cx, cy, def ? def.color : "#444", 8, { speed: 80, life: 0.4, gravity: 600 });
    Sound.play("break");
    const drop = WALL_DROPS[wallId];
    if (drop) this.spawnDrop(cx, cy, drop, 1);
  }

  placeBlock(tx, ty) {
    const s = this.inventory.selectedSlot();
    if (!s) return;
    const def = ITEMS[s.item];
    if (!def) return;
    // Creative mode never depletes the stack you build with.
    const consume = () => this.creative || this.inventory.consumeSelected();

    // Background walls go in their own layer behind the foreground.
    if (def.kind === "wall") {
      if (this.world.wallAt(tx, ty) !== 0) return; // already a wall here
      if (consume()) {
        this.world.setWall(tx, ty, def.wall);
        this.particles.burst(tx * TILE + TILE / 2, ty * TILE + TILE / 2, def.color || "#fff", 5, { speed: 40, life: 0.3 });
        Sound.play("place");
      }
      return;
    }

    if (def.kind !== "block") return;
    if (this.world.get(tx, ty) !== TILE_IDS.AIR) return;
    if (tileDef(def.tile).solid && this.overlapsPlayer(tx, ty)) return;
    if (consume()) {
      this.world.set(tx, ty, def.tile);
      this.particles.burst(tx * TILE + TILE / 2, ty * TILE + TILE / 2, def.color || "#fff", 6, { speed: 50, life: 0.3 });
      Sound.play("place");
      // Placing TNT lights its fuse — stand back!
      if (def.tile === TILE_IDS.TNT) this.primeTnt(tx, ty, 1.4);
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
    r.drawProjectiles(this.projectiles);
    r.drawProjectiles(this.enemyShots);
    for (const e of this.enemies) {
      if (e.friendly || e.freeze > 0) r.drawEnemyAura(e);
      if (e.kind === "zombie") r.drawZombie(e);
      else if (e.kind === "skeleton") r.drawSkeleton(e);
      else if (e.kind === "boss") r.drawBoss(e);
      else if (e.kind === "dragon") r.drawDragon(e);
      else r.drawSlime(e);
    }
    r.drawFires(this.fires, t);
    r.drawLightning(this.bolts);
    for (const a of this.animals) r.drawAnimal(a);
    for (const f of this.fish) r.drawFish(f);
    for (const v of this.villagers) r.drawVillager(v);
    r.drawPlayer(this.player, this.inventory.selectedSlot(), this.inventory.armor);
    if (this.fishing) r.drawFishingLine(this.player, this.fishing);
    r.drawParticles(this.particles);
    r.drawWeather(this.world, this.time, t); // ambient biome motes over the scene
    r.drawLightOverlay(this.world); // smooth dark veil
    r.drawGlow(t);                  // warm glow over the veil
    r.drawCritters(this.critters.list); // ambient wildlife, over the veil so fireflies glow
    if (this.ui === "play") {
      if (this.mining.tile) r.drawMiningOverlay(this.mining.tile, this.mining.progress);
      if (this.hoverTile) r.drawCursor(this.hoverTile, this.hoverTile.inReach);
    }
    r.drawFloatingTexts(this.particles); // damage/pickup numbers, readable over the veil
    r.endShake();

    const biome = this.biomeAtX(Math.floor(this.player.cx / TILE));
    r.drawWeatherFx(this.weather, t, biome); // gloom / fog / rain|snow|sand / lightning
    r.drawBiomeTint(biome, this.renderer.daylight(this.time)); // subtle per-biome color wash
    r.drawNightVignette(this.time);
    r.drawLowHealth(this.player);
    r.drawDizzy(this.player);
    r.drawStim(this.player);
    r.drawHotbar(this.inventory);
    // Name of the just-switched item, hovering over the hotbar (fades out at the end).
    if (this.itemPopup) {
      const left = this.itemPopup.until - performance.now();
      if (left > 0) r.drawItemSwitch(this.itemPopup.text, Math.min(1, left / 350));
      else this.itemPopup = null;
    }
    r.drawHealth(this.player);
    r.drawHunger(this.player);
    r.drawMana(this.player);
    r.drawBuffs(this.player);
    // Only raise the boss bar once the player is actually down in the lair with him.
    if (this.boss && !this.boss.dead && Math.abs(this.player.cx - this.boss.cx) < TILE * 42)
      r.drawBossBar(this.boss);
    // Airborne dragon gets its own bar (stacks below the Warden's if both are up).
    const dragon = this.enemies.find((e) => e.kind === "dragon" && !e.dead);
    if (dragon && Math.abs(this.player.cx - dragon.cx) < TILE * 40)
      r.drawBossBar(dragon, this.boss && !this.boss.dead ? 1 : 0);

    if (this.ui === "play") r.drawPauseButton(this.input.mouse);
    else if (this.ui === "pause") r.drawPause(this.input.mouse);
    if (this.ui === "inv") r.drawInventory(this.inventory, {
      recipes: this.filteredRecipes(),
      creativeItems: this.creative ? this.filteredCreative() : null,
      stationAvailable: (st) => this.stationNear(st),
      mouse: this.input.mouse,
      scroll: this.craftScroll,
      tab: this.craftTab,
      search: this.craftSearch,
      searchFocused: this.searchFocused,
    });
    else if (this.ui === "chest" && this.openChest) r.drawChest(this.inventory, this.openChest.chest, this.input.mouse);
    else if (this.ui === "trade" && this.tradeVillager) r.drawTrade(this.tradeVillager, this.inventory, this.input.mouse);

    if (this.toastMsg && performance.now() < this.toastUntil) r.toast(this.toastMsg);

    this._frames++; this._fpsTime += dt;
    if (this._fpsTime >= 0.5) { this._fps = Math.round(this._frames / this._fpsTime); this._frames = 0; this._fpsTime = 0; }
    if (this.showDebug) {
      const p = this.player, hour = Math.floor(this.time * 24);
      r.drawDebug([
        `FPS: ${this._fps}   world: "${this.worldName}" (${this.mode})`,
        `pos: ${(p.x / TILE).toFixed(1)}, ${(p.y / TILE).toFixed(1)}  hp: ${p.hp.toFixed(0)}/${p.maxHp}  def: ${p.defense || 0}`,
        `onGround: ${p.onGround}  drops: ${this.drops.length}`,
        `time: ${String(hour).padStart(2, "0")}:00  slimes: ${this.enemies.length}  villagers: ${this.villagers.length}`,
        `animals: ${this.animals.length}  fish: ${this.fish.length}  fishing: ${this.fishing ? (this.fishing.hooked ? "BITE!" : "cast") : "no"}`,
        `workbench: ${this.stationNear("workbench")}  furnace: ${this.stationNear("furnace")}`,
        `weather: ${this.weather.kind} ${this.weather.intensity.toFixed(2)}  critters: ${this.critters.list.length}`,
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
