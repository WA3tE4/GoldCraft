// Procedural sound via the Web Audio API — no asset files, no dependencies.
// Short synthesized blips/noise bursts. Browsers require a user gesture before
// audio can start, so call Sound.unlock() from the first input event.
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
  }

  unlock() {
    this._ensure();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  // A short oscillator blip with an exponential decay (optionally pitch-sliding).
  tone(freq, dur, type = "square", vol = 0.5, slideTo = null, delay = 0) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // A filtered noise burst (impacts, digging, footsteps).
  noise(dur, vol = 0.5, filterFreq = 1200) {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  }

  play(name) {
    switch (name) {
      case "mine":   this.noise(0.045, 0.25, 1500); break;
      case "break":  this.noise(0.13, 0.5, 1100); this.tone(170, 0.1, "square", 0.18, 90); break;
      case "place":  this.tone(300, 0.06, "square", 0.22, 440); break;
      case "jump":   this.tone(320, 0.12, "square", 0.2, 640); break;
      case "land":   this.noise(0.06, 0.22, 450); break;
      case "hit":    this.tone(150, 0.08, "square", 0.28, 80); this.noise(0.05, 0.18, 2200); break;
      case "slay":   this.noise(0.18, 0.4, 900); this.tone(120, 0.18, "sawtooth", 0.2, 60); break;
      case "hurt":   this.tone(210, 0.18, "sawtooth", 0.28, 80); break;
      case "pickup": this.tone(680, 0.05, "square", 0.18, 990); break;
      case "craft":  this.tone(523, 0.08, "square", 0.2); this.tone(784, 0.1, "square", 0.16, null, 0.06); break;
      case "trade":  this.tone(660, 0.07, "sine", 0.22, 990); this.tone(880, 0.08, "sine", 0.18, null, 0.07); break;
      case "eat":    this.noise(0.09, 0.18, 700); break;
      case "death":  this.tone(300, 0.5, "sawtooth", 0.32, 55); break;
      case "open":   this.tone(520, 0.05, "sine", 0.18, 720); break;
    }
  }
}

export const Sound = new SoundEngine();
