import { Sound } from "./sound.js";

// Tracks raw keyboard + mouse state. Edge events (just-pressed) are exposed via
// consume* helpers so the game loop can react once per press.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this._justPressed = new Set();

    this.mouse = { x: 0, y: 0, left: false, right: false };

    window.addEventListener("keydown", (e) => {
      Sound.unlock(); // first gesture unlocks the audio context
      if (!this.keys.has(e.code)) this._justPressed.add(e.code);
      this.keys.add(e.code);
      // Stop space/arrows from scrolling the page.
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code))
        e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
      this.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
    });
    this._mouseJust = { left: false, right: false };
    canvas.addEventListener("mousedown", (e) => {
      Sound.unlock();
      if (e.button === 0) { this.mouse.left = true; this._mouseJust.left = true; }
      if (e.button === 2) { this.mouse.right = true; this._mouseJust.right = true; }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => {
      this.wheelDelta += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    this.wheelDelta = 0;
  }

  down(code) { return this.keys.has(code); }

  // True only on the frame the key went down; clears on read.
  pressed(code) {
    if (this._justPressed.has(code)) { this._justPressed.delete(code); return true; }
    return false;
  }

  consumeWheel() {
    const d = this.wheelDelta;
    this.wheelDelta = 0;
    return d;
  }

  // True only on the frame the mouse button went down; clears on read.
  leftClicked() { if (this._mouseJust.left) { this._mouseJust.left = false; return true; } return false; }
  rightClicked() { if (this._mouseJust.right) { this._mouseJust.right = false; return true; } return false; }

  // Call at end of frame to clear per-frame edge state we didn't consume.
  endFrame() {
    this._justPressed.clear();
    this._mouseJust.left = false;
    this._mouseJust.right = false;
  }
}
