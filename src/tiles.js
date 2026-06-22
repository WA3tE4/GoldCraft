// Data-driven registries for tiles, items, and crafting.
// To add a new block: add a TILES entry + (optionally) an ITEMS entry + a drop.

// Numeric ids are stored in the world grid and the save file — keep them STABLE.
export const TILE_IDS = {
  AIR: 0,
  DIRT: 1,
  GRASS: 2,
  STONE: 3,
  WOOD: 4,
  LEAVES: 5,
  SAND: 6,
  COAL_ORE: 7,
  IRON_ORE: 8,
  GOLD_ORE: 9,
  DIAMOND_ORE: 10,
  WATER: 11,
  LAVA: 12,
  PLANK: 13,
  GLASS: 14,
  TORCH: 15,
  WORKBENCH: 16,
  FURNACE: 17,
  LANTERN: 18,
  LADDER: 19,
  TNT: 20,
  GLOWSTONE: 21,
  BRICK: 22,
  CLOUD: 23,
  CROP: 24,
  BANNER: 25,
  TV: 26,
  // --- flora & biome blocks (gatherable world detail) ---
  TALL_GRASS: 27,  // wispy grass tufts, drop plant fiber
  FLOWER: 28,      // colorful blooms, drop a flower
  BERRY_BUSH: 29,  // shrubs heavy with berries
  MUSHROOM: 30,    // cave & forest-floor mushrooms
  CACTUS: 31,      // desert column, prickly
  VINE: 32,        // hanging climbable vines
  SNOW: 33,        // tundra surface cap
  ICE: 34,         // frozen ponds, slick blue
  PUMPKIN: 35,     // autumn gourd, bakes into pie
};

// Background wall ids, stored in a separate grid from foreground tiles.
// Walls don't collide and don't block the sky — they give an enclosed space a
// proper "indoors" backdrop (instead of pitch-black cave) and a dim ambient floor.
export const WALL_IDS = {
  NONE: 0,
  WOOD: 1,
  STONE: 2,
  DIRT: 3,
};
export const WALLS = {
  [WALL_IDS.WOOD]:  { name: "Wood Wall",  color: "#4a371f", item: "wood_wall" },
  [WALL_IDS.STONE]: { name: "Stone Wall", color: "#34383f", item: "stone_wall" },
  [WALL_IDS.DIRT]:  { name: "Dirt Wall",  color: "#3a2817", item: "dirt_wall" },
};
export function wallDef(id) { return WALLS[id] || null; }

