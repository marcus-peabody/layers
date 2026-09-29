(async function () {
  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const msgEl = $('msg');
  const listEl = $('list');

  // The live preview only exists on wide screens (the canvas is hidden on phones).
  const engine = CollageEngine(canvas);
  if (!window.matchMedia || window.matchMedia('(min-width: 900px)').matches) engine.start();

  let items = [];   // [{ row, img, layer, failed }] in draw order (last = in front)
  let settings = { depth_scale: 1, speed: 1, density: 1.2, tilt_sensitivity: 1 };

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
    try { await fn(); flashSaved(); }
    catch (e) { say('Not saved — ' + e.message, 'error'); }
  }

  function slider(label, min, max, step, value, onInput, onChange) {
    const out = el('span', { class: 'val' }, fmt(value));
    const input = el('input', { type: 'range', min, max, step });
    input.value = String(value);
    input.addEventListener('input', () => { const v = parseFloat(input.value); out.textContent = fmt(v); onInput(v); });
    input.addEventListener('change', () => onChange(parseFloat(input.value)));
    return el('label', { class: 'slider' }, el('span', { class: 'lab' }, label, out), input);
  }

  // ---------- layers ----------
  async function makeItem(row) {
    const item = { row, img: null, failed: false };
    try { item.img = await loadImage(Backend.publicUrl(row.storage_path)); }
    catch (e) { item.failed = true; }
    item.layer = { img: item.img, depth: row.depth, scale: row.scale, opacity: 1, seed: layerSeed(row.id) };
    return item;
  }

  function refreshPreview() {
    engine.setLayers(items.filter((i) => i.img && i.row.active).map((i) => i.layer));
  }

  // Move a layer toward the front (dir = +1) or the back (dir = -1).
  function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j], items[idx]];
    const changed = [];
    items.forEach((it, k) => {
      if (it.row.sort_order !== k) { it.row.sort_order = k; changed.push(it); }
    });
    renderList();
    refreshPreview();
    save(() => Promise.all(changed.map((it) => Backend.updateLayer(it.row.id, { sort_order: it.row.sort_order }))));
  }

  async function remove(item) {
    if (!window.confirm('Delete "' + item.row.name + '"?')) return;
    try {
      await Backend.deleteLayer(item.row.id);
    } catch (e) {
      say('Not deleted — ' + e.message, 'error');
      return;
    }
    Backend.deleteFile(item.row.storage_path).catch(() => { /* the row is gone; a leftover file is harmless */ });
    items = items.filter((i) => i !== item);
    renderList();
    refreshPreview();
    flashSaved();
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
          (v) => { row.scale = v; item.layer.scale = v; },
          (v) => save(() => Backend.updateLayer(row.id, { scale: v }))),
        slider('Depth', 0.1, 2.5, 0.05, row.depth,
          (v) => { row.depth = v; item.layer.depth = v; },
          (v) => save(() => Backend.updateLayer(row.id, { depth: v })))),
      el('div', { class: 'btns' },
        el('button', { class: 'btn', type: 'button', title: 'Bring forward', 'aria-label': 'Bring forward', ...(atFront ? { disabled: '' } : {}), onclick: () => move(idx, +1) }, '▲'),
        el('button', { class: 'btn', type: 'button', title: 'Send back', 'aria-label': 'Send back', ...(atBack ? { disabled: '' } : {}), onclick: () => move(idx, -1) }, '▼'),
        el('button', { class: 'btn del', type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: () => remove(item) }, '✕')));
  }

  // The list shows the front-most layer first, like most design tools.
  function renderList() {
    listEl.textContent = '';
    if (!items.length) {
      listEl.append(el('p', { class: 'muted' }, 'No layers yet — add some PNGs above.'));
      return;
    }
    for (let idx = items.length - 1; idx >= 0; idx--) listEl.append(rowEl(items[idx], idx));
  }

  // ---------- uploading ----------
  // Big images make the viewer slow on phones, so shrink anything over maxSide.
  // GIFs are left untouched — redrawing one to canvas keeps only a single frame,
  // which would silently kill the animation.
  async function fitForWeb(file, maxSide) {
    if (file.type === 'image/gif') return file;
    try {
      const url = URL.createObjectURL(file);
      let img;
      try { img = await loadImage(url); } finally { URL.revokeObjectURL(url); }
      const long = Math.max(img.naturalWidth, img.naturalHeight);
      // PNGs may carry transparency; keep them PNG. Everything else (JPEG, HEIC,
      // photos in general) has no alpha channel, so re-encode as JPEG — much
      // smaller than PNG for a photo, at no visible quality cost.
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
    const blob = await fitForWeb(file, 1200);
    const path = uuid() + (EXT[blob.type] || '.png');
    await Backend.uploadFile(path, blob);
    let row;
    try {
      row = await Backend.insertLayer({
        name: file.name,
        storage_path: path,
        depth: +(0.3 + Math.random() * 1.5).toFixed(2),
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
    const images = files.filter((f) => f.type.startsWith('image/'));
    const skipped = files.length - images.length;
    let added = 0;
    const errors = [];
    for (let k = 0; k < images.length; k++) {
      say('Uploading ' + (k + 1) + ' of ' + images.length + '…');
      try { await addOne(images[k]); added++; }
      catch (e) { errors.push(images[k].name + ' — ' + e.message); }
    }
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

  // Paste zone: iOS lets you long-press a photo's subject, "Copy", then paste it
  // anywhere. Needs a focusable/editable element to reliably receive the paste.
  const pasteZone = $('pasteZone');
  const pasteDefault = pasteZone.textContent;
  pasteZone.addEventListener('paste', (e) => {
    e.preventDefault();
    const items2 = (e.clipboardData && e.clipboardData.items) || [];
    const files = [];
    for (const it of items2) {
      if (it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    pasteZone.textContent = files.length ? 'Added \u2014 paste another' : 'No image found in the clipboard';
    setTimeout(() => { pasteZone.textContent = pasteDefault; }, 2000);
    if (files.length) addFiles(files);
  });

  // ---------- scene settings ----------
  function buildScene() {
    const apply = () => engine.setSettings({ depthScale: settings.depth_scale, speed: settings.speed, density: settings.density, tiltSensitivity: settings.tilt_sensitivity ?? 1 });
    const persist = () => save(() => Backend.updateSettings({
      depth_scale: settings.depth_scale, speed: settings.speed, density: settings.density, tilt_sensitivity: settings.tilt_sensitivity
    }));
    const scene = $('scene');
    scene.textContent = '';
    scene.append(
      slider('Apparent depth', 0.1, 2.5, 0.05, settings.depth_scale, (v) => { settings.depth_scale = v; apply(); }, persist),
      slider('Scroll speed', 0.2, 3, 0.1, settings.speed, (v) => { settings.speed = v; apply(); }, persist),
      slider('Density', 0.5, 3, 0.1, settings.density, (v) => { settings.density = v; apply(); }, persist),
      slider('Tilt sensitivity', 0.5, 5, 0.1, settings.tilt_sensitivity ?? 1, (v) => { settings.tilt_sensitivity = v; apply(); }, persist));
    apply();
  }

  $('toggle').addEventListener('click', () => {
    const hidden = $('panel').classList.toggle('hidden');
    $('toggle').textContent = hidden ? 'Show panel' : 'Hide panel';
  });

  // ---------- boot ----------
  if (Backend.problem) { say(Backend.problem, 'error'); return; }
  if (!Backend.configured) {
    say('Supabase isn\u2019t set up yet. Add your project URL and public key to js/config.js.', 'error');
    return;
  }
  say('Loading…');
  try {
    const s = await Backend.getSettings();
    if (s) settings = Object.assign({ tilt_sensitivity: 1 }, s);
    buildScene();
    const rows = await Backend.listLayers(false);
    items = await Promise.all(rows.map(makeItem));
    renderList();
    refreshPreview();
    const failed = items.filter((i) => i.failed).length;
    say(failed ? failed + ' image(s) could not be loaded.' : '', failed ? 'error' : '');
  } catch (e) {
    say('Could not load — ' + e.message, 'error');
  }
})();
