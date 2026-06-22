// In-world television: right-click a TV block to pop up a close-up "set" with a
// YouTube video playing inside it. Rendered as real DOM (an <iframe>) layered
// over the game canvas — canvas can't host a YouTube player.
//
// We use YouTube's standard privacy-enhanced IFrame embed (youtube-nocookie.com).
// That's the official, keyless way to play a video: no Data-API quota, so there's
// nothing to rate-limit. The browser talks straight to YouTube.

// Pull the 11-char video id (and optional start time / playlist) out of any of
// the common YouTube URL shapes: watch?v=, youtu.be/, /embed/, /shorts/, /live/.
function parseYouTube(raw) {
  if (!raw) return null;
  let url;
  try { url = new URL(raw.trim()); }
  catch {
    // Bare id pasted on its own?
    const m = raw.trim().match(/^[\w-]{11}$/);
    return m ? { id: raw.trim(), start: 0, list: null } : null;
  }
  const host = url.hostname.replace(/^www\./, "");
  let id = null, list = url.searchParams.get("list");
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{11})/);
      if (m) id = m[2];
    }
  }
  if (id && !/^[\w-]{11}$/.test(id)) id = null;
  if (!id && !list) return null;
  // start time: t=90 or t=1m30s
  let start = 0;
  const t = url.searchParams.get("t") || url.searchParams.get("start");
  if (t) {
    const hms = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/);
    if (hms && (hms[1] || hms[2] || hms[3]))
      start = (+hms[1] || 0) * 3600 + (+hms[2] || 0) * 60 + (+hms[3] || 0);
    else if (/^\d+$/.test(t)) start = +t;
  }
  return { id, start, list };
}

// YouTube refuses to embed auto-generated "Mix"/"Radio" playlists (ids starting
// with RD — e.g. RDa0sq... ). Embedding one triggers "Error 153". Only real,
// user/channel playlists (PL, UU, OL, FL, LL…) are embeddable, so we drop the rest.
function embeddableList(list) {
  return list && !/^RD/i.test(list) ? list : null;
}

function embedSrc({ id, start, list }) {
  // Use the standard youtube.com embed (not -nocookie): it's far more tolerant
  // of how the page is hosted. The -nocookie domain + an "origin" param throws
  // "Error 153" when the game is opened as a local file:// (origin is "null").
  const base = "https://www.youtube.com/embed/";
  const params = new URLSearchParams({ autoplay: "1", rel: "0", modestbranding: "1", playsinline: "1" });
  if (start) params.set("start", String(start));
  const safeList = embeddableList(list);
  if (safeList) params.set("list", safeList);
  // Playlist with no specific video: use the playlist embed form.
  if (!id && safeList) return `${base}videoseries?${params}`;
  return `${base}${id}?${params}`;
}