// Tile fields:
//   solid     – blocks movement / collides
//   hardness  – base seconds to mine bare-handed (scaled by tool power)
//   color     – base fill (per-tile noise/shading added at render time)
//   mineable  – can be broken
//   needsPick – requires a pickaxe to break (gates progression)
//   emissive  – light emitted (0..15); lava/torch/furnace glow
//   liquid    – rendered translucent + animated, does not collide
//   ore       – render stone base with colored mineral flecks (oreColor)
const T = TILE_IDS;
export const TILES = {
  [T.AIR]:     { name: "Air",     solid: false, hardness: 0,   color: null,      mineable: false },
  [T.DIRT]:    { name: "Dirt",    solid: true,  hardness: 0.5, color: "#6b4a2b", mineable: true },
  [T.GRASS]:   { name: "Grass",   solid: true,  hardness: 0.5, color: "#4a8b3b", mineable: true },
  [T.STONE]:   { name: "Stone",   solid: true,  hardness: 1.4, color: "#6c727f", mineable: true, needsPick: true },
  [T.WOOD]:    { name: "Wood",    solid: true,  hardness: 0.9, color: "#7a5a36", mineable: true },
  [T.LEAVES]:  { name: "Leaves",  solid: false, hardness: 0.2, color: "#3f7a39", mineable: true },
  [T.SAND]:    { name: "Sand",    solid: true,  hardness: 0.4, color: "#d9c27a", mineable: true },
  [T.COAL_ORE]:    { name: "Coal Ore",    solid: true, hardness: 1.6, color: "#6c727f", mineable: true, needsPick: true, ore: true, oreColor: "#26282e" },
  [T.IRON_ORE]:    { name: "Iron Ore",    solid: true, hardness: 2.0, color: "#6c727f", mineable: true, needsPick: true, ore: true, oreColor: "#c8a98c" },
  [T.GOLD_ORE]:    { name: "Gold Ore",    solid: true, hardness: 2.4, color: "#6c727f", mineable: true, needsPick: true, ore: true, oreColor: "#f2c84b" },
  [T.DIAMOND_ORE]: { name: "Diamond Ore", solid: true, hardness: 3.2, color: "#6c727f", mineable: true, needsPick: true, ore: true, oreColor: "#74e0e6" },
  [T.WATER]:   { name: "Water",   solid: false, hardness: 0,   color: "#2a6fdb", mineable: false, liquid: true },
  [T.LAVA]:    { name: "Lava",    solid: false, hardness: 0,   color: "#e2581f", mineable: false, liquid: true, emissive: 13 },
  [T.PLANK]:   { name: "Plank",   solid: true,  hardness: 0.8, color: "#b1814e", mineable: true },
  [T.GLASS]:   { name: "Glass",   solid: true,  hardness: 0.4, color: "#bfe6f0", mineable: true, glass: true },
  [T.TORCH]:   { name: "Torch",   solid: false, hardness: 0.1, color: "#ffb24d", mineable: true, emissive: 14 },
  [T.WORKBENCH]:{ name: "Workbench", solid: true, hardness: 0.8, color: "#9a6b3c", mineable: true },
  [T.FURNACE]: { name: "Furnace", solid: true,  hardness: 1.8, color: "#5a5048", mineable: true, needsPick: true, emissive: 9 },
  [T.LANTERN]: { name: "Lantern", solid: false, hardness: 0.2, color: "#ffd98a", mineable: true, emissive: 15 },
  [T.LADDER]:    { name: "Ladder",    solid: false, hardness: 0.3, color: "#8a6a34", mineable: true, climbable: true },
  [T.TNT]:       { name: "TNT",       solid: true,  hardness: 0.4, color: "#c0392b", mineable: true },
  [T.GLOWSTONE]: { name: "Glowstone", solid: true,  hardness: 0.9, color: "#f6d873", mineable: true, emissive: 14 },
  [T.BRICK]:     { name: "Brick",     solid: true,  hardness: 1.6, color: "#9a4a38", mineable: true, needsPick: true },
  [T.CLOUD]:     { name: "Cloud",     solid: true,  hardness: 0.2, color: "#eef3ff", mineable: true },
  [T.CROP]:      { name: "Crop",      solid: false, hardness: 0.2, color: "#7aa83c", mineable: true },
  [T.BANNER]:    { name: "Banner",    solid: false, hardness: 0.3, color: "#b03030", mineable: true },
  [T.TV]:        { name: "Television", solid: true,  hardness: 0.8, color: "#1b1f2a", mineable: true, emissive: 6 },
  // flora: see-through, soft to break by hand, gathered for food & materials
  [T.TALL_GRASS]: { name: "Tall Grass", solid: false, hardness: 0.15, color: "#4a8b3b", mineable: true },
  [T.FLOWER]:     { name: "Flower",     solid: false, hardness: 0.15, color: "#e85d9c", mineable: true },
  [T.BERRY_BUSH]: { name: "Berry Bush", solid: false, hardness: 0.3,  color: "#2f6b34", mineable: true },
  [T.MUSHROOM]:   { name: "Mushroom",   solid: false, hardness: 0.2,  color: "#d6604a", mineable: true, emissive: 3 },
  [T.CACTUS]:     { name: "Cactus",     solid: true,  hardness: 0.6,  color: "#4f8a3a", mineable: true },
  [T.VINE]:       { name: "Vine",       solid: false, hardness: 0.2,  color: "#3f7a39", mineable: true, climbable: true },
  [T.SNOW]:       { name: "Snow",       solid: true,  hardness: 0.4,  color: "#e8f0f7", mineable: true },
  [T.ICE]:        { name: "Ice",        solid: true,  hardness: 0.5,  color: "#9fcfe6", mineable: true, glass: true },
  [T.PUMPKIN]:    { name: "Pumpkin",    solid: true,  hardness: 0.6,  color: "#d97a26", mineable: true },
};

