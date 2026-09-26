(function(){
  const canvas = document.getElementById('canvas');

  let engine;
  try {
    engine = CollageEngine(canvas);
  } catch (e) {
    console.error('Engine setup failed', e);
    engine = { setLayers(){}, setSettings(){}, start(){} };
  }
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let layers = []; // {id, name, storage_path, img, depth, scale, active, sort_order}
  let settings = { depth_scale: 1, speed: 1, density: 1.2 };

  function loadImg(src){
    return fetch(src).then(resp=>{
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ' fetching ' + src);
      return resp.blob();
    }).then(blob=>{
      const objectUrl = URL.createObjectURL(blob);
      return new Promise((res, rej)=>{
        const im = new Image();
        im.onload = ()=>{ if (!im.naturalWidth) rej(new Error('decoded but zero size: ' + src)); else res(im); };
        im.onerror = ()=>rej(new Error('failed to decode: ' + src));
        im.src = objectUrl;
      });
    });
  }
  function publicUrl(path){ return supabase.storage.from('layers').getPublicUrl(path).data.publicUrl; }

  // ---- load everything ----
  async function loadAll(){
    const { data: s } = await supabase.from('settings').select('*').eq('id',1).single();
    if (s){ settings = s; syncSettingsUI(); engine.setSettings({ depthScale: s.depth_scale, speed: s.speed, density: s.density, tiltSensitivity: s.tilt_sensitivity }); }

    const { data: rows } = await supabase.from('layers').select('*').order('sort_order', { ascending: true });
    layers = [];
    for (const r of rows || []){
      try {
        const img = await loadImg(publicUrl(r.storage_path));
        layers.push({ ...r, img });
      } catch (e) {
        console.error('layer image failed to load', r.name, e);
        layers.push({ ...r, img: new Image() });
      }
    }
    engine.setLayers(layers);
    renderLayerList();
  }

  // ---- settings panel ----
  const depthEl = document.getElementById('depthScale'), speedEl = document.getElementById('speed'),
        densEl = document.getElementById('density'), tiltEl = document.getElementById('tiltSensitivity');
  function syncSettingsUI(){
    depthEl.value = settings.depth_scale; speedEl.value = settings.speed; densEl.value = settings.density;
    tiltEl.value = settings.tilt_sensitivity ?? 1;
    document.getElementById('depthVal').textContent = (+settings.depth_scale).toFixed(2);
    document.getElementById('speedVal').textContent = (+settings.speed).toFixed(2);
    document.getElementById('densVal').textContent = (+settings.density).toFixed(2);
    document.getElementById('tiltVal').textContent = (+(settings.tilt_sensitivity ?? 1)).toFixed(2);
  }
  function liveSettings(){
    settings.depth_scale = parseFloat(depthEl.value);
    settings.speed = parseFloat(speedEl.value);
    settings.density = parseFloat(densEl.value);
    settings.tilt_sensitivity = parseFloat(tiltEl.value);
    engine.setSettings({ depthScale: settings.depth_scale, speed: settings.speed, density: settings.density, tiltSensitivity: settings.tilt_sensitivity });
    syncSettingsUI();
  }
  async function saveSettings(){
    await supabase.from('settings').update({
      depth_scale: settings.depth_scale, speed: settings.speed, density: settings.density, tilt_sensitivity: settings.tilt_sensitivity
    }).eq('id', 1);
  }
  [depthEl, speedEl, densEl, tiltEl].forEach(el=>{
    el.addEventListener('input', liveSettings);
    el.addEventListener('change', saveSettings);
  });

  // ---- upload ----
  const drop = document.getElementById('drop'), fileInput = document.getElementById('fileInput');
  drop.onclick = ()=>fileInput.click();
  fileInput.onchange = e=>{ [...e.target.files].forEach(f=>addFile(f)); fileInput.value=''; };
  ['dragover','dragleave','drop'].forEach(ev=>drop.addEventListener(ev, e=>{
    e.preventDefault(); drop.classList.toggle('over', ev==='dragover');
  }));
  drop.addEventListener('drop', e=>{ [...e.dataTransfer.files].forEach(f=>addFile(f)); });

  const pasteZone = document.getElementById('pasteZone');
  const pasteZoneDefault = pasteZone.textContent;
  pasteZone.addEventListener('paste', e=>{
    e.preventDefault();
    const items = (e.clipboardData && e.clipboardData.items) || [];
    let found = false;
    for (const item of items){
      if (item.type && item.type.startsWith('image/')){
        const blob = item.getAsFile();
        if (blob){ addFile(blob, 'pasted-sticker.png'); found = true; }
      }
    }
    pasteZone.textContent = found ? 'Added — paste another' : 'No image found in clipboard';
    setTimeout(()=>{ pasteZone.textContent = pasteZoneDefault; }, 2000);
  });

  async function toPngBlob(file){
    if (file.type === 'image/png') return file;
    let img;
    try {
      img = await createImageBitmap(file);
    } catch (e) {
      img = await new Promise((res, rej)=>{
        const im = new Image();
        im.onload = ()=>res(im); im.onerror = rej;
        im.src = URL.createObjectURL(file);
      });
    }
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return await new Promise(res=>c.toBlob(res, 'image/png'));
  }

  async function addFile(file, displayName){
    if (!file.type || !file.type.startsWith('image/')) return;
    let pngBlob;
    try { pngBlob = await toPngBlob(file); }
    catch (e) { alert('Could not read that image: ' + e.message); return; }
    const path = `${crypto.randomUUID()}.png`;
    const { error: upErr } = await supabase.storage.from('layers').upload(path, pngBlob, { contentType: 'image/png' });
    if (upErr){ alert('Upload failed: ' + upErr.message); return; }
    const rec = {
      name: displayName || file.name || 'pasted-image.png', storage_path: path,
      depth: +(0.15 + Math.random()*1.6).toFixed(2), scale: 1, active: true,
      sort_order: layers.length
    };
    const { data, error } = await supabase.from('layers').insert(rec).select().single();
    if (error){ alert('Save failed: ' + error.message); return; }
    const img = await loadImg(publicUrl(data.storage_path));
    layers.push({ ...data, img });
    engine.setLayers(layers);
    renderLayerList();
  }

  // ---- layer list: active/scale/reorder/delete ----
  let dragSrc = null;
  async function persistOrder(){
    layers.forEach((l, idx)=>{ l.sort_order = idx; });
    engine.setLayers(layers);
    for (const l of layers){
      await supabase.from('layers').update({ sort_order: l.sort_order }).eq('id', l.id);
    }
  }

  function renderLayerList(){
    const el = document.getElementById('layers');
    if (!layers.length){ el.innerHTML = '<div id="empty">Nothing yet — add PNGs above.</div>'; return; }
    el.innerHTML = '';
    layers.forEach(l=>{
      const row = document.createElement('div'); row.className = 'layer';
      row.innerHTML = `<span class="grip" draggable="true">⠿</span>`+
        `<input type="checkbox" ${l.active ? 'checked' : ''}>`+
        `<img src="${publicUrl(l.storage_path)}" alt="">`+
        `<div class="meta"><div class="name">${l.name}</div><input type="range" min="0.2" max="3" step="0.05" value="${l.scale}"></div>`+
        `<button aria-label="Remove">×</button>`;

      const chk = row.querySelector('input[type=checkbox]');
      chk.onchange = async ()=>{
        l.active = chk.checked; engine.setLayers(layers);
        await supabase.from('layers').update({ active: l.active }).eq('id', l.id);
      };
      const range = row.querySelector('input[type=range]');
      range.addEventListener('input', ()=>{ l.scale = parseFloat(range.value); engine.setLayers(layers); });
      range.addEventListener('change', async ()=>{
        await supabase.from('layers').update({ scale: l.scale }).eq('id', l.id);
      });
      row.querySelector('button').onclick = async ()=>{
        await supabase.storage.from('layers').remove([l.storage_path]);
        await supabase.from('layers').delete().eq('id', l.id);
        layers = layers.filter(x=>x!==l); engine.setLayers(layers);
        await persistOrder(); renderLayerList();
      };

      const grip = row.querySelector('.grip');
      grip.addEventListener('dragstart', e=>{ dragSrc = l; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
      grip.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); document.querySelectorAll('.layer.drag-over').forEach(r=>r.classList.remove('drag-over')); });
      row.addEventListener('dragover', e=>{ if (!dragSrc || dragSrc===l) return; e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', ()=>row.classList.remove('drag-over'));
      row.addEventListener('drop', async e=>{
        e.preventDefault(); row.classList.remove('drag-over');
        if (!dragSrc || dragSrc===l) return;
        const from = layers.indexOf(dragSrc), to = layers.indexOf(l);
        layers.splice(from,1); layers.splice(to,0,dragSrc);
        dragSrc = null; await persistOrder(); renderLayerList();
      });
      el.appendChild(row);
    });
  }

  document.getElementById('clearAll').onclick = async ()=>{
    if (!confirm('Remove all layers?')) return;
    for (const l of layers){ await supabase.storage.from('layers').remove([l.storage_path]); await supabase.from('layers').delete().eq('id', l.id); }
    layers = []; engine.setLayers(layers); renderLayerList();
  };

  document.getElementById('toggle').onclick = ()=>document.getElementById('panel').classList.toggle('hidden');

  // ---- boot ----
  (async ()=>{
    try {
      await loadAll();
      engine.start();
    } catch (e) {
      console.error('Startup failed', e);
    }
  })();
})();
