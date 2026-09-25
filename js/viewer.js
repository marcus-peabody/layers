(async function(){
  const canvas = document.getElementById('canvas');
  const hint = document.getElementById('hint');
  const status = document.getElementById('status');
  const engine = CollageEngine(canvas);
  engine.onFirstInteract(()=>hint.classList.add('gone'));

  function showStatus(msg){
    status.textContent = msg; status.style.display = 'block';
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
    return new Promise((res, rej)=>{
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = ()=>res(im);
      im.onerror = ()=>rej(new Error('image failed to load: ' + src));
      im.src = src;
    });
  }

  async function load(){
    const { data: s, error: sErr } = await supabase.from('settings').select('*').eq('id',1).single();
    if (sErr) { showStatus('Could not load settings: ' + sErr.message); return; }
    engine.setSettings({ depthScale: s.depth_scale, speed: s.speed, density: s.density });

    const { data: rows, error: lErr } = await supabase.from('layers').select('*')
      .eq('active', true).order('sort_order', { ascending: true });
    if (lErr) { showStatus('Could not load layers: ' + lErr.message); return; }
    if (!rows || !rows.length) { showStatus('No active layers found yet — add some from the console.'); return; }

    const layers = [];
    for (const r of rows){
      const { data: pub } = supabase.storage.from('layers').getPublicUrl(r.storage_path);
      try {
        const img = await loadImg(pub.publicUrl);
        layers.push({ id: r.id, img, depth: r.depth, scale: r.scale, active: true });
      } catch (e) {
        showStatus('Image failed to load — check the "layers" storage bucket is set to Public.\n' + e.message);
      }
    }
    if (layers.length) status.style.display = 'none';
    engine.setLayers(layers);
  }

  await load();
  engine.start();
})();
