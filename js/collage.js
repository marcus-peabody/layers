// Parallax collage engine. No dependencies.
//
// Layers are drawn in array order (last = on top). Each layer is an infinite,
// jittered grid of its image. Panning moves every layer by (pan * depth), so
// higher-depth layers sweep past faster and read as closer.
//
//   layer = { img, depth, scale, opacity, seed }
function CollageEngine(canvas) {
  const ctx = canvas.getContext('2d');
  const settings = { depthScale: 1, speed: 1, density: 1.2, tiltSensitivity: 1 };
  let layers = [];
  let W = 0, H = 0;
  let panX = 0, panY = 0;
  let dragging = false, lastX = 0, lastY = 0, lastT = 0;
  let vx = 0, vy = 0;                 // momentum velocity, px/ms
  let firstInteractCb = null;
  const tilt = { enabled: false, baseBeta: null, baseGamma: null, beta: 0, gamma: 0 };

  // The visual viewport (window.innerHeight) shrinks when Safari's address bar
  // is showing. Sizing to that leaves a gap that's never drawn. Instead we size
  // to the canvas's own CSS box, which style.css sets to 100lvh/100lvw — the
  // "large viewport", i.e. the full screen — so the artwork always extends
  // under Safari's translucent chrome instead of resizing to avoid it.
  function viewportSize() {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const v = viewportSize();
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

  // ---- input: drag (touch + mouse) with momentum, and wheel/trackpad ----
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
    // Smoothed velocity, so one jumpy sample right before release doesn't fling it.
    vx = vx * 0.7 + (dx / dt) * 0.3;
    vy = vy * 0.7 + (dy / dt) * 0.3;
    lastX = e.clientX; lastY = e.clientY; lastT = now;
  });
  const stopDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    dragging = false; vx = 0; vy = 0;   // a wheel gesture overrides any touch momentum in flight
    panX += e.deltaX * settings.speed;
    panY += e.deltaY * settings.speed;
    interacted();
  }, { passive: false });

  // ---- tilt (phone orientation) ----
  function handleOrientation(e) {
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
    ctx.clearRect(0, 0, W, H);
    let tiltX = 0, tiltY = 0;
    if (tilt.enabled && tilt.baseGamma !== null) {
      const s = settings.tiltSensitivity;
      tiltX = (tilt.gamma - tilt.baseGamma) * s * 6;
      tiltY = (tilt.beta - tilt.baseBeta) * s * 6;
    }
    for (const l of layers) {
      const iw = l.img.naturalWidth, ih = l.img.naturalHeight;
      if (!iw || !ih) continue;

      // Fit to ~260px on the long side, then apply the layer's own scale.
      const fit = Math.min(1, 260 / Math.max(iw, ih)) * l.scale;
      const dw = iw * fit, dh = ih * fit;
      const cell = Math.max(dw, dh) * 1.7 * settings.density;

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

      ctx.globalAlpha = l.opacity;
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const jx = (hash(i, j, l.seed) - 0.5) * cell * 0.8;
          const jy = (hash(j, i, l.seed + 1) - 0.5) * cell * 0.8;
          const rot = (hash(i + 1, j + 1, l.seed) - 0.5) * 0.5;
          const sx = i * cell + phaseX + jx - camX;   // tile centre on screen
          const sy = j * cell + phaseY + jy - camY;
          if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) continue;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(rot);
          ctx.drawImage(l.img, -dw / 2, -dh / 2, dw, dh);
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
    setSettings(v) { Object.assign(settings, v); },
    onFirstInteract(fn) { firstInteractCb = fn; },
    tiltSupported: typeof window.DeviceOrientationEvent !== 'undefined',
    async enableTilt() {
      tilt.baseBeta = null; tilt.baseGamma = null;
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', handleOrientation);
      tilt.enabled = true;
      return true;
    },
    disableTilt() { tilt.enabled = false; window.removeEventListener('deviceorientation', handleOrientation); },
    isTiltEnabled() { return tilt.enabled; },
    start() { requestAnimationFrame(frame); }
  };
}

// Stable numeric seed for a layer, derived from its id, so a layer keeps the same
// tile layout in the console preview and in the viewer.
function layerSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 9973) + 1;
}
