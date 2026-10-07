// Minimal GIF decoder (no dependencies). parseGif() returns every frame fully
// composited as RGBA, so the collage can show a different frame depending on
// how far you have scrolled. decodeGif() turns those into small canvases.

function parseGif(buf) {
  const d = new Uint8Array(buf);
  if (String.fromCharCode(d[0], d[1], d[2]) !== 'GIF') throw new Error('not a GIF');
  const W = d[6] | (d[7] << 8), H = d[8] | (d[9] << 8);
  let p = 13;
  let gct = null;
  if (d[10] & 0x80) { const n = 3 << ((d[10] & 7) + 1); gct = d.subarray(p, p + n); p += n; }

  const canvas = new Uint8ClampedArray(W * H * 4);   // what the viewer would see right now
  const frames = [];
  let gce = { disposal: 0, trans: -1 };
  let prev = null;                                   // { disposal, x, y, w, h, saved }

  function skipBlocks() { while (d[p] !== 0 && p < d.length) p += d[p] + 1; p++; }

  while (p < d.length) {
    const b = d[p++];
    if (b === 0x3b) break;                           // trailer
    if (b === 0x21) {                                // extension
      const label = d[p++];
      if (label === 0xf9) {                          // graphic control: disposal, transparency
        gce = { disposal: (d[p + 1] >> 2) & 7, trans: (d[p + 1] & 1) ? d[p + 4] : -1 };
      }
      skipBlocks();
      continue;
    }
    if (b !== 0x2c) continue;                        // anything else: ignore

    const x = d[p] | (d[p + 1] << 8), y = d[p + 2] | (d[p + 3] << 8);
    const w = d[p + 4] | (d[p + 5] << 8), h = d[p + 6] | (d[p + 7] << 8);
    const flags = d[p + 8];
    p += 9;
    let ct = gct;
    if (flags & 0x80) { const n = 3 << ((flags & 7) + 1); ct = d.subarray(p, p + n); p += n; }
    const minCode = d[p++];
    const chunks = [];
    let total = 0;
    while (d[p] !== 0 && p < d.length) { chunks.push(d.subarray(p + 1, p + 1 + d[p])); total += d[p]; p += d[p] + 1; }
    p++;
    const data = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { data.set(c, o); o += c.length; }
    const idx = lzw(minCode, data, w * h);

    // Undo the previous frame first, as its disposal method asks.
    if (prev && prev.disposal === 2) clearRect(canvas, W, prev);
    else if (prev && prev.disposal === 3 && prev.saved) restoreRect(canvas, W, prev);
    const saved = gce.disposal === 3 ? saveRect(canvas, W, { x, y, w, h }) : null;

    // Interlaced rows are stored in four passes.
    const rowOf = new Array(h);
    if (flags & 0x40) {
      let r = 0;
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let k = start; k < h; k += step) rowOf[r++] = k;
    } else {
      for (let k = 0; k < h; k++) rowOf[k] = k;
    }
    for (let r = 0; r < h; r++) {
      const py = y + rowOf[r];
      if (py >= H) continue;
      for (let c = 0; c < w; c++) {
        const px = x + c;
        if (px >= W) continue;
        const v = idx[r * w + c];
        if (v === gce.trans || !ct) continue;
        const q = (py * W + px) * 4;
        canvas[q] = ct[v * 3]; canvas[q + 1] = ct[v * 3 + 1]; canvas[q + 2] = ct[v * 3 + 2]; canvas[q + 3] = 255;
      }
    }
    frames.push(new Uint8ClampedArray(canvas));
    prev = { disposal: gce.disposal, x, y, w, h, saved };
    gce = { disposal: 0, trans: -1 };
  }
  return { width: W, height: H, frames };
}

function clearRect(buf, W, r) {
  for (let j = 0; j < r.h; j++) buf.fill(0, ((r.y + j) * W + r.x) * 4, ((r.y + j) * W + r.x + r.w) * 4);
}
function saveRect(buf, W, r) {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let j = 0; j < r.h; j++) out.set(buf.subarray(((r.y + j) * W + r.x) * 4, ((r.y + j) * W + r.x + r.w) * 4), j * r.w * 4);
  return out;
}
function restoreRect(buf, W, r) {
  for (let j = 0; j < r.h; j++) buf.set(r.saved.subarray(j * r.w * 4, (j + 1) * r.w * 4), ((r.y + j) * W + r.x) * 4);
}

function lzw(minCode, data, npix) {
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1;
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  const out = new Uint8Array(npix);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let op = 0, ip = 0, bits = 0, nbits = 0, old = -1, first = 0;
  while (op < npix) {
    while (nbits < size) { if (ip >= data.length) return out; bits |= data[ip++] << nbits; nbits += 8; }
    const code = bits & mask;
    bits >>= size; nbits -= size;
    if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; old = -1; continue; }
    if (code === eoi) break;
    if (old === -1) { out[op++] = suffix[code]; old = code; first = code; continue; }
    let cur = code, sp = 0;
    if (code >= next) { stack[sp++] = first; cur = old; }
    while (cur >= clear) { stack[sp++] = suffix[cur]; cur = prefix[cur]; }
    first = suffix[cur];
    stack[sp++] = first;
    if (next < 4096) {
      prefix[next] = old; suffix[next] = first; next++;
      if ((next & mask) === 0 && next < 4096) { size++; mask = (1 << size) - 1; }
    }
    old = code;
    while (sp > 0 && op < npix) out[op++] = stack[--sp];
  }
  return out;
}

// Browser side: frames as small canvases. Big GIFs are shrunk and thinned so a
// phone can hold them (frames are evenly subsampled down to maxFrames).
function decodeGif(buf, maxSide, maxFrames) {
  const g = parseGif(buf);
  const k = Math.min(1, maxSide / Math.max(g.width, g.height));
  const w = Math.max(1, Math.round(g.width * k)), h = Math.max(1, Math.round(g.height * k));
  const full = document.createElement('canvas');
  full.width = g.width; full.height = g.height;
  const fctx = full.getContext('2d');
  const n = Math.min(g.frames.length, maxFrames);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const src = g.frames[Math.floor(i * g.frames.length / n)];
    fctx.putImageData(new ImageData(src, g.width, g.height), 0, 0);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(full, 0, 0, w, h);
    frames.push(c);
  }
  return { frames, width: w, height: h };
}

if (typeof module !== 'undefined') module.exports = { parseGif, lzw };