export function isClimbable(id) { return !!tileDef(id).climbable; }

export function tileDef(id) { return TILES[id] || TILES[T.AIR]; }
export function isSolid(id) { return tileDef(id).solid; }
export function isOpaque(id) { return tileDef(id).solid; }
export function emissionOf(id) { return tileDef(id).emissive || 0; }

// Item kinds:
//   tool   – mines blocks (power = speed); pickaxes also unlock `needsPick` tiles
//   weapon – melee damage to enemies
//   armor  – equippable (slot head/body/legs), adds defense
//   block  – places a tile (foreground grid)
//   wall   – places a background wall (wall grid; doesn't collide)
//   food   – consumed to restore health (heal)
//   material – crafting ingredient
// `glyph` is a one-char label drawn over non-emoji icons.
export const ITEMS = {
  // tools (dur = durability; sturdier the better the material)
  wood_pickaxe:  { name: "Wood Pickaxe",  kind: "tool", power: 4.0,  color: "#8a6b3c", icon: "⛏", dur: 90,  rarity: "common" },
  stone_pickaxe: { name: "Stone Pickaxe", kind: "tool", power: 6.5,  color: "#9aa0ad", icon: "⛏", dur: 200, rarity: "common" },
  iron_pickaxe:  { name: "Iron Pickaxe",  kind: "tool", power: 9.5,  color: "#e6ede9", icon: "⛏", dur: 450, rarity: "uncommon" },

  // weapons (dur scales with rarity; legendaries never break)
  wood_sword:  { name: "Wood Sword",  kind: "weapon", damage: 8,  color: "#8a6b3c", glyph: "/", dur: 80,  rarity: "common" },
  stone_sword: { name: "Stone Sword", kind: "weapon", damage: 13, color: "#9aa0ad", glyph: "/", dur: 160, rarity: "common" },
  iron_sword:  { name: "Iron Sword",  kind: "weapon", damage: 20, color: "#e6ede9", glyph: "/", dur: 320, rarity: "uncommon" },
  gold_sword:  { name: "Gold Sword",  kind: "weapon", damage: 28, color: "#f7d35e", glyph: "/", dur: 260, rarity: "rare" },
  diamond_sword: { name: "Diamond Sword", kind: "weapon", damage: 40, color: "#74e0e6", glyph: "/", dur: 700, rarity: "epic" },
  excalibur:   { name: "Excalibur",   kind: "weapon", damage: 75, color: "#fff3b0", glyph: "/", glow: true, rarity: "legendary" },
  mjolnir:     { name: "Mjölnir",     kind: "weapon", damage: 65, color: "#aebfd0", glyph: "T", glow: true, lightning: true, rarity: "legendary" },

  // magic wands & staves (kind:"gun" — reuse the firing system; ammo:null = infinite)
  arcane_wand:  { name: "Arcane Wand",   kind: "gun", damage: 22, fireRate: 0.16, bulletSpeed: 700, spread: 0.02, ammo: null, bulletColor: "#c08cff", glow: true, wand: true },
  inferno_staff:{ name: "Inferno Staff", kind: "gun", damage: 30, fireRate: 0.5,  bulletSpeed: 480, spread: 0.04, ammo: null, bulletColor: "#ff7a2a", glow: true, explosive: true, blast: 2, bulletGravity: 60, wand: true },

  // ----- SUPERHERO GEAR -----
  // Marvel/DC legendary kit. Shield & belt & repulsor are kind:"gun" (left-click
  // throws/fires toward the cursor); the Iron Man suit also grants flight and
  // re-skins the player while held. The Flash suit is a kind:"power" buff.
  cap_shield:    { name: "Captain America's Shield", kind: "gun", damage: 46, fireRate: 0.55, bulletSpeed: 640, spread: 0, ammo: null, bulletColor: "#cfd8e6", glow: true, pierce: 5, shield: true, rarity: "legendary" },
  bat_belt:      { name: "Batman's Utility Belt",    kind: "gun", damage: 24, fireRate: 0.42, bulletSpeed: 560, spread: 0.10, ammo: null, bulletColor: "#2b2f3a", pellets: 3, bulletGravity: 90, batarang: true, rarity: "epic" },
  ironman_armor: { name: "Iron Man's Armor",         kind: "gun", damage: 32, fireRate: 0.16, bulletSpeed: 760, spread: 0.015, ammo: null, bulletColor: "#7fe9ff", glow: true, repulsor: true, suit: "ironman", rarity: "legendary" },
  flash_suit:    { name: "The Flash's Suit",         kind: "power", buff: "flash", dur: 30, color: "#d12a2a", icon: "⚡", glow: true, rarity: "legendary" },

  // ----- WIZARD SPELLS (kind:"spell") -----
  // Left-click casts toward the cursor, spending mana (no ammo). `reach:"far"`
  // spells ignore the normal block-reach limit — point anywhere on screen.
  // `spell` names the effect handled in game.castSpell().
  fire_bolt:    { name: "Fire Bolt",       kind: "spell", spell: "firebolt",   mana: 6,  cd: 0.18, damage: 24, color: "#ff7a2a", icon: "🔥", glow: true },
  fireball:     { name: "Fireball",        kind: "spell", spell: "fireball",   mana: 16, cd: 0.7,  damage: 40, color: "#ff5a1a", icon: "☄", glow: true, blast: 3 },
  frost_shard:  { name: "Frost Shard",     kind: "spell", spell: "frost",      mana: 9,  cd: 0.28, damage: 18, color: "#9fe0ff", icon: "❄", glow: true },
  chain_lightning: { name: "Chain Lightning", kind: "spell", spell: "lightning", mana: 14, cd: 0.45, damage: 38, color: "#bfe0ff", icon: "⚡", glow: true, reach: "far" },
  water_surge:  { name: "Water Surge",     kind: "spell", spell: "water",      mana: 8,  cd: 0.5,  damage: 8,  color: "#3a8fe0", icon: "🌊", glow: true, reach: "far" },
  meteor_storm: { name: "Meteor Storm",    kind: "spell", spell: "meteor",     mana: 30, cd: 1.4,  damage: 55, color: "#ff8a3a", icon: "🌠", glow: true, reach: "far", blast: 3 },
  telekinesis:  { name: "Telekinesis",     kind: "spell", spell: "telekinesis", mana: 12, cd: 0.6, damage: 14, color: "#c9b6ff", icon: "✋", glow: true, reach: "far" },
  mind_control: { name: "Mind Control",    kind: "spell", spell: "mindcontrol", mana: 35, cd: 1.0, color: "#a855f7", icon: "🌀", glow: true, reach: "far" },
  incite_madness: { name: "Incite Madness", kind: "spell", spell: "madness",   mana: 28, cd: 1.0, color: "#e0398a", icon: "😈", glow: true, reach: "far" },
  heal_spell:   { name: "Healing Light",   kind: "spell", spell: "heal",       mana: 22, cd: 0.8, heal: 45, color: "#9affb0", icon: "✚", glow: true },

  // guns (kind:"gun") — left-click fires a bullet toward the cursor, spending ammo.
  //   damage, fireRate (s between shots), bulletSpeed, spread (rad), ammo (item key),
  //   bulletColor, bulletGravity, explosive, pellets (shotgun)
  pistol:    { name: "Pistol",          kind: "gun", damage: 14, fireRate: 0.28, bulletSpeed: 560, spread: 0.03, ammo: "bullet",  bulletColor: "#ffe07a", icon: "🔫" },
  shotgun:   { name: "Shotgun",         kind: "gun", damage: 9,  fireRate: 0.7,  bulletSpeed: 520, spread: 0.22, ammo: "bullet",  pellets: 6, bulletColor: "#ffd06a", icon: "🔫" },
  rifle:     { name: "Rifle",           kind: "gun", damage: 34, fireRate: 0.5,  bulletSpeed: 760, spread: 0.012, ammo: "bullet", bulletColor: "#fff0a0", icon: "🔫" },
  minigun:   { name: "Minigun",         kind: "gun", damage: 11, fireRate: 0.06, bulletSpeed: 700, spread: 0.09, ammo: "bullet",  bulletColor: "#ffe07a", icon: "🔫" },
  rocket_launcher: { name: "Rocket Launcher", kind: "gun", damage: 30, fireRate: 1.0, bulletSpeed: 360, spread: 0.01, ammo: "rocket", bulletColor: "#ff8a3a", bulletGravity: 120, explosive: true, blast: 3, icon: "🚀" },
  ray_gun:   { name: "Ray Gun",         kind: "gun", damage: 26, fireRate: 0.12, bulletSpeed: 900, spread: 0.02, ammo: null, bulletColor: "#8affd6", glow: true, icon: "🔫" },
  bfg:       { name: "BFG 9000",        kind: "gun", damage: 90, fireRate: 1.2,  bulletSpeed: 420, spread: 0, ammo: "cell", bulletColor: "#b07aff", glow: true, explosive: true, blast: 5, icon: "🔫" },

  // power-ups (kind:"power") — right-click to drink/use. Timed `buff` for `dur`
  // seconds, or an instant `special` effect.
  speed_potion:   { name: "Swift Potion",     kind: "power", buff: "speed",    dur: 25, color: "#67e8f9", icon: "🧪" },
  jump_potion:    { name: "Bounce Potion",    kind: "power", buff: "jump",     dur: 25, color: "#a3e635", icon: "🧪" },
  feather_potion: { name: "Feather Fall",     kind: "power", buff: "feather",  dur: 35, color: "#e2e8f0", icon: "🪶" },
  regen_potion:   { name: "Regen Potion",     kind: "power", buff: "regen",    dur: 20, color: "#f472b6", icon: "🧪" },
  strength_potion:{ name: "Berserk Potion",   kind: "power", buff: "strength", dur: 25, color: "#ef4444", icon: "🧪" },
  haste_potion:   { name: "Miner's Haste",    kind: "power", buff: "haste",    dur: 30, color: "#fbbf24", icon: "🧪" },
  god_star:       { name: "Invincibility Star", kind: "power", buff: "god",    dur: 15, color: "#fde047", icon: "⭐", glow: true },
  angel_wings:    { name: "Angel Wings",      kind: "power", buff: "fly",      dur: 30, color: "#f8fafc", icon: "🪽", glow: true },
  rocket_boots:   { name: "Rocket Boots",     kind: "power", buff: "fly",      dur: 20, color: "#fb923c", icon: "🚀" },
  boat:           { name: "Boat",             kind: "power", buff: "boat",     dur: 45, color: "#b5793f", icon: "⛵" },
  heart_container:{ name: "Heart Container",  kind: "power", special: "maxhp", amount: 20, color: "#ef4444", icon: "❤", glow: true },
  godhood:        { name: "Godhood Elixir",   kind: "power", buff: "godhood",  dur: 40, color: "#fff3b0", icon: "✨", glow: true },

  // vices (kind:"power") — right-click to indulge. All grant an "intoxicated"
  // buff: a dizzy visual wobble and +5% attack damage (see DRUNK_DAMAGE_MULT).
  // Tradeable/sellable like any other item.
  beer:       { name: "Beer",       kind: "power", buff: "drunk",  dur: 30, color: "#e0a52a", icon: "🍺" },
  wine:       { name: "Wine",       kind: "power", buff: "drunk",  dur: 40, color: "#7a1f3d", icon: "🍷" },
  whiskey:    { name: "Whiskey",    kind: "power", buff: "drunk",  dur: 55, color: "#b5651d", icon: "🥃" },
  cigarette:  { name: "Cigarette",  kind: "power", buff: "buzzed", dur: 20, color: "#e8e0d0", icon: "🚬" },
  cigar:      { name: "Cigar",      kind: "power", buff: "buzzed", dur: 35, color: "#6b4423", icon: "🚬" },
  weed:       { name: "Weed",       kind: "power", buff: "high",   dur: 45, color: "#3f7a39", icon: "🌿" },

  // hard stimulants (kind:"power") — snort/smoke for a short, intense rush:
  // big speed, faster swings, more damage, plus a jittery screen overlay.
  cocaine:    { name: "Cocaine",    kind: "power", buff: "wired",   dur: 25, color: "#f4f8ff", icon: "❄" },
  crack:      { name: "Crack",      kind: "power", buff: "cracked", dur: 14, color: "#e8d6b0", icon: "💎", glow: true },

  // armor (slot: head/body/legs, defense reduces incoming damage)
  iron_helmet: { name: "Iron Helmet", kind: "armor", slot: "head", defense: 2, color: "#dfe6e0", glyph: "▲" },
  iron_chest:  { name: "Iron Chest",  kind: "armor", slot: "body", defense: 4, color: "#dfe6e0", glyph: "■" },
  iron_legs:   { name: "Iron Greaves",kind: "armor", slot: "legs", defense: 2, color: "#dfe6e0", glyph: "Ⅱ" },
  gold_helmet: { name: "Gold Helmet", kind: "armor", slot: "head", defense: 3, color: "#f7d35e", glyph: "▲" },
  gold_chest:  { name: "Gold Chest",  kind: "armor", slot: "body", defense: 6, color: "#f7d35e", glyph: "■" },
  gold_legs:   { name: "Gold Greaves",kind: "armor", slot: "legs", defense: 3, color: "#f7d35e", glyph: "Ⅱ" },

  // tools (special): fishing rod — left-click at water to cast/reel/catch.
  fishing_pole: { name: "Fishing Pole", kind: "fishing", color: "#9a6b3c", icon: "🎣" },

  // food
  apple:        { name: "Apple",        kind: "food", heal: 15,  color: "#d83a3a", glyph: "•" },
  bread:        { name: "Bread",        kind: "food", heal: 35,  color: "#c79a4e", glyph: "▬" },
  golden_apple: { name: "Golden Apple", kind: "food", heal: 100, color: "#f7d35e", glyph: "•" },
  egg:          { name: "Egg",          kind: "food", heal: 6,   color: "#f3e7c8", glyph: "○" },
  wheat:        { name: "Wheat",        kind: "material", color: "#e3c16a", glyph: "ψ" },
  // foraged foods (edible raw, or cooked up into hearty meals)
  berries:      { name: "Berries",      kind: "food", heal: 10,  color: "#c0224a", glyph: "•" },
  mushroom_food:{ name: "Mushroom",     kind: "food", heal: 8,   color: "#d6604a", icon: "🍄" },
  mushroom_stew:{ name: "Mushroom Stew",kind: "food", heal: 45,  color: "#b5723a", icon: "🍲" },
  pumpkin_pie:  { name: "Pumpkin Pie",  kind: "food", heal: 70,  color: "#e0962f", icon: "🥧" },
  // raw foods have NEGATIVE heal: eating them raw costs health (cook them first!).
  raw_fish:     { name: "Raw Fish",     kind: "food", heal: -6,  color: "#9fd8e6", icon: "🐟" },
  cooked_fish:  { name: "Cooked Fish",  kind: "food", heal: 24,  color: "#e0a86a", icon: "🍣" },
  raw_beef:     { name: "Raw Beef",     kind: "food", heal: -8,  color: "#c46a6a", glyph: "≈" },
  cooked_beef:  { name: "Steak",        kind: "food", heal: 42,  color: "#7a4a2c", glyph: "≈" },
  raw_pork:     { name: "Raw Pork",     kind: "food", heal: -8,  color: "#e0a0aa", glyph: "≈" },
  cooked_pork:  { name: "Cooked Pork",  kind: "food", heal: 38,  color: "#caa06a", glyph: "≈" },
  raw_chicken:  { name: "Raw Chicken",  kind: "food", heal: -7,  color: "#e8cfa0", glyph: "≈" },
  cooked_chicken:{ name: "Cooked Chicken", kind: "food", heal: 30, color: "#c9923c", glyph: "≈" },

  // blocks / placeables
  dirt:      { name: "Dirt",      kind: "block", tile: T.DIRT,      color: "#6b4a2b" },
  grass:     { name: "Grass",     kind: "block", tile: T.GRASS,     color: "#4a8b3b" },
  stone:     { name: "Stone",     kind: "block", tile: T.STONE,     color: "#6c727f" },
  wood:      { name: "Wood",      kind: "block", tile: T.WOOD,      color: "#7a5a36" },
  leaves:    { name: "Leaves",    kind: "block", tile: T.LEAVES,    color: "#3f7a39" },
  sand:      { name: "Sand",      kind: "block", tile: T.SAND,      color: "#d9c27a" },
  plank:     { name: "Plank",     kind: "block", tile: T.PLANK,     color: "#b1814e" },
  glass:     { name: "Glass",     kind: "block", tile: T.GLASS,     color: "#bfe6f0" },
  torch:     { name: "Torch",     kind: "block", tile: T.TORCH,     color: "#ffb24d", icon: "🔥" },
  lantern:   { name: "Lantern",   kind: "block", tile: T.LANTERN,   color: "#ffd98a", icon: "🏮" },
  workbench: { name: "Workbench", kind: "block", tile: T.WORKBENCH, color: "#9a6b3c", icon: "🛠" },
  furnace:   { name: "Furnace",   kind: "block", tile: T.FURNACE,   color: "#5a5048", icon: "🔥" },
  ladder:    { name: "Ladder",    kind: "block", tile: T.LADDER,    color: "#8a6a34", glyph: "≡" },
  tnt:       { name: "TNT",       kind: "block", tile: T.TNT,       color: "#c0392b", icon: "🧨" },
  glowstone: { name: "Glowstone", kind: "block", tile: T.GLOWSTONE, color: "#f6d873", icon: "💡" },
  brick:     { name: "Brick",     kind: "block", tile: T.BRICK,     color: "#9a4a38" },
  cloud:     { name: "Cloud",     kind: "block", tile: T.CLOUD,     color: "#eef3ff", glyph: "☁" },
  crop:      { name: "Crop",      kind: "block", tile: T.CROP,      color: "#7aa83c", glyph: "ψ" },
  banner:    { name: "Banner",    kind: "block", tile: T.BANNER,    color: "#b03030", glyph: "⚑" },
  tv:        { name: "Television", kind: "block", tile: T.TV,        color: "#1b1f2a", icon: "📺" },
  // flora placeables — replant the world however you like
  tall_grass: { name: "Tall Grass", kind: "block", tile: T.TALL_GRASS, color: "#4a8b3b", glyph: "ψ" },
  flower:     { name: "Flower",     kind: "block", tile: T.FLOWER,     color: "#e85d9c", glyph: "✿" },
  berry_bush: { name: "Berry Bush", kind: "block", tile: T.BERRY_BUSH, color: "#2f6b34", glyph: "❃" },
  mushroom:   { name: "Mushroom",   kind: "block", tile: T.MUSHROOM,   color: "#d6604a", icon: "🍄" },
  cactus:     { name: "Cactus",     kind: "block", tile: T.CACTUS,     color: "#4f8a3a", glyph: "Ψ" },
  vine:       { name: "Vine",       kind: "block", tile: T.VINE,       color: "#3f7a39", glyph: "≀" },
  snow:       { name: "Snow",       kind: "block", tile: T.SNOW,       color: "#e8f0f7", glyph: "❄" },
  ice:        { name: "Ice",        kind: "block", tile: T.ICE,        color: "#9fcfe6", glyph: "❄" },
  pumpkin:    { name: "Pumpkin",    kind: "block", tile: T.PUMPKIN,    color: "#d97a26", icon: "🎃" },

  // background walls (placed in the wall layer, don't collide)
  wood_wall:  { name: "Wood Wall",  kind: "wall", wall: WALL_IDS.WOOD,  color: "#4a371f", glyph: "▦" },
  stone_wall: { name: "Stone Wall", kind: "wall", wall: WALL_IDS.STONE, color: "#34383f", glyph: "▦" },
  dirt_wall:  { name: "Dirt Wall",  kind: "wall", wall: WALL_IDS.DIRT,  color: "#3a2817", glyph: "▦" },

  // materials
  coal:        { name: "Coal",        kind: "material", color: "#26282e", glyph: "●" },
  iron_ore:    { name: "Iron Ore",    kind: "material", color: "#c8a98c", glyph: "●" },
  gold_ore:    { name: "Gold Ore",    kind: "material", color: "#f2c84b", glyph: "●" },
  diamond:     { name: "Diamond",     kind: "material", color: "#74e0e6", glyph: "◆" },
  iron_ingot:  { name: "Iron Ingot",  kind: "material", color: "#dfe6e0", glyph: "▬" },
  gold_ingot:  { name: "Gold Ingot",  kind: "material", color: "#f7d35e", glyph: "▬" },
  leather:     { name: "Leather",     kind: "material", color: "#8a5a36", glyph: "▭" },
  feather:     { name: "Feather",     kind: "material", color: "#eef3ff", glyph: "⁄" },
  gunpowder:   { name: "Gunpowder",   kind: "material", color: "#3a3a3a", glyph: "✸" },
  bullet:      { name: "Bullet",      kind: "material", color: "#d9b35a", glyph: "•" },
  rocket:      { name: "Rocket",      kind: "material", color: "#ff8a3a", glyph: "➤" },
  cell:        { name: "Energy Cell", kind: "material", color: "#b07aff", glyph: "◈", glow: true },
  magic_essence:{ name: "Magic Essence", kind: "material", color: "#a78bfa", glyph: "✦", glow: true },
  plant_fiber:  { name: "Plant Fiber",    kind: "material", color: "#7fa84a", glyph: "≀" },

  // mob drops
  gel:          { name: "Gel",           kind: "material", color: "#4fb36b", glyph: "✺" },
  bone:         { name: "Bone",          kind: "material", color: "#e8e3cf", glyph: "▮" },
  arrow:        { name: "Arrow",         kind: "material", color: "#c9b27a", glyph: "↟" },
  rotten_flesh: { name: "Rotten Flesh",  kind: "food",     heal: -10, color: "#7a8a4a", glyph: "≈" },
  warden_heart: { name: "Warden's Heart", kind: "power", special: "maxhp", amount: 40, color: "#b0307a", icon: "❤", glow: true },
  dragon_scale: { name: "Dragon Scale",  kind: "material", color: "#c0392b", glyph: "❖", glow: true },
};

