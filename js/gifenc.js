// Tiny GIF encoder + video-to-GIF. Used when a short video is added: it is
// sampled into frames and saved as a GIF, which then behaves like any other
// GIF (frames advance with scroll). No dependencies.

// frames: [{ data: Uint8ClampedArray RGBA, w, h }] (all the same size)
function encodeGif(frames, delayCs, colors) {
  const w = frames[0].w, h = frames[0].h;
  const bits = Math.max(2, Math.min(8, Math.round(Math.log2(colors || 256))));   // palette = 2^bits colours
  const nCol = 1 << bits;

  // Global palette: median cut over a sample of pixels from every frame.
  const sample = [];
  const perFrame = Math.max(200, Math.floor(30000 / frames.length));
  for (const f of frames) {
    const n = f.w * f.h, step = Math.max(1, Math.floor(n / perFrame));
    for (let i = 0; i < n; i += step) sample.push((f.data[i * 4] << 16) | (f.data[i * 4 + 1] << 8) | f.data[i * 4 + 2]);
  }
  let boxes = [sample];
  const chan = (c, sh) => (c >> sh) & 255;
  while (boxes.length < nCol) {
    let bi = -1, best = 0, bsh = 16;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (const sh of [16, 8, 0]) {
        let lo = 255, hi = 0;
        for (const c of b) { const v = chan(c, sh); if (v < lo) lo = v; if (v > hi) hi = v; }
        const score = (hi - lo) * Math.sqrt(b.length);
        if (score > best) { best = score; bi = i; bsh = sh; }
      }
    });
    if (bi < 0) break;
    const b = boxes[bi].slice().sort((p, q) => chan(p, bsh) - chan(q, bsh));
    const m = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
  }
  const pal = boxes.map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const c of b) { r += c >> 16; g += (c >> 8) & 255; bl += c & 255; }
    const n = b.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
  });
  while (pal.length < nCol) pal.push([0, 0, 0]);

  // nearest palette entry, cached per 15-bit colour
  const cache = new Int16Array(32768).fill(-1);
  function nearest(r, g, b) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let v = cache[key];
    if (v >= 0) return v;
    const rr = (r & 0xf8) | 4, gg = (g & 0xf8) | 4, bb = (b & 0xf8) | 4;
    let bd = 1e9; v = 0;
    for (let i = 0; i < nCol; i++) {
      const p = pal[i], d = (p[0] - rr) * (p[0] - rr) + (p[1] - gg) * (p[1] - gg) + (p[2] - bb) * (p[2] - bb);
      if (d < bd) { bd = d; v = i; }
    }
    return (cache[key] = v);
  }

  const out = [];
  const u16 = (v) => out.push(v & 255, (v >> 8) & 255);
  out.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  u16(w); u16(h);
  out.push(0xf0 | (bits - 1), 0, 0);          // global colour table of 2^bits entries
  for (const p of pal) out.push(p[0], p[1], p[2]);
  out.push(0x21, 0xff, 11);                    // loop forever
  for (const ch of 'NETSCAPE2.0') out.push(ch.charCodeAt(0));
  out.push(3, 1, 0, 0, 0);

  for (const f of frames) {
    out.push(0x21, 0xf9, 4, 0, delayCs & 255, (delayCs >> 8) & 255, 0, 0);
    out.push(0x2c); u16(0); u16(0); u16(w); u16(h); out.push(0);
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) idx[i] = nearest(f.data[i * 4], f.data[i * 4 + 1], f.data[i * 4 + 2]);
    out.push(bits);
    const bytes = lzwEncode(idx, bits);
    for (let i = 0; i < bytes.length; i += 255) {
      const n = Math.min(255, bytes.length - i);
      out.push(n);
      for (let k = 0; k < n; k++) out.push(bytes[i + k]);
    }
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}

function lzwEncode(idx, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  const bytes = [];
  let cur = 0, nbits = 0;
  function put(code, size) {
    cur |= code << nbits; nbits += size;
    while (nbits >= 8) { bytes.push(cur & 255); cur >>>= 8; nbits -= 8; }
  }
  let size = minCode + 1, next = eoi + 1;
  let dict = new Map();
  put(clear, size);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const c = idx[i], key = prefix * 256 + c;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    put(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === (1 << size) && size < 12) size++;
    } else {
      put(clear, size);
      dict = new Map(); size = minCode + 1; next = eoi + 1;
    }
    prefix = c;
  }
  put(prefix, size);
  put(eoi, size);
  if (nbits > 0) bytes.push(cur & 255);
  return bytes;
}

// Turn a short video file into a GIF blob. Samples up to maxFrames frames from
// the first maxSeconds, scaled so the long side is maxSide.
async function videoToGif(file, opts) {
  const o = Object.assign({ maxSide: 200, maxFrames: 12, maxSeconds: 4, colors: 64 }, opts || {});
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => {
      v.onloadeddata = res;
      v.onerror = () => rej(new Error('this video format cannot be read by the browser'));
    });
    const dur = Math.min(v.duration && isFinite(v.duration) ? v.duration : 1, o.maxSeconds);
    const k = Math.min(1, o.maxSide / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(2, Math.round(v.videoWidth * k)), h = Math.max(2, Math.round(v.videoHeight * k));
    const n = Math.max(2, Math.min(o.maxFrames, Math.round(dur * 3)));   // a few frames is plenty: it only steps with scroll
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    const frames = [];
    for (let i = 0; i < n; i++) {
      v.currentTime = Math.min(dur * i / n, Math.max(0, v.duration - 0.05) || 0);
      await new Promise((res) => { v.onseeked = res; setTimeout(res, 1500); });
      x.drawImage(v, 0, 0, w, h);
      frames.push({ data: x.getImageData(0, 0, w, h).data, w, h });
    }
    const delay = Math.max(2, Math.round(dur / n * 100));
    return new Blob([encodeGif(frames, delay, o.colors)], { type: 'image/gif' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

if (typeof module !== 'undefined') module.exports = { encodeGif, lzwEncode };
