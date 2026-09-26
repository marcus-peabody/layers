// Shared collage renderer: infinite tiled parallax, panned by drag (touch/mouse)
// and scroll/trackpad wheel. Used by both console.html and index.html.
function CollageEngine(canvas){
  const ctx = canvas.getContext('2d');
  let W, H, dpr = window.devicePixelRatio || 1;

  function resize(){
    W = innerWidth; H = innerHeight; dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize); resize();

  let layers = [];
  let settings = { depthScale: 1, speed: 1, density: 1.2, tiltSensitivity: 1 };
  let offsetX = 0, offsetY = 0, dragging = false, lastX = 0, lastY = 0;
  let onInteract = null;
  const tilt = { enabled: false, baseBeta: null, baseGamma: null, curBeta: 0, curGamma: 0 };

  function handleOrientation(e){
    if (tilt.baseGamma === null){ tilt.baseBeta = e.beta || 0; tilt.baseGamma = e.gamma || 0; }
    tilt.curBeta = e.beta || 0; tilt.curGamma = e.gamma || 0;
  }

  function hash(a,b,c){ const x = Math.sin(a*127.1 + b*311.7 + c*57.3) * 43758.5453; return x - Math.floor(x); }
  function strHash(s){ let h = 0; for (let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0; return h; }

  canvas.addEventListener('pointerdown', e=>{
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    if (onInteract) onInteract();
  });
  canvas.addEventListener('pointermove', e=>{
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    offsetX -= dx * settings.speed; offsetY -= dy * settings.speed;
  });
  canvas.addEventListener('pointerup', ()=>dragging=false);
  canvas.addEventListener('pointercancel', ()=>dragging=false);
  canvas.addEventListener('wheel', e=>{
    e.preventDefault();
    offsetX += e.deltaX * settings.speed; offsetY += e.deltaY * settings.speed;
    if (onInteract) onInteract();
  }, { passive:false });

  function draw(){
    ctx.clearRect(0,0,W,H);
    let tiltX = 0, tiltY = 0;
    if (tilt.enabled && tilt.baseGamma !== null){
      const sens = settings.tiltSensitivity || 1;
      tiltX = (tilt.curGamma - tilt.baseGamma) * sens * 6;
      tiltY = (tilt.curBeta - tilt.baseBeta) * sens * 6;
    }
    for (const l of layers){
      if (!l.active || !l.img || !l.img.width) continue;
      const base = Math.max(l.img.width, l.img.height);
      const fit = Math.min(1, 260/base) * (l.scale || 1);
      const dw = l.img.width*fit, dh = l.img.height*fit;
      const cell = Math.max(dw,dh) * (1.7 * settings.density);
      const parallax = l.depth * settings.depthScale;
      const camX = (offsetX+tiltX)*parallax, camY = (offsetY+tiltY)*parallax;
      const seed = strHash(l.id);
      const phaseX = ((seed%997)/997)*cell, phaseY = ((seed%991)/991)*cell;
      const iMin = Math.floor((camX-phaseX-dw)/cell)-1, iMax = Math.ceil((camX-phaseX+W)/cell)+1;
      const jMin = Math.floor((camY-phaseY-dh)/cell)-1, jMax = Math.ceil((camY-phaseY+H)/cell)+1;
      ctx.globalAlpha = 0.55 + Math.min(0.4, l.depth*0.3);
      for (let i=iMin;i<=iMax;i++){
        for (let j=jMin;j<=jMax;j++){
          const jx = (hash(i,j,seed)-0.5)*cell*0.8;
          const jy = (hash(j,i,seed+1)-0.5)*cell*0.8;
          const rot = (hash(i+1,j+1,seed)-0.5)*0.5;
          const px = i*cell+phaseX+jx-camX-dw/2;
          const py = j*cell+phaseY+jy-camY-dh/2;
          if (px>-dw*1.5 && px<W+dw*0.5 && py>-dh*1.5 && py<H+dh*0.5){
            ctx.save(); ctx.translate(px+dw/2, py+dh/2); ctx.rotate(rot);
            ctx.drawImage(l.img, -dw/2, -dh/2, dw, dh); ctx.restore();
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  return {
    setLayers(v){ layers = v; },
    setSettings(v){ Object.assign(settings, v); },
    onFirstInteract(fn){ onInteract = fn; },
    tiltSupported: typeof window.DeviceOrientationEvent !== 'undefined',
    async enableTilt(){
      tilt.baseBeta = null; tilt.baseGamma = null;
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'){
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', handleOrientation);
      tilt.enabled = true;
      return true;
    },
    disableTilt(){ tilt.enabled = false; window.removeEventListener('deviceorientation', handleOrientation); },
    isTiltEnabled(){ return tilt.enabled; },
    start(){ draw(); }
  };
}
