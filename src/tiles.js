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
};

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
};

export function tileDef(id) { return TILES[id] || TILES[T.AIR]; }
export function isSolid(id) { return tileDef(id).solid; }
export function isOpaque(id) { return tileDef(id).solid; }
export function emissionOf(id) { return tileDef(id).emissive || 0; }

// Item kinds:
//   tool   – mines blocks (power = speed); pickaxes also unlock `needsPick` tiles
//   weapon – melee damage to enemies
//   armor  – equippable (slot head/body/legs), adds defense
//   block  – places a tile
//   food   – consumed to restore health (heal)
//   material – crafting ingredient
// `glyph` is a one-char label drawn over non-emoji icons.
export const ITEMS = {
  // tools
  wood_pickaxe:  { name: "Wood Pickaxe",  kind: "tool", power: 4.0,  color: "#8a6b3c", icon: "⛏" },
  stone_pickaxe: { name: "Stone Pickaxe", kind: "tool", power: 6.5,  color: "#9aa0ad", icon: "⛏" },
  iron_pickaxe:  { name: "Iron Pickaxe",  kind: "tool", power: 9.5,  color: "#e6ede9", icon: "⛏" },

  // weapons
  wood_sword:  { name: "Wood Sword",  kind: "weapon", damage: 8,  color: "#8a6b3c", glyph: "/" },
  stone_sword: { name: "Stone Sword", kind: "weapon", damage: 13, color: "#9aa0ad", glyph: "/" },
  iron_sword:  { name: "Iron Sword",  kind: "weapon", damage: 20, color: "#e6ede9", glyph: "/" },
  gold_sword:  { name: "Gold Sword",  kind: "weapon", damage: 28, color: "#f7d35e", glyph: "/" },

  // armor (slot: head/body/legs, defense reduces incoming damage)
  iron_helmet: { name: "Iron Helmet", kind: "armor", slot: "head", defense: 2, color: "#dfe6e0", glyph: "▲" },
  iron_chest:  { name: "Iron Chest",  kind: "armor", slot: "body", defense: 4, color: "#dfe6e0", glyph: "■" },
  iron_legs:   { name: "Iron Greaves",kind: "armor", slot: "legs", defense: 2, color: "#dfe6e0", glyph: "Ⅱ" },
  gold_helmet: { name: "Gold Helmet", kind: "armor", slot: "head", defense: 3, color: "#f7d35e", glyph: "▲" },
  gold_chest:  { name: "Gold Chest",  kind: "armor", slot: "body", defense: 6, color: "#f7d35e", glyph: "■" },
  gold_legs:   { name: "Gold Greaves",kind: "armor", slot: "legs", defense: 3, color: "#f7d35e", glyph: "Ⅱ" },

  // food
  apple:        { name: "Apple",        kind: "food", heal: 15,  color: "#d83a3a", glyph: "•" },
  bread:        { name: "Bread",        kind: "food", heal: 35,  color: "#c79a4e", glyph: "▬" },
  golden_apple: { name: "Golden Apple", kind: "food", heal: 100, color: "#f7d35e", glyph: "•" },

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
  workbench: { name: "Workbench", kind: "block", tile: T.WORKBENCH, color: "#9a6b3c", icon: "🛠" },
  furnace:   { name: "Furnace",   kind: "block", tile: T.FURNACE,   color: "#5a5048", icon: "🔥" },

  // materials
  coal:        { name: "Coal",        kind: "material", color: "#26282e", glyph: "●" },
  iron_ore:    { name: "Iron Ore",    kind: "material", color: "#c8a98c", glyph: "●" },
  gold_ore:    { name: "Gold Ore",    kind: "material", color: "#f2c84b", glyph: "●" },
  diamond:     { name: "Diamond",     kind: "material", color: "#74e0e6", glyph: "◆" },
  iron_ingot:  { name: "Iron Ingot",  kind: "material", color: "#dfe6e0", glyph: "▬" },
  gold_ingot:  { name: "Gold Ingot",  kind: "material", color: "#f7d35e", glyph: "▬" },
};

// Map a broken tile id -> the item it drops.
export const TILE_DROPS = {
  [T.DIRT]: "dirt", [T.GRASS]: "grass", [T.STONE]: "stone", [T.WOOD]: "wood",
  [T.LEAVES]: "leaves", [T.SAND]: "sand", [T.PLANK]: "plank", [T.GLASS]: "glass",
  [T.TORCH]: "torch", [T.WORKBENCH]: "workbench", [T.FURNACE]: "furnace",
  [T.COAL_ORE]: "coal", [T.IRON_ORE]: "iron_ore",
  [T.GOLD_ORE]: "gold_ore", [T.DIAMOND_ORE]: "diamond",
};

export function itemDef(key) { return ITEMS[key]; }
export function maxStack(key) {
  const d = ITEMS[key];
  if (!d) return 99;
  if (d.kind === "tool" || d.kind === "weapon" || d.kind === "armor") return 1;
  return 99;
}
