// Parallax collage engine. No dependencies.
//
// Layers are drawn in array order (last = on top). Each layer is an infinite,
// jittered grid of its image. Panning moves every layer by (pan * depth), so
// higher-depth layers sweep past faster and read as closer.
//
//   layer = { img, depth, scale, opacity, seed }
function CollageEngine(canvas) {
  const ctx = canvas.getContext('2d');
  const settings = { depthScale: 1, speed: 1, density: 1.2 };
  let layers = [];
  let W = 0, H = 0;
  let panX = 0, panY = 0;
  let dragging = false, lastX = 0, lastY = 0;
  let firstInteractCb = null;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function interacted() {
    if (firstInteractCb) { firstInteractCb(); firstInteractCb = null; }
  }

  // ---- input: drag (touch + mouse) and wheel/trackpad ----
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    interacted();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    panX -= (e.clientX - lastX) * settings.speed;
    panY -= (e.clientY - lastY) * settings.speed;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const stopDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    panX += e.deltaX * settings.speed;
    panY += e.deltaY * settings.speed;
    interacted();
  }, { passive: false });

  // ---- rendering ----
  // Deterministic pseudo-random in [0,1) from three numbers.
  function hash(a, b, c) {
    const x = Math.sin(a * 127.1 + b * 311.7 + c * 57.3) * 43758.5453;
    return x - Math.floor(x);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    for (const l of layers) {
      const iw = l.img.naturalWidth, ih = l.img.naturalHeight;
      if (!iw || !ih) continue;

      // Fit to ~260px on the long side, then apply the layer's own scale.
      const fit = Math.min(1, 260 / Math.max(iw, ih)) * l.scale;
      const dw = iw * fit, dh = ih * fit;
      const cell = Math.max(dw, dh) * 1.7 * settings.density;

      const parallax = l.depth * settings.depthScale;
      const camX = panX * parallax, camY = panY * parallax;

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
  function frame() {
    requestAnimationFrame(frame);
    render();
  }

  return {
    setLayers(v) { layers = v; },
    setSettings(v) { Object.assign(settings, v); },
    onFirstInteract(fn) { firstInteractCb = fn; },
    start() { frame(); }
  };
}

// Stable numeric seed for a layer, derived from its id, so a layer keeps the same
// tile layout in the console preview and in the viewer.
function layerSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 9973) + 1;
}
