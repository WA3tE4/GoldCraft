// Villager trades: the player gives `give` and receives `get`. Rarity is implicit
// in the rates — common goods (wood) buy food/torches; rare goods (gold, diamond)
// buy ingots, armour, and weapons.
export const TRADE_POOL = [
  { give: { item: "wood", count: 8 },        get: { item: "apple", count: 2 } },
  { give: { item: "wood", count: 16 },       get: { item: "bread", count: 1 } },
  { give: { item: "coal", count: 4 },        get: { item: "torch", count: 6 } },
  { give: { item: "wood", count: 30 },       get: { item: "iron_ingot", count: 1 } },
  { give: { item: "iron_ingot", count: 4 },  get: { item: "gold_ingot", count: 1 } },
  { give: { item: "gold_ingot", count: 3 },  get: { item: "iron_helmet", count: 1 } },
  { give: { item: "gold_ingot", count: 5 },  get: { item: "iron_chest", count: 1 } },
  { give: { item: "gold_ingot", count: 6 },  get: { item: "gold_chest", count: 1 } },
  { give: { item: "diamond", count: 1 },     get: { item: "gold_sword", count: 1 } },
  { give: { item: "gold_ingot", count: 8 },  get: { item: "golden_apple", count: 1 } },
  // vices — buy them from villagers, or sell your own stash for coin/goods
  { give: { item: "wheat", count: 6 },        get: { item: "beer", count: 2 } },
  { give: { item: "apple", count: 6 },        get: { item: "wine", count: 1 } },
  { give: { item: "gold_ingot", count: 1 },   get: { item: "whiskey", count: 2 } },
  { give: { item: "leaves", count: 8 },        get: { item: "cigar", count: 1 } },
  { give: { item: "weed", count: 2 },         get: { item: "gold_ingot", count: 1 } },
  { give: { item: "whiskey", count: 1 },      get: { item: "iron_ingot", count: 3 } },
  // hard stimulants — pricey to buy, lucrative to sell
  { give: { item: "gold_ingot", count: 4 },   get: { item: "cocaine", count: 1 } },
  { give: { item: "cocaine", count: 1 },      get: { item: "diamond", count: 1 } },
  { give: { item: "crack", count: 2 },        get: { item: "gold_ingot", count: 3 } },
];

// Pick `n` distinct trades using an rng() -> 0..1.
export function pickTrades(rng, n = 4) {
  const pool = TRADE_POOL.slice();
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice((rng() * pool.length) | 0, 1)[0]);
  return out;
}

export function canTrade(inv, t) { return inv.count(t.give.item) >= t.give.count; }

export function doTrade(inv, t) {
  if (!canTrade(inv, t)) return false;
  let need = t.give.count;
  for (let i = 0; i < inv.slots.length && need > 0; i++) {
    const s = inv.slots[i];
    if (s && s.item === t.give.item) {
      const take = Math.min(s.count, need); s.count -= take; need -= take;
      if (s.count <= 0) inv.slots[i] = null;
    }
  }
  inv.add(t.get.item, t.get.count);
  return true;
}
