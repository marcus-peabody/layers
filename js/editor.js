// In-situ editor: operates on the SAME CollageEngine instance the viewer is
// already rendering, so edits apply directly to the live, public collage --
// there's no separate preview to keep in sync. Call initEditor(engine,
// collage, hasEditAccess) once, after the viewer has loaded that collage.
// Does nothing if Supabase isn't configured, there's no specific collage
// loaded (e.g. the static fallback), or this browser doesn't have edit
// access to it (no remembered/valid ?edit= token) -- it returns null in all
// of those cases and the dock simply has no edit button. Otherwise it returns
// { open, close, isOpen } for the dock to drive.
function initEditor(engine, collage, hasEditAccess) {
  if (Backend.problem || !Backend.configured || !collage || !hasEditAccess) return null;

  const $ = (id) => document.getElementById(id);
  const panel = $('panel');
  const msgEl = $('msg');
  const listEl = $('list');

  let items = [];   // [{ row, img, layer, failed }] in draw order (last = in front)
  // The collage row already carries its own settings -- no extra fetch needed.
  let settings = Object.assign({ tilt_sensitivity: 0.15 }, collage);
  let editing = false;
  let loaded = false;
  let dirty = false;   // something changed since the gallery cover was last captured

  // ---------- small helpers ----------
  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const kid of kids) node.append(kid);
    return node;
  }

  const fmt = (v) => Number(v).toFixed(2);
  const uuid = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  let flashTimer = null;
  function say(text, kind) {
    msgEl.textContent = text || '';
    msgEl.className = kind || '';
    msgEl.style.display = text ? 'block' : 'none';
  }
  function flashSaved() {
    say('Saved', 'ok');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if (msgEl.textContent === 'Saved') say(''); }, 1200);
  }
  async function save(fn) {
    try { await fn(); dirty = true; markVisited(collage.slug); flashSaved(); }
    catch (e) { say('Not saved -- ' + e.message, 'error'); }
  }

  // Every slider shows a plain 1-10 scale; the real value it controls (and what
  // is saved) is mapped linearly from min..max, so behaviour is unchanged.
  function slider(label, min, max, step, value, onInput, onChange) {
    const toScale = (v) => Math.max(1, Math.min(10, 1 + 9 * (v - min) / (max - min)));
    const toValue = (x) => +(min + (x - 1) / 9 * (max - min)).toFixed(4);
    const out = el('span', { class: 'val' }, toScale(value).toFixed(1));
    const input = el('input', { type: 'range', min: 1, max: 10, step: 0.1 });
    input.value = String(toScale(value));
    input.addEventListener('input', () => { const x = parseFloat(input.value); out.textContent = x.toFixed(1); onInput(toValue(x)); });
    input.addEventListener('change', () => onChange(toValue(parseFloat(input.value))));
    return el('label', { class: 'slider' }, el('span', { class: 'lab' }, label, out), input);
  }

  // ---------- layers ----------
  async function makeItem(row) {
    const item = { row, img: null, failed: false };
    let frames = null;
    try {
      const a = await loadLayerAsset(Backend.publicUrl(row.storage_path));
      item.img = a.img; frames = a.frames || null;
    } catch (e) { item.failed = true; }
    item.layer = { img: item.img, frames, depth: row.depth, scale: row.scale, opacity: 1, seed: layerSeed(row.id) };
    return item;
  }

  // Front layers move fastest, so depth must rise along the stack. Reassigns
  // the existing depth values (and sort order) to match the current order and
  // returns the items that changed so the caller can save them.
  function restack() {
    const depths = depthsInStackOrder(items.map((i) => i.row.depth));
    const changed = [];
    items.forEach((it, k) => {
      let c = false;
      if (it.row.depth !== depths[k]) { it.row.depth = depths[k]; it.layer.depth = depths[k]; c = true; }
      if (it.row.sort_order !== k) { it.row.sort_order = k; c = true; }
      if (c) changed.push(it);
    });
    return changed;
  }
  const saveStack = (changed) => save(() => Promise.all(changed.map((it) =>
    Backend.updateLayer(it.row.id, { depth: it.row.depth, sort_order: it.row.sort_order }))));

  // While editing, hidden layers still show (dimmed) so you can see what
  // you're toggling. Closed, it's exactly what a visitor sees: active only.
  function refreshPreview() {
    const visible = items.filter((i) => i.img);
    if (editing) {
      engine.setLayers(visible.map((i) => Object.assign({}, i.layer, { opacity: i.row.active ? 1 : 0.15 })));
    } else {
      engine.setLayers(visible.filter((i) => i.row.active).map((i) => i.layer));
    }
  }

  // Move a layer toward the front (dir = +1) or the back (dir = -1).
  function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j], items[idx]];
    const changed = restack();
    renderList();
    refreshPreview();
    saveStack(changed);
  }

  async function remove(item) {
    if (!window.confirm('Delete "' + item.row.name + '"?')) return;
    try {
      await Backend.deleteLayer(item.row.id);
    } catch (e) {
      say('Not deleted -- ' + e.message, 'error');
      return;
    }
    Backend.deleteFile(item.row.storage_path).catch(() => { /* the row is gone; a leftover file is harmless */ });
    items = items.filter((i) => i !== item);
    dirty = true;
    renderList();
    refreshPreview();
    flashSaved();
  }

  // Small drawn icons for the layer buttons (up/down chevrons, symmetric X).
  function icon(kind) {
    const paths = { up: '<polyline points="6 15 12 9 18 15"></polyline>', down: '<polyline points="6 9 12 15 18 9"></polyline>',
      x: '<line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line>' };
    const span = document.createElement('span');
    span.className = 'ico';
    span.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + paths[kind] + '</svg>';
    return span;
  }

  function rowEl(item, idx) {
    const row = item.row;
    const on = el('input', { type: 'checkbox' });
    on.checked = !!row.active;
    on.addEventListener('change', () => {
      row.active = on.checked;
      renderList();
      refreshPreview();
      save(() => Backend.updateLayer(row.id, { active: row.active }));
    });

    const atFront = idx === items.length - 1;
    const atBack = idx === 0;

    return el('div', { class: 'item' + (row.active ? '' : ' off') },
      el('img', { class: 'thumb', src: Backend.publicUrl(row.storage_path), alt: '' }),
      el('div', { class: 'body' },
        el('div', { class: 'top' },
          el('span', { class: 'name' }, row.name + (item.failed ? ' (image failed to load)' : '')),
          el('label', { class: 'onoff' }, on, ' show')),
        slider('Size', 0.2, 4, 0.05, row.scale,
          (v) => { row.scale = v; item.layer.scale = v; refreshPreview(); },
          (v) => save(() => Backend.updateLayer(row.id, { scale: v })))),
      el('div', { class: 'btns' },
        el('button', { class: 'btn', type: 'button', title: 'Bring forward', 'aria-label': 'Bring forward', ...(atFront ? { disabled: '' } : {}), onclick: () => move(idx, +1) }, icon('up')),
        el('button', { class: 'btn', type: 'button', title: 'Send back', 'aria-label': 'Send back', ...(atBack ? { disabled: '' } : {}), onclick: () => move(idx, -1) }, icon('down')),
        el('button', { class: 'btn del', type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: () => remove(item) }, icon('x'))));
  }

  // The list shows the front-most layer first, like most design tools.
  function renderList() {
    listEl.textContent = '';
    if (!items.length) {
      listEl.append(el('p', { class: 'muted' }, 'No layers yet -- add some PNGs above.'));
      return;
    }
    for (let idx = items.length - 1; idx >= 0; idx--) listEl.append(rowEl(items[idx], idx));
  }

  // ---------- uploading ----------
  // Big images make the viewer slow on phones, so shrink anything over maxSide.
  // GIFs are left untouched -- redrawing one to canvas keeps only a single frame,
  // which would silently kill the animation.
  async function fitForWeb(file, maxSide) {
    if (file.type === 'image/gif') return file;
    try {
      const url = URL.createObjectURL(file);
      let img;
      try { img = await loadImage(url); } finally { URL.revokeObjectURL(url); }
      const long = Math.max(img.naturalWidth, img.naturalHeight);
      const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      if (long <= maxSide && file.type === outType) return file;
      const k = Math.min(1, maxSide / long);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, outType, 0.87));
      return blob || file;
    } catch (e) {
      return file;
    }
  }

  const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif' };

  async function addOne(file) {
    let blob;
    if (file.type.startsWith('video/')) {
      blob = await videoToGif(file);   // short clips become GIFs that step with scroll
      file = { name: file.name.replace(/\.[^.]+$/, '') + '.gif' };
    } else {
      blob = await fitForWeb(file, 1200);
    }
    const path = collage.id + '/' + uuid() + (EXT[blob.type] || '.png');
    await Backend.uploadFile(path, blob);
    let row;
    try {
      row = await Backend.insertLayer({
        collage_id: collage.id,
        name: file.name,
        storage_path: path,
        depth: +Math.min(2.5, (items.length ? Math.max(...items.map((i) => i.row.depth)) : 0.3) + 0.2).toFixed(2),
        scale: 2.5,
        active: true,
        sort_order: items.length ? Math.max(...items.map((i) => i.row.sort_order)) + 1 : 0
      });
    } catch (e) {
      Backend.deleteFile(path).catch(() => {});   // don't leave an orphan file behind
      throw e;
    }
    items.push(await makeItem(row));
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList);
    const images = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    const skipped = files.length - images.length;
    let added = 0;
    const errors = [];
    for (let k = 0; k < images.length; k++) {
      say((images[k].type.startsWith('video/') ? 'Converting video ' : 'Uploading ') + (k + 1) + ' of ' + images.length + '...');
      try { await addOne(images[k]); added++; }
      catch (e) { errors.push(images[k].name + ' -- ' + e.message); }
    }
    if (added) dirty = true;   // the gallery picture needs redoing when the editor closes
    renderList();
    refreshPreview();
    const notes = [];
    if (added) notes.push('Added ' + added + ' layer' + (added === 1 ? '' : 's') + '.');
    if (skipped) notes.push(skipped + ' non-image file' + (skipped === 1 ? '' : 's') + ' skipped.');
    notes.push(...errors);
    say(notes.join('\n'), errors.length || skipped ? 'error' : 'ok');
  }

  const drop = $('drop');
  const fileInput = $('file');
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  // Paste zone for iPhone sticker cutouts: a real <input> with the instruction
  // as placeholder text, not actual content -- placeholder text is never
  // selectable, which is what made the old contenteditable version annoying.
  const pasteZone = $('pasteZone');
  const pastePlaceholder = pasteZone.placeholder;
  pasteZone.addEventListener('paste', (e) => {
    e.preventDefault();
    const clipItems = (e.clipboardData && e.clipboardData.items) || [];
    const files = [];
    for (const it of clipItems) {
      if (it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    pasteZone.value = '';
    pasteZone.placeholder = files.length ? 'Added -- paste another' : 'No image found in the clipboard';
    setTimeout(() => { pasteZone.placeholder = pastePlaceholder; }, 2000);
    if (files.length) addFiles(files);
  });
  // Covers the rare case where something lands as typed/dropped text in the
  // input rather than a proper paste event (clears it so it can't linger).
  pasteZone.addEventListener('input', () => { pasteZone.value = ''; });

  // ---------- name ----------
  const titleInput = $('titleInput');
  titleInput.value = collage.title || '';
  titleInput.addEventListener('change', () => {
    const title = titleInput.value.trim() || 'Untitled';
    titleInput.value = title;
    if (title === collage.title) return;
    collage.title = title;
    save(() => Backend.updateCollage(collage.id, { title })).then(syncSlug);
  });

  // The web address follows the title ("Squamish" -> ?c=squamish). Old
  // addresses stop working; this device keeps its edit access and visit record.
  async function syncSlug() {
    if (slugMatches(collage.slug, collage.title)) return;
    const old = collage.slug;
    try {
      const next = await Backend.uniqueSlug(collage.title, collage.id);
      if (next === old) return;
      await Backend.updateCollage(collage.id, { slug: next });
      const tok = getRememberedEditToken(old);
      if (tok) rememberEditToken(next, tok);
      forgetEditToken(old);
      const seen = getVisited(old);
      if (seen) { try { localStorage.setItem('visited:' + next, String(seen)); } catch (e) { /* ignore */ } }
      collage.slug = next;
      try {
        const u = new URL(location.href);
        u.searchParams.set('c', next);
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) { /* address bar just keeps the old text */ }
    } catch (e) { /* keep the old address; the title is saved regardless */ }
  }
  syncSlug();

  // ---------- scene settings ----------
  function buildScene() {
    const apply = () => engine.setSettings({ depthScale: settings.depth_scale, speed: settings.speed, density: settings.density, tiltSensitivity: settings.tilt_sensitivity ?? 0.15, rotation: settings.rotation ?? 15 });
    const persist = () => save(() => {
      const patch = { depth_scale: settings.depth_scale, speed: settings.speed, density: settings.density, tilt_sensitivity: settings.tilt_sensitivity };
      if ('rotation' in collage) patch.rotation = settings.rotation;   // only once the column exists (see SUPABASE-SETUP.md)
      return Backend.updateCollage(collage.id, patch);
    });
    const scene = $('scene');
    scene.textContent = '';
    scene.append(
      slider('Apparent depth', 0.1, 2.5, 0.05, settings.depth_scale, (v) => { settings.depth_scale = v; apply(); }, persist),
      slider('Scroll speed', 0.2, 3, 0.1, settings.speed, (v) => { settings.speed = v; apply(); }, persist),
      slider('Density', 0.5, 3, 0.1, settings.density, (v) => { settings.density = v; apply(); }, persist),
      slider('Rotation (degrees)', 0, 30, 1, settings.rotation ?? 15, (v) => { settings.rotation = v; apply(); }, persist),
      slider('Tilt sensitivity', 0, 0.3, 0.01, Math.min(0.3, settings.tilt_sensitivity ?? 0.15), (v) => { settings.tilt_sensitivity = v; apply(); }, persist));
    apply();
  }

  // ---------- open / close ----------
  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    say('Loading...');
    try {
      buildScene();
      const rows = await Backend.listLayers(collage.id, false);
      items = await Promise.all(rows.map(makeItem));
      const changed = restack();   // old collages may have depths that ignore stacking
      if (changed.length) saveStack(changed);
      renderList();
      const failed = items.filter((i) => i.failed).length;
      say(failed ? failed + ' image(s) could not be loaded.' : '');
    } catch (e) {
      say('Could not load -- ' + e.message, 'error');
    }
  }

  // The gallery picture: exactly what a 430x932 screen shows when the collage
  // first opens (no pan, no tilt), captured at 2x so the zoom from the gallery
  // lands on the same pixels the live view draws. Taken only when the editor is
  // closed (hidden layers really hidden) and only when something changed.
  const VIEW_W = 430, VIEW_H = 932;
  async function updateCover() {
    if (editing) { dirty = true; return; }      // hidden layers would show dimmed: wait for close
    if (!engine.layerCount()) return;           // nothing to picture yet
    dirty = false;
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const shot = engine.capture(VIEW_W, VIEW_H, 2);
      const c = document.createElement('canvas');
      c.width = shot.width; c.height = shot.height;
      const x = c.getContext('2d');
      x.fillStyle = '#0e0e10';
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(shot, 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
      if (blob) await Backend.uploadFile(collage.id + '/view.jpg', blob, true);
    } catch (e) { /* tainted canvas or network: the gallery just shows a placeholder */ }
  }

  // Whenever the owner opens the collage, refresh its gallery picture a few
  // seconds in. Cheap, and it repairs a missing or out-of-date one by itself.
  setTimeout(updateCover, 4000);

  async function open() {
    panel.classList.remove('hidden');
    await ensureLoaded();
    editing = true;
    refreshPreview();
  }
  function close() {
    panel.classList.add('hidden');
    editing = false;
    refreshPreview();
    if (dirty) updateCover();
  }

  return { open, close, isOpen: () => !panel.classList.contains('hidden') };
}
