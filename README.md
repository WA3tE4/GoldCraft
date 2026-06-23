# 💰 GoldCraft

<!-- BADGES -->
[![License](https://img.shields.io/github/license/Wa3tE4/GoldCraft?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Wa3tE4/GoldCraft?style=flat-square)](https://github.com/Wa3tE4/GoldCraft/stargazers)
[![Forks](https://img.shields.io/github/forks/Wa3tE4/GoldCraft?style=flat-square)](https://github.com/Wa3tE4/GoldCraft/network/members)
[![Issues](https://img.shields.io/github/issues/Wa3tE4/GoldCraft?style=flat-square)](https://github.com/Wa3tE4/GoldCraft/issues)
[![Last Commit](https://img.shields.io/github/last-commit/Wa3tE4/GoldCraft?style=flat-square)](https://github.com/Wa3tE4/GoldCraft/commits)
[![Vanilla JS](https://img.shields.io/badge/built%20with-Vanilla%20JS-f7df1e?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![No Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen?style=flat-square)]()
[![HTML Canvas](https://img.shields.io/badge/renderer-HTML%20Canvas-orange?style=flat-square)]()

> A fully-featured 2D sandbox survival game — zero libraries, zero build steps, zero asset files. Just open a local server and play.

---
><img width="1292" height="496" alt="image" src="https://github.com/user-attachments/assets/cf6deaa5-68dd-4e6b-9321-56f8558d064d" />
><img width="1508" height="739" alt="image" src="https://github.com/user-attachments/assets/580ebb52-add2-4bf4-92ea-d91a1eb2e059" />


<!-- 🖼️ IMAGE SUGGESTION: A wide banner/hero screenshot showing the full game world — sky, terrain, caves, torches glowing, player standing near a workbench. Ideally 1200×600px or similar. -->
<!-- ![Terreria banner](docs/banner.png) -->

---

## What is this?

GoldCraft is a Terraria-inspired 2D tile sandbox built entirely from scratch in vanilla JavaScript and HTML Canvas. No game engine, no npm packages, no compile step — just raw browser APIs doing all the heavy lifting.

It started as a personal challenge: how much of a "real" game can you build before needing to reach for a framework? The answer turned out to be quite a lot. You get procedural terrain generation, a flood-fill lighting system, fluid physics, AI villagers, a full crafting tree, inventory with drag-and-drop armor slots, synthesized sound effects via Web Audio, and a particle system — all in a single folder you can serve with one terminal command.

The world is dark, the ores are deep, and the slimes come out at night. Good luck.

---

## Features at a glance

**World & terrain**
- Seeded procedural generation — hills, caves, ore veins, underground lava lakes, water pools, and pre-built plank villages
- 400 × 200 tile world stored in a flat `Uint8Array` — fast and simple, no chunking needed at this scale
- Ores: coal, iron, gold, diamond (rarer the deeper you go)

**Lighting**
- BFS flood-fill light map recalculated on every tile change
- Emissive sources: torches, lava, glowing ores each cast warm, coloured light
- Smooth day/night cycle — caves stay genuinely dark unless you bring a torch

><img width="627" height="774" alt="image" src="https://github.com/user-attachments/assets/77c654a4-572c-4359-aa5f-18acf6d4d85f" />

<!-- 🖼️ IMAGE SUGGESTION: Side-by-side or split screenshot showing a cave in full dark vs. the same cave lit up with torches. Really shows off the lighting system. -->
<!-- ![Lighting comparison](docs/lighting.png) -->
><img width="707" height="274" alt="image" src="https://github.com/user-attachments/assets/c85b94f4-15a7-4b38-870a-d43cfa5a9519" />


**Physics**
- Pure AABB collision against the tile grid — no physics library
- Gravity, variable jump, acceleration-based movement, jump/land squash animation
- Liquid buoyancy and drag (water is swimmable, lava burns on contact)
- Fall damage that scales with extra height; landing in water cancels it

**Crafting & progression**
- You start with nothing — literally just your fists
- Full crafting tree from raw wood all the way to gold armor and diamond tools
- Station-gated recipes: some things need a workbench nearby, others need a furnace
- Smelting: ore + coal → ingots; sand → glass; wheat → bread

><img width="659" height="404" alt="image" src="https://github.com/user-attachments/assets/57c16afc-35fd-48ab-83bd-fe4cc6707db4" />

<!-- 🖼️ IMAGE SUGGESTION: The inventory/crafting UI open, showing the backpack grid, armor slots on the left, and the crafting recipe list on the right. -->
<!-- ![Inventory & crafting UI](docs/inventory.png) -->

**Inventory & items**
- Drag-and-drop backpack with a 5-slot hotbar
- Dedicated armor slots (helmet, chest, greaves) that raise your `DEF` stat
- Dropped items fall into the world with gravity and magnetise toward you when you walk close
- Floating pickup text and damage numbers

**Sound (no audio files!)**
- Every sound effect is synthesized at runtime via the Web Audio API
- Mining pings, footstep thuds, splash sounds, sword swings — all procedural

**Villagers**
- Live in the generated houses and actually have needs
- Wander by day, return home at night, eat over time to refill their food bar
- Right-click to open their trade menu — swap your surplus ore or wood for gear, food, and torches
- They die permanently if they starve or fall into lava, so keep an eye on them

><img width="665" height="278" alt="image" src="https://github.com/user-attachments/assets/b9f76a91-eec3-4cc5-85f0-0f3cbd811e55" />

<!-- 🖼️ IMAGE SUGGESTION: Player standing next to a villager with the trade UI open. Shows the village houses in the background too. -->
<!-- ![Villager trading](docs/trading.png) -->

**Combat & survival**
- 10 hearts, health regenerates a few seconds after you stop taking damage
- Slimes spawn at night and knock you back on contact — swords hit hardest, but fists work
- Armor reduces incoming damage via the `DEF` stat
- Screen edges pulse red when you're low on health

**Game feel**
- Smoothing camera with look-ahead and screen shake on big hits
- Particle system: mining debris, landing dust, hit splatter, lava embers
- Parallax sky with drifting clouds and rolling mountains
- Equipped item rendered in the player's hand

---

## Getting started

Because the game uses ES modules, your browser will refuse to load it from a `file://` URL. You need a local HTTP server — any of these one-liners will do:

```bash
# Python 3 (ships with most systems)
python -m http.server 8000

# Node.js
npx serve .

# PHP
php -S localhost:8000
```

Then open **http://localhost:8000** in a modern browser (Chrome, Firefox, Edge — anything from the last couple of years). That's it. No install, no build.

---

## Controls

| Action | Input |
|---|---|
| Move | `A` / `D` — or `←` / `→` |
| Jump / swim up | `Space`, `W`, or `↑` |
| Mine / attack | Hold **Left Mouse** |
| Place block / eat | **Right Mouse** |
| Trade with villager | **Right Mouse** on the villager |
| Select hotbar slot | `1`–`5` or **scroll wheel** |
| Inventory & crafting | `E` or `C` |
| Close any menu | `E` or `Esc` |
| Mute / unmute | `M` |
| Debug HUD | `F3` |
| Save / Load | `F5` / `F9` |

The world auto-loads from your last save when you open the game. Press `F5` to wipe and regenerate a fresh world if you want to start over (useful after updates that change the generator).

---

## Progression guide

If you've never played this style of game before, here's the loop:

1. **Punch trees** — yes, with your bare hands. Collect wood.
2. Open inventory (`E`) → craft `4 Wood → Planks`, then `6 Planks → Workbench`.
3. **Place the workbench** (right-click with it selected) and stand next to it. The crafting list will update with new recipes.
4. Craft a **Wood Pickaxe** — now you can mine stone.
5. Craft a **Furnace** (12 stone, at workbench) and place it.
6. Mine **coal** and **iron/gold ore** underground. Smelt ore + coal → ingots at the furnace.
7. Craft **stone → iron → gold** tools, swords, and armor. Make **torches** — caves are very dark.
8. Dig deeper for **diamond**, **lava lakes**, and whatever the villagers want to trade.

<!-- 🖼️ IMAGE SUGGESTION: A progression timeline graphic or four screenshots in a row: (1) punching a tree, (2) first workbench placed, (3) underground mining with torches, (4) kitted out in gold armor. -->
<!-- ![Progression overview](docs/progression.png) -->

---

## Architecture

The entire game is split into focused ES modules. There's no bundler — the browser loads them natively.

| Module | What it does |
|---|---|
| `config.js` | Every tunable constant: tile size, gravity, speeds, health values, damage numbers |
| `tiles.js` | Data-driven tile & item registries, hardness values, drop tables |
| `crafting.js` | Full recipe tree and craft/ingredient helpers |
| `trade.js` | Villager trade pool and trade execution logic |
| `world.js` | Tile grid storage, queries, and skylight column cache |
| `worldgen.js` | Seeded terrain, cave carving, ore vein placement, liquid pockets, village generation |
| `lighting.js` | BFS flood-fill light map with emissive source tracking |
| `particles.js` | Particle system and floating combat/pickup text |
| `sound.js` | Procedural Web Audio sound effects — no asset files |
| `physics.js` | Pure AABB-vs-grid collision with liquid buoyancy |
| `player.js` | Movement, jump, vitals, fall tracking, armor damage reduction |
| `inventory.js` | Backpack, hotbar, armor slots, held-stack drag logic |
| `drop.js` | Dropped-item entity with gravity and magnet pickup radius |
| `input.js` | Keyboard and mouse state, key and click edge events |
| `enemy.js` | Slime enemy — health, knockback, night spawning |
| `npc.js` | Villager AI — home-seeking, wandering, hunger, trade UI |
| `renderer.js` | Camera, tile culling, lighting composite, entity and UI rendering |
| `save.js` | Serialize/deserialize world, player, inventory, armor, and villagers to localStorage |
| `game.js` | Main loop and the wiring that connects every system |

### Adding new content

The registries in `tiles.js` and `crafting.js` are intentionally data-driven so you don't have to touch the engine to add things:

- **New block:** add a `TILES` entry (id, color, hardness, solid, optional flags like `needsPick`, `emissive`, `ore`), an `ITEMS` entry, and a `TILE_DROPS` mapping.
- **New item / tool / weapon / armor / food:** one `ITEMS` entry with the right `kind`, then a `RECIPES` line in `crafting.js`.
- **New trade good:** add an entry to `TRADE_POOL` in `trade.js`.
- **Tune feel or balance:** all the physics and survival constants live in `config.js` (`MAX_HP`, `SAFE_FALL_TILES`, `LAVA_DPS`, `SLIME_TOUCH_DMG`, …).
- **New entity:** follow the pattern in `enemy.js` — a body `{x, y, vx, vy, w, h}` passed to `stepBody`, update logic in the game loop, draw in `renderer.js`.

---

## Known limitations / design decisions

- **Liquids don't flow.** Water and lava stay in the pockets the generator placed them in. It's on the list.
- **Single save slot.** The world is stored as JSON in `localStorage`, with the tile grid base64-encoded. It's simple and it works for the scale of this project.
- **Save compatibility.** Saves from older versions load fine, but the inventory field was added later — very old saves will start you with an empty backpack. Hit `F5` to regenerate if you want a clean slate.
- **No mobile support.** It's keyboard + mouse only right now.

---

## Contributing

This is a solo project and currently not accepting pull requests — but if you find a bug or have a clever idea, feel free to [open an issue](https://github.com/Wa3tE4/GoldCraft/issues). I'd love to hear what people think.

---

## License

[MIT](LICENSE) — do whatever you want with it, just don't pretend you wrote the whole thing from scratch. *short term open source*