// Map a broken tile id -> the item it drops.
export const TILE_DROPS = {
  [T.DIRT]: "dirt", [T.GRASS]: "grass", [T.STONE]: "stone", [T.WOOD]: "wood",
  [T.LEAVES]: "leaves", [T.SAND]: "sand", [T.PLANK]: "plank", [T.GLASS]: "glass",
  [T.TORCH]: "torch", [T.WORKBENCH]: "workbench", [T.FURNACE]: "furnace",
  [T.LANTERN]: "lantern", [T.LADDER]: "ladder", [T.TNT]: "tnt",
  [T.GLOWSTONE]: "glowstone", [T.BRICK]: "brick", [T.CLOUD]: "cloud",
  [T.CROP]: "wheat", [T.BANNER]: "banner", [T.TV]: "tv",
  [T.COAL_ORE]: "coal", [T.IRON_ORE]: "iron_ore",
  [T.GOLD_ORE]: "gold_ore", [T.DIAMOND_ORE]: "diamond",
  [T.TALL_GRASS]: "plant_fiber", [T.FLOWER]: "flower", [T.BERRY_BUSH]: "berries",
  [T.MUSHROOM]: "mushroom", [T.CACTUS]: "cactus", [T.VINE]: "vine",
  [T.SNOW]: "snow", [T.ICE]: "ice", [T.PUMPKIN]: "pumpkin",
};

// Map a broken wall id -> the item it drops.
export const WALL_DROPS = {
  [WALL_IDS.WOOD]: "wood_wall", [WALL_IDS.STONE]: "stone_wall", [WALL_IDS.DIRT]: "dirt_wall",
};

export function itemDef(key) { return ITEMS[key]; }
export function maxStack(key) {
  const d = ITEMS[key];
  if (!d) return 99;
  if (d.kind === "tool" || d.kind === "weapon" || d.kind === "armor" || d.kind === "gun" || d.kind === "fishing" || d.kind === "spell") return 1;
  return 99;
}
