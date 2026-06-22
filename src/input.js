import { Sound } from "./sound.js";

// Tracks raw keyboard + mouse state. Edge events (just-pressed) are exposed via
// consume* helpers so the game loop can react once per press.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this._justPressed = new Set();

    this.mouse = { x: 0, y: 0, left: false, right: false };

    this.typed = ""; // buffer of printable chars + "\b" for the inventory search box
    window.addEventListener("keydown", (e) => {
      Sound.unlock(); // first gesture unlocks the audio context
      if (!this.keys.has(e.code)) this._justPressed.add(e.code);
      this.keys.add(e.code);
      if (e.key && e.key.length === 1) this.typed += e.key;
      else if (e.key === "Backspace") this.typed += "\b";
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

    // ----- touch / mobile -----
    this.uiMode = "play";      // current game UI, set each frame by the game
    this.buildMode = false;    // on a touch device, world taps place instead of mine
    this.uiZones = [];         // canvas rects (hotbar, pause) where a tap is UI-only
    this.scrollZone = null;    // canvas rect where a vertical drag scrolls a list
    this._touchId = null;      // id of the finger currently driving the world cursor
    this._touchUi = false;     // that finger landed on a UI zone — don't dig the world
    this._initTouch();
  }

  // First touch anywhere reveals the on-screen controls; the canvas itself
  // becomes a virtual mouse (position + held button), and the overlay buttons
  // act as virtual keys.
  _initTouch() {
    const reveal = () => document.body.classList.add("touch");

    const setFromTouch = (t) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = (t.clientX - r.left) * (this.canvas.width / r.width);
      this.mouse.y = (t.clientY - r.top) * (this.canvas.height / r.height);
    };
    const inUiZone = () =>
      this.uiZones.some((z) => this.mouse.x >= z.x && this.mouse.x <= z.x + z.w &&
        this.mouse.y >= z.y && this.mouse.y <= z.y + z.h);

    const TAP_SLOP = 12;     // px of movement still treated as a tap, not a drag
    const SCROLL_STEP = 26;  // px of vertical drag per scroll tick in menus

    this.canvas.addEventListener("touchstart", (e) => {
      Sound.unlock();
      reveal();
      if (this._touchId === null) {
        const t = e.changedTouches[0];
        this._touchId = t.identifier;
        setFromTouch(t);
        this._touchStartX = t.clientX; this._touchStartY = t.clientY;
        this._lastClientY = t.clientY;
        this._touchMoved = false;
        this._scrollAccum = 0;
        this.mouse.left = false; this.mouse.right = false;
        if (this.uiMode === "play") {
          // Action game: engage immediately. A tap also leaves a left edge so
          // canvas UI (hotbar/pause) is tappable; held button drives the world.
          this._mouseJust.left = true;
          this._touchUi = inUiZone();
          if (!this._touchUi) {
            if (this.buildMode) {
              // Build = right-click: held for placing, edge for eat/use/trade/TV.
              this.mouse.right = true; this._mouseJust.right = true;
            } else {
              this.mouse.left = true; // held for mining/attacking/firing
            }
          }
        }
        // In a menu we defer: a tap fires on release, a drag scrolls instead.
      }
      e.preventDefault();
    }, { passive: false });

    this.canvas.addEventListener("touchmove", (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._touchId) continue;
        setFromTouch(t);
        if (Math.hypot(t.clientX - this._touchStartX, t.clientY - this._touchStartY) > TAP_SLOP)
          this._touchMoved = true;
        // Drag-to-scroll while a menu list is open (only over the scrollable area).
        const z = this.scrollZone;
        const overList = !z || (this.mouse.x >= z.x && this.mouse.x <= z.x + z.w &&
          this.mouse.y >= z.y && this.mouse.y <= z.y + z.h);
        if (this.uiMode !== "play" && overList) {
          this._scrollAccum += this._lastClientY - t.clientY; // finger up => scroll down
          while (this._scrollAccum >= SCROLL_STEP) { this.wheelDelta += 1; this._scrollAccum -= SCROLL_STEP; }
          while (this._scrollAccum <= -SCROLL_STEP) { this.wheelDelta -= 1; this._scrollAccum += SCROLL_STEP; }
        }
        this._lastClientY = t.clientY;
        break;
      }
      e.preventDefault();
    }, { passive: false });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._touchId) continue;
        // A clean tap inside a menu fires its click now (on release), so drags
        // used for scrolling don't accidentally select/craft.
        if (this.uiMode !== "play" && !this._touchMoved) this._mouseJust.left = true;
        this._touchId = null; this._touchUi = false;
        this.mouse.left = false; this.mouse.right = false;
        break;
      }
    };
    this.canvas.addEventListener("touchend", end);
    this.canvas.addEventListener("touchcancel", end);

    // ----- overlay buttons -----
    document.querySelectorAll("#touch .tc-btn").forEach((btn) => {
      const hold = (down) => btn.classList.toggle("held", down);
      if (btn.dataset.key) {
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault(); reveal(); Sound.unlock();
          this.setKey(btn.dataset.key, true); hold(true);
        });
        const up = (e) => { e.preventDefault(); this.setKey(btn.dataset.key, false); hold(false); };
        btn.addEventListener("pointerup", up);
        btn.addEventListener("pointercancel", up);
        btn.addEventListener("pointerleave", up);
      } else if (btn.dataset.tap === "inv") {
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault(); reveal(); Sound.unlock(); this.pulseKey("KeyE");
        });
      } else if (btn.dataset.tap === "esc") {
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault(); this.pulseKey("Escape");
        });
      } else if (btn.dataset.toggle === "build") {
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault(); reveal();
          this.buildMode = !this.buildMode;
          btn.classList.toggle("build", this.buildMode);
          btn.textContent = this.buildMode ? "▦" : "⛏";
        });
      }
    });
  }

  // The game calls this each frame so touch input can route correctly and the
  // overlay can hide itself behind canvas menus.
  setUi(ui) {
    this.uiMode = ui;
    document.body.classList.toggle("ui-open", ui !== "play");
  }

  // Drive a key code as if from the keyboard (used by the on-screen buttons).
  setKey(code, down) {
    if (down) {
      if (!this.keys.has(code)) this._justPressed.add(code);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
  }

  // A momentary press: registers one just-pressed edge without staying held.
  pulseKey(code) { this._justPressed.add(code); }

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

  consumeTyped() { const t = this.typed; this.typed = ""; return t; }

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
