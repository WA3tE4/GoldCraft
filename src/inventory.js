import { ITEMS, maxStack } from "./tiles.js";

// A grid inventory: `hotbarSize` slots double as the bottom hotbar, the rest is
// the backpack shown on the inventory screen. Plus three armor slots and a
// "held" stack that follows the cursor while rearranging items.
export class Inventory {
  constructor(size = 30, hotbarSize = 5) {
    this.size = size;
    this.hotbarSize = hotbarSize;
    this.slots = new Array(size).fill(null);   // each: null | { item, count }
    this.armor = { head: null, body: null, legs: null };
    this.selected = 0;                         // hotbar index
    this.held = null;                          // stack on the cursor
  }

  selectedSlot() { return this.slots[this.selected]; }
  select(i) { if (i >= 0 && i < this.hotbarSize) this.selected = i; }
  scroll(d) { this.selected = (this.selected + d + this.hotbarSize) % this.hotbarSize; }

  // Add items, stacking into existing stacks (respecting max stack), then empties.
  // Returns the amount that didn't fit.
  add(itemKey, count = 1) {
    if (!ITEMS[itemKey]) return count;
    const max = maxStack(itemKey);
    for (let i = 0; i < this.size && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.item === itemKey && s.count < max) {
        const a = Math.min(max - s.count, count); s.count += a; count -= a;
      }
    }
    for (let i = 0; i < this.size && count > 0; i++) {
      if (!this.slots[i]) { const a = Math.min(max, count); this.slots[i] = { item: itemKey, count: a }; count -= a; }
    }
    return count;
  }

  // Place a single item carrying extra metadata (e.g. a tool's remaining
  // durability) into the first empty slot. Returns 0 on success, 1 if full.
  addSingleWithMeta(itemKey, meta = {}) {
    if (!ITEMS[itemKey]) return 1;
    for (let i = 0; i < this.size; i++) {
      if (!this.slots[i]) { this.slots[i] = { item: itemKey, count: 1, ...meta }; return 0; }
    }
    return 1;
  }

  // Remove one of the selected stack (block placing, food eating).
  decrementSelected() {
    const s = this.selectedSlot();
    if (!s) return false;
    s.count -= 1;
    if (s.count <= 0) this.slots[this.selected] = null;
    return true;
  }
  consumeSelected() { return this.decrementSelected(); }

  count(itemKey) { let n = 0; for (const s of this.slots) if (s && s.item === itemKey) n += s.count; return n; }

  // Remove up to `count` of an item from anywhere in the backpack. Returns how
  // many were actually removed (used by guns spending ammo).
  remove(itemKey, count = 1) {
    let removed = 0;
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.item === itemKey) {
        const take = Math.min(s.count, count);
        s.count -= take; count -= take; removed += take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return removed;
  }
  totalDefense() {
    let d = 0;
    for (const k in this.armor) { const s = this.armor[k]; if (s) d += ITEMS[s.item].defense || 0; }
    return d;
  }

  // --- Cursor interactions on the inventory screen ---
  clickSlot(i) {
    const cur = this.slots[i];
    if (this.held) {
      if (!cur) { this.slots[i] = this.held; this.held = null; }
      else if (cur.item === this.held.item) {
        const max = maxStack(cur.item);
        const a = Math.min(max - cur.count, this.held.count);
        cur.count += a; this.held.count -= a;
        if (this.held.count <= 0) this.held = null;
      } else { this.slots[i] = this.held; this.held = cur; } // swap
    } else if (cur) { this.held = cur; this.slots[i] = null; }
  }

  // Like clickSlot, but operating on an external container array (e.g. a chest).
  // Shares the cursor-held stack so items flow freely between bag and container.
  clickContainerSlot(arr, i) {
    const cur = arr[i];
    if (this.held) {
      if (!cur) { arr[i] = this.held; this.held = null; }
      else if (cur.item === this.held.item) {
        const max = maxStack(cur.item);
        const a = Math.min(max - cur.count, this.held.count);
        cur.count += a; this.held.count -= a;
        if (this.held.count <= 0) this.held = null;
      } else { arr[i] = this.held; this.held = cur; } // swap
    } else if (cur) { this.held = cur; arr[i] = null; }
  }

  clickArmor(slotKey) {
    const cur = this.armor[slotKey];
    if (this.held) {
      const def = ITEMS[this.held.item];
      if (def && def.kind === "armor" && def.slot === slotKey) {
        this.armor[slotKey] = this.held; // armor stacks are always count 1
        this.held = cur || null;
      }
      // non-matching items are ignored (can't go in an armor slot)
    } else if (cur) { this.held = cur; this.armor[slotKey] = null; }
  }

  toJSON() { return { selected: this.selected, slots: this.slots, armor: this.armor }; }

  static fromJSON(data, size = 30, hotbarSize = 5) {
    const inv = new Inventory(size, hotbarSize);
    if (data) {
      inv.selected = data.selected ?? 0;
      if (data.slots) inv.slots = data.slots;
      if (data.armor) inv.armor = { head: null, body: null, legs: null, ...data.armor };
      while (inv.slots.length < size) inv.slots.push(null);
    }
    return inv;
  }
}
