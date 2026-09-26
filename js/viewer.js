(async function(){
  const canvas = document.getElementById('canvas');
  const hint = document.getElementById('hint');
  const status = document.getElementById('status');

  function showStatus(msg){
    status.textContent = msg; status.style.display = 'block';
  }
  showStatus('Loading…');

  let engine;
  try {
    engine = CollageEngine(canvas);
    engine.onFirstInteract(()=>hint.classList.add('gone'));
  } catch (e) {
    showStatus('Engine setup failed: ' + (e && e.message ? e.message : e));
    return;
  }

  let supabase;
  try {
    if (!window.supabase) throw new Error('Supabase library failed to load (check your network / ad blocker).');
    if (SUPABASE_URL.includes('YOUR-PROJECT') || SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
      throw new Error('supabase-config.js still has placeholder values — fill in your real project URL and anon key.');
    }
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    showStatus('Setup error: ' + e.message);
    return;
  }

  async function loadImg(src){
    const resp = await fetch(src);
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' fetching ' + src);
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    return new Promise((res, rej)=>{
      const im = new Image();
      im.onload = ()=>{
        if (!im.naturalWidth) rej(new Error('decoded but has zero size: ' + src));
        else res(im);
      };
      im.onerror = ()=>rej(new Error('failed to decode image: ' + src));
      im.src = objectUrl;
    });
  }

  async function load(){
    try {
      const { data: s, error: sErr } = await supabase.from('settings').select('*').eq('id',1).single();
      if (sErr) { showStatus('Could not load settings: ' + sErr.message); return; }
      engine.setSettings({ depthScale: s.depth_scale, speed: s.speed, density: s.density, tiltSensitivity: s.tilt_sensitivity });

      const { data: rows, error: lErr } = await supabase.from('layers').select('*')
        .eq('active', true).order('sort_order', { ascending: true });
      if (lErr) { showStatus('Could not load layers: ' + lErr.message); return; }
      if (!rows || !rows.length) { showStatus('No active layers found yet — add some from the console.'); return; }

      const layers = [];
      let failCount = 0, lastErr = '';
      for (const r of rows){
        const { data: pub } = supabase.storage.from('layers').getPublicUrl(r.storage_path);
        try {
          const img = await loadImg(pub.publicUrl);
          layers.push({ id: r.id, img, depth: r.depth, scale: r.scale, active: true });
        } catch (e) {
          failCount++; lastErr = e.message;
        }
      }
      if (failCount && !layers.length) showStatus(`All ${failCount} image(s) failed to load.\n${lastErr}`);
      else if (failCount) showStatus(`${failCount} of ${rows.length} image(s) failed to load.\n${lastErr}`);
      else status.style.display = 'none';
      engine.setLayers(layers);
    } catch (e) {
      showStatus('Unexpected error: ' + (e && e.message ? e.message : e));
    }
  }

  await load();
  engine.start();

  const tiltBtn = document.getElementById('tiltBtn');
  if ('ontouchstart' in window && engine.tiltSupported){
    tiltBtn.style.display = 'block';
    tiltBtn.onclick = async ()=>{
      if (engine.isTiltEnabled()){
        engine.disableTilt(); tiltBtn.textContent = 'Enable tilt'; tiltBtn.classList.remove('on');
      } else {
        const ok = await engine.enableTilt();
        if (ok){ tiltBtn.textContent = 'Tilt on'; tiltBtn.classList.add('on'); }
        else { showStatus('Tilt permission was denied — check Settings > Safari > Motion & Orientation Access.'); }
      }
    };
  }
})();
