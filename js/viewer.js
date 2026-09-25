(async function(){
  const canvas = document.getElementById('canvas');
  const hint = document.getElementById('hint');
  const engine = CollageEngine(canvas);
  engine.onFirstInteract(()=>hint.classList.add('gone'));
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function loadImg(src){
    return new Promise(res=>{
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = ()=>res(im); im.onerror = ()=>res(im);
      im.src = src;
    });
  }

  async function load(){
    const { data: s } = await supabase.from('settings').select('*').eq('id',1).single();
    if (s) engine.setSettings({ depthScale: s.depth_scale, speed: s.speed, density: s.density });

    const { data: rows } = await supabase.from('layers').select('*')
      .eq('active', true).order('sort_order', { ascending: true });

    const layers = [];
    for (const r of rows || []){
      const { data: pub } = supabase.storage.from('layers').getPublicUrl(r.storage_path);
      const img = await loadImg(pub.publicUrl);
      layers.push({ id: r.id, img, depth: r.depth, scale: r.scale, active: true });
    }
    engine.setLayers(layers);
  }

  await load();
  engine.start();
})();
