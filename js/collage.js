// Parallax collage engine. No dependencies.
//
// Layers are drawn in array order (last = on top). Each layer is an infinite,
// jittered grid of its image. Panning moves every layer by (pan * depth), so
// higher-depth layers sweep past faster and read as closer.
//
//   layer = { img, depth, scale, opacity, seed, frames? }
//
// If a layer has `frames` (an animated GIF, decoded to canvases), the frame
// shown depends on how far you have scrolled, not on time.
//
// opts.scroller (optional): a real, empty, overflow:scroll element the same
// size as the canvas. When given, touch drags and wheel/trackpad scrolling
// become genuine browser scrolling on that element instead of something we
// simulate -- which is what actually gets Safari to auto-hide its chrome on
// iPhone. Desktop mouse click-and-drag is unaffected either way; native
// scrolling doesn't respond to mouse drags, so that path stays exactly as it
// was. Without opts.scroller, everything (touch, mouse, wheel) falls back to
// the original simulated panning on the canvas itself.
// What the tilt button does. 'look': the phone is a window onto the collage --
// turn and tilt it to look around, as if the layers lay inside a sphere around
// you (infinite, so you can keep turning). 'offset': the old small parallax nudge.
const TILT_MODE = 'look';
const LOOK_PX_PER_RAD = 4000;   // x tilt sensitivity (0.15 -> 600px per radian)
const GIF_PX_PER_FRAME = 24;   // scroll distance that advances a GIF layer by one frame

