// GoldCraft start menu — a small DOM overlay that boots the canvas game.
// Handles: New World (name + Survival/Creative), Load World (saved-world list),
// and Settings (debug, sound, screen shake, on-screen controls).
import { Game } from "./game.js";
import {
  listWorlds, loadWorld, deleteWorld, worldExists, loadSettings, saveSettings,
} from "./save.js";
import { Sound } from "./sound.js";

const root = document.getElementById("menu");
const helpEl = document.getElementById("help");
const canvas = document.getElementById("game");

const DEFAULT_SETTINGS = { sound: true, debug: false, shake: true, controls: false };
let settings = { ...DEFAULT_SETTINGS, ...loadSettings() };

// ---- helpers ----
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};
const panel = (...kids) => { root.replaceChildren(el("div", { className: "panel" }, ...kids)); };
const brand = () => el("div", { className: "brand-wrap" },
  el("div", { className: "brand", textContent: "GoldCraft" }),
  el("div", { className: "brand-rule" }),
);
const fmtDate = (t) => t ? new Date(t).toLocaleString() : "";
// A main-menu button with a leading icon + trailing chevron.
const navBtn = (icon, label, onclick, primary = false) =>
  el("button", {
    className: "menu-btn nav" + (primary ? " primary" : ""), onclick,
    innerHTML: `<span class="ico">${icon}</span><span class="txt">${escapeHtml(label)}</span>`,
  });

// ---- boot the game ----
function boot(opts) {
  root.style.display = "none";
  canvas.style.display = "block";
  document.body.classList.add("playing"); // reveals on-screen controls on touch
  helpEl.style.display = settings.controls ? "block" : "none";
  Sound.enabled = settings.sound;
  const game = new Game(opts);
  game.applySettings(settings);
}

// ---- main menu ----
function mainView() {
  panel(
    brand(),
    el("div", { className: "tagline", textContent: "mine · build · survive" }),
    navBtn("✦", "New World", newWorldView, true),
    navBtn("◷", "Load World", loadView),
    navBtn("⚙", "Settings", settingsView),
    el("div", { className: "foot", textContent: "GoldCraft · v1.0" }),
  );
}

// ---- new world ----
function newWorldView() {
  let mode = "survival";
  let dragon = true;
  const err = el("div", { className: "err" });

  // Dragon on/off — some players love the challenge, others find it relentless.
  const dragonSw = el("div", { className: "switch on" }, el("div", { className: "knob" }));
  const dragonRow = el("div", { className: "toggle" },
    el("div", {}, el("div", { textContent: "🐉 Dragon" }),
      el("small", { style: "opacity:.5", textContent: "A roaming fire-breathing boss. Off for calmer skies." })),
    dragonSw,
  );
  dragonSw.onclick = () => { dragon = !dragon; dragonSw.classList.toggle("on", dragon); };
  const name = el("input", { className: "text-input", value: suggestName(), maxLength: 24, spellcheck: false });

  const survBtn = el("button", { className: "menu-btn stack sel", innerHTML: '<span class="mode-title">⚔ Survival</span><small>Enemies, damage, gather to craft</small>' });
  const creaBtn = el("button", { className: "menu-btn stack", innerHTML: '<span class="mode-title">✦ Creative</span><small>Fly, invincible, instant build, infinite blocks</small>' });
  const pick = (m) => {
    mode = m;
    survBtn.classList.toggle("sel", m === "survival");
    creaBtn.classList.toggle("sel", m === "creative");
  };
  survBtn.onclick = () => pick("survival");
  creaBtn.onclick = () => pick("creative");

  const create = () => {
    const n = name.value.trim();
    if (!n) { err.textContent = "Please name your world."; return; }
    if (worldExists(n)) { err.textContent = `A world named "${n}" already exists.`; return; }
    boot({ worldName: n, mode, dragon });
  };
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });

  panel(
    brand(),
    el("div", { className: "field-label", textContent: "World name" }),
    name,
    el("div", { className: "field-label", textContent: "Game mode" }),
    survBtn, creaBtn,
    el("div", { className: "field-label", textContent: "Options" }),
    dragonRow,
    err,
    el("div", { className: "seg" },
      el("button", { className: "menu-btn", style: "flex:1", textContent: "← Back", onclick: mainView }),
      el("button", { className: "menu-btn primary", style: "flex:1", textContent: "✓ Create", onclick: create }),
    ),
  );
  name.focus(); name.select();
}

function suggestName() {
  const base = "World";
  if (!worldExists(base)) return base;
  for (let i = 2; i < 999; i++) if (!worldExists(`${base} ${i}`)) return `${base} ${i}`;
  return base;
}

// ---- load world ----
function loadView() {
  const worlds = listWorlds();
  const list = el("div", {});
  if (worlds.length === 0) {
    list.append(el("div", { className: "empty", textContent: "No saved worlds yet — start a new one!" }));
  } else {
    for (const w of worlds) {
      const open = el("button", {
        className: "menu-btn stack",
        innerHTML: `<span class="mode-title">${w.mode === "creative" ? "✦" : "⚔"} ${escapeHtml(w.name)}</span>` +
          `<small>${w.mode === "creative" ? "Creative" : "Survival"} · ${fmtDate(w.savedAt)}</small>`,
        onclick: () => {
          const data = loadWorld(w.name);
          if (data) boot({ worldName: w.name, mode: w.mode, loadData: data });
          else loadView();
        },
      });
      const del = el("button", {
        className: "del-btn", textContent: "✕", title: "Delete world",
        onclick: () => { if (confirm(`Delete "${w.name}"? This cannot be undone.`)) { deleteWorld(w.name); loadView(); } },
      });
      list.append(el("div", { className: "world-row" }, open, del));
    }
  }
  panel(
    brand(),
    el("div", { className: "tagline", textContent: "Load World" }),
    list,
    el("button", { className: "menu-btn", textContent: "← Back", onclick: mainView }),
  );
}

// ---- settings ----
function settingsView() {
  const toggle = (label, key, desc) => {
    const sw = el("div", { className: "switch" + (settings[key] ? " on" : "") }, el("div", { className: "knob" }));
    sw.onclick = () => {
      settings[key] = !settings[key];
      sw.classList.toggle("on", settings[key]);
      saveSettings(settings);
    };
    return el("div", { className: "toggle" },
      el("div", {}, el("div", { textContent: label }), el("small", { style: "opacity:.5", textContent: desc })),
      sw,
    );
  };

  panel(
    brand(),
    el("div", { className: "tagline", textContent: "Settings" }),
    toggle("🐞 Debug overlay", "debug", "FPS / position / world info (toggle in-game with F3)"),
    toggle("🔊 Sound", "sound", "Music & effects (toggle in-game with M)"),
    toggle("🎬 Screen shake", "shake", "Camera kick on hits and explosions"),
    toggle("⌨ On-screen controls", "controls", "Show the keybind hints at the bottom-left"),
    el("div", { className: "hint", innerHTML:
      "In-game keys &nbsp; " +
      "<kbd>A</kbd>/<kbd>D</kbd> move · <kbd>Space</kbd> jump · <kbd>LMB</kbd> mine/attack · " +
      "<kbd>RMB</kbd> place/use · <kbd>1</kbd>–<kbd>5</kbd> hotbar · <kbd>E</kbd> inventory · " +
      "<kbd>M</kbd> mute · <kbd>F3</kbd> debug · <kbd>F5</kbd> save · <kbd>F9</kbd> reload · <kbd>F10</kbd> quit to menu" }),
    el("button", { className: "menu-btn", textContent: "← Back", onclick: () => { saveSettings(settings); mainView(); } }),
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

mainView();
