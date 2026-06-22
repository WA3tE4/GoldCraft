// A simple, self-driving weather system layered over the day/night clock.
// It drifts between clear skies and three moods — rain, thunderstorm, and fog —
// always fading through a clear gap in between so transitions stay smooth.
//
// The Game reads `kind`, `intensity` (0..1, eased), `flash` (lightning), and the
// one-frame `struck` event; the Renderer turns those into screen effects.
export class Weather {
  constructor() {
    this.kind = "clear";     // "clear" | "rain" | "storm" | "fog"
    this.intensity = 0;      // eased 0..1 strength of the current weather
    this._target = 0;        // intensity we're easing toward
    this._timer = 25 + Math.random() * 45; // seconds until the next change
    this.flash = 0;          // current lightning-flash brightness (0..1)
    this._strikeCd = 4 + Math.random() * 6;
    this.struck = false;     // true the single frame a storm bolt fires
  }

  // True while precipitation is actually falling (drives rain fx + gameplay).
  get raining() { return (this.kind === "rain" || this.kind === "storm") && this.intensity > 0.2; }

  update(dt) {
    this.struck = false;
    this._timer -= dt;
    if (this._timer <= 0) this._pick();

    // Ease toward the target; weather rolls in a touch faster than it clears.
    const rate = (this._target > this.intensity ? 0.22 : 0.13) * dt;
    const d = this._target - this.intensity;
    this.intensity += Math.sign(d) * Math.min(Math.abs(d), rate);
    if (this.intensity <= 0.01 && this._target === 0) { this.intensity = 0; this.kind = "clear"; }

    // Lightning: bright flashes fade quickly; storms strike on a random cadence.
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (this.kind === "storm" && this.intensity > 0.4) {
      this._strikeCd -= dt;
      if (this._strikeCd <= 0) {
        this._strikeCd = 3 + Math.random() * 7;
        this.flash = 0.6 + Math.random() * 0.4;
        this.struck = true;
      }
    }
  }

  _pick() {
    // If something's currently going, fade it back to clear first (a calm gap).
    if (this.intensity > 0.05 && this._target > 0) {
      this._target = 0;
      this._timer = 30 + Math.random() * 60;
      return;
    }
    // Skies are clear: roll for the next spell (clear stays most common).
    const roll = Math.random();
    if (roll < 0.5) { this._timer = 40 + Math.random() * 80; return; } // stay clear
    if (roll < 0.75) { this.kind = "rain"; this._target = 0.55 + Math.random() * 0.3; }
    else if (roll < 0.9) { this.kind = "fog"; this._target = 0.45 + Math.random() * 0.3; }
    else { this.kind = "storm"; this._target = 0.8 + Math.random() * 0.2; }
    this._timer = 22 + Math.random() * 40;
  }
}
