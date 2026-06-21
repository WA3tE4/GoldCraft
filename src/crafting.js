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

  // --- furnace: smelting & glass & baking ---
  { out: { item: "iron_ingot", count: 1 }, in: [{ item: "iron_ore", count: 1 }, { item: "coal", count: 1 }], station: "furnace" },
  { out: { item: "gold_ingot", count: 1 }, in: [{ item: "gold_ore", count: 1 }, { item: "coal", count: 1 }], station: "furnace" },
  { out: { item: "glass", count: 1 }, in: [{ item: "sand", count: 2 }], station: "furnace" },
  { out: { item: "bread", count: 1 }, in: [{ item: "apple", count: 2 }], station: "furnace" },
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
