import { ITEMS } from "./tiles.js";

// Recipe = { out:{item,count}, in:[{item,count}...], station:null|"workbench"|"furnace" }.
// `station` requires the player to be standing near that tile to craft.
//
// Progression: punch trees for wood -> planks -> workbench -> wood tools ->
// mine stone/coal -> furnace -> smelt ore into ingots -> iron/gold gear.
export const RECIPES = [
  // --- handheld basics ---
  { out: { item: "plank", count: 4 }, in: [{ item: "wood", count: 1 }], station: null },
  { out: { item: "workbench", count: 1 }, in: [{ item: "plank", count: 6 }], station: null },
  { out: { item: "torch", count: 4 }, in: [{ item: "plank", count: 1 }, { item: "coal", count: 1 }], station: null },

  // --- background walls (make rooms feel indoors & not pitch black) ---
  { out: { item: "wood_wall", count: 4 }, in: [{ item: "plank", count: 1 }], station: null },
  { out: { item: "dirt_wall", count: 4 }, in: [{ item: "dirt", count: 2 }], station: null },
  { out: { item: "stone_wall", count: 4 }, in: [{ item: "stone", count: 1 }], station: "workbench" },
  { out: { item: "lantern", count: 1 }, in: [{ item: "torch", count: 1 }, { item: "iron_ingot", count: 1 }], station: null },

  // --- workbench: tools & weapons ---
  { out: { item: "wood_pickaxe", count: 1 }, in: [{ item: "plank", count: 5 }], station: "workbench" },
  { out: { item: "wood_sword", count: 1 }, in: [{ item: "plank", count: 4 }], station: "workbench" },
  { out: { item: "furnace", count: 1 }, in: [{ item: "stone", count: 12 }], station: "workbench" },
  { out: { item: "stone_pickaxe", count: 1 }, in: [{ item: "plank", count: 2 }, { item: "stone", count: 8 }], station: "workbench" },
  { out: { item: "stone_sword", count: 1 }, in: [{ item: "plank", count: 2 }, { item: "stone", count: 6 }], station: "workbench" },
  { out: { item: "iron_pickaxe", count: 1 }, in: [{ item: "plank", count: 2 }, { item: "iron_ingot", count: 6 }], station: "workbench" },
  { out: { item: "iron_sword", count: 1 }, in: [{ item: "plank", count: 1 }, { item: "iron_ingot", count: 5 }], station: "workbench" },
  { out: { item: "gold_sword", count: 1 }, in: [{ item: "gold_ingot", count: 6 }, { item: "diamond", count: 1 }], station: "workbench" },

  // --- workbench: armor ---
  { out: { item: "iron_helmet", count: 1 }, in: [{ item: "iron_ingot", count: 5 }], station: "workbench" },
  { out: { item: "iron_chest", count: 1 }, in: [{ item: "iron_ingot", count: 8 }], station: "workbench" },
  { out: { item: "iron_legs", count: 1 }, in: [{ item: "iron_ingot", count: 6 }], station: "workbench" },
  { out: { item: "gold_helmet", count: 1 }, in: [{ item: "gold_ingot", count: 5 }], station: "workbench" },
  { out: { item: "gold_chest", count: 1 }, in: [{ item: "gold_ingot", count: 8 }], station: "workbench" },
  { out: { item: "gold_legs", count: 1 }, in: [{ item: "gold_ingot", count: 6 }], station: "workbench" },
  { out: { item: "golden_apple", count: 1 }, in: [{ item: "gold_ingot", count: 8 }, { item: "apple", count: 1 }], station: "workbench" },

  // --- fishing ---
  { out: { item: "fishing_pole", count: 1 }, in: [{ item: "plank", count: 8 }, { item: "iron_ingot", count: 1 }], station: "workbench" },

  // --- furnace: smelting & glass & baking & cooking ---
  { out: { item: "iron_ingot", count: 1 }, in: [{ item: "iron_ore", count: 1 }, { item: "coal", count: 1 }], station: "furnace" },
  { out: { item: "gold_ingot", count: 1 }, in: [{ item: "gold_ore", count: 1 }, { item: "coal", count: 1 }], station: "furnace" },
  { out: { item: "glass", count: 1 }, in: [{ item: "sand", count: 2 }], station: "furnace" },
  { out: { item: "bread", count: 1 }, in: [{ item: "apple", count: 2 }], station: "furnace" },
  { out: { item: "cooked_fish", count: 1 }, in: [{ item: "raw_fish", count: 1 }], station: "furnace" },
  { out: { item: "cooked_beef", count: 1 }, in: [{ item: "raw_beef", count: 1 }], station: "furnace" },
  { out: { item: "cooked_pork", count: 1 }, in: [{ item: "raw_pork", count: 1 }], station: "furnace" },
  { out: { item: "cooked_chicken", count: 1 }, in: [{ item: "raw_chicken", count: 1 }], station: "furnace" },
  { out: { item: "mushroom_stew", count: 1 }, in: [{ item: "mushroom", count: 3 }], station: "furnace" },
  { out: { item: "pumpkin_pie", count: 1 }, in: [{ item: "pumpkin", count: 1 }, { item: "wheat", count: 2 }, { item: "egg", count: 1 }], station: "furnace" },

  // --- foraging: plant fiber is an early, no-tools crafting staple ---
  { out: { item: "torch", count: 2 }, in: [{ item: "plant_fiber", count: 2 }, { item: "coal", count: 1 }], station: null },
  { out: { item: "wood", count: 1 }, in: [{ item: "plant_fiber", count: 4 }], station: null },
  { out: { item: "wine", count: 1 }, in: [{ item: "berries", count: 5 }], station: "furnace" },

  // --- decorative & utility blocks ---
  { out: { item: "ladder", count: 4 }, in: [{ item: "plank", count: 2 }], station: null },
  { out: { item: "brick", count: 4 }, in: [{ item: "stone", count: 4 }], station: "furnace" },
  { out: { item: "cloud", count: 8 }, in: [{ item: "glass", count: 1 }, { item: "sand", count: 1 }], station: null },
  { out: { item: "glowstone", count: 2 }, in: [{ item: "glass", count: 1 }, { item: "gold_ingot", count: 1 }, { item: "torch", count: 1 }], station: "workbench" },
  { out: { item: "tv", count: 1 }, in: [{ item: "glass", count: 2 }, { item: "iron_ingot", count: 3 }, { item: "magic_essence", count: 1 }], station: "workbench" },
  { out: { item: "bed", count: 1 }, in: [{ item: "plank", count: 10 }, { item: "plant_fiber", count: 5 }], station: "workbench" },
  { out: { item: "chest", count: 1 }, in: [{ item: "plank", count: 8 }], station: "workbench" },

  // --- ammo & explosives (furnace = "munitions bench") ---
  { out: { item: "gunpowder", count: 2 }, in: [{ item: "coal", count: 1 }, { item: "sand", count: 1 }], station: "furnace" },
  { out: { item: "bullet", count: 10 }, in: [{ item: "iron_ingot", count: 1 }, { item: "gunpowder", count: 1 }], station: "furnace" },
  { out: { item: "rocket", count: 3 }, in: [{ item: "iron_ingot", count: 1 }, { item: "gunpowder", count: 3 }], station: "furnace" },
  { out: { item: "cell", count: 6 }, in: [{ item: "diamond", count: 1 }, { item: "gunpowder", count: 2 }], station: "furnace" },
  { out: { item: "tnt", count: 1 }, in: [{ item: "gunpowder", count: 5 }, { item: "sand", count: 2 }], station: "workbench" },

  // --- guns (workbench) ---
  { out: { item: "pistol", count: 1 }, in: [{ item: "iron_ingot", count: 8 }, { item: "plank", count: 2 }], station: "workbench" },
  { out: { item: "shotgun", count: 1 }, in: [{ item: "iron_ingot", count: 12 }, { item: "plank", count: 4 }], station: "workbench" },
  { out: { item: "rifle", count: 1 }, in: [{ item: "iron_ingot", count: 14 }, { item: "gold_ingot", count: 2 }, { item: "plank", count: 4 }], station: "workbench" },
  { out: { item: "minigun", count: 1 }, in: [{ item: "iron_ingot", count: 20 }, { item: "gold_ingot", count: 5 }, { item: "diamond", count: 1 }], station: "workbench" },
  { out: { item: "rocket_launcher", count: 1 }, in: [{ item: "iron_ingot", count: 16 }, { item: "gold_ingot", count: 4 }, { item: "tnt", count: 2 }], station: "workbench" },
  { out: { item: "ray_gun", count: 1 }, in: [{ item: "gold_ingot", count: 10 }, { item: "diamond", count: 3 }, { item: "magic_essence", count: 2 }], station: "workbench" },
  { out: { item: "bfg", count: 1 }, in: [{ item: "iron_ingot", count: 24 }, { item: "diamond", count: 6 }, { item: "magic_essence", count: 4 }], station: "workbench" },

  // --- top-tier melee ---
  { out: { item: "diamond_sword", count: 1 }, in: [{ item: "diamond", count: 4 }, { item: "gold_ingot", count: 2 }], station: "workbench" },
  { out: { item: "excalibur", count: 1 }, in: [{ item: "diamond_sword", count: 1 }, { item: "magic_essence", count: 5 }, { item: "gold_ingot", count: 8 }], station: "workbench" },

  // --- legendary & arcane ---
  { out: { item: "mjolnir", count: 1 }, in: [{ item: "iron_ingot", count: 10 }, { item: "diamond", count: 3 }, { item: "magic_essence", count: 4 }], station: "workbench" },
  { out: { item: "arcane_wand", count: 1 }, in: [{ item: "gold_ingot", count: 4 }, { item: "magic_essence", count: 3 }], station: "workbench" },

  // --- SUPERHERO GEAR ---
  { out: { item: "cap_shield", count: 1 },    in: [{ item: "iron_ingot", count: 14 }, { item: "diamond", count: 2 }, { item: "magic_essence", count: 2 }], station: "workbench" },
  { out: { item: "bat_belt", count: 1 },      in: [{ item: "iron_ingot", count: 10 }, { item: "gold_ingot", count: 3 }, { item: "gunpowder", count: 4 }], station: "workbench" },
  { out: { item: "ironman_armor", count: 1 }, in: [{ item: "iron_ingot", count: 20 }, { item: "gold_ingot", count: 8 }, { item: "diamond", count: 4 }, { item: "magic_essence", count: 5 }], station: "workbench" },
  { out: { item: "flash_suit", count: 1 },    in: [{ item: "magic_essence", count: 6 }, { item: "gold_ingot", count: 4 }, { item: "diamond", count: 2 }], station: "workbench" },
  { out: { item: "inferno_staff", count: 1 }, in: [{ item: "gold_ingot", count: 6 }, { item: "diamond", count: 2 }, { item: "magic_essence", count: 5 }], station: "workbench" },

  // --- WIZARD SPELLS (workbench = "arcane lectern"): scribed from essence ---
  { out: { item: "fire_bolt", count: 1 },     in: [{ item: "magic_essence", count: 1 }, { item: "coal", count: 2 }], station: "workbench" },
  { out: { item: "frost_shard", count: 1 },   in: [{ item: "magic_essence", count: 1 }, { item: "ice", count: 3 }], station: "workbench" },
  { out: { item: "water_surge", count: 1 },   in: [{ item: "magic_essence", count: 1 }, { item: "glass", count: 2 }], station: "workbench" },
  { out: { item: "heal_spell", count: 1 },    in: [{ item: "magic_essence", count: 2 }, { item: "flower", count: 4 }], station: "workbench" },
  { out: { item: "fireball", count: 1 },      in: [{ item: "magic_essence", count: 2 }, { item: "gunpowder", count: 3 }], station: "workbench" },
  { out: { item: "telekinesis", count: 1 },   in: [{ item: "magic_essence", count: 3 }, { item: "feather", count: 4 }], station: "workbench" },
  { out: { item: "chain_lightning", count: 1 }, in: [{ item: "magic_essence", count: 3 }, { item: "gold_ingot", count: 3 }], station: "workbench" },
  { out: { item: "incite_madness", count: 1 }, in: [{ item: "magic_essence", count: 4 }, { item: "rotten_flesh", count: 3 }], station: "workbench" },
  { out: { item: "mind_control", count: 1 },   in: [{ item: "magic_essence", count: 5 }, { item: "diamond", count: 2 }], station: "workbench" },
  { out: { item: "meteor_storm", count: 1 },   in: [{ item: "magic_essence", count: 6 }, { item: "diamond", count: 3 }, { item: "gold_ingot", count: 4 }], station: "workbench" },

  // --- magic essence: the key reagent for god-like power-ups ---
  { out: { item: "magic_essence", count: 1 }, in: [{ item: "diamond", count: 1 }, { item: "gold_ingot", count: 2 }], station: "furnace" },

  // --- power-ups (workbench) ---
  { out: { item: "speed_potion", count: 1 }, in: [{ item: "magic_essence", count: 1 }, { item: "apple", count: 2 }], station: "workbench" },
  { out: { item: "jump_potion", count: 1 }, in: [{ item: "magic_essence", count: 1 }, { item: "leaves", count: 4 }], station: "workbench" },
  { out: { item: "feather_potion", count: 1 }, in: [{ item: "magic_essence", count: 1 }, { item: "cloud", count: 2 }], station: "workbench" },
  { out: { item: "regen_potion", count: 1 }, in: [{ item: "magic_essence", count: 1 }, { item: "bread", count: 2 }], station: "workbench" },
  { out: { item: "strength_potion", count: 1 }, in: [{ item: "magic_essence", count: 2 }, { item: "iron_ingot", count: 3 }], station: "workbench" },
  { out: { item: "haste_potion", count: 1 }, in: [{ item: "magic_essence", count: 1 }, { item: "coal", count: 3 }], station: "workbench" },
  { out: { item: "boat", count: 1 }, in: [{ item: "plank", count: 12 }, { item: "iron_ingot", count: 2 }], station: "workbench" },
  { out: { item: "rocket_boots", count: 1 }, in: [{ item: "iron_ingot", count: 6 }, { item: "gunpowder", count: 4 }, { item: "magic_essence", count: 1 }], station: "workbench" },
  { out: { item: "angel_wings", count: 1 }, in: [{ item: "magic_essence", count: 3 }, { item: "cloud", count: 6 }, { item: "gold_ingot", count: 4 }], station: "workbench" },
  { out: { item: "god_star", count: 1 }, in: [{ item: "magic_essence", count: 4 }, { item: "diamond", count: 3 }], station: "workbench" },
  { out: { item: "heart_container", count: 1 }, in: [{ item: "magic_essence", count: 2 }, { item: "golden_apple", count: 1 }], station: "workbench" },
  { out: { item: "godhood", count: 1 }, in: [{ item: "magic_essence", count: 10 }, { item: "diamond", count: 8 }, { item: "golden_apple", count: 2 }], station: "workbench" },

  // --- vices: liquor (furnace = "still") & smokes (workbench = "rolling table") ---
  { out: { item: "beer", count: 2 },      in: [{ item: "wheat", count: 4 }], station: "furnace" },
  { out: { item: "wine", count: 1 },      in: [{ item: "apple", count: 4 }], station: "furnace" },
  { out: { item: "whiskey", count: 1 },   in: [{ item: "wheat", count: 6 }, { item: "coal", count: 1 }], station: "furnace" },
  { out: { item: "weed", count: 2 },      in: [{ item: "leaves", count: 3 }, { item: "wheat", count: 1 }], station: "workbench" },
  { out: { item: "cigarette", count: 4 }, in: [{ item: "leaves", count: 2 }, { item: "plank", count: 1 }], station: "workbench" },
  { out: { item: "cigar", count: 1 },     in: [{ item: "leaves", count: 4 }], station: "workbench" },
  // hard stimulants — refined goods, then "cooked" into crack at the furnace
  { out: { item: "cocaine", count: 1 },   in: [{ item: "wheat", count: 6 }, { item: "magic_essence", count: 1 }], station: "workbench" },
  { out: { item: "crack", count: 2 },     in: [{ item: "cocaine", count: 1 }, { item: "coal", count: 1 }], station: "furnace" },
];

export function countItem(inv, itemKey) { return inv.count(itemKey); }

export function hasIngredients(inv, recipe) {
  return recipe.in.every((req) => inv.count(req.item) >= req.count);
}

function removeItem(inv, itemKey, count) {
  for (let i = 0; i < inv.slots.length && count > 0; i++) {
    const s = inv.slots[i];
    if (s && s.item === itemKey) {
      const take = Math.min(s.count, count);
      s.count -= take; count -= take;
      if (s.count <= 0) inv.slots[i] = null;
    }
  }
}

export function craft(inv, recipe, stationAvailable) {
  if (!hasIngredients(inv, recipe)) return false;
  if (recipe.station && !stationAvailable(recipe.station)) return false;
  for (const req of recipe.in) removeItem(inv, req.item, req.count);
  inv.add(recipe.out.item, recipe.out.count);
  return true;
}

export function itemName(key) { return ITEMS[key] ? ITEMS[key].name : key; }
