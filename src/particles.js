// Lightweight particle + floating-text system. No collision (particles are short
// lived); cheap to spawn in bulk for juice: mining debris, dust, sparks, embers.
export class Particles {
  constructor(max = 700) {
    this.list = [];
    this.floats = [];
    this.max = max;
  }

  spawn(p) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0,
      life: p.life, maxLife: p.life,
      size: p.size || 2, color: p.color || "#fff",
      gravity: p.gravity == null ? 600 : p.gravity,
      drag: p.drag == null ? 0.98 : p.drag,
      glow: !!p.glow,
    });
  }

  // A burst of `n` particles flung outward from (x,y).
  burst(x, y, color, n, opts = {}) {
    const spd = opts.speed || 90;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spd * (0.3 + Math.random() * 0.7);
      this.spawn({
        x, y,
        vx: Math.cos(a) * s + (opts.vx || 0),
        vy: Math.sin(a) * s - (opts.up || 0),
        life: (opts.life || 0.5) * (0.6 + Math.random() * 0.6),
        size: opts.size || (2 + (Math.random() * 2 | 0)),
        color, gravity: opts.gravity, drag: opts.drag, glow: opts.glow,
      });
    }
  }

  float(x, y, text, color = "#fff") {
    this.floats.push({ x, y, vy: -34, life: 0.9, maxLife: 0.9, text, color });
  }

  update(dt) {
    for (const p of this.list) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.vx *= p.drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (this.list.length) this.list = this.list.filter((p) => p.life > 0);

    for (const f of this.floats) { f.life -= dt; f.y += f.vy * dt; f.vy *= 0.92; }
    if (this.floats.length) this.floats = this.floats.filter((f) => f.life > 0);
  }

  draw(ctx, camX, camY) {
    for (const p of this.list) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.globalAlpha = a;
      if (p.glow) ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - camX), Math.round(p.y - camY), p.size, p.size);
      if (p.glow) ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
  }

  drawFloats(ctx, camX, camY) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of this.floats) {
      const a = Math.max(0, Math.min(1, f.life / f.maxLife));
      ctx.globalAlpha = a;
      ctx.font = "bold 13px monospace";
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillText(f.text, Math.round(f.x - camX) + 1, Math.round(f.y - camY) + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, Math.round(f.x - camX), Math.round(f.y - camY));
    }
    ctx.globalAlpha = 1;
  }
}