function CollageEngine(canvas, opts) {
  opts = opts || {};
  const scroller = opts.scroller || null;
  const ctx = canvas.getContext('2d');
  const settings = { depthScale: 1, speed: 1, density: 1.2, tiltSensitivity: 0.15, rotation: 15 };   // rotation: max tilt of each image, degrees either way
  let layers = [];
  let W = 0, H = 0;
  let panX = 0, panY = 0;
  let dragging = false, lastX = 0, lastY = 0, lastT = 0;
  let vx = 0, vy = 0;                 // momentum velocity, px/ms (mouse-drag path only)
  let firstInteractCb = null;
  const tilt = { enabled: false, baseBeta: null, baseGamma: null, beta: 0, gamma: 0,
    yaw: null, pitch: 0, lastYaw: 0, x: 0, y: 0, sx: 0, sy: 0 };   // x/y: look target (px, unscaled); sx/sy: smoothed

  // The visual viewport (window.innerHeight) shrinks when Safari's address bar
  // is showing. Sizing to that leaves a gap that's never drawn. Instead we size
  // to the canvas's own CSS box, which style.css sets to 100lvh/100lvw -- the
  // "large viewport", i.e. the full screen -- so the artwork always extends
  // under Safari's translucent chrome instead of resizing to avoid it.
  function viewportSize() {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }
  function resize() {
    // Capped at 2: the canvas is oversized (see style.css) and phones run short
    // of canvas memory; the layers are upscaled photos anyway, so 3x buys nothing.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const v = viewportSize();
    if (v.w === W && v.h === H) return;   // skip the work when nothing changed
    W = v.w; H = v.h;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  resize();

  function interacted() {
    if (firstInteractCb) { firstInteractCb(); firstInteractCb = null; }
  }

  let syncScroll = null;
  if (scroller) {
    // ---- real native scrolling drives pan for touch, trackpad, and wheel ----
    // The scroller is parked in the middle of a huge scroll range and quietly
    // re-centered whenever it drifts too far, so scrolling feels infinite.
    // Re-centering updates last{Left,Top} *before* the resulting scroll event
    // arrives, so that event computes a delta of zero -- the jump is invisible
    // to panX/panY even though the scroller's own position just snapped.
    const WORLD = 60000, CENTER = WORLD / 2, MARGIN = WORLD * 0.25;
    let lastLeft = CENTER, lastTop = CENTER;
    scroller.scrollLeft = CENTER;
    scroller.scrollTop = CENTER;
    // Read the scroll position on scroll events AND once at the start of every
    // drawn frame. Scroll events can arrive out of step with drawing, which shows
    // as a slight stutter; sampling per frame keeps the picture locked to where
    // the finger / momentum has actually got to. Calling it twice is harmless:
    // the second call sees a delta of zero.
    syncScroll = () => {
      const sl = scroller.scrollLeft, st = scroller.scrollTop;
      if (sl === lastLeft && st === lastTop) return;
      panX += (sl - lastLeft) * settings.speed;
      panY += (st - lastTop) * settings.speed;
      lastLeft = sl; lastTop = st;
      interacted();
      if (sl < MARGIN || sl > WORLD - MARGIN || st < MARGIN || st > WORLD - MARGIN) {
        scroller.scrollLeft = CENTER; scroller.scrollTop = CENTER;
        lastLeft = CENTER; lastTop = CENTER;
      }
    };
    scroller.addEventListener('scroll', syncScroll, { passive: true });

    // Desktop mouse click-and-drag: native scrolling doesn't respond to this
    // at all, so it's handled the same way as the no-scroller fallback below,
    // just restricted to pointerType 'mouse' (touch already has real scrolling).
    scroller.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      dragging = true;
      lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
      vx = 0; vy = 0;
      scroller.setPointerCapture(e.pointerId);
      interacted();
    });
    scroller.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerType !== 'mouse') return;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      panX -= dx * settings.speed;
      panY -= dy * settings.speed;
      vx = vx * 0.7 + (dx / dt) * 0.3;
      vy = vy * 0.7 + (dy / dt) * 0.3;
      lastX = e.clientX; lastY = e.clientY; lastT = now;
    });
    const stopDragS = (e) => { if (e.pointerType === 'mouse') dragging = false; };
    scroller.addEventListener('pointerup', stopDragS);
    scroller.addEventListener('pointercancel', stopDragS);
  } else {
    // ---- fallback: simulate everything on the canvas itself (used when no
    // scroller is supplied, e.g. the console's live preview) ----
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
      vx = 0; vy = 0;
      canvas.setPointerCapture(e.pointerId);
      interacted();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      panX -= dx * settings.speed;
      panY -= dy * settings.speed;
      vx = vx * 0.7 + (dx / dt) * 0.3;
      vy = vy * 0.7 + (dy / dt) * 0.3;
      lastX = e.clientX; lastY = e.clientY; lastT = now;
    });
    const stopDrag = () => { dragging = false; };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      dragging = false; vx = 0; vy = 0;
      panX += e.deltaX * settings.speed;
      panY += e.deltaY * settings.speed;
      interacted();
    }, { passive: false });
  }

  // ---- tilt (phone orientation) ----
  function handleOrientation(e) {
    if (TILT_MODE === 'look') {
      // Which way is the back of the phone pointing? Taken from the full
      // rotation (not raw alpha/beta), so it stays stable when held upright.
      const d = Math.PI / 180, a = (e.alpha || 0) * d, b = (e.beta || 0) * d, g = (e.gamma || 0) * d;
      const zx = Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g);
      const zy = Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.sin(b) * Math.cos(g);
      const zz = Math.cos(b) * Math.cos(g);
      const yaw = Math.atan2(-zx, -zy);
      const pitch = Math.asin(Math.max(-1, Math.min(1, -zz)));
      if (tilt.yaw === null) { tilt.yaw = yaw; tilt.lastYaw = yaw; tilt.pitch0 = pitch; tilt.unwrapped = 0; }
      let dy = yaw - tilt.lastYaw;
      if (dy > Math.PI) dy -= 2 * Math.PI; else if (dy < -Math.PI) dy += 2 * Math.PI;
      tilt.unwrapped += dy; tilt.lastYaw = yaw;
      tilt.pitch = pitch - tilt.pitch0;
      return;
    }
    if (tilt.baseGamma === null) { tilt.baseBeta = e.beta || 0; tilt.baseGamma = e.gamma || 0; }
    tilt.beta = e.beta || 0; tilt.gamma = e.gamma || 0;
  }

  // ---- rendering ----
  // Deterministic pseudo-random in [0,1) from three numbers.
  function hash(a, b, c) {
    const x = Math.sin(a * 127.1 + b * 311.7 + c * 57.3) * 43758.5453;
    return x - Math.floor(x);
  }

  function render() {
    let tiltX = 0, tiltY = 0;
    if (TILT_MODE === 'look') {
      if (tilt.enabled && tilt.yaw !== null) {
        const k = settings.tiltSensitivity * LOOK_PX_PER_RAD;
        const tx = tilt.unwrapped * k, ty = -tilt.pitch * k;   // turn right -> look right; tilt up -> look up
        tilt.sx += (tx - tilt.sx) * 0.3; tilt.sy += (ty - tilt.sy) * 0.3;   // light smoothing against sensor jitter
        tiltX = tilt.sx; tiltY = tilt.sy;
      }
    } else if (tilt.enabled && tilt.baseGamma !== null) {
      const s = settings.tiltSensitivity;
      tiltX = (tilt.gamma - tilt.baseGamma) * s * 6;
      tiltY = (tilt.beta - tilt.baseBeta) * s * 6;
    }
    drawScene(ctx, W, H, panX, panY, tiltX, tiltY);
  }

  // Draws the whole collage for a given camera onto any 2D context. render()
  // uses it for the live canvas; capture() uses it for the gallery cover.
  function drawScene(ctx, W, H, panX, panY, tiltX, tiltY) {
    ctx.clearRect(0, 0, W, H);
    // Many layers must not all pile onto every spot, or the front few hide the
    // rest. Past 8 layers each one is spread thinner (so the total on screen
    // stays about what 8 layers give) and also drops out of some whole zones, so
    // exploring reveals different layers in different places.
    const nLayers = layers.length;
    const spread = Math.max(1, Math.sqrt(nLayers / 8));
    const zoneKeep = Math.min(1, 0.4 + 6 / nLayers);
    for (const l of layers) {
      const iw = l.img.naturalWidth || l.img.width, ih = l.img.naturalHeight || l.img.height;
      if (!iw || !ih) continue;

      // Fit to ~260px on the long side, then apply the layer's own scale.
      const fit = Math.min(1, 260 / Math.max(iw, ih)) * l.scale;
      const dw = iw * fit, dh = ih * fit;
      const cell = Math.max(dw, dh) * 1.7 * settings.density * spread;

      const parallax = l.depth * settings.depthScale;
      const camX = (panX + tiltX) * parallax, camY = (panY + tiltY) * parallax;

      // Each layer's grid is offset by its own seed so layers never line up.
      const phaseX = hash(l.seed, 1, 2) * cell;
      const phaseY = hash(l.seed, 3, 4) * cell;

      const i0 = Math.floor((camX - phaseX - dw) / cell) - 1;
      const i1 = Math.ceil((camX - phaseX + W + dw) / cell) + 1;
      const j0 = Math.floor((camY - phaseY - dh) / cell) - 1;
      const j1 = Math.ceil((camY - phaseY + H + dh) / cell) + 1;
      const margin = Math.max(dw, dh);

      let src = l.img;
      if (l.frames && l.frames.length > 1) {
        const n = l.frames.length;
        const k = Math.floor((camX + camY) / GIF_PX_PER_FRAME) + l.seed;
        src = l.frames[((k % n) + n) % n];
      }

      ctx.globalAlpha = l.opacity;
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          if (zoneKeep < 1 && hash(Math.floor(i / 3), Math.floor(j / 3), l.seed + 7) > zoneKeep) continue;   // this layer is absent from this zone
          const jx = (hash(i, j, l.seed) - 0.5) * cell * 0.8;
          const jy = (hash(j, i, l.seed + 1) - 0.5) * cell * 0.8;
          const rot = (hash(i + 1, j + 1, l.seed) - 0.5) * 2 * settings.rotation * Math.PI / 180;
          const sx = i * cell + phaseX + jx - camX;   // tile centre on screen
          const sy = j * cell + phaseY + jy - camY;
          if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) continue;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(rot);
          ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // Schedule the next frame first, so one bad frame can never stop the loop.
  let lastFrameT = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    resize();
    if (syncScroll) syncScroll();   // pick up the latest scroll position for this frame
    const dt = lastFrameT ? Math.min(50, t - lastFrameT) : 16;
    lastFrameT = t;
    if (!dragging && (Math.abs(vx) > 0.001 || Math.abs(vy) > 0.001)) {
      panX -= vx * settings.speed * dt;
      panY -= vy * settings.speed * dt;
      const friction = Math.pow(0.94, dt / 16);   // frame-rate independent decay
      vx *= friction; vy *= friction;
    }
    render();
  }

  return {
    setLayers(v) { layers = v; },
    setSettings(v) {
      Object.assign(settings, v);
      if (settings.tiltSensitivity > 0.3) settings.tiltSensitivity = 0.3;   // old collages saved a larger range
    },
    onFirstInteract(fn) { firstInteractCb = fn; },
    tiltSupported: typeof window.DeviceOrientationEvent !== 'undefined',
    async enableTilt() {
      tilt.baseBeta = null; tilt.baseGamma = null;
      tilt.yaw = null; tilt.sx = 0; tilt.sy = 0;
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', handleOrientation);
      tilt.enabled = true;
      return true;
    },
    disableTilt() {
      // Where you were looking becomes where the collage stays (no snap back).
      if (TILT_MODE === 'look') { panX += tilt.sx; panY += tilt.sy; tilt.sx = 0; tilt.sy = 0; tilt.yaw = null; }
      tilt.enabled = false; window.removeEventListener('deviceorientation', handleOrientation);
    },
    isTiltEnabled() { return tilt.enabled; },
    start() { requestAnimationFrame(frame); },

    // A picture of exactly what a w x h screen shows when the collage first
    // opens (camera at the start, no tilt). The live canvas spills `bleed` px
    // past every screen edge, so the screen's top-left sits at (bleed, bleed).
    // Returns a canvas w*scale by h*scale.
    capture(w, h, scale) {
      const bleed = opts.bleed || 0;
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      const x = c.getContext('2d');
      x.setTransform(scale, 0, 0, scale, -bleed * scale, -bleed * scale);
      drawScene(x, w + 2 * bleed, h + 2 * bleed, 0, 0, 0, 0);
      return c;
    }
  };
}

// Stable numeric seed for a layer, derived from its id, so a layer keeps the same
// tile layout in the console preview and in the viewer.
function layerSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 9973) + 1;
}

// Front layers must move fastest (close things sweep past, far things drift).
// Given layer depths listed back-to-front, return them sorted so each layer is
// at least as deep as the one behind it. Used wherever depths are loaded.
function depthsInStackOrder(depths) {
  return depths.slice().sort((a, b) => a - b);
}
