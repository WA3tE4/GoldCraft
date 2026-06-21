import { TILE, CAM_SMOOTH, CAM_LOOKAHEAD } from "./config.js";
import { tileDef, TILE_IDS, ITEMS, maxStack } from "./tiles.js";
import { LightMap, MAX_LIGHT } from "./lighting.js";
import { hasIngredients } from "./crafting.js";

const AMBIENT = 0.16; // minimum brightness so dark areas stay faintly readable

// Owns the camera and all drawing: culled tiles, smooth lighting, parallax sky,
// entities, particles, and all UI.
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.camX = 0;
    this.camY = 0;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this._camInit = false;
    this.lightMap = new LightMap();
    this._lbuf = null;          // offscreen light buffer
    this.clouds = Array.from({ length: 9 }, () => ({
      x: Math.random(), y: Math.random() * 0.4, s: 0.5 + Math.random(), spd: 0.004 + Math.random() * 0.01,
    }));
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.ctx.imageSmoothingEnabled = false;
  }

  get vw() { return this.canvas.width; }
  get vh() { return this.canvas.height; }

  addShake(mag) { this.shake = Math.min(14, Math.max(this.shake, mag)); }

  // Smoothly follow the player with velocity look-ahead; update screen shake.
  centerOn(px, py, world, dt = 0.016, vx = 0) {
    let tx = px + vx * CAM_LOOKAHEAD - this.vw / 2;
    let ty = py - this.vh / 2;
    tx = Math.max(0, Math.min(tx, world.w * TILE - this.vw));
    ty = Math.max(0, Math.min(ty, world.h * TILE - this.vh));
    if (!this._camInit) { this.camX = tx; this.camY = ty; this._camInit = true; }
    const k = 1 - Math.exp(-CAM_SMOOTH * dt);
    this.camX = Math.round(this.camX + (tx - this.camX) * k);
    this.camY = Math.round(this.camY + (ty - this.camY) * k);

    this.shake = Math.max(0, this.shake - dt * 30);
    this.shakeX = (Math.random() * 2 - 1) * this.shake;
    this.shakeY = (Math.random() * 2 - 1) * this.shake;
  }

  // Shake is applied as a draw-time translate so cursor/world math stays exact.
  beginShake() { this.ctx.save(); this.ctx.translate(Math.round(this.shakeX), Math.round(this.shakeY)); }
  endShake() { this.ctx.restore(); }

  screenToWorld(sx, sy) { return { x: sx + this.camX, y: sy + this.camY }; }

  // Daylight 0..1 from the day-cycle phase (0.5 = noon).
  daylight(dayT) {
    return Math.max(0, Math.sin(dayT * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5);
  }

  drawSky(dayT) {
    const ctx = this.ctx;
    const b = this.daylight(dayT);
    const top = mix([8, 10, 28], [82, 150, 235], b);
    const bot = mix([24, 26, 52], [165, 205, 245], b);
    const g = ctx.createLinearGradient(0, 0, 0, this.vh);
    g.addColorStop(0, rgb(top));
    g.addColorStop(1, rgb(bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);

    // Stars at night + a sun/moon disc.
    if (b < 0.5) {
      ctx.fillStyle = `rgba(255,255,255,${(0.5 - b) * 0.9})`;
      for (let i = 0; i < 60; i++) {
        const sx = (i * 137.5) % this.vw;
        const sy = (i * 71.3) % (this.vh * 0.6);
        ctx.fillRect(sx, sy, 2, 2);
      }
    }
    // Sun / moon with a soft halo.
    const ang = dayT * Math.PI * 2 - Math.PI / 2;
    const cx = this.vw / 2 + Math.cos(ang) * this.vw * 0.42;
    const cy = this.vh * 0.55 + Math.sin(ang) * this.vh * 0.42;
    const disc = b > 0.3 ? "#ffe9a8" : "#dfe7f5";
    const halo = ctx.createRadialGradient(cx, cy, 8, cx, cy, 90);
    halo.addColorStop(0, b > 0.3 ? "rgba(255,228,150,0.5)" : "rgba(200,215,255,0.35)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo; ctx.fillRect(cx - 90, cy - 90, 180, 180);
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle = disc; ctx.fill();
  }

  // Drifting clouds + layered parallax hills for depth, behind the world.
  drawBackground(dayT, t) {
    const ctx = this.ctx;
    const b = this.daylight(dayT);

    // Clouds
    for (const c of this.clouds) {
      c.x += c.spd * 0.02;
      if (c.x > 1.2) c.x = -0.2;
      const x = c.x * this.vw;
      const y = (0.06 + c.y) * this.vh;
      const s = c.s;
      ctx.fillStyle = `rgba(${b > 0.4 ? "245,248,255" : "150,160,190"},${0.18 + b * 0.22})`;
      this._blob(x, y, 34 * s, 16 * s);
      this._blob(x + 26 * s, y + 5 * s, 26 * s, 13 * s);
      this._blob(x - 24 * s, y + 6 * s, 22 * s, 12 * s);
    }

    // Two parallax mountain ridges, scrolling slower than the world.
    this._ridge(this.camX * 0.25, this.vh * 0.62, 150, 0.0016, mix([30, 40, 60], [70, 95, 120], b));
    this._ridge(this.camX * 0.45, this.vh * 0.72, 110, 0.0026, mix([24, 32, 48], [54, 78, 96], b));
  }

  _blob(x, y, rw, rh) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
  }
  _ridge(offset, baseY, height, freq, color) {
    const ctx = this.ctx;
    ctx.fillStyle = rgb(color);
    ctx.beginPath();
    ctx.moveTo(0, this.vh);
    for (let x = 0; x <= this.vw; x += 8) {
      const wx = x + offset;
      const y = baseY - (Math.sin(wx * freq) * 0.5 + Math.sin(wx * freq * 2.3 + 1.7) * 0.3 + 0.5) * height;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(this.vw, this.vh);
    ctx.closePath(); ctx.fill();
  }

  // Compute lighting for the visible window (+margin) before drawing tiles.
  computeLight(world, dayT) {
    const x0 = Math.floor(this.camX / TILE) - 6;
    const y0 = Math.floor(this.camY / TILE) - 6;
    const x1 = Math.ceil((this.camX + this.vw) / TILE) + 6;
    const y1 = Math.ceil((this.camY + this.vh) / TILE) + 6;
    // Night keeps a dim moonlight floor so the surface isn't pitch black.
    const skyLevel = Math.round((0.18 + 0.82 * this.daylight(dayT)) * MAX_LIGHT);
    this.lightMap.compute(world, x0, y0, x1, y1, skyLevel);
  }

  drawWorld(world, t) {
    const ctx = this.ctx;
    const x0 = Math.floor(this.camX / TILE);
    const y0 = Math.floor(this.camY / TILE);
    const x1 = Math.ceil((this.camX + this.vw) / TILE);
    const y1 = Math.ceil((this.camY + this.vh) / TILE);

    // Tiles are drawn at full brightness; the smooth light overlay (drawn after
    // entities) handles all shading. This kills the old blocky shadows.
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const id = world.get(tx, ty);
        const sx = tx * TILE - this.camX;
        const sy = ty * TILE - this.camY;

        if (id === TILE_IDS.AIR) {
          // Enclosed/underground air gets a dark cave backdrop; open sky is skipped.
          if (ty >= world.skyTop[tx]) {
            ctx.fillStyle = "#15110f";
            ctx.fillRect(sx, sy, TILE, TILE);
          }
          continue;
        }

        const def = tileDef(id);
        if (def.liquid) { this.drawLiquid(def, sx, sy, tx, ty, t); continue; }

        ctx.fillStyle = def.color;
        ctx.fillRect(sx, sy, TILE, TILE);

        const n = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
        if (def.ore) {
          ctx.fillStyle = def.oreColor;
          for (let i = 0; i < 4; i++) {
            const fx = sx + 2 + ((n >> (i * 3)) % 11);
            const fy = sy + 2 + ((n >> (i * 3 + 2)) % 11);
            ctx.fillRect(fx, fy, 3, 3);
          }
          ctx.fillStyle = "rgba(255,255,255,0.4)";
          ctx.fillRect(sx + 3 + (n % 9), sy + 3 + ((n >> 5) % 9), 1, 1);
        } else if (def.glass) {
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fillRect(sx + 2, sy + 2, 4, 4);
        } else {
          ctx.fillStyle = "rgba(0,0,0,0.10)";
          ctx.fillRect(sx + (n % 13), sy + ((n >> 4) % 13), 3, 3);
        }

        // Cube shading: top highlight + bottom shade.
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fillRect(sx, sy, TILE, 2);
        ctx.fillStyle = "rgba(0,0,0,0.14)";
        ctx.fillRect(sx, sy + TILE - 2, TILE, 2);

        // Grass tufts poking up from grass exposed to air above.
        if (id === TILE_IDS.GRASS && !tileDef(world.get(tx, ty - 1)).solid) {
          ctx.fillStyle = "#5bbf4a";
          ctx.fillRect(sx + (n % 4), sy - 2, 2, 3);
          ctx.fillRect(sx + 6 + ((n >> 3) % 4), sy - 3, 2, 4);
          ctx.fillRect(sx + 11 + ((n >> 6) % 3), sy - 2, 2, 3);
        }

        if (id === TILE_IDS.TORCH) this.drawTorch(sx, sy, t);
      }
    }
  }

  // Render the light map as a smooth dark veil: low-res buffer (1px/tile) drawn
  // upscaled with bilinear smoothing, so shadows are soft gradients not blocks.
  drawLightOverlay(world) {
    const L = this.lightMap;
    if (!L.w || !L.h) return;
    if (!this._lbuf || this._lbuf.canvas.width < L.w || this._lbuf.canvas.height < L.h) {
      const c = document.createElement("canvas");
      c.width = Math.max(L.w, 256); c.height = Math.max(L.h, 256);
      this._lbuf = { canvas: c, ctx: c.getContext("2d") };
    }
    const buf = this._lbuf;
    const img = buf.ctx.createImageData(L.w, L.h);
    const data = img.data;
    for (let j = 0; j < L.h; j++) {
      const ty = L.y0 + j;
      for (let i = 0; i < L.w; i++) {
        const tx = L.x0 + i;
        const o = (j * L.w + i) * 4;
        // Don't darken open sky — the sky gradient + vignette own day/night there.
        if (ty < world.skyTop[tx]) { data[o + 3] = 0; continue; }
        const bright = Math.max(AMBIENT, L.light[j * L.w + i] / MAX_LIGHT);
        data[o] = 6; data[o + 1] = 7; data[o + 2] = 16; // cool near-black
        data[o + 3] = Math.round((1 - bright) * 255);
      }
    }
    buf.ctx.putImageData(img, 0, 0);
    const dx = L.x0 * TILE - this.camX;
    const dy = L.y0 * TILE - this.camY;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buf.canvas, 0, 0, L.w, L.h, dx, dy, L.w * TILE, L.h * TILE);
    ctx.imageSmoothingEnabled = false;
  }

  // Warm additive glow around lava/torches/furnaces, on top of the dark veil.
  drawGlow(t) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const s of this.lightMap.sources) {
      const cx = s.tx * TILE + TILE / 2 - this.camX;
      const cy = s.ty * TILE + TILE / 2 - this.camY;
      const flick = 1 + Math.sin(t * 11 + s.tx * 1.3) * 0.08;
      const rad = (s.e / MAX_LIGHT) * TILE * 5.5 * flick;
      const warm = s.id === TILE_IDS.WATER ? "rgba(90,150,230," : "rgba(255,170,70,";
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
      g.addColorStop(0, warm + "0.5)");
      g.addColorStop(1, warm + "0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    ctx.restore();
  }

  drawLiquid(def, sx, sy, tx, ty, t) {
    const ctx = this.ctx;
    const wave = Math.sin(t * 2 + tx * 0.6) * 1.5;
    const emissive = (def.emissive || 0) > 0;
    ctx.globalAlpha = emissive ? 0.92 : 0.72;
    ctx.fillStyle = def.color;
    ctx.fillRect(sx, sy + 2 + wave, TILE, TILE - 2 - wave);
    ctx.globalAlpha = 1;
    ctx.fillStyle = emissive ? "rgba(255,220,120,0.5)" : "rgba(255,255,255,0.25)";
    ctx.fillRect(sx, sy + 2 + wave, TILE, 2);
  }

  drawTorch(sx, sy, t) {
    const ctx = this.ctx;
    ctx.fillStyle = "#6b4322";
    ctx.fillRect(sx + TILE / 2 - 1, sy + 6, 3, TILE - 6);
    const flick = Math.sin(t * 12) * 1.2;
    ctx.fillStyle = "#ffd24d";
    ctx.beginPath();
    ctx.ellipse(sx + TILE / 2, sy + 5 + flick, 3.2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff7a1a";
    ctx.beginPath();
    ctx.ellipse(sx + TILE / 2, sy + 6 + flick, 2, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawMiningOverlay(tile, progress) {
    if (!tile || progress <= 0) return;
    const ctx = this.ctx;
    const sx = tile.tx * TILE - this.camX;
    const sy = tile.ty * TILE - this.camY;
    ctx.strokeStyle = `rgba(0,0,0,${0.3 + progress * 0.5})`;
    ctx.lineWidth = 1;
    const steps = Math.ceil(progress * 4);
    for (let i = 0; i < steps; i++) {
      ctx.beginPath();
      ctx.moveTo(sx + 2 + i * 3, sy + 2);
      ctx.lineTo(sx + 6 + i * 3, sy + TILE - 2);
      ctx.stroke();
    }
  }

  drawCursor(tile, inReach) {
    const ctx = this.ctx;
    const sx = tile.tx * TILE - this.camX;
    const sy = tile.ty * TILE - this.camY;
    ctx.strokeStyle = inReach ? "rgba(255,255,255,0.7)" : "rgba(255,80,80,0.7)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
  }

  drawPlayer(player, held) {
    const ctx = this.ctx;
    // Blink during i-frames after taking a hit.
    if (player.invuln > 0 && Math.floor(performance.now() / 80) % 2 === 0) return;
    const sx = Math.round(player.x - this.camX);
    const sy = Math.round(player.y - this.camY);
    const w = player.w, h = player.h;
    const f = player.facing;
    const swingLeg = Math.sin(player.animTime) * 5;
    const sq = player.squashY, sw = 1 / Math.sqrt(sq);

    ctx.save();
    ctx.translate(sx + w / 2, sy + h);  // pivot at the feet
    ctx.scale(f * sw, sq);              // facing flip + jump/land squash
    ctx.translate(0, -h);               // back to a top-origin coordinate frame

    // legs (animated)
    ctx.fillStyle = "#2b5fa8";
    ctx.fillRect(-w / 2 + 1, h * 0.6, 4, h * 0.4 - swingLeg);
    ctx.fillRect(w / 2 - 5, h * 0.6, 4, h * 0.4 + swingLeg);
    // body
    ctx.fillStyle = "#c75b3a";
    ctx.fillRect(-w / 2, h * 0.3, w, h * 0.35);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(-w / 2, h * 0.3, w, 2);
    // head
    ctx.fillStyle = "#e8c39e";
    ctx.fillRect(-w / 2 + 1, 0, w - 2, h * 0.32);
    ctx.fillStyle = "#3a2a1a"; // hair
    ctx.fillRect(-w / 2 + 1, 0, w - 2, 3);
    ctx.fillStyle = "#1a1a1a"; // eye
    ctx.fillRect(w / 2 - 4, 6, 2, 2);
    // arm — swings while mining/attacking; the equipped item is held at the hand
    const arm = player.swing > 0 ? -1.2 + player.swing * 1.6 : -0.2;
    ctx.save();
    ctx.translate(w / 2 - 2, h * 0.34);
    ctx.rotate(arm);
    ctx.fillStyle = "#b34e30";
    ctx.fillRect(0, 0, 3, h * 0.32);
    if (held) this._heldInHand(held, h);
    ctx.restore();

    ctx.restore();

    if (player.hurtFlash > 0) { ctx.fillStyle = `rgba(255,60,60,${player.hurtFlash})`; ctx.fillRect(sx - 2, sy - 2, w + 4, h + 4); }
  }

  // Draw the equipped item in the player's hand (called inside the arm transform).
  _heldInHand(held, h) {
    const ctx = this.ctx;
    const def = ITEMS[held.item];
    if (!def) return;
    ctx.save();
    ctx.translate(1.5, h * 0.32); // the hand, at the end of the arm
    if (def.kind === "weapon") {
      ctx.fillStyle = "#caa15a"; ctx.fillRect(-3, -1, 6, 2);     // guard
      ctx.fillStyle = def.color; ctx.fillRect(-1.5, 1, 3, 13);   // blade
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(-1.5, 1, 1, 13);
    } else if (def.kind === "tool") {
      ctx.fillStyle = "#6b4a2b"; ctx.fillRect(-1, -1, 2, 12);    // handle
      ctx.fillStyle = def.color; ctx.fillRect(-4, 9, 8, 3);      // head
    } else if (def.kind === "block") {
      ctx.fillStyle = def.color; ctx.fillRect(-3, 1, 6, 6);      // mini cube
      ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(-3, 1, 6, 1.5);
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 0.5; ctx.strokeRect(-3, 1, 6, 6);
    } else if (def.icon) {
      ctx.font = "9px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = def.color; ctx.fillText(def.icon, 0, 6);
    } else {
      ctx.fillStyle = def.color; ctx.fillRect(-2.5, 2, 5, 5);    // generic
    }
    ctx.restore();
  }

  // Small floating health bar over a hurt creature (only when damaged).
  _entityHealthBar(e, sx, sy) {
    if (e.hp >= e.maxHp) return;
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(sx - 1, sy - 7, e.w + 2, 4);
    ctx.fillStyle = "#e05a5a";
    ctx.fillRect(sx, sy - 6, e.w * Math.max(0, e.hp / e.maxHp), 2);
  }

  drawSlime(s) {
    const ctx = this.ctx;
    const squash = s.squash * 4;
    const sx = Math.round(s.x - this.camX);
    const sy = Math.round(s.y - this.camY + squash);
    ctx.fillStyle = s.hurtFlash > 0 ? "#d6f5dd" : "#4fb36b";
    ctx.fillRect(sx, sy, s.w, s.h - squash);
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(sx + 2, sy + 2, s.w - 6, 2);
    ctx.fillStyle = "#0d2e18";
    ctx.fillRect(sx + 3, sy + 4, 2, 2);
    ctx.fillRect(sx + s.w - 5, sy + 4, 2, 2);
    this._entityHealthBar(s, sx, sy);
  }

  drawVillager(v) {
    const ctx = this.ctx;
    const sx = Math.round(v.x - this.camX);
    const sy = Math.round(v.y - this.camY);
    const w = v.w, h = v.h, f = v.facing;
    const legSwing = Math.sin(v.animTime) * 4;

    ctx.save();
    ctx.translate(sx + w / 2, sy);
    ctx.scale(f, 1);
    ctx.fillStyle = "#3a3a4a";
    ctx.fillRect(-w / 2 + 1, h * 0.6, 4, h * 0.4 - legSwing);
    ctx.fillRect(w / 2 - 5, h * 0.6, 4, h * 0.4 + legSwing);
    ctx.fillStyle = v.color; // robe
    ctx.fillRect(-w / 2, h * 0.28, w, h * 0.4);
    ctx.fillStyle = "#e8c39e"; // head
    ctx.fillRect(-w / 2 + 1, 0, w - 2, h * 0.3);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(w / 2 - 4, 5, 2, 2);
    ctx.restore();

    // name + food bar floating above
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(sx - 4, sy - 16, w + 8, 11);
    ctx.fillStyle = "#fff";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(v.name, sx + w / 2, sy - 15);
    ctx.fillStyle = "#3a1a1a";
    ctx.fillRect(sx - 2, sy - 4, w + 4, 3);
    ctx.fillStyle = v.food > 0.3 ? "#7bd86f" : "#e05a5a";
    ctx.fillRect(sx - 2, sy - 4, (w + 4) * v.food, 3);

    if (v.hurtFlash > 0) { ctx.fillStyle = `rgba(255,60,60,${v.hurtFlash * 2})`; ctx.fillRect(sx, sy, w, h); }
  }

  drawParticles(particles) { particles.draw(this.ctx, this.camX, this.camY); }
  drawFloatingTexts(particles) { particles.drawFloats(this.ctx, this.camX, this.camY); }

  // Player health hearts (top-left) + a red screen pulse when low.
  drawHealth(player) {
    const ctx = this.ctx;
    const hearts = 10, perHeart = player.maxHp / hearts;
    const x0 = 12, y0 = 12, size = 16, gap = 3;
    for (let i = 0; i < hearts; i++) {
      const x = x0 + i * (size + gap);
      const fill = Math.max(0, Math.min(1, player.hp / perHeart - i));
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(x - 1, y0 - 1, size + 2, size + 2);
      ctx.fillStyle = "#3a1418"; // empty heart
      this._heart(x, y0, size);
      if (fill > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y0, size * fill, size);
        ctx.clip();
        ctx.fillStyle = "#e23a4e";
        this._heart(x, y0, size);
        ctx.restore();
      }
    }
  }

  _heart(x, y, s) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y + s * 0.85);
    ctx.bezierCurveTo(x - s * 0.1, y + s * 0.45, x + s * 0.2, y + s * 0.02, x + s / 2, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.8, y + s * 0.02, x + s * 1.1, y + s * 0.45, x + s / 2, y + s * 0.85);
    ctx.fill();
  }

  drawLowHealth(player) {
    const frac = player.hp / player.maxHp;
    if (frac > 0.3) return;
    const pulse = 0.18 + Math.sin(performance.now() / 180) * 0.08;
    const g = this.ctx.createRadialGradient(
      this.vw / 2, this.vh / 2, this.vh * 0.25,
      this.vw / 2, this.vh / 2, this.vh * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(160,10,10,${pulse * (1 - frac / 0.3)})`);
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, this.vw, this.vh);
  }

  drawHotbar(inv) {
    const ctx = this.ctx;
    const slot = 44, pad = 6;
    const totalW = inv.hotbarSize * (slot + pad) - pad;
    const x0 = (this.vw - totalW) / 2;
    const y0 = this.vh - slot - 12;

    for (let i = 0; i < inv.hotbarSize; i++) {
      const x = x0 + i * (slot + pad);
      ctx.fillStyle = "rgba(20,22,40,0.8)";
      ctx.fillRect(x, y0, slot, slot);
      ctx.strokeStyle = i === inv.selected ? "#f9e2af" : "rgba(255,255,255,0.25)";
      ctx.lineWidth = i === inv.selected ? 3 : 1.5;
      ctx.strokeRect(x + 0.5, y0 + 0.5, slot - 1, slot - 1);
      this.drawItemIcon(inv.slots[i], x, y0, slot);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "10px monospace";
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(i + 1, x + 3, y0 + 2);
    }
  }

  // Generic item icon: emoji if defined, else a colored chip + glyph; stack count.
  drawItemIcon(s, x, y, size) {
    if (!s) return;
    const ctx = this.ctx;
    const def = ITEMS[s.item];
    if (!def) return;
    if (def.kind === "weapon") {
      this._swordIcon(x + size / 2, y + size / 2, size, def.color);
    } else if (def.icon) {
      ctx.fillStyle = def.color;
      ctx.font = `${Math.floor(size * 0.5)}px serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(def.icon, x + size / 2, y + size / 2 - 1);
    } else {
      const m = size * 0.24;
      ctx.fillStyle = def.color;
      ctx.fillRect(x + m, y + m, size - 2 * m, size - 2 * m);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x + m, y + size - m - 2, size - 2 * m, 2); // base shadow
      if (def.glyph) {
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.font = `bold ${Math.floor(size * 0.34)}px monospace`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(def.glyph, x + size / 2, y + size / 2);
      }
    }
    if (maxStack(s.item) > 1 && s.count > 1) {
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.floor(size * 0.26)}px monospace`;
      ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      ctx.fillText(s.count, x + size - 3, y + size - 2);
    }
  }

  // A little diagonal sword: steel blade, gold crossguard, brown grip.
  _swordIcon(cx, cy, size, bladeColor) {
    const ctx = this.ctx;
    const u = size / 16; // unit scaled to the slot
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 4); // point up-right
    // blade
    ctx.fillStyle = bladeColor;
    ctx.fillRect(-1.4 * u, -6.5 * u, 2.8 * u, 8.5 * u);
    // bright edge + tip
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(-1.4 * u, -6.5 * u, 1 * u, 8.5 * u);
    ctx.beginPath();
    ctx.moveTo(-1.4 * u, -6.5 * u); ctx.lineTo(0, -8.3 * u); ctx.lineTo(1.4 * u, -6.5 * u);
    ctx.closePath(); ctx.fillStyle = bladeColor; ctx.fill();
    // crossguard
    ctx.fillStyle = "#caa15a";
    ctx.fillRect(-4 * u, 1.6 * u, 8 * u, 1.8 * u);
    // grip + pommel
    ctx.fillStyle = "#6b4a2b";
    ctx.fillRect(-1.1 * u, 3.4 * u, 2.2 * u, 3.4 * u);
    ctx.fillStyle = "#caa15a";
    ctx.fillRect(-1.5 * u, 6.6 * u, 3 * u, 1.4 * u);
    ctx.restore();
  }

  // --- Inventory screen layout (one source of truth for draw + hit-test) ---
  invLayout() {
    const cols = 5, rows = 6, slot = 44, gap = 5;
    const gridW = cols * (slot + gap) - gap;
    const gridH = rows * (slot + gap) - gap;
    const armorW = slot;
    const craftW = 250;
    const totalW = armorW + 18 + gridW + 24 + craftW;
    const x0 = (this.vw - totalW) / 2;
    const y0 = (this.vh - gridH) / 2 - 10;
    return {
      cols, rows, slot, gap, gridW, gridH, x0, y0,
      armorX: x0, gridX: x0 + armorW + 18, craftX: x0 + armorW + 18 + gridW + 24, craftW,
    };
  }
  _armorKeys() { return ["head", "body", "legs"]; }
  slotRect(L, i) {
    const c = i % L.cols, r = (i / L.cols) | 0;
    return { x: L.gridX + c * (L.slot + L.gap), y: L.y0 + r * (L.slot + L.gap), w: L.slot, h: L.slot };
  }
  armorRect(L, idx) { return { x: L.armorX, y: L.y0 + idx * (L.slot + L.gap), w: L.slot, h: L.slot }; }
  recipeRect(L, i, scroll = 0) { const rowH = 30; return { x: L.craftX, y: L.y0 + 24 + (i - scroll) * rowH, w: L.craftW, h: rowH - 3 }; }

  static CRAFT_ROWS = 9; // visible crafting rows before scrolling

  drawInventory(inv, recipes, stationAvailable, mouse, scroll = 0) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(6,8,18,0.72)";
    ctx.fillRect(0, 0, this.vw, this.vh); // dim the world behind
    const L = this.invLayout();

    // backpack grid
    for (let i = 0; i < inv.size; i++) {
      const r = this.slotRect(L, i);
      const hot = i < inv.hotbarSize;
      ctx.fillStyle = hot ? "rgba(40,40,66,0.95)" : "rgba(24,26,46,0.95)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = i === inv.selected ? "#f9e2af" : "rgba(255,255,255,0.18)";
      ctx.lineWidth = i === inv.selected ? 2.5 : 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      this.drawItemIcon(inv.slots[i], r.x, r.y, r.w);
    }

    // armor column
    const aKeys = this._armorKeys();
    const aGlyph = { head: "▲", body: "■", legs: "Ⅱ" };
    for (let i = 0; i < aKeys.length; i++) {
      const r = this.armorRect(L, i);
      ctx.fillStyle = "rgba(36,28,48,0.95)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "rgba(200,180,255,0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      const slot = inv.armor[aKeys[i]];
      if (slot) this.drawItemIcon(slot, r.x, r.y, r.w);
      else {
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.font = "18px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(aGlyph[aKeys[i]], r.x + r.w / 2, r.y + r.h / 2);
      }
    }
    ctx.fillStyle = "#cdd6f4";
    ctx.font = "11px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(`DEF ${inv.totalDefense()}`, L.armorX + L.slot / 2, L.y0 + 3 * (L.slot + L.gap) + 2);

    // title
    ctx.fillStyle = "#f9e2af";
    ctx.font = "13px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    ctx.fillText("INVENTORY  ·  click to move items  ·  E/Esc close", L.gridX, L.y0 - 6);

    // crafting list
    ctx.fillStyle = "#f9e2af";
    ctx.font = "12px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    const more = recipes.length > Renderer.CRAFT_ROWS;
    ctx.fillText(`CRAFTING (click to make)${more ? " · scroll ▲▼" : ""}`, L.craftX, L.y0 + 4);
    const end = Math.min(recipes.length, scroll + Renderer.CRAFT_ROWS);
    for (let i = scroll; i < end; i++) {
      const r = recipes[i];
      const rr = this.recipeRect(L, i, scroll);
      const can = hasIngredients(inv, r) && (!r.station || stationAvailable(r.station));
      const hover = mouse && mouse.x >= rr.x && mouse.x <= rr.x + rr.w && mouse.y >= rr.y && mouse.y <= rr.y + rr.h;
      ctx.fillStyle = hover ? "rgba(249,226,175,0.16)" : "rgba(20,22,40,0.7)";
      ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
      const out = ITEMS[r.out.item];
      this.drawItemIcon({ item: r.out.item, count: r.out.count }, rr.x + 2, rr.y + 1, rr.h - 2);
      ctx.fillStyle = can ? "#cdd6f4" : "#70748a";
      ctx.font = "11px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(`${out.name} x${r.out.count}`, rr.x + rr.h + 2, rr.y + 2);
      const reqs = r.in.map((q) => `${q.count} ${ITEMS[q.item].name}`).join(", ");
      ctx.fillStyle = can ? "#8d92a8" : "#565a6c";
      ctx.font = "9px monospace";
      ctx.fillText(reqs + (r.station ? ` [${r.station}]` : ""), rr.x + rr.h + 2, rr.y + 15);
    }

    // held stack follows the cursor; otherwise show a tooltip for the hovered item
    if (inv.held && mouse) {
      this.drawItemIcon(inv.held, mouse.x - 18, mouse.y - 18, 36);
    } else if (mouse) {
      const hit = this.invHitTest(inv, mouse.x, mouse.y);
      let key = null;
      if (hit && hit.type === "slot" && inv.slots[hit.index]) key = inv.slots[hit.index].item;
      else if (hit && hit.type === "armor" && inv.armor[hit.slot]) key = inv.armor[hit.slot].item;
      else { const ri = this.recipeHitTest(recipes, mouse.x, mouse.y, scroll); if (ri >= 0) key = recipes[ri].out.item; }
      if (key) this._tooltip(key, mouse.x, mouse.y);
    }
  }

  _tooltip(key, mx, my) {
    const ctx = this.ctx;
    const def = ITEMS[key]; if (!def) return;
    let stat = "Material";
    if (def.kind === "tool") stat = `Pickaxe · power ${def.power}`;
    else if (def.kind === "weapon") stat = `Weapon · ${def.damage} dmg`;
    else if (def.kind === "armor") stat = `Armor · +${def.defense} def (${def.slot})`;
    else if (def.kind === "food") stat = `Food · heals ${def.heal}`;
    else if (def.kind === "block") stat = "Placeable block";
    ctx.font = "12px monospace";
    const w = Math.max(ctx.measureText(def.name).width, 120) + 22;
    const x = Math.min(mx + 14, this.vw - w - 6), y = my + 14;
    ctx.fillStyle = "rgba(10,12,24,0.96)";
    ctx.fillRect(x, y, w, 34);
    ctx.strokeStyle = "#45475a"; ctx.strokeRect(x + 0.5, y + 0.5, w, 34);
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillStyle = "#f9e2af"; ctx.font = "12px monospace";
    ctx.fillText(def.name, x + 8, y + 5);
    ctx.fillStyle = "#9aa0b5"; ctx.font = "10px monospace";
    ctx.fillText(stat, x + 8, y + 20);
  }

  invHitTest(inv, mx, my) {
    const L = this.invLayout();
    for (let i = 0; i < inv.size; i++) {
      const r = this.slotRect(L, i);
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return { type: "slot", index: i };
    }
    const aKeys = this._armorKeys();
    for (let i = 0; i < aKeys.length; i++) {
      const r = this.armorRect(L, i);
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return { type: "armor", slot: aKeys[i] };
    }
    return null;
  }
  recipeHitTest(recipes, mx, my, scroll = 0) {
    const L = this.invLayout();
    const end = Math.min(recipes.length, scroll + Renderer.CRAFT_ROWS);
    for (let i = scroll; i < end; i++) {
      const r = this.recipeRect(L, i, scroll);
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return i;
    }
    return -1;
  }

  // --- Trading screen ---
  tradeLayout(v) {
    const w = 360, rowH = 38;
    const h = 50 + v.trades.length * rowH;
    return { x: (this.vw - w) / 2, y: (this.vh - h) / 2, w, h, rowH };
  }
  tradeRowRect(L, i) { return { x: L.x + 10, y: L.y + 44 + i * L.rowH, w: L.w - 20, h: L.rowH - 4 }; }

  drawTrade(v, inv, mouse) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(6,8,18,0.72)";
    ctx.fillRect(0, 0, this.vw, this.vh);
    const L = this.tradeLayout(v);
    ctx.fillStyle = "rgba(15,17,32,0.96)";
    ctx.fillRect(L.x, L.y, L.w, L.h);
    ctx.strokeStyle = "#45475a";
    ctx.strokeRect(L.x + 0.5, L.y + 0.5, L.w, L.h);
    ctx.fillStyle = "#f9e2af";
    ctx.font = "14px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(`${v.name} the trader  ·  click an offer  ·  E/Esc close`, L.x + 12, L.y + 12);

    for (let i = 0; i < v.trades.length; i++) {
      const t = v.trades[i];
      const rr = this.tradeRowRect(L, i);
      const can = inv.count(t.give.item) >= t.give.count;
      const hover = mouse && mouse.x >= rr.x && mouse.x <= rr.x + rr.w && mouse.y >= rr.y && mouse.y <= rr.y + rr.h;
      ctx.fillStyle = hover && can ? "rgba(126,216,111,0.18)" : "rgba(20,22,40,0.7)";
      ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
      this.drawItemIcon({ item: t.give.item, count: t.give.count }, rr.x + 2, rr.y + 2, rr.h - 4);
      ctx.fillStyle = can ? "#cdd6f4" : "#70748a";
      ctx.font = "12px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(`${t.give.count} ${ITEMS[t.give.item].name}`, rr.x + rr.h + 4, rr.y + rr.h / 2);
      ctx.textAlign = "center";
      ctx.fillText("→", rr.x + rr.w * 0.55, rr.y + rr.h / 2);
      this.drawItemIcon({ item: t.get.item, count: t.get.count }, rr.x + rr.w * 0.6, rr.y + 2, rr.h - 4);
      ctx.textAlign = "left";
      ctx.fillStyle = can ? "#9bd88f" : "#70748a";
      ctx.fillText(`${t.get.count} ${ITEMS[t.get.item].name}`, rr.x + rr.w * 0.6 + rr.h, rr.y + rr.h / 2);
    }
  }
  tradeHitTest(v, mx, my) {
    const L = this.tradeLayout(v);
    for (let i = 0; i < v.trades.length; i++) {
      const r = this.tradeRowRect(L, i);
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return i;
    }
    return -1;
  }

  // Dropped items lying in the world.
  drawDrops(drops) {
    const ctx = this.ctx;
    for (const d of drops) {
      const sx = Math.round(d.x - this.camX);
      const sy = Math.round(d.y - this.camY + Math.sin(d.bob) * 2);
      const def = ITEMS[d.item];
      if (!def) continue;
      ctx.fillStyle = def.color || "#fff";
      ctx.fillRect(sx, sy, d.w, d.h);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(sx, sy, d.w, 1);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, d.w - 1, d.h - 1);
    }
  }

  drawNightVignette(dayT) {
    // Soft edge darkening at night for mood (lighting handles the rest).
    const b = this.daylight(dayT);
    const d = (1 - b) * 0.35;
    if (d < 0.02) return;
    const g = this.ctx.createRadialGradient(
      this.vw / 2, this.vh / 2, this.vh * 0.3,
      this.vw / 2, this.vh / 2, this.vh * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(2,4,16,${d})`);
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, this.vw, this.vh);
  }

  drawDebug(lines) {
    const ctx = this.ctx;
    ctx.font = "12px monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    let y = 36; // below the health hearts
    for (const line of lines) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(8, y, ctx.measureText(line).width + 8, 15);
      ctx.fillStyle = "#a6e3a1";
      ctx.fillText(line, 12, y + 1);
      y += 16;
    }
  }

  toast(msg) {
    const ctx = this.ctx;
    ctx.font = "14px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const w = ctx.measureText(msg).width + 20;
    ctx.fillStyle = "rgba(20,22,40,0.85)";
    ctx.fillRect((this.vw - w) / 2, 12, w, 24);
    ctx.fillStyle = "#f9e2af";
    ctx.fillText(msg, this.vw / 2, 18);
  }
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function rgb(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
