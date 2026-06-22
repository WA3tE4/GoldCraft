import { TILE, CAM_SMOOTH, CAM_LOOKAHEAD } from "./config.js";
import { tileDef, wallDef, TILE_IDS, ITEMS, maxStack } from "./tiles.js";
import { LightMap, MAX_LIGHT } from "./lighting.js";
import { hasIngredients } from "./crafting.js";
import { GANGS } from "./npc.js";

const AMBIENT = 0.22;      // minimum brightness so dark caves stay faintly readable
const WALL_AMBIENT = 0.42; // walled-in rooms keep a cozy "indoors" glow, never pitch black
const SKY_REACH = 5;       // how many tiles sideways daylight reaches to keep exposed pillars/edges lit

// Label + color for the active-buff HUD chips (see drawBuffs).
const BUFF_META = {
  speed:    { label: "Swift",      color: "#67e8f9" },
  jump:     { label: "Bounce",     color: "#a3e635" },
  feather:  { label: "Feather",    color: "#e2e8f0" },
  regen:    { label: "Regen",      color: "#f472b6" },
  strength: { label: "Berserk",    color: "#ef4444" },
  haste:    { label: "Haste",      color: "#fbbf24" },
  god:      { label: "Invincible", color: "#fde047" },
  fly:      { label: "Flight",     color: "#f8fafc" },
  boat:     { label: "Sailing",    color: "#b5793f" },
  godhood:  { label: "GODHOOD",    color: "#fff3b0" },
  drunk:    { label: "Drunk",      color: "#e0a52a" },
  buzzed:   { label: "Buzzed",     color: "#cdbfa0" },
  high:     { label: "High",       color: "#69b34c" },
  wired:    { label: "Wired",      color: "#dbeafe" },
  cracked:  { label: "CRACKED",    color: "#fca5a5" },
};

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
    this.shakeEnabled = true;   // toggled from the settings menu
    this._camInit = false;
    this.lightMap = new LightMap();
    this._lbuf = null;          // offscreen light buffer
    this._initBackground();
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

  // On touch devices the hotbar rides above the on-screen thumb buttons so it
  // stays tappable and clear of the jump / move clusters.
  get hotbarLift() { return document.body.classList.contains("touch") ? 24 : 0; }

  addShake(mag) { if (this.shakeEnabled) this.shake = Math.min(14, Math.max(this.shake, mag)); }

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

  // ---------------------------------------------------------------------------
  // BACKGROUND SYSTEM
  // Layered, parallaxed sky designed for atmospheric depth: gradient sky, stars,
  // sun/moon, three procedural mountain ranges with fog between them, three cloud
  // layers, and ambient biome particles. See drawSky / drawBackground / drawWeather.
  // ---------------------------------------------------------------------------

  // One-time procedural setup: a seeded RNG drives stars, mountain profiles, and
  // the three cloud fields so the scene is rich but deterministic per session.
  _initBackground() {
    const rng = mulberry32(0x9e3779b9);
    this._bgRng = rng;
    this._lastBgT = null;
    this._shoot = null;       // active shooting star / comet, or null
    this._nextShoot = 6 + rng() * 14;

    // Stars: scattered across the upper sky, varied size/brightness/twinkle.
    this.stars = Array.from({ length: 150 }, () => ({
      x: rng(), y: rng() * 0.62,
      r: rng() < 0.85 ? 1 : 2,
      base: 0.35 + rng() * 0.65,
      tw: rng() * Math.PI * 2,            // twinkle phase
      tws: 0.6 + rng() * 1.8,             // twinkle speed
      warm: rng() < 0.25,                 // a few warm-tinted stars
    }));

    // Mountain ranges: each is a sum of sine octaves with random phases, giving
    // irregular, non-repeating silhouettes. Stored as raw octave tables sampled
    // in world space so parallax never reveals a tiling seam.
    const makeRange = (octaves, baseFreq) =>
      Array.from({ length: octaves }, (_, i) => ({
        freq: baseFreq * Math.pow(2.13, i) * (0.85 + rng() * 0.3),
        amp: Math.pow(0.55, i) * (0.8 + rng() * 0.4),
        phase: rng() * Math.PI * 2,
      }));
    this._mtn = [
      { oct: makeRange(3, 0.0006), parallax: 0.05 }, // far  — smooth, large
      { oct: makeRange(4, 0.0011), parallax: 0.15 }, // mid  — sharper peaks
      { oct: makeRange(5, 0.0019), parallax: 0.30 }, // near — jagged, detailed
    ];

    // Cloud fields: far/mid/near. Each cloud is a clump of soft elliptical puffs.
    const makeClouds = (count, sizeMin, sizeMax, yTop, yBand, alphaMin, alphaMax) =>
      Array.from({ length: count }, () => {
        const scale = sizeMin + rng() * (sizeMax - sizeMin);
        const puffN = 5 + (rng() * 11 | 0); // 5..15 segments
        const puffs = [];
        for (let i = 0; i < puffN; i++) {
          const f = (i / (puffN - 1)) * 2 - 1; // -1..1 along the cloud
          puffs.push({
            dx: f * scale * 1.6 + (rng() - 0.5) * scale * 0.5,
            dy: (rng() - 0.5) * scale * 0.5 - Math.cos(f * 1.4) * scale * 0.25,
            rw: scale * (0.5 + rng() * 0.7),
            rh: scale * (0.32 + rng() * 0.4),
            wob: rng() * Math.PI * 2,
          });
        }
        return {
          x: rng(), y: yTop + rng() * yBand,
          alpha: alphaMin + rng() * (alphaMax - alphaMin),
          spd: 0.004 + rng() * 0.01,
          puffs,
        };
      });
    this._cloudLayers = [
      { clouds: makeClouds(5, 60, 95, 0.04, 0.16, 0.10, 0.20), parallax: 0.02, spd: 0.5 },
      { clouds: makeClouds(7, 38, 60, 0.08, 0.22, 0.18, 0.34), parallax: 0.08, spd: 1.0 },
      { clouds: makeClouds(6, 26, 44, 0.02, 0.18, 0.30, 0.55), parallax: 0.15, spd: 1.7 },
    ];

    this._particles = []; // ambient weather particles (lazily seeded per biome)
    this._bgBiome = "forest";
  }

  // Sample a mountain range's normalized height (0..1) at world-x `wx`.
  _mtnHeight(range, wx) {
    let h = 0, amp = 0;
    for (const o of range) { h += Math.sin(wx * o.freq + o.phase) * o.amp; amp += o.amp; }
    return (h / amp) * 0.5 + 0.5;
  }

  // --- LAYER 1: gradient sky ------------------------------------------------
  drawSky(dayT) {
    const ctx = this.ctx;
    const p = skyPalette(dayT);
    this._sky = p; // cached for fog / cloud / particle tinting this frame
    const g = ctx.createLinearGradient(0, 0, 0, this.vh);
    g.addColorStop(0, rgb(p.top));
    g.addColorStop(0.5, rgb(p.mid));
    g.addColorStop(1, rgb(p.bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);
  }

  // --- LAYERS 2-3: stars (night) + sun/moon disc ----------------------------
  // Drawn from drawBackground so they share the frame's dt; kept separate for
  // clarity. `night` is 0 (full day) .. 1 (full night).
  _drawStars(t, night) {
    if (night <= 0.01) return;
    const ctx = this.ctx;
    for (const s of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * s.tws + s.tw);
      const a = s.base * tw * night;
      if (a <= 0.02) continue;
      ctx.fillStyle = s.warm
        ? `rgba(255,235,205,${a})`
        : `rgba(225,235,255,${a})`;
      ctx.fillRect((s.x * this.vw) | 0, (s.y * this.vh) | 0, s.r, s.r);
    }
  }

  // Rare shooting star / comet streaking across the night sky.
  _drawShootingStar(dt, t, night) {
    if (night <= 0.2) { this._shoot = null; return; }
    const ctx = this.ctx;
    if (!this._shoot) {
      this._nextShoot -= dt;
      if (this._nextShoot <= 0) {
        const comet = this._bgRng() < 0.18;
        this._shoot = {
          x: 0.1 + this._bgRng() * 0.6, y: this._bgRng() * 0.3,
          vx: 0.5 + this._bgRng() * 0.5, vy: 0.18 + this._bgRng() * 0.22,
          life: 0, dur: comet ? 2.6 : 0.9, comet,
        };
        this._nextShoot = (comet ? 30 : 9) + this._bgRng() * 22;
      }
      return;
    }
    const s = this._shoot;
    s.life += dt;
    if (s.life > s.dur) { this._shoot = null; return; }
    const fade = Math.sin((s.life / s.dur) * Math.PI) * night;
    const hx = (s.x + s.vx * (s.life / s.dur)) * this.vw;
    const hy = (s.y + s.vy * (s.life / s.dur)) * this.vh;
    const len = s.comet ? 120 : 60;
    const tx = hx - s.vx * len, ty = hy - s.vy * len;
    const grad = ctx.createLinearGradient(hx, hy, tx, ty);
    grad.addColorStop(0, `rgba(255,255,245,${0.9 * fade})`);
    grad.addColorStop(1, "rgba(255,255,245,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = s.comet ? 2.5 : 1.5;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
    if (s.comet) {
      const halo = ctx.createRadialGradient(hx, hy, 0, hx, hy, 9);
      halo.addColorStop(0, `rgba(220,235,255,${0.8 * fade})`);
      halo.addColorStop(1, "rgba(220,235,255,0)");
      ctx.fillStyle = halo; ctx.fillRect(hx - 9, hy - 9, 18, 18);
    }
  }

  // Sun (warm, oversized, soft halo) by day; phased moon with faint glow by
  // night. Returns the celestial body's screen position so clouds/fog can be
  // tinted by proximity to it.
  _drawSunMoon(dayT) {
    const ctx = this.ctx;
    const isDay = dayT > 0.21 && dayT < 0.79;
    // Arc the body horizon-to-horizon over its half of the cycle.
    const span = isDay ? [0.21, 0.79] : (dayT >= 0.79 ? [0.79, 1.21] : [-0.21, 0.21]);
    const local = dayT < 0.21 ? dayT + 1 : dayT;
    const pp = (local - span[0]) / (span[1] - span[0]);
    const cx = this.vw * (0.08 + 0.84 * pp);
    const cy = this.vh * 0.86 - Math.sin(pp * Math.PI) * this.vh * 0.72;
    this._lightX = cx; this._lightY = cy; this._lightDay = isDay;

    if (isDay) {
      // Warm radial halo, oversized soft glow, then the bright disc.
      const R = 130;
      const halo = ctx.createRadialGradient(cx, cy, 6, cx, cy, R);
      const hi = this.daylight(dayT);
      halo.addColorStop(0, `rgba(255,240,200,${0.55})`);
      halo.addColorStop(0.35, `rgba(255,210,140,${0.28 * (0.5 + hi)})`);
      halo.addColorStop(1, "rgba(255,180,120,0)");
      ctx.fillStyle = halo; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2);
      ctx.fillStyle = "#fff4cf"; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fillStyle = "#ffe9a8"; ctx.fill();
    } else {
      const R = 80;
      const halo = ctx.createRadialGradient(cx, cy, 4, cx, cy, R);
      halo.addColorStop(0, "rgba(210,222,255,0.30)");
      halo.addColorStop(1, "rgba(180,200,255,0)");
      ctx.fillStyle = halo; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      // Moon disc, then carve a phase shadow with the sky color.
      ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fillStyle = "#e8edf7"; ctx.fill();
      // Phase: offset a sky-colored disc over the moon (0 = new .. full).
      const phase = this._moonPhase ?? (this._moonPhase = this._bgRng());
      const off = (phase * 2 - 1) * 44; // -44..44
      if (Math.abs(off) < 42) {
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.clip();
        ctx.beginPath(); ctx.arc(cx + off, cy, 22, 0, Math.PI * 2);
        ctx.fillStyle = rgb((this._sky || skyPalette(dayT)).top);
        ctx.fill();
        ctx.restore();
      }
      // A couple of soft craters for character.
      ctx.fillStyle = "rgba(150,160,185,0.35)";
      ctx.beginPath(); ctx.arc(cx - 6, cy - 5, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 5, cy + 6, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Atmospheric perspective: blend a layer color toward the sky's lower band by
  // `depth` (0 near .. 1 far) — farther = bluer, brighter, lower contrast.
  _aerial(color, depth) {
    const haze = (this._sky || { bot: [180, 210, 245] }).bot;
    return mix(color, haze, depth);
  }

  // --- LAYERS 4-10: mountains, fog, clouds; plus stars/sun drawn here so they
  // animate with the same dt. Everything behind the world tiles. ------------
  drawBackground(dayT, t) {
    const dt = this._lastBgT == null ? 0.016 : Math.min(0.05, Math.max(0, t - this._lastBgT));
    this._lastBgT = t;
    const night = 1 - this.daylight(dayT);

    // 2-3. Stars, shooting stars, sun/moon.
    this._drawStars(t, night);
    this._drawShootingStar(dt, t, night);
    this._drawSunMoon(dayT);

    // 4-7. Three mountain ranges with atmospheric perspective + fog between.
    const cfg = [
      { layer: 0, baseY: 0.54, height: 0.42, color: [118, 138, 170], depth: 0.80, snow: 0.74 },
      { layer: 1, baseY: 0.68, height: 0.40, color: [72, 96, 130],   depth: 0.5,  snow: 0.66 },
      { layer: 2, baseY: 0.82, height: 0.40, color: [40, 58, 86],    depth: 0.20, snow: 0.55 },
    ];
    this._drawMountain(cfg[0], dayT);
    this._drawMountain(cfg[1], dayT);
    this._drawFog(t, 0.56, 0.62);            // mid fog band
    this._drawMountain(cfg[2], dayT);
    this._drawFog(t, 0.72, 0.7);             // near fog band, denser

    // 8-10. Cloud fields, back to front.
    for (let i = 0; i < this._cloudLayers.length; i++)
      this._drawCloudLayer(this._cloudLayers[i], dt, t, dayT, i / 2);
  }

  _drawMountain(c, dayT) {
    const ctx = this.ctx;
    const range = this._mtn[c.layer];
    const oct = range.oct;
    const off = this.camX * range.parallax;
    const baseY = this.vh * c.baseY;
    const H = this.vh * c.height;
    const bright = this.daylight(dayT);
    // Aerial perspective + day/night dimming.
    let col = this._aerial(c.color, c.depth);
    col = mix(mix(col, [16, 20, 38], 0.55 * (1 - bright)), col, bright);

    // Trace the silhouette once; reuse the points for fill, snow and shading.
    const step = 4;
    const pts = [];
    let minY = this.vh;
    for (let x = -step; x <= this.vw + step; x += step) {
      const h = this._mtnHeight(oct, x + off);
      const y = baseY - h * H;
      pts.push([x, y]);
      if (y < minY) minY = y;
    }
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], this.vh);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], this.vh);
      ctx.closePath();
    };

    // Body: subtle vertical gradient (a touch lighter near the crests, darker
    // toward the base) gives the range volume instead of a flat cut-out.
    const topCol = mix(col, [255, 255, 255], 0.10);
    const botCol = mix(col, [0, 0, 0], 0.22);
    const bg = ctx.createLinearGradient(0, minY, 0, this.vh);
    bg.addColorStop(0, rgb(topCol));
    bg.addColorStop(1, rgb(botCol));
    trace(); ctx.fillStyle = bg; ctx.fill();

    // Snow caps: clip to the silhouette and lay a soft white band over the
    // upper slopes, so only the peaks that poke above the snow line get capped.
    if (c.snow > 0) {
      ctx.save();
      trace(); ctx.clip();
      const snowTop = minY - 2;
      const snowLine = baseY - c.snow * H;
      const sc = mix([238, 245, 255], col, 0.08 + 0.25 * (1 - bright));
      const sg = ctx.createLinearGradient(0, snowTop, 0, snowLine);
      sg.addColorStop(0, `rgba(${sc[0] | 0},${sc[1] | 0},${sc[2] | 0},0.95)`);
      sg.addColorStop(0.7, `rgba(${sc[0] | 0},${sc[1] | 0},${sc[2] | 0},0.55)`);
      sg.addColorStop(1, `rgba(${sc[0] | 0},${sc[1] | 0},${sc[2] | 0},0)`);
      ctx.fillStyle = sg;
      ctx.fillRect(0, snowTop, this.vw, snowLine - snowTop);
      ctx.restore();
    }

    // Near range: a thin, soft sunlit rim along the crest for crispness.
    if (c.layer === 2) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,244,220,${0.10 + 0.14 * bright})`;
      ctx.lineWidth = 1.25;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++)
        i === 0 ? ctx.moveTo(pts[i][0], pts[i][1]) : ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Soft drifting fog band tinted by the current sky, sitting between ranges.
  _drawFog(t, yFrac, density) {
    const ctx = this.ctx;
    const p = this._sky || skyPalette(0.5);
    // Fog takes the warm/cool cast of the horizon (orange at sunset, gold at
    // sunrise, blue at night) by leaning on the sky's middle band.
    const tint = mix(p.mid, p.bot, 0.5);
    const top = this.vh * (yFrac - 0.06);
    const h = this.vh * 0.2;
    const drift = (Math.sin(t * 0.05) * 0.5 + 0.5);
    const a = (0.10 + 0.16 * density) * (0.7 + 0.3 * drift);
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, `rgba(${tint[0] | 0},${tint[1] | 0},${tint[2] | 0},0)`);
    g.addColorStop(0.5, `rgba(${tint[0] | 0},${tint[1] | 0},${tint[2] | 0},${a})`);
    g.addColorStop(1, `rgba(${tint[0] | 0},${tint[1] | 0},${tint[2] | 0},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, top, this.vw, h);
  }

  _drawCloudLayer(L, dt, t, dayT, depth) {
    const ctx = this.ctx;
    const bright = this.daylight(dayT);
    const p = this._sky || skyPalette(dayT);
    // Base cloud color: bright and white by day, dusky and sky-tinted by night.
    const dayCol = [252, 250, 248];
    const nightCol = mix([120, 132, 168], p.mid, 0.4);
    const base = mix(nightCol, dayCol, bright);

    for (const c of L.clouds) {
      c.x += c.spd * L.spd * dt * 0.06;
      if (c.x > 1.3) c.x -= 1.6;
      const px = c.x * this.vw * 1.3 - this.camX * L.parallax * 0.15;
      const cx = ((px % (this.vw * 1.3)) + this.vw * 1.3) % (this.vw * 1.3) - this.vw * 0.15;
      const cy = c.y * this.vh;

      // Brighten clouds that drift near the sun.
      let glow = 0;
      if (this._lightDay) {
        const d = Math.hypot(cx - this._lightX, cy - this._lightY);
        glow = Math.max(0, 1 - d / 320);
      }
      const col = mix(base, [255, 248, 225], glow * 0.5);
      const alpha = c.alpha * (0.65 + 0.35 * bright) + glow * 0.12;
      const cs = `${col[0] | 0},${col[1] | 0},${col[2] | 0}`;

      // Soft radial puffs blend into a single fluffy mass; overlapping cores
      // build density while edges feather out to nothing.
      for (const pf of c.puffs) {
        const wob = Math.sin(t * 0.35 + pf.wob) * 1.3 * (1 + depth);
        const px = cx + pf.dx, py = cy + pf.dy + wob;
        const r = pf.rw;
        const g = ctx.createRadialGradient(px, py - r * 0.15, r * 0.1, px, py, r);
        g.addColorStop(0, `rgba(${cs},${alpha})`);
        g.addColorStop(0.55, `rgba(${cs},${alpha * 0.7})`);
        g.addColorStop(1, `rgba(${cs},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // --- LAYER 12: ambient foreground particles, biome-aware. Called late in the
  // render order (in front of the world) so motes drift over the scene. -------
  drawWeather(world, dayT, t) {
    const dt = this._weatherT == null ? 0.016 : Math.min(0.05, Math.max(0, t - this._weatherT));
    this._weatherT = t;

    // Detect biome from the surface tile at screen center.
    const cxTile = Math.floor((this.camX + this.vw / 2) / TILE);
    const top = world.skyTop ? world.skyTop[cxTile] : 0;
    const surf = world.get ? world.get(cxTile, top) : 0;
    const biome = surf === TILE_IDS.SAND ? "desert"
      : (surf === TILE_IDS.SNOW || surf === TILE_IDS.ICE) ? "snow"
      : "forest";

    const ps = this._particles;
    const rng = this._bgRng;
    const night = 1 - this.daylight(dayT);

    // Spawn toward a target count for the active biome.
    const target = biome === "snow" ? 70 : biome === "forest" ? 40 : 55;
    while (ps.length < target) {
      ps.push({
        x: rng() * this.vw, y: rng() * this.vh, biome,
        vx: 0, vy: 0, ph: rng() * Math.PI * 2, sz: 0,
        seed: rng(),
      });
    }
    // Drift biome out gradually if it changed.
    if (ps.length && ps[0].biome !== biome && ps.length > target)
      ps.splice(0, 1);

    const ctx = this.ctx;
    for (let i = ps.length - 1; i >= 0; i--) {
      const o = ps[i];
      if (o.biome === "snow") {
        o.vx = Math.sin(t * 0.6 + o.ph) * 14;
        o.vy = 22 + o.seed * 18;
        const sz = 1.5 + o.seed * 1.8;
        ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.4 * Math.sin(t + o.ph)})`;
        ctx.fillRect(o.x | 0, o.y | 0, sz, sz);
      } else if (o.biome === "forest") {
        o.vx = Math.sin(t * 0.8 + o.ph) * 12 + 6;
        o.vy = 10 + o.seed * 10;
        // Leaves (warm) and pale pollen motes.
        if (o.seed < 0.5) {
          ctx.fillStyle = `rgba(${180 + o.seed * 60 | 0},${130 + o.seed * 40 | 0},60,0.55)`;
          ctx.save();
          ctx.translate(o.x, o.y);
          ctx.rotate(t + o.ph);
          ctx.fillRect(-2, -1, 4, 2);
          ctx.restore();
        } else {
          ctx.fillStyle = `rgba(255,250,200,${0.25 + 0.25 * Math.sin(t * 2 + o.ph)})`;
          ctx.fillRect(o.x | 0, o.y | 0, 2, 2);
        }
      } else { // desert dust + faint fireflies-of-dust shimmer
        o.vx = 24 + Math.sin(t * 0.4 + o.ph) * 8;
        o.vy = Math.sin(t * 0.5 + o.ph) * 4;
        ctx.fillStyle = `rgba(225,205,160,${0.18 + 0.12 * Math.sin(t + o.ph)})`;
        ctx.fillRect(o.x | 0, o.y | 0, 2, 1);
      }
      // Fireflies at night in forest: a few glowing motes.
      if (o.biome === "forest" && night > 0.5 && o.seed > 0.85) {
        const a = (0.4 + 0.6 * Math.sin(t * 3 + o.ph)) * night;
        ctx.fillStyle = `rgba(190,255,120,${a})`;
        ctx.fillRect(o.x | 0, o.y | 0, 2, 2);
      }
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.y > this.vh + 8) { o.y = -8; o.x = rng() * this.vw; }
      if (o.x > this.vw + 8) o.x = -8;
      if (o.x < -8) o.x = this.vw + 8;
    }
  }

  // Compute lighting for the visible window (+margin) before drawing tiles.
  computeLight(world, dayT) {
    const x0 = Math.floor(this.camX / TILE) - 6;
    const y0 = Math.floor(this.camY / TILE) - 6;
    const x1 = Math.ceil((this.camX + this.vw) / TILE) + 6;
    const y1 = Math.ceil((this.camY + this.vh) / TILE) + 6;
    // Night keeps a dim moonlight floor so the surface isn't pitch black.
    const skyLevel = Math.round((0.18 + 0.82 * this.daylight(dayT)) * MAX_LIGHT);
    this.skyLevel = skyLevel;            // reused by the light overlay for surface fade
    this.lightMap.compute(world, x0, y0, x1, y1, skyLevel);
  }

  // Backdrop for un-walled air below the surface. Pure black at every depth made
  // shallow dug pockets read as harsh black squares poking through the terrain;
  // instead fade from a dim earthy tone just under the grass to the cold cave
  // void deeper down, so near-surface holes look like exposed dirt, not voids.
  _caveBg(world, tx, ty) {
    const depth = ty - world.skyTop[tx];
    // Stretch the fade so mid-depth cave pockets stay a dim earthy tone rather
    // than reading as stark black holes punched into the dirt.
    const t = Math.min(1, Math.max(0, depth / 16));
    const r = Math.round(34 * (1 - t) + 9 * t);
    const g = Math.round(25 * (1 - t) + 10 * t);
    const b = Math.round(19 * (1 - t) + 18 * t);
    return `rgb(${r},${g},${b})`;
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
          // A placed background wall shows through air (a proper "indoors" backdrop);
          // otherwise enclosed/underground air gets the dark cave backdrop.
          const wid = world.wallAt(tx, ty);
          if (wid) this._drawWall(wid, sx, sy, tx, ty);
          else if (ty >= world.skyTop[tx]) {
            ctx.fillStyle = this._caveBg(world, tx, ty);
            ctx.fillRect(sx, sy, TILE, TILE);
          }
          continue;
        }

        const def = tileDef(id);
        if (def.liquid) { this.drawLiquid(world, def, sx, sy, tx, ty, t); continue; }
        if (id === TILE_IDS.LANTERN) {
          // Draw the wall backdrop behind a wall-mounted lantern, then the lantern.
          const wid = world.wallAt(tx, ty);
          if (wid) this._drawWall(wid, sx, sy, tx, ty);
          this.drawLantern(sx, sy, t);
          continue;
        }
        if (id === TILE_IDS.LADDER) {
          // A ladder is see-through: show whatever wall is behind it, then the rungs.
          const wid = world.wallAt(tx, ty);
          if (wid) this._drawWall(wid, sx, sy, tx, ty);
          this.drawLadder(sx, sy);
          continue;
        }

        if (id === TILE_IDS.CROP || id === TILE_IDS.BANNER || id === TILE_IDS.TALL_GRASS ||
            id === TILE_IDS.FLOWER || id === TILE_IDS.BERRY_BUSH || id === TILE_IDS.MUSHROOM ||
            id === TILE_IDS.VINE) {
          // See-through decorations: show whatever's behind, then the sprite.
          const wid = world.wallAt(tx, ty);
          if (wid) this._drawWall(wid, sx, sy, tx, ty);
          else if (ty >= world.skyTop[tx]) { ctx.fillStyle = this._caveBg(world, tx, ty); ctx.fillRect(sx, sy, TILE, TILE); }
          if (id === TILE_IDS.CROP) this.drawCrop(sx, sy, tx, ty);
          else if (id === TILE_IDS.BANNER) this.drawBanner(sx, sy, t, tx);
          else if (id === TILE_IDS.TALL_GRASS) this.drawTallGrass(sx, sy, tx, ty, t);
          else if (id === TILE_IDS.FLOWER) this.drawFlower(sx, sy, tx, ty, t);
          else if (id === TILE_IDS.BERRY_BUSH) this.drawBerryBush(sx, sy, tx, ty);
          else if (id === TILE_IDS.MUSHROOM) this.drawMushroom(sx, sy, tx, ty);
          else this.drawVine(sx, sy, tx, ty, t);
          continue;
        }

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
        if (id === TILE_IDS.TNT) this.drawTnt(sx, sy, t);
        if (id === TILE_IDS.CACTUS) this.drawCactusDetail(sx, sy, tx, ty);
        if (id === TILE_IDS.PUMPKIN) this.drawPumpkinDetail(sx, sy, tx, ty);
        if (id === TILE_IDS.SNOW) this.drawSnowDetail(sx, sy, tx, ty);
      }
    }
  }

  drawLadder(sx, sy) {
    const ctx = this.ctx;
    ctx.fillStyle = "#8a6a34";
    ctx.fillRect(sx + 2, sy, 2, TILE);             // left rail
    ctx.fillRect(sx + TILE - 4, sy, 2, TILE);      // right rail
    ctx.fillStyle = "#a8854a";
    ctx.fillRect(sx + 2, sy + 3, TILE - 4, 2);     // rungs
    ctx.fillRect(sx + 2, sy + 9, TILE - 4, 2);
  }

  // A clump of wheat: green stalks rising to golden grain heads.
  drawCrop(sx, sy, tx, ty) {
    const ctx = this.ctx;
    const n = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    for (let i = 0; i < 4; i++) {
      const gx = sx + 2 + i * 3.5 + ((n >> (i * 2)) % 2);
      ctx.fillStyle = "#5d8a32";
      ctx.fillRect(gx, sy + 6, 1.5, TILE - 6);   // stalk
      ctx.fillStyle = "#e3c16a";
      ctx.fillRect(gx - 0.5, sy + 3, 2.5, 4);    // grain head
    }
  }

  // Wispy tufts of tall grass, leaning gently with a breeze.
  drawTallGrass(sx, sy, tx, ty, t) {
    const ctx = this.ctx;
    const n = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    const sway = Math.sin(t * 1.6 + tx * 0.6) * 1.3;
    for (let i = 0; i < 5; i++) {
      const bx = sx + 2 + i * 2.6 + ((n >> (i * 2)) % 2);
      const hgt = 7 + ((n >> (i * 3)) % 5);
      ctx.strokeStyle = i % 2 ? "#5fae46" : "#4d9138";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(bx, sy + TILE);
      ctx.quadraticCurveTo(bx + sway * 0.5, sy + TILE - hgt * 0.6, bx + sway, sy + TILE - hgt);
      ctx.stroke();
    }
  }

  // A single bloom on a slender stalk; petal color varies by position.
  drawFlower(sx, sy, tx, ty, t) {
    const ctx = this.ctx;
    const n = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    const palette = ["#e85d9c", "#f2c14e", "#6fa8ff", "#ef5350", "#c084fc", "#ffffff"];
    const petal = palette[n % palette.length];
    const sway = Math.sin(t * 1.4 + tx) * 1.2;
    const cx = sx + TILE / 2 + sway, cy = sy + 4;
    ctx.strokeStyle = "#3f7a2e"; ctx.lineWidth = 1.4; // stem
    ctx.beginPath(); ctx.moveTo(sx + TILE / 2, sy + TILE); ctx.lineTo(cx, cy + 2); ctx.stroke();
    ctx.fillStyle = "#4d9138"; // leaf
    ctx.fillRect(sx + TILE / 2 - 3, sy + TILE - 6, 3, 2);
    ctx.fillStyle = petal; // four petals
    for (const [dx, dy] of [[-2.5, 0], [2.5, 0], [0, -2.5], [0, 2.5]]) {
      ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#3a2a14"; // center
    ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, Math.PI * 2); ctx.fill();
  }

  // A rounded shrub dotted with ripe red berries.
  drawBerryBush(sx, sy, tx, ty) {
    const ctx = this.ctx;
    const n = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    ctx.fillStyle = "#2f6b34";
    ctx.beginPath(); ctx.ellipse(sx + TILE / 2, sy + TILE - 5, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3c8040"; // lit top
    ctx.beginPath(); ctx.ellipse(sx + TILE / 2 - 1, sy + TILE - 7, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c0224a"; // berries
    for (let i = 0; i < 5; i++) {
      const bx = sx + 3 + ((n >> (i * 3)) % 10);
      const by = sy + 5 + ((n >> (i * 2)) % 7);
      ctx.beginPath(); ctx.arc(bx, by, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // A red-capped mushroom with white spots, faintly glowing in the dark.
  drawMushroom(sx, sy, tx, ty) {
    const ctx = this.ctx;
    const cx = sx + TILE / 2;
    ctx.fillStyle = "#e8ddc8"; // stalk
    ctx.fillRect(cx - 1.5, sy + 7, 3, TILE - 7);
    ctx.fillStyle = "#d6604a"; // cap
    ctx.beginPath(); ctx.ellipse(cx, sy + 7, 5.5, 4, 0, Math.PI, 0); ctx.fill();
    ctx.fillRect(cx - 5.5, sy + 6, 11, 2);
    ctx.fillStyle = "#fbeede"; // spots
    ctx.beginPath(); ctx.arc(cx - 2, sy + 5, 1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 2, sy + 4.5, 1.2, 0, Math.PI * 2); ctx.fill();
  }

  // A dangling vine, swaying slightly, with small leaf nubs.
  drawVine(sx, sy, tx, ty, t) {
    const ctx = this.ctx;
    const sway = Math.sin(t * 1.3 + ty * 0.5) * 1.5;
    ctx.strokeStyle = "#3f7a39"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + TILE / 2, sy);
    ctx.quadraticCurveTo(sx + TILE / 2 + sway, sy + TILE / 2, sx + TILE / 2 + sway * 0.6, sy + TILE);
    ctx.stroke();
    ctx.fillStyle = "#4d9138";
    ctx.fillRect(sx + TILE / 2 - 3, sy + 4, 2.5, 2);
    ctx.fillRect(sx + TILE / 2 + 1 + sway * 0.4, sy + 10, 2.5, 2);
  }

  // Vertical ribbing + areoles on a cactus segment.
  drawCactusDetail(sx, sy, tx, ty) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(255,255,255,0.10)"; // sunlit ridge
    ctx.fillRect(sx + 3, sy, 2, TILE);
    ctx.fillStyle = "rgba(0,0,0,0.16)";       // shaded grooves
    ctx.fillRect(sx + 7, sy, 1, TILE);
    ctx.fillRect(sx + 11, sy, 1, TILE);
    ctx.fillStyle = "#e8e0b0";                // tiny spines
    for (let y = sy + 2; y < sy + TILE; y += 4) {
      ctx.fillRect(sx + 3, y, 1, 1);
      ctx.fillRect(sx + 10, y + 1, 1, 1);
    }
  }

  // Carved ridges + stem on a pumpkin block.
  drawPumpkinDetail(sx, sy, tx, ty) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.18)"; // rib grooves
    ctx.fillRect(sx + 4, sy + 2, 1, TILE - 3);
    ctx.fillRect(sx + 8, sy + 2, 1, TILE - 3);
    ctx.fillRect(sx + 12, sy + 2, 1, TILE - 3);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(sx + 2, sy + 2, 1, TILE - 3);
    ctx.fillStyle = "#5a7a32"; // stem
    ctx.fillRect(sx + TILE / 2 - 1, sy - 2, 3, 3);
  }

  // A dusting of sparkle on snow so it doesn't read as a flat slab.
  drawSnowDetail(sx, sy, tx, ty) {
    const ctx = this.ctx;
    const n = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(sx + (n % 12), sy + 1 + ((n >> 4) % 4), 1, 1);
    ctx.fillRect(sx + ((n >> 8) % 12), sy + 2 + ((n >> 6) % 5), 1, 1);
  }

  // A heraldic banner waving on its pole, color drawn from the gang palette.
  drawBanner(sx, sy, t, tx) {
    const ctx = this.ctx;
    const wave = Math.sin(t * 3 + tx) * 1.5;
    ctx.fillStyle = "#5a4a2a";
    ctx.fillRect(sx, sy - TILE, 2, TILE * 2);    // pole (the tile above holds the pole top)
    // Cloth: a red field with a gold chevron, gently rippling.
    ctx.fillStyle = "#b03030";
    ctx.fillRect(sx + 2, sy + 1, 11, 13 + wave);
    ctx.fillStyle = "#e8c349";
    ctx.beginPath();
    ctx.moveTo(sx + 2, sy + 4);
    ctx.lineTo(sx + 7.5, sy + 8 + wave * 0.5);
    ctx.lineTo(sx + 13, sy + 4);
    ctx.lineTo(sx + 13, sy + 7);
    ctx.lineTo(sx + 7.5, sy + 11 + wave * 0.5);
    ctx.lineTo(sx + 2, sy + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.18)";          // shaded swallow-tail edge
    ctx.fillRect(sx + 11, sy + 1, 2, 13 + wave);
  }

  drawTnt(sx, sy, t) {
    const ctx = this.ctx;
    // dark band with "TNT" stencil dots + a sparking fuse on top
    ctx.fillStyle = "#2a0c0c";
    ctx.fillRect(sx, sy + 5, TILE, 6);
    ctx.fillStyle = "#f4e3c1";
    ctx.font = "bold 6px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("TNT", sx + TILE / 2, sy + 8.5);
    ctx.fillStyle = "#3a2a18"; // fuse
    ctx.fillRect(sx + TILE / 2 - 1, sy - 2, 2, 4);
    const flick = 0.5 + 0.5 * Math.sin(t * 30 + sx);
    ctx.fillStyle = `rgba(255,${180 + flick * 60 | 0},80,${0.6 + flick * 0.4})`;
    ctx.fillRect(sx + TILE / 2 - 1.5, sy - 4, 3, 3);
  }

  // Bullets / rockets / energy bolts in flight, with a fading trail.
  drawProjectiles(projectiles) {
    const ctx = this.ctx;
    for (const p of projectiles) {
      for (let i = 0; i < p.trail.length; i++) {
        const tp = p.trail[i];
        const a = (i / p.trail.length) * 0.5;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a;
        ctx.fillRect(Math.round(tp.x - this.camX) - 1, Math.round(tp.y - this.camY) - 1, 3, 3);
      }
      ctx.globalAlpha = 1;
      const sx = Math.round(p.cx - this.camX), sy = Math.round(p.cy - this.camY);
      if (p.glow) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 7);
        g.addColorStop(0, p.color); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.fillRect(sx - 7, sy - 7, 14, 14);
      }
      if (p.spin) {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(performance.now() / 50 + p.cx);
        const r = p.w / 2 + 1;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(sx - 2, sy - 2, 4, 4);
      }
    }
  }

  // Jagged lightning bolts (Mjölnir): a bright forked streak from above to the
  // struck foe, plus a thin chain link back to the source for zapped enemies.
  drawLightning(bolts) {
    if (!bolts || !bolts.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const b of bolts) {
      const a = Math.max(0, Math.min(1, b.life / 0.18));
      const x = b.x - this.camX;
      const y0 = b.top - this.camY, y1 = b.y - this.camY;
      this._bolt(x, y0, x, y1, 10, a);
      if (b.chainFrom) this._bolt(b.chainFrom.x - this.camX, b.chainFrom.y - this.camY, x, y1, 6, a * 0.8);
      // bright impact flash at the foe
      const g = ctx.createRadialGradient(x, y1, 0, x, y1, 14);
      g.addColorStop(0, `rgba(220,240,255,${a * 0.8})`);
      g.addColorStop(1, "rgba(120,180,255,0)");
      ctx.fillStyle = g; ctx.fillRect(x - 14, y1 - 14, 28, 28);
    }
    ctx.restore();
  }

  _bolt(x0, y0, x1, y1, segs, a) {
    const ctx = this.ctx;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const jitter = (i === 0 || i === segs) ? 0 : (Math.random() * 2 - 1) * 6;
      pts.push([x0 + (x1 - x0) * t + jitter, y0 + (y1 - y0) * t]);
    }
    // wide soft glow underlay, then a crisp white core
    ctx.strokeStyle = `rgba(120,180,255,${a * 0.5})`; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke();
    ctx.strokeStyle = `rgba(240,250,255,${a})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke();
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
    const skyNorm = (this.skyLevel || 0) / MAX_LIGHT;
    for (let j = 0; j < L.h; j++) {
      const ty = L.y0 + j;
      for (let i = 0; i < L.w; i++) {
        const tx = L.x0 + i;
        const o = (j * L.w + i) * 4;
        const top = world.skyTop[tx];
        // Don't darken open sky — the sky gradient + vignette own day/night there.
        if (ty < top) { data[o + 3] = 0; continue; }
        // Walled-in tiles keep a higher minimum brightness so houses read as
        // dim-but-livable indoors instead of pitch black under a roof.
        const floor = world.wallAt(tx, ty) ? WALL_AMBIENT : AMBIENT;
        // Soft skylight bleed: daylight fades smoothly a few tiles into solid
        // ground instead of collapsing to a hard black band. At night the BFS
        // light alone dies one tile under the surface (skyLevel ~3, -2/step),
        // which read as an odd shelf — this gives a gentle vertical gradient.
        const depth = ty - top;
        // Smoothstep falloff over ~9 tiles: an eased curve removes the lingering
        // hard line where the lit surface band meets the dark underground.
        const d = Math.max(0, 1 - depth / 9);
        const bleed = skyNorm * d * d * (3 - 2 * d);
        // Lateral sky exposure: a thin pillar or a wall edge standing out in the
        // open is "deep" below its OWN column's peak, so the vertical bleed above
        // wrongly treats its lower body as underground and lets it fall to black.
        // Look a few tiles left/right: if open sky reaches this same row nearby,
        // the tile is really out in daylight, so keep it lit (fading with how far
        // the daylight has to travel sideways to reach it).
        let lateral = 0;
        for (let dx = 1; dx <= SKY_REACH; dx++) {
          const lc = tx - dx, rc = tx + dx;
          const open = (lc >= 0 && ty < world.skyTop[lc]) ||
                       (rc < world.w && ty < world.skyTop[rc]);
          if (open) { lateral = skyNorm * (1 - (dx - 1) / SKY_REACH); break; }
        }
        const bright = Math.max(floor, bleed, lateral, L.light[j * L.w + i] / MAX_LIGHT);
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

  drawLiquid(world, def, sx, sy, tx, ty, t) {
    const ctx = this.ctx;
    const id = world.get(tx, ty);
    const emissive = (def.emissive || 0) > 0;

    // Neighbours decide where the "skin" of the body is: only the true top
    // surface (no liquid above) gets the animated wave crest — every other
    // tile is filled edge-to-edge so the body reads as one solid volume with
    // no gaps or stripes.
    const sameAbove = world.get(tx, ty - 1) === id;
    const sameBelow = world.get(tx, ty + 1) === id;

    // Translucent liquid needs something behind it or it reads as a void.
    // Show the placed wall, else the cave/underground backdrop.
    const wid = world.wallAt(tx, ty);
    if (wid) this._drawWall(wid, sx, sy, tx, ty);
    else { ctx.fillStyle = this._caveBg(world, tx, ty); ctx.fillRect(sx, sy, TILE, TILE); }

    // Surface tiles fill only as deep as their liquid level (shallow flows look
    // shallow), with a gentle animated wave riding the top. Interior tiles fill
    // edge-to-edge. The wave is never tall enough to leave a gap mid-body.
    let top = sy;
    if (!sameAbove) {
      const level = world.liquidLevel(tx, ty);            // 0..1 fill fraction
      const base = sy + (1 - Math.min(1, level)) * (TILE - 2);
      const wave = Math.sin(t * 2.2 + tx * 0.7) + Math.sin(t * 3.7 + tx * 1.9) * 0.4;
      top = base + (wave + 1.4) * 1.1;                    // settle into a shallow dip
      top = Math.max(sy, Math.min(top, sy + TILE - 2));
    }

    // Body fill. Interior tiles are a flat base colour so a deep pool reads as
    // one seamless volume (no per-tile banding). Surface tiles fade from a bright
    // crest highlight DOWN to that same base colour, so the surface row meets the
    // interior below it with no visible seam.
    ctx.globalAlpha = emissive ? 0.95 : 0.8;
    if (sameAbove) {
      ctx.fillStyle = def.color;
      ctx.fillRect(sx, top, TILE, sy + TILE - top);
    } else {
      const g = ctx.createLinearGradient(0, top, 0, sy + TILE);
      g.addColorStop(0, emissive ? "#ff8a4d" : "#5b9bf0"); // sunlit crest
      g.addColorStop(1, def.color);                         // == interior colour
      ctx.fillStyle = g;
      ctx.fillRect(sx, top, TILE, sy + TILE - top);
    }

    // Surface crest: bright foam/glow line riding the top of surface tiles, plus
    // a faint shimmer just under it. Kept to surface tiles only so the interior
    // body stays a clean, seamless fill.
    if (!sameAbove) {
      const band = top + 3 + Math.sin(t * 1.6 + tx * 0.5) * 1.5;
      ctx.globalAlpha = emissive ? 0.18 : 0.12;
      ctx.fillStyle = emissive ? "#ffd27a" : "#bfe0ff";
      ctx.fillRect(sx, band, TILE, 1);

      ctx.globalAlpha = emissive ? 0.7 : 0.45;
      ctx.fillStyle = emissive ? "rgba(255,230,150,1)" : "rgba(220,240,255,1)";
      ctx.fillRect(sx, top, TILE, 2);
      // tiny specular flecks on the crest
      ctx.globalAlpha = emissive ? 0.5 : 0.3;
      ctx.fillStyle = "#ffffff";
      const n = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
      ctx.fillRect(sx + 2 + (n % 5), top, 2, 1);
      ctx.fillRect(sx + 9 + ((n >> 4) % 4), top + 1, 2, 1);
    }

    // Faint floor shade where the body meets the bottom of an enclosed pool.
    if (!sameBelow) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#000000";
      ctx.fillRect(sx, sy + TILE - 2, TILE, 2);
    }

    ctx.globalAlpha = 1;
  }

  // Background wall: filled material with an inset frame + speckle so it clearly
  // reads as "behind" the foreground rather than a solid block.
  _drawWall(wid, sx, sy, tx, ty) {
    const def = wallDef(wid);
    if (!def) return;
    const ctx = this.ctx;
    ctx.fillStyle = def.color;
    ctx.fillRect(sx, sy, TILE, TILE);
    const n = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(sx + (n % 12), sy + ((n >> 4) % 12), 2, 2);
    // recessed bevel: dark top/left, faint light bottom/right
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(sx, sy, TILE, 1);
    ctx.fillRect(sx, sy, 1, TILE);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(sx, sy + TILE - 1, TILE, 1);
    ctx.fillRect(sx + TILE - 1, sy, 1, TILE);
  }

  drawLantern(sx, sy, t) {
    const ctx = this.ctx;
    const flick = 0.82 + Math.sin(t * 9 + sx * 0.7) * 0.18;
    ctx.fillStyle = "#3a3026"; // hanger
    ctx.fillRect(sx + TILE / 2 - 1, sy, 2, 4);
    ctx.fillStyle = "#6b5836"; // metal frame
    ctx.fillRect(sx + TILE / 2 - 4, sy + 4, 8, 9);
    ctx.fillStyle = `rgba(255,221,138,${flick})`; // glowing glass
    ctx.fillRect(sx + TILE / 2 - 3, sy + 5, 6, 7);
    ctx.fillStyle = "#fff4c6";
    ctx.fillRect(sx + TILE / 2 - 1, sy + 6, 2, 4);
    ctx.fillStyle = "#5a4a2c"; // base
    ctx.fillRect(sx + TILE / 2 - 3, sy + 12, 6, 2);
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

  drawPlayer(player, held, armor) {
    const ctx = this.ctx;
    // Blink during i-frames after taking a hit.
    if (player.invuln > 0 && Math.floor(performance.now() / 80) % 2 === 0) return;
    const sx = Math.round(player.x - this.camX);
    const sy = Math.round(player.y - this.camY);
    const w = player.w, h = player.h;
    const f = player.facing;
    const swingLeg = Math.sin(player.animTime) * 5;
    const stride = Math.cos(player.animTime) * 2;
    const sq = player.squashY, sw = 1 / Math.sqrt(sq);

    // Equipped armor pieces (may be null for an unarmored player).
    const ah = armor && armor.head ? ITEMS[armor.head.item] : null;
    const ab = armor && armor.body ? ITEMS[armor.body.item] : null;
    const al = armor && armor.legs ? ITEMS[armor.legs.item] : null;

    // Superhero suits re-skin the body below; flags gate the normal overlays.
    const ironSuit = held && ITEMS[held.item] && ITEMS[held.item].suit === "ironman";
    const flashSuit = player.hasBuff && player.hasBuff("flash");

    // Iron Man jet thrust beneath the boots while airborne.
    if (ironSuit && (player.hasBuff("fly") || player.flying)) {
      const flick = 0.6 + 0.4 * Math.sin(performance.now() / 40);
      const g = ctx.createRadialGradient(sx + w / 2, sy + h + 4, 0, sx + w / 2, sy + h + 4, 12);
      g.addColorStop(0, `rgba(150,233,255,${0.7 * flick})`);
      g.addColorStop(1, "rgba(150,233,255,0)");
      ctx.fillStyle = g; ctx.fillRect(sx - 4, sy + h - 2, w + 8, 16);
    }

    // Power auras: golden invincibility halo, white wings while flying.
    const god = player.hasBuff && (player.hasBuff("god") || player.hasBuff("godhood"));
    if (god) {
      const cx = sx + w / 2, cy = sy + h / 2;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
      const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, 26);
      g.addColorStop(0, `rgba(255,236,120,${0.45 + pulse * 0.25})`);
      g.addColorStop(1, "rgba(255,236,120,0)");
      ctx.fillStyle = g; ctx.fillRect(cx - 26, cy - 26, 52, 52);
    }
    if (player.hasBuff && player.hasBuff("fly") && !ironSuit) {
      const wob = Math.sin(performance.now() / 120) * 2;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.ellipse(sx - 2, sy + h * 0.4 + wob, 5, 9, 0.5, 0, Math.PI * 2);
      ctx.ellipse(sx + w + 2, sy + h * 0.4 + wob, 5, 9, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Soft contact shadow on the ground — tightens when grounded, fades in air.
    {
      const air = Math.min(1, Math.abs(player.vy || 0) / 520);
      const shA = 0.28 * (1 - air * 0.8);
      if (shA > 0.02) {
        const sg = ctx.createRadialGradient(sx + w / 2, sy + h + 2, 1, sx + w / 2, sy + h + 2, w * 0.7);
        sg.addColorStop(0, `rgba(0,0,0,${shA})`);
        sg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.ellipse(sx + w / 2, sy + h + 2, w * (0.55 + air * 0.25), 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.save();
    ctx.translate(sx + w / 2, sy + h);  // pivot at the feet
    ctx.scale(f * sw, sq);              // facing flip + jump/land squash
    ctx.translate(0, -h);               // back to a top-origin coordinate frame

    // Geometry anchors (top-origin frame, x centered on 0).
    const hipY = h * 0.62, legLen = h - hipY;
    const torsoY = h * 0.34, torsoH = hipY - torsoY + 1;
    const headY = 0, headH = h * 0.30, headW = w + 1;
    const skinLit = "#f3d8b6", skin = "#e8c39e", skinDark = "#cfa07c", skinShadow = "#b9885f";

    // ---- BACK ARM (behind torso, darker for depth) ----
    const backSleeve = "#8c2222";
    ctx.fillStyle = backSleeve;
    ctx.fillRect(-w / 2 + 1, torsoY + 1, 3, torsoH * 0.6);
    ctx.fillStyle = "rgba(0,0,0,0.18)"; // inner-edge shade
    ctx.fillRect(-w / 2 + 3, torsoY + 1, 1, torsoH * 0.6);
    ctx.fillStyle = skinShadow; // back forearm
    ctx.fillRect(-w / 2 + 1, torsoY + torsoH * 0.6, 3, torsoH * 0.25);
    ctx.fillStyle = this._shade(skinShadow, -0.12); // back hand (in shade)
    ctx.fillRect(-w / 2 + 1, torsoY + torsoH * 0.85, 3, 3);

    // ---- LEGS (boots + pants, alternating swing) ----
    const lpL = -w / 2 + 1, lpR = w / 2 - 5;
    const legBackLen = legLen - swingLeg, legFrontLen = legLen + swingLeg;
    // Designer blue jeans + sneakers. Back leg a shade darker for depth.
    for (const [x, len, back] of [[lpL, legBackLen, true], [lpR, legFrontLen, false]]) {
      const pantLen = len - 3;
      // Vertical denim gradient: faded thigh fall to darker hem (washed look).
      const pg = ctx.createLinearGradient(0, hipY, 0, hipY + pantLen);
      if (back) { pg.addColorStop(0, "#26487f"); pg.addColorStop(1, "#1d3a68"); }
      else { pg.addColorStop(0, "#3865a0"); pg.addColorStop(0.6, "#2f5896"); pg.addColorStop(1, "#264a82"); }
      ctx.fillStyle = pg;
      ctx.fillRect(x, hipY, 4, pantLen);
      ctx.fillStyle = back ? "rgba(255,255,255,0.06)" : "rgba(170,205,255,0.18)"; // outer-thigh sheen
      ctx.fillRect(x, hipY, 1, pantLen);
      ctx.fillStyle = "rgba(0,0,0,0.22)"; // inseam shade
      ctx.fillRect(x + 3, hipY, 1, pantLen);
      ctx.fillStyle = "rgba(0,0,0,0.15)"; // knee whisker fold
      ctx.fillRect(x, hipY + pantLen * 0.5, 4, 1);
      ctx.fillStyle = "rgba(150,190,240,0.18)"; // faded knee highlight
      ctx.fillRect(x + 1, hipY + pantLen * 0.42, 2, 1.5);
      // Contrast tan stitching — the "designer" detail (outseam + pocket).
      ctx.fillStyle = back ? "rgba(206,170,110,0.35)" : "rgba(214,178,116,0.6)";
      ctx.fillRect(x + 0.6, hipY + 1, 0.5, pantLen - 1);   // outseam stitch
      ctx.fillRect(x + 1, hipY + 2, 2, 0.6);               // pocket top stitch
      ctx.fillRect(x + 1, hipY + 2, 0.5, 1.6);             // pocket side stitch
      ctx.fillStyle = "rgba(0,0,0,0.18)"; // hem cuff line
      ctx.fillRect(x, hipY + pantLen - 1.5, 4, 1);

      // ---- SNEAKER (Jordan-style: white midsole, red accent, swoosh) ----
      const footY = hipY + len - 3.5;
      const dim = back ? 0.82 : 1; // back shoe slightly muted
      const W = (r, g2, b) => `rgb(${(r * dim) | 0},${(g2 * dim) | 0},${(b * dim) | 0})`;
      ctx.fillStyle = W(236, 239, 243); ctx.fillRect(x - 1, footY, 6, 2.6);        // white upper
      ctx.fillStyle = W(200, 53, 43);   ctx.fillRect(x - 1, footY, 1.6, 2.6);      // red heel panel
      ctx.fillStyle = W(200, 53, 43);   ctx.fillRect(x + 4, footY, 1, 2.6);        // red toe accent
      ctx.fillStyle = W(40, 44, 52);    ctx.fillRect(x + 1, footY + 0.7, 3.2, 1);  // swoosh stripe
      ctx.fillStyle = W(222, 226, 232); ctx.fillRect(x + 1.4, footY, 2.2, 0.8);    // tongue/laces panel
      ctx.fillStyle = "rgba(0,0,0,0.2)";  ctx.fillRect(x + 1.6, footY + 0.1, 1.8, 0.5); // lace shadow
      ctx.fillStyle = W(247, 248, 250); ctx.fillRect(x - 1.2, footY + 2.3, 6.4, 1.4); // white midsole
      ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(x - 1.2, footY + 3.4, 6.4, 0.7); // outsole shadow
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(x + 4, footY + 2.4, 1.5, 0.8); // toe sole shine
    }
    if (al) this._drawLegArmor(al, lpL, lpR, hipY, legBackLen, legFrontLen);

    // ---- TORSO (shaded shirt: collar, chest fold, side shadow, belt) ----
    const tg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    tg.addColorStop(0, "#8f1f1f");
    tg.addColorStop(0.45, "#c62f2f");
    tg.addColorStop(0.7, "#e04545");
    tg.addColorStop(1, "#a62525");
    ctx.fillStyle = tg;
    ctx.fillRect(-w / 2, torsoY, w, torsoH);
    ctx.fillStyle = "rgba(0,0,0,0.16)"; // shaded far side
    ctx.fillRect(-w / 2, torsoY, 1.5, torsoH);
    ctx.fillStyle = "rgba(255,255,255,0.16)"; // lit near side + top
    ctx.fillRect(w / 2 - 1.5, torsoY, 1.5, torsoH);
    ctx.fillRect(-w / 2, torsoY, w, 1.5);
    ctx.fillStyle = "#ec5a5a"; // collar
    ctx.fillRect(-2.5, torsoY, 5, 2);
    ctx.fillStyle = "rgba(0,0,0,0.14)"; // collar V shadow + center seam
    ctx.fillRect(-0.5, torsoY + 1.5, 1, torsoH * 0.55);
    ctx.fillStyle = "rgba(0,0,0,0.10)"; // chest cloth fold
    ctx.fillRect(-w / 2 + 1.5, torsoY + torsoH * 0.42, w * 0.4, 1);
    ctx.fillStyle = "rgba(0,0,0,0.10)"; // hem shadow above belt
    ctx.fillRect(-w / 2, hipY - 4.5, w, 1.5);
    ctx.fillStyle = "#5a3a22";          // leather belt
    ctx.fillRect(-w / 2, hipY - 3, w, 3);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; // belt lower edge
    ctx.fillRect(-w / 2, hipY - 1, w, 1);
    ctx.fillStyle = "#e8c45c";          // brass buckle
    ctx.fillRect(-1.5, hipY - 3, 3, 3);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; // buckle glint
    ctx.fillRect(-1, hipY - 2.5, 1, 1);
    if (ab) this._drawBodyArmor(ab, w, torsoY, torsoH);

    // ---- HEAD (skin shading, hair, ear, face) ----
    const hx = -headW / 2 + 0.5;
    const hg = ctx.createLinearGradient(hx, 0, hx + headW, 0);
    hg.addColorStop(0, skinShadow);
    hg.addColorStop(0.4, skin);
    hg.addColorStop(0.75, skinLit);
    hg.addColorStop(1, "#f6dcbb");
    ctx.fillStyle = hg;
    ctx.fillRect(hx, headY, headW, headH);
    ctx.fillStyle = "rgba(0,0,0,0.10)"; // jaw underside shade
    ctx.fillRect(hx, headH * 0.86, headW, headH * 0.14);
    // Ear with inner shadow.
    ctx.fillStyle = skin; ctx.fillRect(hx - 0.5, headH * 0.46, 2, 4);
    ctx.fillStyle = skinShadow; ctx.fillRect(hx, headH * 0.5, 1, 2);
    // Hair: brown MULLET — short & styled on top/front, long flap down the back.
    // (Back of the head is the -x / hx side; front/face is the +x side.)
    const hairDark = "#3a2615", hairBase = "#5a3a20", hairMid = "#71502f", hairHi = "#8a6440";
    // Long mullet tail: hangs from the crown down past the head onto the nape.
    ctx.fillStyle = hairBase;
    ctx.fillRect(hx - 0.5, headY + headH * 0.18, 3, headH * 1.05);
    ctx.fillStyle = hairDark; // inner shadow of the tail
    ctx.fillRect(hx + 1.5, headY + headH * 0.5, 1, headH * 0.7);
    ctx.fillStyle = hairMid;  // lit edge of the tail
    ctx.fillRect(hx - 0.5, headY + headH * 0.18, 1, headH * 0.95);
    // Top cap + front fringe sweep (the tidy "business" up front).
    ctx.fillStyle = hairBase;
    ctx.fillRect(hx, headY, headW, headH * 0.34);
    ctx.fillRect(hx + headW - 3, headY, 3, headH * 0.46);     // front fringe
    ctx.fillRect(hx, headY, 2, headH * 0.42);                 // short side
    ctx.fillStyle = hairDark; // sideburn + fringe shadow
    ctx.fillRect(hx + headW - 2, headH * 0.32, 1.5, headH * 0.26);
    ctx.fillRect(hx, headY + headH * 0.33, headW, 1);
    ctx.fillStyle = hairMid;  // midtone strands across the cap
    ctx.fillRect(hx + 1, headY + 1, headW - 3, 1.2);
    ctx.fillStyle = hairHi;   // top sheen
    ctx.fillRect(hx + headW * 0.42, headY + 0.5, headW * 0.42, 1);
    // Face features.
    ctx.fillStyle = "#2a1c10"; // brow
    ctx.fillRect(headW / 2 - 4.5, headH * 0.42, 3.2, 1.2);
    ctx.fillStyle = "#fff"; // eye white
    ctx.fillRect(headW / 2 - 4.2, headH * 0.5, 2.6, 2.6);
    ctx.fillStyle = "#3a5a8c"; // iris
    ctx.fillRect(headW / 2 - 3.2, headH * 0.5, 1.6, 2.6);
    ctx.fillStyle = "#10141c"; // pupil
    ctx.fillRect(headW / 2 - 2.8, headH * 0.52, 1, 1.8);
    ctx.fillStyle = "rgba(255,255,255,0.9)"; // catchlight
    ctx.fillRect(headW / 2 - 3.4, headH * 0.5, 0.8, 0.8);
    ctx.fillStyle = "rgba(220,150,110,0.35)"; // cheek blush
    ctx.fillRect(headW / 2 - 5, headH * 0.66, 2.5, 1.5);
    ctx.fillStyle = skinShadow; // nose bridge + tip
    ctx.fillRect(headW / 2 - 0.5, headH * 0.54, 1.5, 3);
    ctx.fillStyle = this._shade(skinShadow, -0.12);
    ctx.fillRect(headW / 2 - 0.5, headH * 0.66, 1.5, 1);
    ctx.fillStyle = "rgba(140,55,45,0.5)"; // mouth
    ctx.fillRect(headW / 2 - 4, headH * 0.79, 3, 1.2);
    ctx.fillStyle = "rgba(255,255,255,0.12)"; // chin highlight
    ctx.fillRect(headW / 2 - 3, headH * 0.86, 2.5, 1);
    if (ah) this._drawHeadArmor(ah, hx, headY, headW, headH);

    // ---- SUPERHERO SUIT OVERLAY (painted over torso/legs/head) ----
    if (ironSuit) this._drawIronSuit(w, torsoY, torsoH, hipY, hx, headY, headW, headH, lpL, lpR, legBackLen, legFrontLen);
    else if (flashSuit) this._drawFlashSuit(w, torsoY, torsoH, hipY, hx, headY, headW, headH, lpL, lpR, legBackLen, legFrontLen);

    // ---- FRONT ARM — swings while mining/attacking; holds the item ----
    const arm = player.swing > 0 ? -1.2 + player.swing * 1.6 : -0.2 + stride * 0.04;
    ctx.save();
    ctx.translate(w / 2 - 2, torsoY + 1);
    ctx.rotate(arm);
    ctx.fillStyle = "#d23a3a"; // sleeve (lit, slightly brighter than torso)
    ctx.fillRect(0, 0, 3.4, torsoH * 0.52);
    ctx.fillStyle = "rgba(255,255,255,0.16)"; // sleeve highlight
    ctx.fillRect(0, 0, 1, torsoH * 0.52);
    ctx.fillStyle = "#9c2424"; // rolled cuff
    ctx.fillRect(-0.3, torsoH * 0.5, 4, 2);
    ctx.fillStyle = skin; // forearm
    ctx.fillRect(0.2, torsoH * 0.55, 3.2, torsoH * 0.22);
    ctx.fillStyle = skinLit; // forearm highlight
    ctx.fillRect(0.2, torsoH * 0.55, 1, torsoH * 0.22);
    ctx.fillStyle = skin; // fist
    ctx.fillRect(-0.2, torsoH * 0.77, 3.8, 3.2);
    ctx.fillStyle = "rgba(0,0,0,0.15)"; // knuckle lines
    ctx.fillRect(-0.2, torsoH * 0.77 + 1.4, 3.8, 0.7);
    if (ab) { ctx.fillStyle = this._shade(ab.color, -0.15); ctx.fillRect(-0.4, 0, 3.6, 3); } // pauldron cap
    if (held) this._heldInHand(held, h);
    ctx.restore();

    ctx.restore();

    if (player.hurtFlash > 0) { ctx.fillStyle = `rgba(255,60,60,${player.hurtFlash})`; ctx.fillRect(sx - 2, sy - 2, w + 4, h + 4); }
  }

  // Lighten (amt>0) or darken (amt<0) a #rrggbb color by a 0..1 fraction.
  _shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
    return `rgb(${r},${g},${b})`;
  }

  // --- Armor overlays drawn over the bare player parts (top-origin frame) ---
  _drawHeadArmor(def, hx, hy, hw, hh) {
    const ctx = this.ctx;
    const c = def.color, lit = this._shade(c, 0.35), dark = this._shade(c, -0.3);
    ctx.fillStyle = c; // dome helm covering the crown
    ctx.fillRect(hx - 0.5, hy - 1, hw + 1, hh * 0.55);
    ctx.fillStyle = dark; // cheek guards
    ctx.fillRect(hx - 0.5, hy + hh * 0.2, 2, hh * 0.6);
    ctx.fillRect(hx + hw - 1.5, hy + hh * 0.2, 2, hh * 0.6);
    ctx.fillStyle = lit; // crown highlight
    ctx.fillRect(hx + 1, hy, hw - 3, 1.5);
    ctx.fillStyle = this._shade(c, 0.6); // crest ridge
    ctx.fillRect(-0.5, hy - 2, 1.5, hh * 0.5);
    ctx.fillStyle = dark; // brow shadow line
    ctx.fillRect(hx, hy + hh * 0.5, hw, 1);
  }

  _drawBodyArmor(def, w, ty, th) {
    const ctx = this.ctx;
    const c = def.color, lit = this._shade(c, 0.35), dark = this._shade(c, -0.28);
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, dark); g.addColorStop(0.5, c); g.addColorStop(1, lit);
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2 - 0.5, ty, w + 1, th * 0.82); // chestplate
    ctx.fillStyle = lit; // shoulder pauldrons
    ctx.fillRect(-w / 2 - 1, ty - 1, 4, 3);
    ctx.fillRect(w / 2 - 3, ty - 1, 4, 3);
    ctx.fillStyle = dark; // sculpted plate lines
    ctx.fillRect(-0.5, ty + 1, 1, th * 0.78);
    ctx.fillRect(-w / 2 + 1, ty + th * 0.45, w - 2, 1);
    ctx.fillStyle = "rgba(255,255,255,0.4)"; // top-edge gleam
    ctx.fillRect(-w / 2, ty, w, 1.5);
  }

  _drawLegArmor(def, lpL, lpR, hipY, backLen, frontLen) {
    const ctx = this.ctx;
    const c = def.color, dark = this._shade(c, -0.28), lit = this._shade(c, 0.3);
    for (const [x, len] of [[lpL, backLen], [lpR, frontLen]]) {
      ctx.fillStyle = c; // greave plate
      ctx.fillRect(x - 0.5, hipY, 5, len * 0.7);
      ctx.fillStyle = lit; // thigh highlight
      ctx.fillRect(x - 0.5, hipY, 5, 1);
      ctx.fillStyle = dark; // outer shade
      ctx.fillRect(x + 3.5, hipY, 1, len * 0.7);
      ctx.fillStyle = this._shade(c, 0.15); // knee guard
      ctx.fillRect(x - 1, hipY + len * 0.55, 6, 2);
    }
  }

  // Iron Man: red plating with gold trim, glowing eye slit + chest arc reactor.
  _drawIronSuit(w, ty, th, hipY, hx, hy, hw, hh, lpL, lpR, backLen, frontLen) {
    const ctx = this.ctx, t = performance.now();
    const red = "#b3261d", redLit = "#e0463a", gold = "#e8b53a", goldLit = "#ffd76a";
    // legs
    for (const [x, len] of [[lpL, backLen], [lpR, frontLen]]) {
      ctx.fillStyle = red; ctx.fillRect(x - 0.5, hipY, 5, len * 0.7);
      ctx.fillStyle = gold; ctx.fillRect(x - 1, hipY + len * 0.55, 6, 2); // knee
      ctx.fillStyle = goldLit; ctx.fillRect(x - 0.5, hipY, 5, 1);
    }
    // torso
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, "#7e1812"); g.addColorStop(0.5, redLit); g.addColorStop(1, red);
    ctx.fillStyle = g; ctx.fillRect(-w / 2 - 0.5, ty, w + 1, th * 0.82);
    ctx.fillStyle = gold; // gold abdomen + shoulders
    ctx.fillRect(-w / 2, ty + th * 0.5, w, th * 0.32);
    ctx.fillRect(-w / 2 - 1, ty - 1, 4, 3); ctx.fillRect(w / 2 - 3, ty - 1, 4, 3);
    // arc reactor
    const pulse = 0.5 + 0.5 * Math.sin(t / 200);
    const rg = ctx.createRadialGradient(0, ty + th * 0.28, 0, 0, ty + th * 0.28, 5);
    rg.addColorStop(0, "#ffffff"); rg.addColorStop(0.5, `rgba(150,233,255,${0.7 + pulse * 0.3})`); rg.addColorStop(1, "rgba(150,233,255,0)");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, ty + th * 0.28, 4.5, 0, 7); ctx.fill();
    // helmet
    ctx.fillStyle = red; ctx.fillRect(hx - 0.5, hy - 1, hw + 1, hh * 0.95);
    ctx.fillStyle = gold; ctx.fillRect(hx - 0.5, hy + hh * 0.34, hw + 1, hh * 0.22); // faceplate
    ctx.fillStyle = goldLit; ctx.fillRect(hx + 1, hy, hw - 3, 1.5);
    ctx.fillStyle = `rgba(180,240,255,${0.7 + pulse * 0.3})`; // eye slits
    ctx.fillRect(hx + 1, hy + hh * 0.4, hw * 0.32, 1.6);
    ctx.fillRect(hx + hw - hw * 0.32 - 1, hy + hh * 0.4, hw * 0.32, 1.6);
  }

  // The Flash: red suit, gold belt + boots, white-disc cowl with lightning ear.
  _drawFlashSuit(w, ty, th, hipY, hx, hy, hw, hh, lpL, lpR, backLen, frontLen) {
    const ctx = this.ctx, t = performance.now();
    const red = "#c4241c", redLit = "#e8463a", gold = "#f2c63a";
    for (const [x, len] of [[lpL, backLen], [lpR, frontLen]]) {
      ctx.fillStyle = red; ctx.fillRect(x - 0.5, hipY, 5, len * 0.7);
      ctx.fillStyle = gold; ctx.fillRect(x - 1, hipY + len - 3, 6, 3); // gold boots
    }
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, "#8e1610"); g.addColorStop(0.5, redLit); g.addColorStop(1, red);
    ctx.fillStyle = g; ctx.fillRect(-w / 2 - 0.5, ty, w + 1, th * 0.82);
    ctx.fillStyle = gold; ctx.fillRect(-w / 2, hipY - 3, w, 3);        // gold belt
    // chest lightning-bolt emblem
    const pulse = 0.6 + 0.4 * Math.sin(t / 120);
    ctx.fillStyle = `rgba(255,225,60,${pulse})`;
    ctx.fillRect(-0.5, ty + 2, 1.5, th * 0.4);
    ctx.fillRect(-1.5, ty + th * 0.18, 2, 1.2);
    // cowl
    ctx.fillStyle = red; ctx.fillRect(hx - 0.5, hy - 1, hw + 1, hh * 0.62);
    ctx.fillStyle = "#fff"; // exposed face disc
    ctx.fillRect(hx + hw * 0.32, hy + hh * 0.4, hw * 0.5, hh * 0.42);
    ctx.fillStyle = gold; // ear lightning wings
    ctx.fillRect(hx - 1.5, hy + hh * 0.15, 2.5, 2);
    ctx.fillRect(hx + hw - 1, hy + hh * 0.15, 2.5, 2);
  }

  // Draw the equipped item in the player's hand (called inside the arm transform).
  _heldInHand(held, h) {
    const ctx = this.ctx;
    const def = ITEMS[held.item];
    if (!def) return;
    ctx.save();
    ctx.translate(1.5, h * 0.32); // the hand, at the end of the arm
    if (def.kind === "weapon") {
      this._meleeInHand(def, held.item);
    } else if (def.kind === "tool") {
      ctx.fillStyle = "#6b4a2b"; ctx.fillRect(-1, -1, 2, 12);    // handle
      ctx.fillStyle = def.color; ctx.fillRect(-4, 9, 8, 3);      // head
    } else if (def.kind === "gun") {
      this._gunInHand(def, held.item);
    } else if (def.kind === "power") {
      ctx.fillStyle = "#cfd8e6"; ctx.fillRect(-2, -1, 4, 2);     // bottle neck
      ctx.fillStyle = def.color; ctx.fillRect(-3, 1, 6, 7);      // potion body
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(-3, 1, 2, 7);
    } else if (def.kind === "block" || def.kind === "wall") {
      ctx.fillStyle = def.color; ctx.fillRect(-3, 1, 6, 6);      // mini cube
      ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(-3, 1, 6, 1.5);
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 0.5; ctx.strokeRect(-3, 1, 6, 6);
    } else if (def.kind === "armor") {
      const c = def.color, lit = this._shade(c, 0.3);
      ctx.fillStyle = c; ctx.fillRect(-3, 1, 6, 5);
      ctx.fillStyle = lit; ctx.fillRect(-3, 1, 6, 1.5);
    } else if (def.kind === "spell") {
      // A short staff capped with a glowing arcane orb in the spell's colour.
      ctx.strokeStyle = "#5a4632"; ctx.lineWidth = 1.6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-1, 9); ctx.lineTo(2, -2); ctx.stroke();
      const g = ctx.createRadialGradient(2, -3, 0, 2, -3, 5);
      g.addColorStop(0, "#ffffff"); g.addColorStop(0.4, def.color); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(2, -3, 4.5, 0, 7); ctx.fill();
      ctx.fillStyle = def.color; ctx.beginPath(); ctx.arc(2, -3, 1.8, 0, 7); ctx.fill();
    } else if (def.kind === "fishing") {
      ctx.strokeStyle = "#9a6b3c"; ctx.lineWidth = 1.4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(8, 9); ctx.stroke();   // pole
      ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(8, 9); ctx.lineTo(8, 13); ctx.stroke();  // line
    } else if (def.kind === "food") {
      ctx.fillStyle = def.color; ctx.beginPath(); ctx.arc(0, 4, 3, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.beginPath(); ctx.arc(-1, 3, 1, 0, 7); ctx.fill();
    } else if (def.kind === "material") {
      ctx.fillStyle = def.color; ctx.fillRect(-2.5, 1, 5, 5);    // little chunk
      ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(-2.5, 1, 5, 1.5);
    } else {
      ctx.fillStyle = def.color; ctx.fillRect(-2.5, 2, 5, 5);    // generic
    }
    ctx.restore();
  }

  // Melee weapon in the hand (blade/head points "down" +y, swings with the arm).
  // Swords scale by tier; Mjölnir is a runed hammer; Excalibur radiates.
  _meleeInHand(def, key) {
    const ctx = this.ctx;
    const t = performance.now();
    if (key === "mjolnir") {
      // short wrapped handle + chunky steel head with a glowing rune
      ctx.fillStyle = "#5a3b22"; ctx.fillRect(-1, 0, 2, 13);     // handle
      ctx.fillStyle = "#caa15a"; ctx.fillRect(-1.5, 11, 3, 2);   // pommel band
      const c = def.color, lit = this._shade(c, 0.4), dark = this._shade(c, -0.35);
      const g = ctx.createLinearGradient(-5, 0, 5, 0);
      g.addColorStop(0, dark); g.addColorStop(0.5, lit); g.addColorStop(1, dark);
      ctx.fillStyle = g; ctx.fillRect(-5, -3, 10, 8);            // head
      ctx.fillStyle = dark; ctx.fillRect(-5, -3, 10, 1);
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(-5, 4, 10, 1);
      const pulse = 0.5 + 0.5 * Math.sin(t / 120);
      ctx.fillStyle = `rgba(150,210,255,${0.5 + pulse * 0.5})`; // rune
      ctx.fillRect(-1, -1.5, 2, 5); ctx.fillRect(-2.5, 0, 5, 1.5);
      this._weaponGlow(0, 0, 14, `rgba(150,210,255,${0.18 + pulse * 0.16})`);
      return;
    }
    const tier = { wood_sword: 0, stone_sword: 1, iron_sword: 2, gold_sword: 3, diamond_sword: 4, excalibur: 5 }[key] ?? 2;
    const len = 12 + tier * 1.4;
    const gw = 3 + tier * 0.5; // half guard width
    if (def.glow) {
      const pulse = 0.5 + 0.5 * Math.sin(t / 150);
      this._weaponGlow(0, len / 2, len + 6, `rgba(255,243,176,${0.16 + pulse * 0.16})`);
    }
    // grip + pommel above the hand
    ctx.fillStyle = "#5a3b22"; ctx.fillRect(-1, -3, 2, 3);
    ctx.fillStyle = tier >= 5 ? "#f7d35e" : "#caa15a";
    ctx.fillRect(-gw, -1, gw * 2, 2);                            // crossguard
    if (tier >= 5) { ctx.fillRect(-gw - 1, -1.5, 1.5, 3); ctx.fillRect(gw - 0.5, -1.5, 1.5, 3); } // ornate tips
    // blade
    ctx.fillStyle = def.color; ctx.fillRect(-1.5, 1, 3, len);
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(-1.5, 1, 1, len); // bright edge
    ctx.beginPath(); ctx.moveTo(-1.5, 1 + len); ctx.lineTo(0, 4 + len); ctx.lineTo(1.5, 1 + len);
    ctx.closePath(); ctx.fillStyle = def.color; ctx.fill();      // pointed tip
    if (tier === 4) { ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(-1, 3, 2, 2); ctx.fillRect(-1, len * 0.6, 2, 2); } // diamond facets
  }

  // Firearm/wand in the hand (barrel/tip points forward +x).
  _gunInHand(def, key) {
    const ctx = this.ctx;
    const t = performance.now();
    const muzzle = (x, y, color) => { this._weaponGlow(x, y, 6, color); };
    if (def.wand) {
      // a slim staff with a glowing crystal at the tip
      const c = def.bulletColor || "#c08cff";
      ctx.fillStyle = key === "inferno_staff" ? "#4a2a18" : "#3a2c4a";
      ctx.fillRect(-2, 0, 11, 2);                                // shaft
      ctx.fillStyle = "#caa15a"; ctx.fillRect(7, -0.5, 2, 3);    // collar
      const pulse = 0.5 + 0.5 * Math.sin(t / 100);
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(10, 1, 2.2, 0, 7); ctx.fill(); // orb
      ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillRect(9, 0, 1, 1);
      muzzle(10, 1, this._rgba(c, 0.2 + pulse * 0.25));
      return;
    }
    const steel = "#3a3f4b", dark = "#262a33", lite = "#565d6c";
    if (key === "cap_shield") {
      // round shield held edge-on in the hand, blue rings + white star
      ctx.save(); ctx.translate(2, 3); ctx.rotate(t / 300);
      ctx.fillStyle = "#b1233a"; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
      ctx.fillStyle = "#e8e8ec"; ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, 7); ctx.fill();
      ctx.fillStyle = "#1f4fa8"; ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; this._star(0, 0, 2.6);
      ctx.restore(); return;
    }
    if (key === "bat_belt") {
      // a spinning batarang at the fingertips
      ctx.save(); ctx.translate(3, 2); ctx.rotate(t / 80);
      ctx.fillStyle = "#1b1e26";
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-1, -1.5); ctx.lineTo(0, -4);
      ctx.lineTo(1, -1.5); ctx.lineTo(5, 0); ctx.lineTo(1, 1.5); ctx.lineTo(0, 4);
      ctx.lineTo(-1, 1.5); ctx.closePath(); ctx.fill();
      ctx.restore(); return;
    }
    if (key === "ironman_armor") {
      // red-gold gauntlet with a glowing repulsor in the palm
      ctx.fillStyle = "#b3261d"; ctx.fillRect(-2, 0, 8, 4);
      ctx.fillStyle = "#e8b53a"; ctx.fillRect(-2, 0, 8, 1.2);
      const pulse = 0.5 + 0.5 * Math.sin(t / 80);
      const c = def.bulletColor || "#7fe9ff";
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(6, 2, 2, 0, 7); ctx.fill();
      muzzle(7, 2, this._rgba(c, 0.3 + pulse * 0.3)); return;
    }
    if (key === "pistol") {
      ctx.fillStyle = steel; ctx.fillRect(-1, 1, 9, 3);
      ctx.fillStyle = dark; ctx.fillRect(-1, 3, 3, 5);
    } else if (key === "shotgun") {
      ctx.fillStyle = steel; ctx.fillRect(-2, 0.5, 14, 2);       // upper barrel
      ctx.fillStyle = lite; ctx.fillRect(-2, 2.5, 14, 2);        // lower barrel
      ctx.fillStyle = "#5a3b22"; ctx.fillRect(-4, 3, 4, 4);      // wood stock
    } else if (key === "rifle") {
      ctx.fillStyle = steel; ctx.fillRect(-3, 1.5, 16, 2);       // long barrel
      ctx.fillStyle = dark; ctx.fillRect(2, 0, 3, 1.5);          // scope
      ctx.fillStyle = "#5a3b22"; ctx.fillRect(-5, 2, 4, 4);      // stock
      ctx.fillStyle = dark; ctx.fillRect(-2, 3.5, 2, 4);         // grip
    } else if (key === "minigun") {
      ctx.fillStyle = lite; ctx.fillRect(-2, 0.5, 13, 1.5);      // barrels
      ctx.fillStyle = steel; ctx.fillRect(-2, 2, 13, 1.5);
      ctx.fillStyle = dark; ctx.fillRect(-2, 3.5, 13, 1.5);
      ctx.fillStyle = "#444a57"; ctx.beginPath(); ctx.arc(-1, 2.5, 3, 0, 7); ctx.fill(); // drum
    } else if (key === "rocket_launcher") {
      ctx.fillStyle = "#3f5d3a"; ctx.fillRect(-4, 0, 16, 5);     // thick tube
      ctx.fillStyle = "#2c3f29"; ctx.fillRect(-4, 0, 16, 1.5);
      ctx.fillStyle = "#1d2a1b"; ctx.beginPath(); ctx.arc(11, 2.5, 2.5, 0, 7); ctx.fill(); // muzzle ring
    } else if (key === "ray_gun") {
      const c = def.bulletColor || "#8affd6";
      ctx.fillStyle = "#cdd6e4"; ctx.fillRect(-2, 1, 10, 4);     // sleek body
      ctx.fillStyle = dark; ctx.fillRect(-3, 3, 3, 5);           // grip
      ctx.fillStyle = c; ctx.fillRect(7, 1.5, 3, 3);             // emitter
      muzzle(9, 3, this._rgba(c, 0.4));
    } else if (key === "bfg") {
      ctx.fillStyle = "#2f4f3a"; ctx.fillRect(-4, -0.5, 15, 7);  // bulky body
      ctx.fillStyle = "#1e3327"; ctx.fillRect(-4, -0.5, 15, 2);
      const c = def.bulletColor || "#b07aff";
      const pulse = 0.5 + 0.5 * Math.sin(t / 90);
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(9, 3, 2.6, 0, 7); ctx.fill(); // plasma core
      ctx.fillStyle = dark; ctx.fillRect(-2, 5, 4, 4);           // grip
      muzzle(9, 3, this._rgba(c, 0.3 + pulse * 0.3));
    } else { // generic firearm fallback
      ctx.fillStyle = steel; ctx.fillRect(-1, 2, 12, 3);
      ctx.fillStyle = dark; ctx.fillRect(-2, 4, 4, 5);
    }
    if (def.glow && !def.wand) { ctx.fillStyle = def.bulletColor || "#8affd6"; ctx.fillRect(10, 2.5, 2, 2); }
  }

  // Soft radial glow used for magical/energy weapon tips.
  _weaponGlow(x, y, r, color) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  // Filled 5-point star centered at (cx,cy) with outer radius r.
  _star(cx, cy, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? r : r * 0.42;
      const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
  }

  // Convert #rrggbb (+alpha) to an rgba() string.
  _rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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

  // Aura behind a mind-controlled thrall (violet) or a frozen foe (icy blue).
  drawEnemyAura(e) {
    const ctx = this.ctx;
    const cx = Math.round(e.cx - this.camX), cy = Math.round(e.cy - this.camY);
    const r = Math.max(e.w, e.h) * 0.9 + 8;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
    const col = e.friendly ? "192,132,252" : "150,215,255";
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
    g.addColorStop(0, `rgba(${col},${0.4 + pulse * 0.2})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  drawSlime(s) {
    const ctx = this.ctx;
    const squash = s.squash * 4;
    const sx = Math.round(s.x - this.camX);
    const sy = Math.round(s.y - this.camY + squash);
    const w = s.w, hgt = s.h - squash;
    const flash = s.hurtFlash > 0;
    const dir = Math.sign(s.vx) || 1; // look toward travel

    ctx.save();
    ctx.translate(sx + w / 2, sy + hgt);
    ctx.scale(dir, 1);
    ctx.translate(-w / 2, -hgt);

    // gelatinous rounded body with a translucent gradient
    const g = ctx.createLinearGradient(0, 0, 0, hgt);
    if (flash) { g.addColorStop(0, "#eafff0"); g.addColorStop(1, "#bff0cf"); }
    else { g.addColorStop(0, "#67d98a"); g.addColorStop(0.55, "#3fa861"); g.addColorStop(1, "#2c7d47"); }
    ctx.fillStyle = g;
    this._roundRect(0, 0, w, hgt, Math.min(5, hgt / 2));
    ctx.fill();
    // jelly sheen highlight
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    this._roundRect(2, 1.5, w - 7, 2.5, 1.5); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(2, hgt * 0.5, 2, hgt * 0.3);
    // a couple of suspended inner bubbles
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath(); ctx.arc(w * 0.65, hgt * 0.62, 1.5, 0, 7); ctx.fill();
    // eyes (whites + pupils) + tiny mouth
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(w * 0.28, hgt * 0.32, 3, 3);
    ctx.fillRect(w * 0.62, hgt * 0.32, 3, 3);
    ctx.fillStyle = "#0d2e18";
    ctx.fillRect(w * 0.28 + 1.5, hgt * 0.32 + 0.5, 1.5, 2);
    ctx.fillRect(w * 0.62 + 1.5, hgt * 0.32 + 0.5, 1.5, 2);
    ctx.fillStyle = "rgba(13,46,24,0.7)";
    ctx.fillRect(w * 0.42, hgt * 0.6, 3, 1);
    ctx.restore();

    this._entityHealthBar(s, sx, sy);
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  drawVillager(v) {
    const ctx = this.ctx;
    const sx = Math.round(v.x - this.camX);
    const sy = Math.round(v.y - this.camY);
    const w = v.w, h = v.h, f = v.facing;
    const legSwing = Math.sin(v.animTime) * 4;

    // Spell auras: violet halo for a charmed thrall, red for murderous madness.
    if (v.charmed || v.rage > 0) {
      const cx = sx + w / 2, cy = sy + h / 2;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 110);
      const col = v.rage > 0 ? "239,57,138" : "168,85,247";
      const g = ctx.createRadialGradient(cx, cy, 3, cx, cy, 22);
      g.addColorStop(0, `rgba(${col},${0.35 + pulse * 0.25})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.fillRect(cx - 22, cy - 22, 44, 44);
    }

    const skin = "#e8c39e", skinDark = "#cfa07c";
    const robeLit = this._shade(v.color, 0.18), robeDark = this._shade(v.color, -0.22);
    ctx.save();
    ctx.translate(sx + w / 2, sy);
    ctx.scale(f, 1);
    // legs (boots + trousers)
    ctx.fillStyle = "#3a3a4a";
    ctx.fillRect(-w / 2 + 1, h * 0.62, 4, h * 0.38 - legSwing);
    ctx.fillRect(w / 2 - 5, h * 0.62, 4, h * 0.38 + legSwing);
    ctx.fillStyle = "#241c14";
    ctx.fillRect(-w / 2, h - 2, 5, 2);
    ctx.fillRect(w / 2 - 5, h - 2, 5, 2);
    // back arm
    ctx.fillStyle = robeDark;
    ctx.fillRect(-w / 2, h * 0.32, 3, h * 0.32);
    // robe with shaded gradient + hem trim
    const rg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    rg.addColorStop(0, robeDark); rg.addColorStop(0.5, v.color); rg.addColorStop(1, robeLit);
    ctx.fillStyle = rg;
    ctx.fillRect(-w / 2, h * 0.28, w, h * 0.42);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(-w / 2, h * 0.28, w, 1.5);
    ctx.fillStyle = robeDark; // hem + center seam
    ctx.fillRect(-w / 2, h * 0.66, w, 2);
    ctx.fillRect(-0.5, h * 0.3, 1, h * 0.36);
    // front arm
    ctx.fillStyle = v.color;
    ctx.fillRect(w / 2 - 3, h * 0.32, 3, h * 0.3);
    ctx.fillStyle = skin;
    ctx.fillRect(w / 2 - 3, h * 0.62, 3, 2);
    // head with skin shading
    const hw = w - 2, hx = -w / 2 + 1, hh = h * 0.3;
    const hg = ctx.createLinearGradient(hx, 0, hx + hw, 0);
    hg.addColorStop(0, skinDark); hg.addColorStop(0.6, skin); hg.addColorStop(1, "#f1d2ad");
    ctx.fillStyle = hg;
    ctx.fillRect(hx, 0, hw, hh);
    ctx.fillStyle = "#6b5436"; // hair/hood
    ctx.fillRect(hx, 0, hw, hh * 0.32);
    ctx.fillRect(hx, 0, 1.5, hh * 0.6);
    ctx.fillStyle = "#1a1a1a"; // eye
    ctx.fillRect(hw / 2 - 1, hh * 0.5, 2, 2);
    ctx.fillStyle = skinDark; // nose
    ctx.fillRect(hw / 2 + 1.5, hh * 0.58, 1.5, 2);
    ctx.fillStyle = "rgba(150,40,40,0.3)"; // mouth
    ctx.fillRect(hw / 2 - 1, hh * 0.8, 2.5, 1);

    // --- Role regalia (drawn in the body transform) ---
    const gangCol = v.gang && GANGS[v.gang] ? GANGS[v.gang].color : null;
    if (v.royal) {
      // A golden crown with jewelled points sitting on the head.
      ctx.fillStyle = "#f2c84b";
      ctx.fillRect(hx, -3, hw, 3);
      for (let i = 0; i <= 3; i++) {
        const px = hx + (hw / 3) * i;
        ctx.beginPath();
        ctx.moveTo(px - 1.5, -3); ctx.lineTo(px, -7); ctx.lineTo(px + 1.5, -3);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = v.role === "queen" ? "#e0407a" : "#7a3df0"; // central jewel
      ctx.fillRect(hw / 2 - 1, -2.5, 2, 2);
    } else if (v.patrol) {
      // Guard: a riveted iron helm and a gang-colored sash across the chest.
      ctx.fillStyle = "#aab2bd";
      ctx.fillRect(hx - 0.5, -2, hw + 1, hh * 0.55);
      ctx.fillStyle = "#cfd6df";
      ctx.fillRect(hx - 0.5, -2, hw + 1, 1.5);
      ctx.fillStyle = "#7c8590";
      ctx.fillRect(hw / 2 + 0.5, -1, 1.5, hh * 0.55); // nose guard
      if (gangCol) { ctx.fillStyle = gangCol; ctx.fillRect(-w / 2, h * 0.34, w, 2.5); }
      ctx.fillStyle = "#9aa3ad"; // spear shaft + tip
      ctx.fillRect(w / 2 - 1, -6, 1.5, h * 0.72);
      ctx.fillRect(w / 2 - 1.75, -8, 3, 3);
    } else if (gangCol) {
      // Rank-and-file gang members wear a colored sash.
      ctx.fillStyle = gangCol;
      ctx.fillRect(-w / 2, h * 0.32, w, 2);
    }
    ctx.restore();

    // name (+ title) + food bar floating above
    const title = v.role === "king" ? "King " : v.role === "queen" ? "Queen "
      : v.role === "guard" ? "Guard " : v.role === "farmer" ? "Farmer " : "";
    const gangName = v.gang && GANGS[v.gang] ? GANGS[v.gang].name : null;
    const label = title + v.name;
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const lw = Math.max(ctx.measureText(label).width, gangName ? ctx.measureText(gangName).width : 0);
    const boxTop = gangName ? sy - 27 : sy - 16;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(sx + w / 2 - lw / 2 - 3, boxTop, lw + 6, gangName ? 22 : 11);
    ctx.fillStyle = v.royal ? "#f2c84b" : "#fff";
    ctx.fillText(label, sx + w / 2, boxTop + 1);
    if (gangName) {
      ctx.fillStyle = (GANGS[v.gang] && GANGS[v.gang].color) || "#aaa";
      ctx.fillText(gangName, sx + w / 2, boxTop + 11);
    }
    ctx.fillStyle = "#3a1a1a";
    ctx.fillRect(sx - 2, sy - 4, w + 4, 3);
    ctx.fillStyle = v.food > 0.3 ? "#7bd86f" : "#e05a5a";
    ctx.fillRect(sx - 2, sy - 4, (w + 4) * v.food, 3);

    if (v.hurtFlash > 0) { ctx.fillStyle = `rgba(255,60,60,${v.hurtFlash * 2})`; ctx.fillRect(sx, sy, w, h); }
  }

  // Shambling undead — rotting skin, ragged shirt, outstretched arms.
  drawZombie(z) {
    const ctx = this.ctx;
    const sx = Math.round(z.x - this.camX);
    const sy = Math.round(z.y - this.camY);
    const w = z.w, h = z.h, f = z.facing;
    const legSwing = Math.sin(z.animTime) * 4;
    const flash = z.hurtFlash > 0;
    const skin = flash ? "#d8ffe0" : (z.tint || "#5f8a52");
    const skinDark = this._shade(skin, -0.25);

    ctx.save();
    ctx.translate(sx + w / 2, sy);
    ctx.scale(f, 1);
    // legs (tattered trousers)
    ctx.fillStyle = "#3b3550";
    ctx.fillRect(-w / 2 + 1, h * 0.62, 4, h * 0.38 - legSwing);
    ctx.fillRect(w / 2 - 5, h * 0.62, 4, h * 0.38 + legSwing);
    // torso (ragged shirt)
    const tg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    tg.addColorStop(0, skinDark); tg.addColorStop(0.5, skin); tg.addColorStop(1, this._shade(skin, 0.15));
    ctx.fillStyle = tg;
    ctx.fillRect(-w / 2, h * 0.3, w, h * 0.36);
    ctx.fillStyle = "#4a5a3a";
    ctx.fillRect(-w / 2, h * 0.42, w, 3); // torn shirt band
    // outstretched arms (the classic zombie reach)
    ctx.fillStyle = skin;
    ctx.fillRect(w / 2 - 1, h * 0.34, 6, 3);
    ctx.fillStyle = skinDark;
    ctx.fillRect(-w / 2 - 3, h * 0.36, 4, 3);
    // head
    const hw = w - 2, hx = -w / 2 + 1, hh = h * 0.3;
    ctx.fillStyle = skin;
    ctx.fillRect(hx, 0, hw, hh);
    ctx.fillStyle = skinDark;
    ctx.fillRect(hx, hh * 0.7, hw, hh * 0.3);
    // sunken glowing eyes + grimace
    ctx.fillStyle = flash ? "#ffffff" : "#1c2a14";
    ctx.fillRect(hw * 0.2, hh * 0.45, 2, 2);
    ctx.fillRect(hw * 0.62, hh * 0.45, 2, 2);
    ctx.fillStyle = "rgba(20,10,10,0.6)";
    ctx.fillRect(hx + 2, hh * 0.82, hw - 4, 1);
    ctx.restore();

    this._entityHealthBar(z, sx, sy);
  }

  // Skeleton archer — bony white frame holding a small bow.
  drawSkeleton(s) {
    const ctx = this.ctx;
    const sx = Math.round(s.x - this.camX);
    const sy = Math.round(s.y - this.camY);
    const w = s.w, h = s.h, f = s.facing;
    const legSwing = Math.sin(s.animTime) * 3;
    const flash = s.hurtFlash > 0;
    const bone = flash ? "#ffffff" : "#e8e3cf";
    const boneDark = this._shade(bone, -0.18);

    ctx.save();
    ctx.translate(sx + w / 2, sy);
    ctx.scale(f, 1);
    // leg bones
    ctx.fillStyle = boneDark;
    ctx.fillRect(-w / 2 + 2, h * 0.62, 3, h * 0.38 - legSwing);
    ctx.fillRect(w / 2 - 5, h * 0.62, 3, h * 0.38 + legSwing);
    // ribcage / spine
    ctx.fillStyle = bone;
    ctx.fillRect(-2, h * 0.3, 4, h * 0.34);
    for (let i = 0; i < 4; i++) ctx.fillRect(-w / 2 + 2, h * 0.34 + i * 4, w - 4, 1.5);
    // skull
    const hw = w - 3, hx = -w / 2 + 1.5, hh = h * 0.28;
    ctx.fillStyle = bone;
    ctx.fillRect(hx, 0, hw, hh);
    ctx.fillStyle = "#1a1a1a"; // eye sockets
    ctx.fillRect(hx + 1.5, hh * 0.4, 2, 2);
    ctx.fillRect(hx + hw - 3.5, hh * 0.4, 2, 2);
    ctx.fillStyle = boneDark; // jaw
    ctx.fillRect(hx + 1, hh * 0.8, hw - 2, 1.5);
    // bow held out front
    ctx.strokeStyle = "#9a6b3c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(w / 2 + 1, h * 0.42, 6, -Math.PI / 2.2, Math.PI / 2.2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(240,240,240,0.6)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(w / 2 + 1, h * 0.42 - 5);
    ctx.lineTo(w / 2 + 1, h * 0.42 + 5);
    ctx.stroke();
    ctx.restore();

    this._entityHealthBar(s, sx, sy);
  }

  // The Cave Warden — a massive horned brute wreathed in a dark aura.
  drawBoss(b) {
    const ctx = this.ctx;
    const sx = Math.round(b.x - this.camX);
    const sy = Math.round(b.y - this.camY);
    const w = b.w, h = b.h, f = b.facing;
    const flash = b.hurtFlash > 0;
    const stride = Math.sin(b.animTime) * 5;
    const pulse = 0.5 + 0.5 * Math.sin((b.glowPulse || 0) * 4);

    // dark aura
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.25 * pulse;
    const ag = ctx.createRadialGradient(sx + w / 2, sy + h / 2, 4, sx + w / 2, sy + h / 2, w);
    ag.addColorStop(0, "rgba(150,40,160,0.6)");
    ag.addColorStop(1, "rgba(150,40,160,0)");
    ctx.fillStyle = ag;
    ctx.fillRect(sx - w, sy - h / 2, w * 3, h * 2);
    ctx.restore();

    const body = flash ? "#f6dcff" : "#3a2440";
    const bodyLit = this._shade(body, 0.22), bodyDark = this._shade(body, -0.3);

    ctx.save();
    ctx.translate(sx + w / 2, sy);
    ctx.scale(f, 1);
    // legs
    ctx.fillStyle = bodyDark;
    ctx.fillRect(-w / 2 + 3, h * 0.6, 8, h * 0.4 - stride);
    ctx.fillRect(w / 2 - 11, h * 0.6, 8, h * 0.4 + stride);
    // torso
    const tg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    tg.addColorStop(0, bodyDark); tg.addColorStop(0.5, body); tg.addColorStop(1, bodyLit);
    ctx.fillStyle = tg;
    this._roundRect(-w / 2, h * 0.26, w, h * 0.4, 5); ctx.fill();
    // arms / fists
    ctx.fillStyle = body;
    ctx.fillRect(-w / 2 - 5, h * 0.3, 7, h * 0.3);
    ctx.fillRect(w / 2 - 2, h * 0.3, 7, h * 0.3);
    ctx.fillStyle = bodyDark;
    ctx.fillRect(w / 2 - 1, h * 0.55, 8, 7);
    ctx.fillRect(-w / 2 - 6, h * 0.55, 8, 7);
    // head + horns
    const hw = w * 0.55, hx = -hw / 2, hh = h * 0.26;
    ctx.fillStyle = body;
    this._roundRect(hx, 0, hw, hh, 3); ctx.fill();
    ctx.fillStyle = "#d8cbe0";
    ctx.beginPath(); ctx.moveTo(hx, 2); ctx.lineTo(hx - 5, -6); ctx.lineTo(hx + 3, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx + hw, 2); ctx.lineTo(hx + hw + 5, -6); ctx.lineTo(hx + hw - 3, 0); ctx.fill();
    // burning eyes
    ctx.fillStyle = `rgba(255,${80 + pulse * 120 | 0},40,1)`;
    ctx.fillRect(hx + hw * 0.2, hh * 0.4, 3, 3);
    ctx.fillRect(hx + hw * 0.6, hh * 0.4, 3, 3);
    ctx.fillStyle = "rgba(20,0,0,0.6)";
    ctx.fillRect(hx + 2, hh * 0.78, hw - 4, 2);
    ctx.restore();

    if (flash) { ctx.fillStyle = `rgba(255,120,255,${b.hurtFlash})`; ctx.fillRect(sx, sy, w, h); }
  }

  // A great winged dragon, drawn in side view: long neck + horned head, a deep
  // body, a sweeping tail, and a pair of membranous wings that beat as it flies.
  drawDragon(d) {
    const ctx = this.ctx;
    const sx = Math.round(d.x - this.camX), sy = Math.round(d.y - this.camY);
    const w = d.w, h = d.h, f = d.facing;
    const flash = d.hurtFlash > 0;
    const wing = Math.sin(d.flap); // -1..1 wing-beat phase
    const rage = !!d.enraged;

    // Enraged dragons glow red-hot; pulse the heat a little.
    const heat = rage ? 0.5 + 0.5 * Math.sin((d.animTime || 0) * 8) : 0;
    const body = flash ? "#ffd9d2" : (rage ? "#b8281a" : "#7a1f1f");
    const bodyLit = this._shade(body, 0.25 + heat * 0.2), bodyDark = this._shade(body, -0.32);
    const membrane = flash ? "#ffe0c0" : (rage ? "#ff5a32" : "#b5402f");

    // Heat aura behind an enraged dragon.
    if (rage) {
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.25 * heat;
      const ag = ctx.createRadialGradient(sx + w / 2, sy + h / 2, 4, sx + w / 2, sy + h / 2, w * 0.9);
      ag.addColorStop(0, "rgba(255,120,40,0.7)");
      ag.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = ag;
      ctx.fillRect(sx - w / 2, sy - h / 2, w * 2, h * 2);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(sx + w / 2, sy + h / 2);
    ctx.scale(f, 1);

    // Far wing (behind the body), beating in counter-phase and dimmer.
    this._dragonWing(membrane, bodyDark, -wing, 0.6);

    // Tail: a tapering triangle sweeping back from the body.
    ctx.fillStyle = bodyDark;
    ctx.beginPath();
    ctx.moveTo(-w * 0.32, 0);
    ctx.lineTo(-w * 0.62, -3 + wing * 2);
    ctx.lineTo(-w * 0.30, 5);
    ctx.closePath(); ctx.fill();
    // tail spade
    ctx.beginPath();
    ctx.moveTo(-w * 0.6, -3 + wing * 2);
    ctx.lineTo(-w * 0.7, -8 + wing * 2);
    ctx.lineTo(-w * 0.55, -2 + wing * 2);
    ctx.closePath(); ctx.fill();

    // Body: a fat rounded lozenge.
    const bg = ctx.createLinearGradient(0, -h * 0.4, 0, h * 0.4);
    bg.addColorStop(0, bodyLit); bg.addColorStop(1, bodyDark);
    ctx.fillStyle = bg;
    this._roundRect(-w * 0.34, -h * 0.34, w * 0.6, h * 0.68, 7); ctx.fill();

    // Neck + head, raised toward the front.
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(w * 0.18, -h * 0.2);
    ctx.lineTo(w * 0.42, -h * 0.5);
    ctx.lineTo(w * 0.5, -h * 0.5);
    ctx.lineTo(w * 0.3, h * 0.05);
    ctx.closePath(); ctx.fill();
    // head
    ctx.fillStyle = bodyLit;
    this._roundRect(w * 0.4, -h * 0.62, w * 0.22, h * 0.34, 3); ctx.fill();
    // snout
    ctx.fillStyle = body;
    ctx.fillRect(w * 0.58, -h * 0.5, w * 0.12, h * 0.16);
    // horns
    ctx.fillStyle = "#e8d8c0";
    ctx.beginPath();
    ctx.moveTo(w * 0.42, -h * 0.6); ctx.lineTo(w * 0.38, -h * 0.82); ctx.lineTo(w * 0.48, -h * 0.6); ctx.closePath(); ctx.fill();
    // glowing eye
    ctx.fillStyle = "#ffd23a";
    ctx.fillRect(w * 0.5, -h * 0.5, 3, 3);

    // Back spikes along the body ridge.
    ctx.fillStyle = bodyDark;
    for (let i = 0; i < 4; i++) {
      const x = -w * 0.28 + i * w * 0.14;
      ctx.beginPath();
      ctx.moveTo(x, -h * 0.32); ctx.lineTo(x + 4, -h * 0.5); ctx.lineTo(x + 8, -h * 0.32); ctx.closePath(); ctx.fill();
    }

    // Near wing (in front of the body), full brightness.
    this._dragonWing(membrane, body, wing, 1);

    ctx.restore();

    if (flash) { ctx.fillStyle = `rgba(255,140,90,${d.hurtFlash})`; ctx.fillRect(sx, sy, w, h); }
  }

  // One bat-like wing: a fan of membrane panels between bone struts. `phase`
  // (-1..1) lifts/drops the wingtip; `alpha` dims the far wing.
  _dragonWing(membrane, bone, phase, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    const lift = phase * 14;
    ctx.fillStyle = membrane;
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(-6, -20 - lift);
    ctx.lineTo(6, -16 - lift);
    ctx.lineTo(18, -22 - lift);
    ctx.lineTo(22, -6 - lift * 0.4);
    ctx.lineTo(4, 2);
    ctx.closePath(); ctx.fill();
    // bone struts
    ctx.strokeStyle = bone; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -4); ctx.lineTo(-6, -20 - lift);
    ctx.moveTo(0, -4); ctx.lineTo(6, -16 - lift);
    ctx.moveTo(0, -4); ctx.lineTo(18, -22 - lift);
    ctx.stroke();
    ctx.restore();
  }

  // Animated flames over burning tiles.
  drawFires(fires, t) {
    if (!fires || !fires.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const fr of fires) {
      const bx = fr.tx * TILE - this.camX, by = fr.ty * TILE - this.camY;
      const grow = Math.min(1, fr.life / 0.6); // shrink as it dies out
      for (let i = 0; i < 3; i++) {
        const ph = t * 9 + i * 2.1 + fr.tx * 0.7;
        const fx = bx + TILE * (0.3 + 0.4 * i) + Math.sin(ph) * 2;
        const fh = (TILE * (0.7 + 0.25 * Math.sin(ph * 1.7))) * grow;
        const fy = by + TILE - fh;
        const g = ctx.createLinearGradient(fx, fy + fh, fx, fy);
        g.addColorStop(0, "rgba(255,120,30,0.9)");
        g.addColorStop(0.6, "rgba(255,190,60,0.7)");
        g.addColorStop(1, "rgba(255,240,160,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(fx - 3, fy + fh);
        ctx.quadraticCurveTo(fx - 4, fy + fh * 0.4, fx, fy);
        ctx.quadraticCurveTo(fx + 4, fy + fh * 0.4, fx + 3, fy + fh);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  // Big boss health bar pinned to the top-centre of the screen.
  drawBossBar(b, row = 0) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const bw = Math.min(360, W * 0.6), bh = 12;
    const bx = (W - bw) / 2, by = 14 + row * (bh + 8);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.fillStyle = "#2a0a18";
    ctx.fillRect(bx, by, bw, bh);
    const frac = Math.max(0, b.hp / b.maxHp);
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, "#c0306a"); g.addColorStop(1, "#ff5a8a");
    ctx.fillStyle = g;
    ctx.fillRect(bx, by, bw * frac, bh);
    ctx.fillStyle = "#fff";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.name || "Boss", bx + bw / 2, by + bh / 2 + 0.5);
    ctx.restore();
  }

  // --- Farm animals (cow / pig / chicken) ---
  drawAnimal(a) {
    const ctx = this.ctx;
    const sx = Math.round(a.x - this.camX), sy = Math.round(a.y - this.camY);
    const w = a.w, h = a.h, f = a.facing;
    const swing = Math.sin(a.animTime) * 3;
    ctx.save();
    ctx.translate(sx + w / 2, sy + h);
    ctx.scale(f, 1);
    ctx.translate(-w / 2, -h);
    if (a.type === "chicken") this._drawChicken(w, h, swing);
    else this._drawQuadruped(w, h, swing, a);
    ctx.restore();
    if (a.hurtFlash > 0) { ctx.fillStyle = `rgba(255,60,60,${a.hurtFlash * 2})`; ctx.fillRect(sx, sy, w, h); }
    this._entityHealthBar(a, sx, sy);
  }

  _drawQuadruped(w, h, swing, a) {
    const ctx = this.ctx;
    // legs (back pair static, front pair swings)
    ctx.fillStyle = "#4a3a2c";
    ctx.fillRect(3, h - 5, 3, 5 - swing * 0.4);
    ctx.fillRect(7, h - 5, 3, 5 + swing * 0.4);
    ctx.fillRect(w - 9, h - 5, 3, 5 - swing * 0.4);
    ctx.fillRect(w - 5, h - 5, 3, 5 + swing * 0.4);
    // body
    ctx.fillStyle = a.def.color;
    ctx.fillRect(1, h * 0.24, w - 2, h * 0.56);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(1, h * 0.24, w - 2, 2);
    // cow spots
    if (a.def.spot) {
      ctx.fillStyle = a.def.spot;
      ctx.fillRect(4, h * 0.34, 5, 4);
      ctx.fillRect(w * 0.5, h * 0.5, 5, 4);
    }
    // pig curly tail at the back
    if (a.type === "pig") { ctx.fillStyle = a.def.color; ctx.fillRect(-1, h * 0.32, 2, 2); ctx.fillRect(-2, h * 0.28, 2, 2); }
    // head at the front
    ctx.fillStyle = a.def.color;
    ctx.fillRect(w - 7, h * 0.12, 7, h * 0.5);
    // snout
    ctx.fillStyle = a.type === "pig" ? "#d98a98" : "#b9a98f";
    ctx.fillRect(w - 3, h * 0.32, 3, h * 0.2);
    if (a.type === "pig") { ctx.fillStyle = "#9a5560"; ctx.fillRect(w - 2.5, h * 0.36, 1, 1.5); ctx.fillRect(w - 1.5, h * 0.36, 1, 1.5); }
    // eye
    ctx.fillStyle = "#161616";
    ctx.fillRect(w - 4.5, h * 0.24, 1.5, 1.5);
    // cow horns / pig ear
    if (a.type === "cow") { ctx.fillStyle = "#efeada"; ctx.fillRect(w - 6.5, h * 0.06, 1.5, 2); ctx.fillRect(w - 3, h * 0.06, 1.5, 2); }
    if (a.type === "pig") { ctx.fillStyle = a.def.color; ctx.fillRect(w - 6, h * 0.02, 2, 3); }
  }

  _drawChicken(w, h, swing) {
    const ctx = this.ctx;
    ctx.fillStyle = "#caa15a"; // legs
    ctx.fillRect(w * 0.38, h - 3, 1.5, 3 - swing * 0.2);
    ctx.fillRect(w * 0.58, h - 3, 1.5, 3 + swing * 0.2);
    ctx.fillStyle = "#dcdcdc"; // tail
    ctx.fillRect(0, h * 0.3, 3, 5);
    ctx.fillStyle = "#f6f6f6"; // body
    ctx.fillRect(1, h * 0.34, w - 3, h * 0.5);
    ctx.fillStyle = "#ffffff"; // head
    ctx.fillRect(w - 6, h * 0.06, 5, 6);
    ctx.fillStyle = "#e0403a"; // comb
    ctx.fillRect(w - 5, h * 0.0, 3, 2);
    ctx.fillStyle = "#f2a83a"; // beak
    ctx.fillRect(w - 1.5, h * 0.26, 2.5, 2);
    ctx.fillStyle = "#161616"; // eye
    ctx.fillRect(w - 3, h * 0.2, 1.5, 1.5);
  }

  // A fish swimming in the water (or flopping out of it).
  drawFish(fz) {
    const ctx = this.ctx;
    const sx = Math.round(fz.cx - this.camX), sy = Math.round(fz.cy - this.camY);
    const f = fz.facing || 1;
    const wob = Math.sin(fz._wob) * 1.5;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(f, 1);
    ctx.globalAlpha = fz.outOfWater > 0 ? 1 : 0.92;
    ctx.fillStyle = fz.hurtFlash > 0 ? "#ffffff" : fz.color;
    ctx.beginPath(); ctx.ellipse(0, wob, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); // tail fin
    ctx.moveTo(-4, wob); ctx.lineTo(-8, wob - 3); ctx.lineTo(-8, wob + 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(-1, wob - 2, 3, 1);
    ctx.fillStyle = "#0a0a0a"; // eye
    ctx.fillRect(2.5, wob - 1, 1.5, 1.5);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // The cast line + bobber while fishing (drawn in world space, inside shake).
  drawFishingLine(player, fz) {
    if (!fz) return;
    const ctx = this.ctx;
    const hx = player.cx - this.camX + player.facing * 7;
    const hy = player.cy - this.camY - 6;
    const bx = fz.bx - this.camX;
    const by = fz.by - this.camY + (fz.dip || 0);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.quadraticCurveTo((hx + bx) / 2, Math.max(hy, by) + 8, bx, by);
    ctx.stroke();
    ctx.fillStyle = fz.hooked ? "#ff5a4a" : "#f0f0f0"; // bobber
    ctx.fillRect(bx - 2, by - 2, 4, 4);
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(bx - 2, by - 2, 4, 2);
    if (fz.hooked) {
      ctx.fillStyle = "#ffe08a";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillText("!", bx, by - 7);
    }
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

  // A slim mana bar tucked just under the heart row.
  drawMana(player) {
    if (player.maxMana == null) return;
    const ctx = this.ctx;
    const x0 = 12, y0 = 32, w = 190, h = 9;
    const frac = Math.max(0, Math.min(1, player.mana / player.maxMana));
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x0 - 1, y0 - 1, w + 2, h + 2);
    ctx.fillStyle = "#16203a";
    ctx.fillRect(x0, y0, w, h);
    const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    g.addColorStop(0, "#4a7bd6"); g.addColorStop(1, "#8ad0ff");
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, w * frac, h);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(x0, y0, w * frac, 2);
    ctx.fillStyle = "#bcd6ff"; ctx.font = "8px monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(`MANA ${Math.round(player.mana)}`, x0 + 4, y0 + h / 2 + 0.5);
  }

  _heart(x, y, s) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y + s * 0.85);
    ctx.bezierCurveTo(x - s * 0.1, y + s * 0.45, x + s * 0.2, y + s * 0.02, x + s / 2, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.8, y + s * 0.02, x + s * 1.1, y + s * 0.45, x + s / 2, y + s * 0.85);
    ctx.fill();
  }

  // Active power-up chips stacked at the top-right, each with a shrinking timer bar.
  drawBuffs(player) {
    if (!player.buffs) return;
    const ctx = this.ctx;
    const keys = Object.keys(player.buffs).filter((k) => player.buffs[k] > 0);
    if (!keys.length) return;
    const w = 132, h = 20, gap = 5, x = this.vw - w - 12;
    let y = 12;
    ctx.font = "11px monospace"; ctx.textBaseline = "middle";
    for (const k of keys) {
      const meta = BUFF_META[k] || { label: k, color: "#cdd6f4" };
      const tleft = player.buffs[k];
      const frac = Math.max(0, Math.min(1, tleft / 30));
      ctx.fillStyle = "rgba(10,12,24,0.8)";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = meta.color;
      ctx.fillRect(x, y, 3, h);                       // color tab
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(x + 3, y + h - 3, (w - 3) * frac, 3); // timer bar
      ctx.fillStyle = meta.color;
      ctx.textAlign = "left";
      ctx.fillText(meta.label, x + 8, y + h / 2);
      ctx.fillStyle = "#cdd6f4"; ctx.textAlign = "right";
      ctx.fillText(`${Math.ceil(tleft)}s`, x + w - 6, y + h / 2);
      y += h + gap;
    }
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

  // Dizzy "under the influence" overlay: a swaying, pulsing vignette in two
  // drifting hotspots to fake wooziness/double-vision without moving the world.
  drawDizzy(player) {
    if (!player.isIntoxicated || !player.isIntoxicated()) return;
    const ctx = this.ctx;
    const t = performance.now() / 1000;
    const cx = this.vw / 2, cy = this.vh / 2;
    const sway = 0.16 + Math.sin(t * 1.3) * 0.05;     // breathing intensity
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 2; i++) {
      const ang = t * 1.7 + i * Math.PI;               // two hotspots orbit opposite
      const ox = cx + Math.cos(ang) * this.vw * 0.06;
      const oy = cy + Math.sin(ang * 1.3) * this.vh * 0.05;
      const g = ctx.createRadialGradient(ox, oy, this.vh * 0.2, ox, oy, this.vh * 0.75);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(120,70,150,${sway})`);   // woozy violet edges
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.vw, this.vh);
    }
    ctx.restore();
  }

  // Stimulant rush (cocaine/crack): a fast-flickering bright edge tint with a
  // racing pulse — the twitchy counterpart to the drunk wobble. Crack is redder
  // and more violent than cocaine's icy shimmer.
  drawStim(player) {
    if (!player.isStimmed || !player.isStimmed()) return;
    const ctx = this.ctx;
    const crack = (player.buffs.cracked || 0) > 0;
    const t = performance.now() / 1000;
    const speed = crack ? 22 : 13;                    // flicker rate
    const flick = 0.5 + 0.5 * Math.sin(t * speed);
    const amp = (crack ? 0.22 : 0.12) * (0.6 + 0.4 * flick);
    const tint = crack ? "230,70,70" : "180,210,255";
    const g = ctx.createRadialGradient(
      this.vw / 2, this.vh / 2, this.vh * 0.3,
      this.vw / 2, this.vh / 2, this.vh * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(${tint},${amp})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);
  }

  // Geometry of the hotbar, shared by drawHotbar and hotbarHitTest.
  hotbarRect() {
    const slot = 44, pad = 6;
    const totalW = 5 * (slot + pad) - pad; // hotbarSize is always 5
    return {
      slot, pad, totalW,
      x0: (this.vw - totalW) / 2,
      y0: this.vh - slot - 12 - this.hotbarLift,
    };
  }

  // Which hotbar slot (if any) is under the given screen point; -1 for none.
  hotbarHitTest(inv, mx, my) {
    const { slot, pad, x0, y0 } = this.hotbarRect();
    if (my < y0 || my > y0 + slot) return -1;
    for (let i = 0; i < inv.hotbarSize; i++) {
      const x = x0 + i * (slot + pad);
      if (mx >= x && mx <= x + slot) return i;
    }
    return -1;
  }

  drawHotbar(inv) {
    const ctx = this.ctx;
    const { slot, pad, x0, y0 } = this.hotbarRect();

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

  // Every item gets a hand-drawn icon (no emoji placeholders); plus a durability
  // bar for worn tools/weapons and a stack count.
  drawItemIcon(s, x, y, size) {
    if (!s) return;
    const ctx = this.ctx;
    const def = ITEMS[s.item];
    if (!def) return;
    const cx = x + size / 2, cy = y + size / 2;
    switch (def.kind) {
      case "weapon":
        if (s.item === "mjolnir") this._hammerIcon(cx, cy, size, def);
        else this._swordIcon(cx, cy, size, def.color, def.glow);
        break;
      case "gun": this._gunIcon(cx, cy, size, def, s.item); break;
      case "tool": this._toolIcon(cx, cy, size, def); break;
      case "armor": this._armorIcon(cx, cy, size, def); break;
      case "power": this._powerIcon(cx, cy, size, def, s.item); break;
      case "food": this._foodIcon(cx, cy, size, def, s.item); break;
      case "fishing": this._rodIcon(cx, cy, size); break;
      case "block": this._blockIcon(x, y, size, def, s.item); break;
      case "wall": this._wallIcon(x, y, size, def); break;
      case "material": this._materialIcon(cx, cy, size, def, s.item); break;
      default: this._chipIcon(x, y, size, def);
    }
    // durability bar (only when a breakable item has been used)
    if (def.dur && s.dur != null && s.dur < def.dur) {
      const frac = Math.max(0, s.dur / def.dur);
      const bw = size - 6, bh = 2.5, bx = x + 3, by = y + size - 4;
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = frac > 0.5 ? "#5fd06a" : frac > 0.25 ? "#e6c14a" : "#e0532e";
      ctx.fillRect(bx, by, bw * frac, bh);
    }
    if (maxStack(s.item) > 1 && s.count > 1) {
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.floor(size * 0.26)}px monospace`;
      ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      ctx.fillText(s.count, x + size - 3, y + size - 2);
    }
  }

  // ---- per-kind drawn icons (units scale to slot via u = size/16) ----

  _chipIcon(x, y, size, def) {
    const ctx = this.ctx;
    const m = size * 0.24;
    ctx.fillStyle = def.color || "#aaa";
    ctx.fillRect(x + m, y + m, size - 2 * m, size - 2 * m);
    ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.fillRect(x + m, y + m, size - 2 * m, 2);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x + m, y + size - m - 2, size - 2 * m, 2);
    if (def.glyph) {
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.font = `bold ${Math.floor(size * 0.34)}px monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(def.glyph, x + size / 2, y + size / 2);
    }
  }

  // Pickaxe: wooden haft + a curved material-colored head.
  _toolIcon(cx, cy, size, def) {
    const ctx = this.ctx; const u = size / 16;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = "#6b4a2b"; ctx.fillRect(-1 * u, -6 * u, 2 * u, 12 * u); // haft
    const c = def.color, lit = this._shade(c, 0.35), dark = this._shade(c, -0.3);
    ctx.strokeStyle = c; ctx.lineWidth = 2.4 * u; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-5 * u, -5 * u); ctx.quadraticCurveTo(0, -7.5 * u, 5 * u, -5 * u); ctx.stroke(); // head
    ctx.strokeStyle = lit; ctx.lineWidth = 0.8 * u;
    ctx.beginPath(); ctx.moveTo(-4.5 * u, -5.3 * u); ctx.quadraticCurveTo(0, -7.2 * u, 4.5 * u, -5.3 * u); ctx.stroke();
    ctx.restore();
  }

  // Armor: a silhouette per slot (helmet / chestplate / greaves) in its color.
  _armorIcon(cx, cy, size, def) {
    const ctx = this.ctx; const u = size / 16;
    const c = def.color, lit = this._shade(c, 0.35), dark = this._shade(c, -0.3);
    ctx.save(); ctx.translate(cx, cy);
    const g = ctx.createLinearGradient(-6 * u, 0, 6 * u, 0);
    g.addColorStop(0, dark); g.addColorStop(0.5, c); g.addColorStop(1, lit);
    ctx.fillStyle = g;
    if (def.slot === "head") {
      ctx.beginPath(); ctx.arc(0, 0, 5 * u, Math.PI, 0); ctx.lineTo(5 * u, 3 * u); ctx.lineTo(-5 * u, 3 * u); ctx.closePath(); ctx.fill();
      ctx.fillStyle = dark; ctx.fillRect(-1 * u, -5 * u, 2 * u, 8 * u); // nose guard
    } else if (def.slot === "legs") {
      ctx.fillRect(-5 * u, -4 * u, 4 * u, 8 * u);
      ctx.fillRect(1 * u, -4 * u, 4 * u, 8 * u);
      ctx.fillStyle = lit; ctx.fillRect(-5 * u, -4 * u, 4 * u, 1.2 * u); ctx.fillRect(1 * u, -4 * u, 4 * u, 1.2 * u);
    } else { // body / chestplate
      ctx.fillRect(-5 * u, -4 * u, 10 * u, 8 * u);
      ctx.fillStyle = lit; ctx.fillRect(-6 * u, -4.5 * u, 3 * u, 2.5 * u); ctx.fillRect(3 * u, -4.5 * u, 3 * u, 2.5 * u); // pauldrons
      ctx.fillStyle = dark; ctx.fillRect(-0.5 * u, -4 * u, 1 * u, 8 * u);
    }
    ctx.restore();
  }

  // Power-ups: bottle by default, with special shapes for non-potion items.
  _powerIcon(cx, cy, size, def, key) {
    const ctx = this.ctx; const u = size / 16; const c = def.color;
    const t = performance.now();
    ctx.save(); ctx.translate(cx, cy);
    if (key === "heart_container" || key === "warden_heart") {
      this._heartShape(0, 0, 5.5 * u, c);
    } else if (key === "god_star") {
      const pulse = 0.5 + 0.5 * Math.sin(t / 160);
      this._weaponGlow(cx, cy, size * 0.5, this._rgba(c, 0.2 + pulse * 0.2));
      this._starShape(0, 0, 6 * u, 2.6 * u, c);
    } else if (key === "angel_wings") {
      ctx.fillStyle = "#f3f6ff";
      ctx.beginPath(); ctx.ellipse(-2 * u, 0, 5 * u, 3 * u, 0.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(2 * u, 0, 5 * u, 3 * u, -0.5, 0, 7); ctx.fill();
    } else if (key === "boat") {
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-6 * u, 0); ctx.lineTo(6 * u, 0); ctx.lineTo(4 * u, 4 * u); ctx.lineTo(-4 * u, 4 * u); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#f3f6ff"; ctx.beginPath(); ctx.moveTo(0, -6 * u); ctx.lineTo(0, 0); ctx.lineTo(4 * u, -1 * u); ctx.closePath(); ctx.fill();
    } else { // potion bottle
      const lit = this._shade(c, 0.35);
      ctx.fillStyle = "#cfd8e6"; ctx.fillRect(-1.6 * u, -6 * u, 3.2 * u, 2 * u); // neck
      ctx.fillStyle = "#7a5a36"; ctx.fillRect(-1.8 * u, -6.8 * u, 3.6 * u, 1.2 * u); // cork
      const g = ctx.createLinearGradient(-4 * u, 0, 4 * u, 0);
      g.addColorStop(0, this._shade(c, -0.25)); g.addColorStop(0.5, c); g.addColorStop(1, lit);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 1 * u, 4.2 * u, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(-1.5 * u, -0.5 * u, 1 * u, 0, 7); ctx.fill();
      if (def.glow) this._weaponGlow(cx, cy + u, size * 0.45, this._rgba(c, 0.25));
    }
    ctx.restore();
  }

  // Food: distinct silhouettes for the common edibles, generic morsel otherwise.
  _foodIcon(cx, cy, size, def, key) {
    const ctx = this.ctx; const u = size / 16; const c = def.color;
    ctx.save(); ctx.translate(cx, cy);
    if (key === "apple" || key === "golden_apple") {
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(-1.6 * u, 0.5 * u, 3.4 * u, 0, 7); ctx.arc(1.6 * u, 0.5 * u, 3.4 * u, 0, 7); ctx.fill();
      ctx.fillStyle = "#6b4a2b"; ctx.fillRect(-0.4 * u, -5 * u, 1 * u, 3 * u); // stem
      ctx.fillStyle = "#4a8b3b"; ctx.beginPath(); ctx.ellipse(2 * u, -3.5 * u, 2 * u, 1 * u, 0.6, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.arc(-2 * u, -1 * u, 1 * u, 0, 7); ctx.fill();
    } else if (key === "bread") {
      ctx.fillStyle = c; ctx.beginPath(); this._rr(-5 * u, -3 * u, 10 * u, 6 * u, 3 * u); ctx.fill();
      ctx.strokeStyle = this._shade(c, -0.3); ctx.lineWidth = 0.7 * u;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 1.8 * u, -2.4 * u); ctx.lineTo(i * 1.8 * u + u, -0.5 * u); ctx.stroke(); }
    } else if (key === "egg") {
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 0, 3.2 * u, 4.2 * u, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.ellipse(-1 * u, -1 * u, 1 * u, 1.5 * u, 0, 0, 7); ctx.fill();
    } else if (key === "raw_fish" || key === "cooked_fish") {
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(-0.5 * u, 0, 4 * u, 2.4 * u, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(3 * u, 0); ctx.lineTo(6 * u, -2.5 * u); ctx.lineTo(6 * u, 2.5 * u); ctx.closePath(); ctx.fill(); // tail
      ctx.fillStyle = "#1a1a1a"; ctx.beginPath(); ctx.arc(-3 * u, -0.5 * u, 0.7 * u, 0, 7); ctx.fill(); // eye
    } else if (key.startsWith("raw_") || key.startsWith("cooked_") || key === "rotten_flesh") {
      // meat cut: rounded steak with a little bone
      ctx.fillStyle = c; ctx.beginPath(); this._rr(-4.5 * u, -3 * u, 8 * u, 6 * u, 2.5 * u); ctx.fill();
      ctx.fillStyle = "#f1ead2"; ctx.beginPath(); ctx.arc(4 * u, -2 * u, 1.4 * u, 0, 7); ctx.arc(4 * u, 2 * u, 1.4 * u, 0, 7); ctx.fill();
      ctx.fillStyle = "#f1ead2"; ctx.fillRect(2.5 * u, -2 * u, 2 * u, 4 * u);
    } else {
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, 3.5 * u, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // Fishing rod: a slim pole with line and a tiny hook.
  _rodIcon(cx, cy, size) {
    const ctx = this.ctx; const u = size / 16;
    ctx.save(); ctx.translate(cx, cy);
    ctx.strokeStyle = "#9a6b3c"; ctx.lineWidth = 1.6 * u; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-5 * u, 6 * u); ctx.lineTo(5 * u, -6 * u); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 0.5 * u;
    ctx.beginPath(); ctx.moveTo(5 * u, -6 * u); ctx.lineTo(5 * u, 2 * u); ctx.stroke(); // line
    ctx.strokeStyle = "#cdd6e4"; ctx.lineWidth = 0.8 * u;
    ctx.beginPath(); ctx.arc(4.4 * u, 2.5 * u, 1 * u, 0, Math.PI * 1.5); ctx.stroke(); // hook
    ctx.restore();
  }

  // Placeable block: a little cube with a top face, special-cased for fixtures.
  _blockIcon(x, y, size, def, key) {
    const ctx = this.ctx;
    const m = size * 0.22, w = size - 2 * m, bx = x + m, by = y + m;
    if (key === "torch") {
      ctx.fillStyle = "#6b4a2b"; ctx.fillRect(x + size / 2 - 1, y + size * 0.4, 2, size * 0.45);
      const fl = 0.5 + 0.5 * Math.sin(performance.now() / 110);
      this._weaponGlow(x + size / 2, y + size * 0.36, size * 0.4, `rgba(255,170,60,${0.3 + fl * 0.3})`);
      ctx.fillStyle = "#ffd24d"; ctx.beginPath(); ctx.ellipse(x + size / 2, y + size * 0.36, 2.5, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff3b0"; ctx.beginPath(); ctx.ellipse(x + size / 2, y + size * 0.38, 1.2, 2, 0, 0, 7); ctx.fill();
      return;
    }
    const c = def.color, lit = this._shade(c, 0.3), dark = this._shade(c, -0.28);
    ctx.fillStyle = c; ctx.fillRect(bx, by, w, w);
    ctx.fillStyle = lit; ctx.fillRect(bx, by, w, w * 0.28);                 // top face
    ctx.fillStyle = dark; ctx.fillRect(bx, by + w * 0.72, w, w * 0.28);     // bottom shade
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, w - 1);
    // a hint of fixture detailing
    if (key === "furnace") { ctx.fillStyle = "#1c1410"; ctx.fillRect(bx + w * 0.28, by + w * 0.45, w * 0.44, w * 0.4); ctx.fillStyle = "#ff7a2a"; ctx.fillRect(bx + w * 0.34, by + w * 0.55, w * 0.32, w * 0.22); }
    else if (key === "workbench") { ctx.fillStyle = dark; ctx.fillRect(bx, by + w * 0.3, w, 1.5); ctx.fillRect(bx + w * 0.2, by + w * 0.3, 1.5, w * 0.7); ctx.fillRect(bx + w * 0.7, by + w * 0.3, 1.5, w * 0.7); }
    else if (key === "tnt") { ctx.fillStyle = "#f1ead2"; ctx.fillRect(bx, by + w * 0.38, w, w * 0.24); ctx.fillStyle = "#1c1410"; ctx.font = `bold ${Math.floor(w * 0.2)}px monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("TNT", bx + w / 2, by + w * 0.5); }
    else if (key === "glowstone" || key === "lantern") { this._weaponGlow(x + size / 2, y + size / 2, size * 0.4, this._rgba(c, 0.3)); ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(bx + w * 0.3, by + w * 0.3, w * 0.4, w * 0.4); }
    else if (key === "ladder") { ctx.strokeStyle = dark; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(bx + w * 0.25, by); ctx.lineTo(bx + w * 0.25, by + w); ctx.moveTo(bx + w * 0.75, by); ctx.lineTo(bx + w * 0.75, by + w); for (let r = 0.25; r < 1; r += 0.25) { ctx.moveTo(bx + w * 0.25, by + w * r); ctx.lineTo(bx + w * 0.75, by + w * r); } ctx.stroke(); }
  }

  // Background wall: a darker, recessed tile with a grid.
  _wallIcon(x, y, size, def) {
    const ctx = this.ctx;
    const m = size * 0.2, w = size - 2 * m, bx = x + m, by = y + m;
    ctx.fillStyle = def.color || "#333"; ctx.fillRect(bx, by, w, w);
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by + w / 2); ctx.lineTo(bx + w, by + w / 2);
    ctx.moveTo(bx + w / 2, by); ctx.lineTo(bx + w / 2, by + w);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, w - 1);
  }

  // Materials: ingots, gems, ore nuggets, bones, gel, feathers, ammo, etc.
  _materialIcon(cx, cy, size, def, key) {
    const ctx = this.ctx; const u = size / 16; const c = def.color;
    const lit = this._shade(c, 0.4), dark = this._shade(c, -0.3);
    ctx.save(); ctx.translate(cx, cy);
    if (key.endsWith("_ingot")) {                       // stacked bar
      ctx.fillStyle = c; this._rr(-5 * u, -1 * u, 10 * u, 3.5 * u, 1 * u); ctx.fill();
      ctx.fillStyle = lit; this._rr(-3.5 * u, -4 * u, 7 * u, 3 * u, 1 * u); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(-3 * u, -3.5 * u, 5 * u, 0.8 * u);
    } else if (key === "diamond") {                     // faceted gem
      this._gemShape(0, 0, 5 * u, c);
    } else if (key === "coal" || key.endsWith("_ore")) { // rough nugget
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, 0, 4.5 * u, 0, 7); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(-1 * u, -1 * u, 1.6 * u, 0, 7); ctx.arc(1.5 * u, 0.5 * u, 1.3 * u, 0, 7); ctx.arc(0, 2 * u, 1 * u, 0, 7); ctx.fill();
    } else if (key === "bone") {
      ctx.strokeStyle = c; ctx.lineWidth = 2.2 * u; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-4 * u, -4 * u); ctx.lineTo(4 * u, 4 * u); ctx.stroke();
      ctx.fillStyle = c;
      for (const [sx, sy] of [[-4, -4], [4, 4]]) { ctx.beginPath(); ctx.arc(sx * u - u, sy * u, 1.4 * u, 0, 7); ctx.arc(sx * u + u, sy * u, 1.4 * u, 0, 7); ctx.fill(); }
    } else if (key === "arrow") {
      ctx.strokeStyle = "#9a6b3c"; ctx.lineWidth = 1.4 * u;
      ctx.beginPath(); ctx.moveTo(-5 * u, 5 * u); ctx.lineTo(4 * u, -4 * u); ctx.stroke();
      ctx.fillStyle = "#cdd6e4"; ctx.beginPath(); ctx.moveTo(5 * u, -5 * u); ctx.lineTo(2 * u, -4 * u); ctx.lineTo(4 * u, -2 * u); ctx.closePath(); ctx.fill(); // head
      ctx.strokeStyle = "#e8e3cf"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-5 * u, 5 * u); ctx.lineTo(-3 * u, 5 * u); ctx.moveTo(-5 * u, 5 * u); ctx.lineTo(-5 * u, 3 * u); ctx.stroke(); // fletch
    } else if (key === "gel") {
      ctx.fillStyle = this._rgba(c, 0.85); ctx.beginPath(); this._rr(-4 * u, -3 * u, 8 * u, 6 * u, 3 * u); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.beginPath(); ctx.arc(-1.5 * u, -1 * u, 1.2 * u, 0, 7); ctx.fill();
    } else if (key === "feather") {
      ctx.strokeStyle = "#cdd6e4"; ctx.lineWidth = 1 * u;
      ctx.beginPath(); ctx.moveTo(-4 * u, 5 * u); ctx.quadraticCurveTo(3 * u, -2 * u, 4 * u, -5 * u); ctx.stroke();
      ctx.fillStyle = "rgba(240,245,255,0.85)"; ctx.beginPath(); ctx.ellipse(1 * u, -1 * u, 3 * u, 1.5 * u, -0.7, 0, 7); ctx.fill();
    } else if (key === "bullet" || key === "cell" || key === "rocket") {
      ctx.fillStyle = c; this._rr(-2 * u, -5 * u, 4 * u, 8 * u, 1.5 * u); ctx.fill();
      ctx.fillStyle = lit; ctx.beginPath(); ctx.moveTo(-2 * u, -3 * u); ctx.lineTo(0, -6 * u); ctx.lineTo(2 * u, -3 * u); ctx.closePath(); ctx.fill();
      if (def.glow) this._weaponGlow(cx, cy, size * 0.4, this._rgba(c, 0.3));
    } else {                                            // generic shard
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, -5 * u); ctx.lineTo(4 * u, 0); ctx.lineTo(0, 5 * u); ctx.lineTo(-4 * u, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(-1 * u, -3 * u, 1.5 * u, 6 * u);
      if (def.glow) this._weaponGlow(cx, cy, size * 0.4, this._rgba(c, 0.25));
    }
    ctx.restore();
  }

  // --- small shape helpers ---
  _rr(x, y, w, h, r) { const ctx = this.ctx; r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  _heartShape(cx, cy, s, color) { const ctx = this.ctx; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.6); ctx.bezierCurveTo(cx - s, cy - s * 0.3, cx - s * 0.5, cy - s, cx, cy - s * 0.3); ctx.bezierCurveTo(cx + s * 0.5, cy - s, cx + s, cy - s * 0.3, cx, cy + s * 0.6); ctx.fill(); ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.beginPath(); ctx.arc(cx - s * 0.35, cy - s * 0.35, s * 0.22, 0, 7); ctx.fill(); }
  _starShape(cx, cy, ro, ri, color) { const ctx = this.ctx; ctx.fillStyle = color; ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const r = i % 2 ? ri : ro; ctx[i ? "lineTo" : "moveTo"](cx + Math.cos(a) * r, cy + Math.sin(a) * r); } ctx.closePath(); ctx.fill(); }
  _gemShape(cx, cy, s, color) { const ctx = this.ctx; const lit = this._shade(color, 0.4), dark = this._shade(color, -0.25); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy - s * 0.2); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy - s * 0.2); ctx.closePath(); ctx.fill(); ctx.fillStyle = lit; ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy - s * 0.2); ctx.lineTo(cx, cy - s * 0.2); ctx.closePath(); ctx.fill(); ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(cx - s, cy - s * 0.2); ctx.lineTo(cx, cy + s); ctx.lineTo(cx, cy - s * 0.2); ctx.closePath(); ctx.fill(); }

  // A little diagonal sword: steel blade, gold crossguard, brown grip.
  _swordIcon(cx, cy, size, bladeColor, glow) {
    const ctx = this.ctx;
    const u = size / 16; // unit scaled to the slot
    if (glow) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
      this._weaponGlow(cx, cy, size * 0.5, this._rgba(bladeColor, 0.2 + pulse * 0.2));
    }
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

  // Mjölnir: a stout runed war-hammer with a glowing rune.
  _hammerIcon(cx, cy, size, def) {
    const ctx = this.ctx;
    const u = size / 16;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 130);
    this._weaponGlow(cx, cy - 2 * u, size * 0.5, `rgba(150,210,255,${0.18 + pulse * 0.18})`);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 8);
    ctx.fillStyle = "#5a3b22"; ctx.fillRect(-1.2 * u, -2 * u, 2.4 * u, 9 * u);  // handle
    ctx.fillStyle = "#caa15a"; ctx.fillRect(-1.6 * u, 6 * u, 3.2 * u, 1.6 * u); // pommel band
    const c = def.color, lit = this._shade(c, 0.4), dark = this._shade(c, -0.35);
    const g = ctx.createLinearGradient(-6 * u, 0, 6 * u, 0);
    g.addColorStop(0, dark); g.addColorStop(0.5, lit); g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.fillRect(-6 * u, -6 * u, 12 * u, 5 * u);             // head
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(-6 * u, -6 * u, 12 * u, 1 * u);
    ctx.fillStyle = `rgba(150,210,255,${0.5 + pulse * 0.5})`;                   // rune
    ctx.fillRect(-0.8 * u, -5 * u, 1.6 * u, 3 * u); ctx.fillRect(-2 * u, -3.8 * u, 4 * u, 1 * u);
    ctx.restore();
  }

  // A compact side-profile firearm/wand icon matching the in-hand silhouette.
  _gunIcon(cx, cy, size, def, key) {
    const ctx = this.ctx;
    const u = size / 16;
    ctx.save();
    ctx.translate(cx - size * 0.28, cy);
    ctx.scale(u, u);
    this._gunInHand(def, key); // reuse the in-hand art, scaled to the slot
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
  // Crafting panel header: a search box then a 2-row strip of category tabs.
  // Recipe rows begin below that header.
  searchRect(L) { return { x: L.craftX, y: L.y0 + 16, w: L.craftW, h: 22 }; }
  tabRect(L, i) {
    const cols = 4, gap = 4, tw = (L.craftW - (cols - 1) * gap) / cols, th = 18;
    const c = i % cols, r = (i / cols) | 0;
    return { x: L.craftX + c * (tw + gap), y: L.y0 + 44 + r * (th + 4), w: tw, h: th };
  }
  recipeRect(L, i, scroll = 0) { const rowH = 32; return { x: L.craftX, y: L.y0 + 90 + (i - scroll) * rowH, w: L.craftW, h: rowH - 4 }; }

  static CRAFT_ROWS = 7; // visible crafting rows before scrolling
  static CRAFT_TABS = [
    { key: "all",      label: "All" },
    { key: "tools",    label: "Tools" },
    { key: "weapons",  label: "Weapons" },
    { key: "armor",    label: "Armor" },
    { key: "blocks",   label: "Blocks" },
    { key: "food",     label: "Food" },
    { key: "magic",    label: "Magic" },
    { key: "material", label: "Mats" },
  ];

  // Options bag keeps the long parameter list readable from game.js.
  drawInventory(inv, opts = {}) {
    const {
      recipes = [], creativeItems = null, stationAvailable,
      mouse, scroll = 0, tab = "all", search = "", searchFocused = false,
    } = opts;
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

    this._drawCraftHeader(L, !!creativeItems, tab, search, searchFocused, mouse);
    if (creativeItems) this._drawCreativePalette(L, inv, creativeItems, mouse, scroll);
    else this._drawCraftingList(L, inv, recipes, stationAvailable, mouse, scroll);

    // held stack follows the cursor; otherwise show a tooltip for the hovered item
    if (inv.held && mouse) {
      this.drawItemIcon(inv.held, mouse.x - 18, mouse.y - 18, 36);
    } else if (mouse) {
      const hit = this.invHitTest(inv, mouse.x, mouse.y);
      let key = null;
      if (hit && hit.type === "slot" && inv.slots[hit.index]) key = inv.slots[hit.index].item;
      else if (hit && hit.type === "armor" && inv.armor[hit.slot]) key = inv.armor[hit.slot].item;
      else if (creativeItems) { const ci = this.recipeHitTest(creativeItems, mouse.x, mouse.y, scroll); if (ci >= 0) key = creativeItems[ci]; }
      else { const ri = this.recipeHitTest(recipes, mouse.x, mouse.y, scroll); if (ri >= 0) key = recipes[ri].out.item; }
      if (key) this._tooltip(key, mouse.x, mouse.y);
    }
  }

  // Search box + category tab strip drawn above the recipe/creative list.
  _drawCraftHeader(L, creative, tab, search, focused, mouse) {
    const ctx = this.ctx;
    ctx.fillStyle = "#f9e2af"; ctx.font = "12px monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    ctx.fillText(creative ? "CREATIVE  (click to add)" : "CRAFTING  (click to make)", L.craftX, L.y0 + 12);

    const s = this.searchRect(L);
    ctx.fillStyle = "rgba(12,14,28,0.95)"; ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.strokeStyle = focused ? "#f9e2af" : "rgba(255,255,255,0.25)"; ctx.lineWidth = focused ? 2 : 1;
    ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = "12px monospace";
    if (search) { ctx.fillStyle = "#cdd6f4"; ctx.fillText(search + (focused ? "_" : ""), s.x + 8, s.y + s.h / 2 + 1); }
    else { ctx.fillStyle = "#6b7089"; ctx.fillText(focused ? "type to search…_" : "search…  (click)", s.x + 8, s.y + s.h / 2 + 1); }

    const tabs = Renderer.CRAFT_TABS;
    for (let i = 0; i < tabs.length; i++) {
      const r = this.tabRect(L, i);
      const active = tabs[i].key === tab;
      const hover = mouse && mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h;
      ctx.fillStyle = active ? "rgba(249,226,175,0.9)" : hover ? "rgba(249,226,175,0.2)" : "rgba(20,22,40,0.85)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = active ? "#1a1c2e" : "#cdd6f4";
      ctx.font = "10px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(tabs[i].label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    }
  }

  // Pill shown just above the hotbar naming the item the player just switched to.
  drawItemSwitch(text, alpha) {
    const ctx = this.ctx;
    const slot = 44;
    const cy = this.vh - slot - 12 - 24; // sit just above the hotbar
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = "14px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 24;
    const x = (this.vw - w) / 2;
    ctx.fillStyle = "rgba(20,22,40,0.92)"; ctx.fillRect(x, cy - 13, w, 26);
    ctx.strokeStyle = "rgba(249,226,175,0.7)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, cy - 13 + 0.5, w - 1, 25);
    ctx.fillStyle = "#f9e2af"; ctx.fillText(text, this.vw / 2, cy + 1);
    ctx.restore();
  }

  // Right-hand column: the survival crafting recipe list.
  _drawCraftingList(L, inv, recipes, stationAvailable, mouse, scroll) {
    const ctx = this.ctx;
    if (recipes.length === 0) { this._drawEmptyList(L); return; }
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
    this._drawScrollHint(L, recipes.length, scroll);
  }

  // "No matches" placeholder when a search/tab filters everything out.
  _drawEmptyList(L) {
    const ctx = this.ctx;
    ctx.fillStyle = "#6b7089"; ctx.font = "12px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("no matches", L.craftX + L.craftW / 2, this.recipeRect(L, 1, 0).y);
  }

  // Tiny ▲▼ affordance bottom-right of the list when it scrolls.
  _drawScrollHint(L, total, scroll) {
    if (total <= Renderer.CRAFT_ROWS) return;
    const ctx = this.ctx;
    const up = scroll > 0, down = scroll + Renderer.CRAFT_ROWS < total;
    ctx.font = "11px monospace"; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.fillStyle = "#8d92a8";
    ctx.fillText(`${up ? "▲" : "△"}${down ? "▼" : "▽"} scroll`, L.craftX + L.craftW, this.recipeRect(L, Renderer.CRAFT_ROWS, 0).y - 4);
  }

  // Right-hand column: the Creative "click any item to add it" palette.
  _drawCreativePalette(L, inv, items, mouse, scroll) {
    const ctx = this.ctx;
    if (items.length === 0) { this._drawEmptyList(L); return; }
    const end = Math.min(items.length, scroll + Renderer.CRAFT_ROWS);
    for (let i = scroll; i < end; i++) {
      const key = items[i];
      const def = ITEMS[key];
      const rr = this.recipeRect(L, i, scroll);
      const hover = mouse && mouse.x >= rr.x && mouse.x <= rr.x + rr.w && mouse.y >= rr.y && mouse.y <= rr.y + rr.h;
      ctx.fillStyle = hover ? "rgba(249,226,175,0.16)" : "rgba(20,22,40,0.7)";
      ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
      this.drawItemIcon({ item: key, count: maxStack(key) }, rr.x + 2, rr.y + 1, rr.h - 2);
      ctx.fillStyle = "#cdd6f4";
      ctx.font = "11px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(def.name, rr.x + rr.h + 2, rr.y + 2);
      ctx.fillStyle = "#8d92a8";
      ctx.font = "9px monospace";
      ctx.fillText(def.kind, rr.x + rr.h + 2, rr.y + 15);
    }
    this._drawScrollHint(L, items.length, scroll);
  }

  _tooltip(key, mx, my) {
    const ctx = this.ctx;
    const def = ITEMS[key]; if (!def) return;
    let stat = "Material";
    if (def.kind === "tool") stat = `Pickaxe · power ${def.power}`;
    else if (def.kind === "weapon") stat = `Weapon · ${def.damage} dmg`;
    else if (def.kind === "armor") stat = `Armor · +${def.defense} def (${def.slot})`;
    else if (def.kind === "food") stat = `Food · heals ${def.heal}`;
    else if (def.kind === "gun") stat = `Gun · ${def.damage} dmg${def.ammo ? " · " + ITEMS[def.ammo].name : " · no ammo"}`;
    else if (def.kind === "power") stat = def.special === "maxhp" ? `Power · +${def.amount} max HP` : `Power · ${def.dur}s buff`;
    else if (def.kind === "block") stat = "Placeable block";
    // Optional extra line: durability + rarity for gear.
    const RARITY = { common: "#cdd6f4", uncommon: "#7bd86f", rare: "#6aa8ff", epic: "#c08cff", legendary: "#f7b955" };
    let line2 = "";
    if (def.dur) line2 = `Durability ${def.dur}`;
    else if (def.rarity === "legendary") line2 = "Unbreakable";
    if (def.rarity) line2 += `${line2 ? "  ·  " : ""}${def.rarity[0].toUpperCase()}${def.rarity.slice(1)}`;
    const rows = line2 ? 3 : 2;
    const boxH = 18 + rows * 13;
    ctx.font = "12px monospace";
    const w = Math.max(ctx.measureText(def.name).width, ctx.measureText(line2).width, 120) + 22;
    const x = Math.min(mx + 14, this.vw - w - 6), y = my + 14;
    ctx.fillStyle = "rgba(10,12,24,0.96)";
    ctx.fillRect(x, y, w, boxH);
    ctx.strokeStyle = "#45475a"; ctx.strokeRect(x + 0.5, y + 0.5, w, boxH);
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillStyle = (def.rarity && RARITY[def.rarity]) || "#f9e2af"; ctx.font = "12px monospace";
    ctx.fillText(def.name, x + 8, y + 5);
    ctx.fillStyle = "#9aa0b5"; ctx.font = "10px monospace";
    ctx.fillText(stat, x + 8, y + 20);
    if (line2) { ctx.fillStyle = "#7d8294"; ctx.fillText(line2, x + 8, y + 33); }
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
  // Returns the tab key under the cursor, or null.
  tabHitTest(mx, my) {
    const L = this.invLayout();
    const tabs = Renderer.CRAFT_TABS;
    for (let i = 0; i < tabs.length; i++) {
      const r = this.tabRect(L, i);
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return tabs[i].key;
    }
    return null;
  }
  searchHitTest(mx, my) {
    const L = this.invLayout();
    const s = this.searchRect(L);
    return mx >= s.x && mx <= s.x + s.w && my >= s.y && my <= s.y + s.h;
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
    const isize = 14;
    for (const d of drops) {
      const def = ITEMS[d.item];
      if (!def) continue;
      const sx = Math.round(d.x - this.camX + d.w / 2 - isize / 2);
      const sy = Math.round(d.y - this.camY + d.h / 2 - isize / 2 + Math.sin(d.bob) * 2);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
      this.drawItemIcon({ item: d.item, count: 1 }, sx, sy, isize); // shared art = consistent look
      ctx.restore();
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

  // --- Pause button + pause menu ---
  _rr(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  pauseBtnRect() { const s = document.body.classList.contains("touch") ? 44 : 30; return { x: this.vw - s - 12, y: 12, w: s, h: s }; }
  pauseBtnHit(mx, my) { const r = this.pauseBtnRect(); return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h; }

  drawPauseButton(mouse) {
    const ctx = this.ctx; const r = this.pauseBtnRect();
    const hover = mouse && this.pauseBtnHit(mouse.x, mouse.y);
    ctx.save();
    this._rr(r.x, r.y, r.w, r.h, 7);
    ctx.fillStyle = hover ? "rgba(40,46,70,0.92)" : "rgba(20,22,40,0.7)"; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.stroke();
    ctx.fillStyle = "#e8ecf8";
    const bw = 4, bh = 14, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    ctx.fillRect(cx - 6, cy - bh / 2, bw, bh);
    ctx.fillRect(cx + 2, cy - bh / 2, bw, bh);
    ctx.restore();
  }

  pauseLayout() {
    const w = 320, bh = 46, gap = 12, n = 3;
    const ph = 70 + n * (bh + gap) - gap + 14;
    return { x: (this.vw - w) / 2, y: (this.vh - ph) / 2, w, ph, bh, gap };
  }
  pauseBtnRects(L) {
    const items = [
      { key: "resume", label: "Resume",               color: "#5469c4" },
      { key: "save",   label: "Save & Exit to Menu",   color: "#3a7d4a" },
      { key: "exit",   label: "Exit without Saving",   color: "#7d3a3a" },
    ];
    return items.map((it, i) => ({ ...it, x: L.x + 24, y: L.y + 64 + i * (L.bh + L.gap), w: L.w - 48, h: L.bh }));
  }
  pauseHitTest(mx, my) {
    for (const b of this.pauseBtnRects(this.pauseLayout()))
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return b.key;
    return null;
  }
  drawPause(mouse) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(6,8,18,0.8)"; ctx.fillRect(0, 0, this.vw, this.vh);
    const L = this.pauseLayout();
    ctx.save();
    this._rr(L.x, L.y, L.w, L.ph, 16);
    ctx.fillStyle = "rgba(17,20,31,0.97)"; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#f7d35e"; ctx.font = "bold 26px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("PAUSED", L.x + L.w / 2, L.y + 22);
    for (const b of this.pauseBtnRects(L)) {
      const hover = mouse && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
      this._rr(b.x, b.y, b.w, b.h, 9);
      ctx.fillStyle = hover ? this._shade(b.color, 0.2) : "rgba(27,32,48,0.95)"; ctx.fill();
      this._rr(b.x, b.y, b.w, b.h, 9);
      ctx.lineWidth = 1.5; ctx.strokeStyle = b.color; ctx.stroke();
      ctx.fillStyle = "#e8ecf8"; ctx.font = "14px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
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

// Small seeded PRNG (mulberry32) for deterministic procedural backgrounds.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Day-night sky keyframes (top/mid/bottom gradient bands), keyed by cycle phase
// dayT (0 = midnight, 0.5 = noon). Interpolated with wraparound for a smooth,
// continuously shifting sky through dawn, morning, noon, sunset, dusk, night.
const SKY_KEYS = [
  { t: 0.00, top: [10, 20, 50],   mid: [20, 40, 90],    bot: [40, 70, 120] },   // night
  { t: 0.18, top: [40, 30, 90],   mid: [120, 75, 120],  bot: [205, 130, 110] }, // pre-dawn
  { t: 0.23, top: [70, 50, 120],  mid: [220, 120, 100], bot: [255, 180, 120] }, // dawn
  { t: 0.31, top: [55, 110, 190], mid: [140, 180, 235], bot: [220, 235, 250] }, // morning
  { t: 0.50, top: [30, 90, 180],  mid: [90, 160, 240],  bot: [190, 230, 255] }, // noon
  { t: 0.68, top: [38, 95, 175],  mid: [135, 165, 220], bot: [240, 220, 205] }, // afternoon
  { t: 0.75, top: [40, 30, 90],   mid: [255, 100, 70],  bot: [255, 180, 120] }, // sunset
  { t: 0.81, top: [30, 25, 72],   mid: [110, 55, 95],   bot: [190, 105, 95] },  // dusk
  { t: 0.88, top: [10, 20, 50],   mid: [20, 40, 90],    bot: [40, 70, 120] },   // night
];

function skyPalette(dayT) {
  const tt = ((dayT % 1) + 1) % 1;
  let a = SKY_KEYS[SKY_KEYS.length - 1], b = SKY_KEYS[0], span = 1;
  for (let i = 0; i < SKY_KEYS.length; i++) {
    const cur = SKY_KEYS[i], nxt = SKY_KEYS[(i + 1) % SKY_KEYS.length];
    const lo = cur.t, hi = nxt.t > cur.t ? nxt.t : nxt.t + 1;
    const tw = tt < cur.t ? tt + 1 : tt;
    if (tw >= lo && tw <= hi) { a = cur; b = nxt; span = (tw - lo) / (hi - lo); break; }
  }
  const k = span * span * (3 - 2 * span); // smoothstep between keyframes
  return { top: mix(a.top, b.top, k), mid: mix(a.mid, b.mid, k), bot: mix(a.bot, b.bot, k) };
}