export const TV = {
  _root: null,
  _screen: null,
  _onClose: null,
  get isOpen() { return !!this._root && this._root.style.display !== "none"; },

  // Build the overlay DOM once, lazily.
  _build() {
    if (this._root) return;
    const root = document.createElement("div");
    root.id = "tv-overlay";
    root.style.cssText = [
      "position:fixed", "inset:0", "z-index:50", "display:none",
      "align-items:center", "justify-content:center",
      "background:rgba(4,5,12,0.82)", "backdrop-filter:blur(2px)",
      "font-family:ui-monospace,Consolas,monospace", "color:#cdd6f4",
    ].join(";");

    // The TV cabinet.
    const tv = document.createElement("div");
    tv.style.cssText = [
      "position:relative", "width:min(860px,92vw)",
      "background:linear-gradient(#2a2018,#171009)",
      "border:3px solid #0c0905", "border-radius:18px",
      "padding:18px 18px 46px", "box-shadow:0 24px 70px rgba(0,0,0,0.7)",
    ].join(";");

    // The screen (16:9), holds either the URL form or the iframe.
    const screen = document.createElement("div");
    screen.style.cssText = [
      "position:relative", "width:100%", "aspect-ratio:16/9",
      "background:#05060a", "border:4px solid #050402", "border-radius:8px",
      "overflow:hidden", "box-shadow:inset 0 0 60px rgba(0,0,0,0.8)",
      "display:flex", "align-items:center", "justify-content:center",
    ].join(";");

    // Little control strip / stand at the bottom of the cabinet.
    const strip = document.createElement("div");
    strip.style.cssText = "position:absolute;left:0;right:0;bottom:12px;display:flex;align-items:center;justify-content:center;gap:14px;opacity:0.8;font-size:12px";
    strip.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;background:#e74c3c;box-shadow:0 0 8px #e74c3c"></span><span style="letter-spacing:3px">▮ ▮ ▮  T V  ▮ ▮ ▮</span>`;

    // Close button.
    const close = document.createElement("button");
    close.textContent = "✕";
    close.title = "Turn off (Esc)";
    close.style.cssText = [
      "position:absolute", "top:-14px", "right:-14px", "width:34px", "height:34px",
      "border-radius:50%", "border:2px solid #0c0905", "background:#c0392b",
      "color:#fff", "font:inherit", "font-size:16px", "cursor:pointer",
      "box-shadow:0 4px 12px rgba(0,0,0,0.5)",
    ].join(";");
    close.onclick = () => this.close();

    tv.appendChild(close);
    tv.appendChild(screen);
    tv.appendChild(strip);
    root.appendChild(tv);

    // Click the dark backdrop (outside the cabinet) to turn it off.
    root.addEventListener("mousedown", (e) => { if (e.target === root) this.close(); });
    // Swallow gameplay key handling while typing / watching.
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { this.close(); }
      e.stopPropagation();
    });

    document.body.appendChild(root);
    this._root = root;
    this._screen = screen;
  },

  // Show the channel-tuning form inside the screen. `current` pre-fills it.
  _showForm(current, onPlay) {
    const screen = this._screen;
    screen.innerHTML = "";
    const form = document.createElement("div");
    form.style.cssText = "width:78%;max-width:520px;text-align:center;display:flex;flex-direction:column;gap:12px";
    form.innerHTML = `
      <div style="font-size:34px;font-weight:800;color:#f7d35e;letter-spacing:2px;text-shadow:0 2px 0 #7a5a12">📺 TUNE IN</div>
      <div style="opacity:0.6;font-size:12px">Paste a YouTube link — video, short, live, or playlist.</div>`;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "https://www.youtube.com/watch?v=…";
    if (current) input.value = current;
    input.style.cssText = "width:100%;box-sizing:border-box;padding:11px 12px;font:inherit;color:#cdd6f4;background:#0c0f18;border:1px solid #2f3550;border-radius:8px";
    const err = document.createElement("div");
    err.style.cssText = "color:#f38ba8;font-size:12px;min-height:16px";
    const btn = document.createElement("button");
    btn.textContent = "▶  PLAY";
    btn.style.cssText = "padding:12px;font:inherit;font-size:15px;color:#0c0f18;background:#f7d35e;border:none;border-radius:8px;cursor:pointer;font-weight:700";

    const go = () => {
      const parsed = parseYouTube(input.value);
      if (!parsed) { err.textContent = "Couldn't read that as a YouTube link."; return; }
      onPlay(input.value.trim(), parsed);
    };
    btn.onclick = go;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });

    form.appendChild(input);
    form.appendChild(err);
    form.appendChild(btn);
    screen.appendChild(form);
    setTimeout(() => input.focus(), 30);
  },

  // Load the actual YouTube iframe into the screen.
  _showVideo(parsed) {
    const screen = this._screen;
    screen.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.src = embedSrc(parsed);
    iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#000";
    iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    screen.appendChild(iframe);

    // A small "change channel" button over the corner.
    const chan = document.createElement("button");
    chan.textContent = "⟳ change";
    chan.style.cssText = "position:absolute;bottom:8px;right:8px;padding:5px 9px;font:inherit;font-size:11px;color:#cdd6f4;background:rgba(10,12,24,0.75);border:1px solid #2f3550;border-radius:6px;cursor:pointer";
    chan.onmousedown = (e) => e.stopPropagation();
    chan.onclick = () => this._showForm(this._lastUrl, (url, p) => { this._commit(url, p); });
    screen.appendChild(chan);
  },

  _commit(url, parsed) {
    this._lastUrl = url;
    if (this._onSetUrl) this._onSetUrl(url);
    this._showVideo(parsed);
  },

  // Open the TV. `opts`: { url, onSetUrl, onClose }.
  //   url       – previously tuned URL for this set (or null/empty)
  //   onSetUrl  – called with the new URL when the player tunes a channel
  //   onClose   – called when the TV is turned off
  open(opts = {}) {
    this._build();
    this._onSetUrl = opts.onSetUrl || null;
    this._onClose = opts.onClose || null;
    this._lastUrl = opts.url || "";
    this._root.style.display = "flex";
    const parsed = parseYouTube(this._lastUrl);
    if (parsed) this._showVideo(parsed);
    else this._showForm(this._lastUrl, (url, p) => this._commit(url, p));
  },

  close() {
    if (!this._root) return;
    this._root.style.display = "none";
    if (this._screen) this._screen.innerHTML = ""; // unload iframe -> stops audio
    const cb = this._onClose; this._onClose = null;
    if (cb) cb();
  },
};
