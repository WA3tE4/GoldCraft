# 💰 GoldCraft

<p align="center">

![Status](https://img.shields.io/badge/status-playable-brightgreen?style=for-the-badge)
![Made With](https://img.shields.io/badge/made%20with-Vanilla%20JavaScript-F7DF1E?style=for-the-badge\&logo=javascript\&logoColor=black)
![Rendering](https://img.shields.io/badge/rendering-HTML5%20Canvas-E34F26?style=for-the-badge\&logo=html5\&logoColor=white)
![Genre](https://img.shields.io/badge/genre-survival%20sandbox-8b5cf6?style=for-the-badge)

</p>

<p align="center">

![Repo Size](https://img.shields.io/github/repo-size/Wa3tE4/GoldCraft?style=flat-square)
![Last Commit](https://img.shields.io/github/last-commit/Wa3tE4/GoldCraft?style=flat-square)
![Issues](https://img.shields.io/github/issues/Wa3tE4/GoldCraft?style=flat-square)
![Stars](https://img.shields.io/github/stars/Wa3tE4/GoldCraft?style=flat-square)
![License](https://img.shields.io/github/license/Wa3tE4/GoldCraft?style=flat-square)

</p>

<p align="center">
<b>Punch trees.</b> • <b>Dig holes.</b> • <b>Accidentally fall into lava.</b>
</p>

<p align="center">
A tiny <b>Terraria-inspired</b> survival sandbox built entirely with
<b>vanilla JavaScript</b> and <b>HTML Canvas</b>.
</p>

---

## 📸 Screenshot

> Visuals.


> <img width="1279" height="904" alt="image" src="https://github.com/user-attachments/assets/aace053a-f62a-4de9-94dc-f49b1ef376f1" />

>Sneak Peek at the next update.
>
><img width="1598" height="906" alt="image" src="https://github.com/user-attachments/assets/a0840bb7-cb01-4649-9f96-e8e301ffb4a2" />
><img width="1594" height="906" alt="image" src="https://github.com/user-attachments/assets/d8fa5a3b-7022-47a5-b37b-f4a7a7cb876e" />




---

## ✨ Features

### 🌎 Procedural Worlds

* Random terrain generation
* Cave systems
* Ore veins

  * Coal
  * Iron
  * Gold
  * Diamond
* Underground lakes
* Lava pools
* Villages with NPCs

Every world is different.

---

### ⛏️ Survival Progression

You start with **absolutely nothing**.

* Punch trees for wood
* Craft planks
* Build a workbench
* Make your first pickaxe
* Mine stone and ores
* Smelt ingots
* Upgrade your gear
* Explore deeper caves

Simple in theory.

---

### 🎒 Inventory & Equipment

* Drag-and-drop inventory
* Hotbar
* Armor slots
* World item drops
* Magnetic pickups
* Floating pickup text

Equip helmets, chestplates, and greaves to increase your defense and survive longer underground.

---

### 🔨 Crafting

Craft nearly everything in the game.

Includes:

* Workbench crafting
* Furnace smelting
* Tools
* Weapons
* Armor
* Food
* Torches
* Glass
* Building blocks

Some recipes require standing near a crafting station.

---

### 💡 Dynamic Lighting

Terreria uses a flood-fill lighting engine featuring:

* Smooth gradient lighting
* Dynamic torch glow
* Glowing lava
* Day/night skylight
* Ambient cave darkness
* Emissive light sources

Caves are actually dark.

Bring torches.

---

### 🌊 Liquids

The world contains:

* 💧 Water
* 🔥 Lava

Water lets you swim and cancels fall damage.

Lava is lava.

---

### ⚔️ Combat & Survival

Survive against:

* Night-time slimes
* Gravity
* Lava
* Massive falls
* Your own poor decisions

Features:

* Health system
* Armor and defense
* Fall damage
* Lava damage over time
* Health regeneration
* Knockback
* Respawning
* Low-health screen effects

---

### 🏘️ Villagers

Villagers are fully simulated NPCs.

They:

* Wander villages
* Return home at night
* Eat food
* Get hungry
* Heal over time
* Trade items
* Permanently die

Trade with them for:

* Food
* Torches
* Ingots
* Weapons
* Armor
* Rare materials

Try not to set their houses on fire.

---

### ✨ Game Feel

A surprising amount of effort went into making things feel good:

* Procedural sound effects via Web Audio
* Smooth camera movement
* Camera look-ahead
* Screen shake
* Mining particles
* Landing dust
* Lava embers
* Floating damage numbers
* Jump squash-and-stretch
* Equipped items shown in hand
* Parallax mountains
* Drifting clouds

Small details matter.

---

## 🚀 Running the Game

Because the game uses ES Modules, browsers won't allow it to run directly from `file://`.

Serve the folder over HTTP instead.

### Python

```bash
python -m http.server 8000
```

### Node

```bash
npx serve .
```

Then open:

```text
http://localhost:8000
```

in any modern browser.

---

## 🎮 Controls

| Action               | Keys                    |
| -------------------- | ----------------------- |
| Move                 | `A / D` or `← / →`      |
| Jump / Swim Up       | `W`, `↑`, or `Space`    |
| Mine / Attack        | Hold Left Mouse         |
| Place Block          | Right Mouse             |
| Eat Food             | Right Mouse             |
| Trade with Villager  | Right Mouse on villager |
| Select Hotbar        | `1-5` or Mouse Wheel    |
| Inventory & Crafting | `E` or `C`              |
| Close Menus          | `Esc` or `E`            |
| Mute Sound           | `M`                     |
| Toggle Debug         | `F3`                    |
| Save                 | `F5`                    |
| Load                 | `F9`                    |

The world automatically loads your previous save.

---

## 🌳 Early Game Guide

1. Punch trees for wood.
2. Craft **Planks**.
3. Craft a **Workbench**.
4. Make a **Wood Pickaxe**.
5. Mine stone.
6. Craft a **Furnace**.
7. Gather coal and ores.
8. Smelt ingots.
9. Upgrade your tools and armor.
10. Dig deeper.

If you think you've dug deep enough...

you probably haven't.

---

## 🏗️ Project Structure

| Module         | Purpose                      |
| -------------- | ---------------------------- |
| `config.js`    | Constants, physics, vitals   |
| `tiles.js`     | Tiles, items, drops          |
| `crafting.js`  | Recipes and crafting helpers |
| `trade.js`     | Villager trades              |
| `world.js`     | Tile grid + world data       |
| `worldgen.js`  | Terrain, caves, villages     |
| `lighting.js`  | Flood-fill lighting engine   |
| `particles.js` | Particles + floating text    |
| `sound.js`     | Procedural audio             |
| `physics.js`   | AABB collision + liquids     |
| `player.js`    | Player movement & vitals     |
| `inventory.js` | Inventory + armor            |
| `drop.js`      | Dropped items                |
| `input.js`     | Keyboard + mouse input       |
| `enemy.js`     | Slime AI                     |
| `npc.js`       | Villager AI                  |
| `renderer.js`  | Rendering + UI               |
| `save.js`      | Save / load                  |
| `game.js`      | Main loop                    |

---

## 📝 Notes

* Worlds are stored as a single `Uint8Array` grid (`400×200` tiles).
* Saves are stored in `localStorage`.
* Older saves still load.
* Liquids currently don't flow.
* Caves are intentionally dark.

If that's too spooky, increase `AMBIENT` inside `renderer.js`.

---

## ❤️ Why?

Because building games from scratch is fun.

And because sometimes it's nice to remember that you don't need a giant engine, dozens of dependencies, or a fancy build system to make something cool.

Sometimes all you need is:

a canvas,

a few thousand blocks,

and an unhealthy fascination with digging straight down.


