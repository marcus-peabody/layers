(async function () {
  const canvas = document.getElementById('canvas');
  const statusEl = document.getElementById('status');
  const hintEl = document.getElementById('hint');

  function say(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = isError ? 'error' : '';
  }

  const engine = CollageEngine(canvas);
  engine.onFirstInteract(() => hintEl.classList.add('gone'));
  engine.start();

  // ---- the two places the layers can come from ----
  async function fromSupabase() {
    const [s, rows] = await Promise.all([Backend.getSettings(), Backend.listLayers(true)]);
    return {
      settings: s ? { depthScale: s.depth_scale, speed: s.speed, density: s.density, tiltSensitivity: s.tilt_sensitivity } : {},
      defs: rows.map((r) => ({
        url: Backend.publicUrl(r.storage_path),
        depth: r.depth,
        scale: r.scale,
        seed: layerSeed(r.id)
      }))
    };
  }

  async function fromManifest() {
    const res = await fetch('manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest.json: HTTP ' + res.status);
    const m = await res.json();
    return {
      settings: Object.assign({ tiltSensitivity: 0.5 }, m.settings || {}),
      defs: (m.layers || []).map((d, i) => ({
        url: d.file,
        depth: d.depth,
        scale: d.scale,
        opacity: d.opacity,
        seed: i + 1
      }))
    };
  }

  // Fetch a source, then load every image in it.
  async function load(source) {
    const { settings, defs } = await source();
    const results = await Promise.allSettled(defs.map((d) => loadImage(d.url)));
    const layers = [];
    const failures = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        layers.push({
          img: r.value,
          depth: defs[i].depth ?? 1,
          scale: defs[i].scale ?? 1,
          opacity: defs[i].opacity ?? 1,
          seed: defs[i].seed
        });
      } else {
        failures.push(r.reason.message);
      }
    });
    return { settings, layers, failures, total: defs.length };
  }

  say('Loading…');
  const problems = [];   // things that went wrong (shown in red)
  let info = '';         // things that are merely worth knowing
  let result = null;
  let source = 'static';

  try {
    if (Backend.problem) {
      problems.push(Backend.problem);
    } else if (Backend.configured) {
      try {
        const r = await load(fromSupabase);
        if (r.total === 0) info = 'no layers in Supabase yet, showing the static set';
        else if (r.layers.length === 0) problems.push('Supabase images failed to load:\n' + r.failures.join('\n'));
        else { result = r; source = 'supabase'; }
      } catch (e) {
        problems.push('Supabase: ' + e.message);
      }
    }
    if (!result) result = await load(fromManifest);

    engine.setSettings(result.settings);
    engine.setLayers(result.layers);

    if (result.failures.length) {
      problems.push(result.layers.length + ' of ' + result.total + ' layers loaded:\n' + result.failures.join('\n'));
    }
    if (problems.length) {
      say(problems.join('\n'), true);
    } else {
      say('Loaded ' + result.layers.length + ' layers · ' + source + (info ? ' · ' + info : ''));
      setTimeout(() => statusEl.classList.add('gone'), 2500);
    }
  } catch (e) {
    problems.push('Error: ' + (e && e.message ? e.message : e));
    say(problems.join('\n'), true);
  }

  const versionEl = document.getElementById('version');
  if (versionEl) {
    setInterval(() => {
      const r = canvas.getBoundingClientRect();
      const vv = window.visualViewport;
      versionEl.textContent = 'v6 · canvas ' + Math.round(r.width) + '\u00d7' + Math.round(r.height)
        + ' · screen ' + window.screen.width + '\u00d7' + window.screen.height
        + ' · inner ' + window.innerWidth + '\u00d7' + window.innerHeight
        + (vv ? ' · vv ' + Math.round(vv.width) + '\u00d7' + Math.round(vv.height) : '');
    }, 500);
  }

  const tiltBtn = document.getElementById('tiltBtn');  if ('ontouchstart' in window && engine.tiltSupported) {
    tiltBtn.classList.remove('gone');
    tiltBtn.addEventListener('click', async () => {
      if (engine.isTiltEnabled()) {
        engine.disableTilt();
        tiltBtn.textContent = 'Enable tilt';
        tiltBtn.classList.remove('on');
      } else {
        const ok = await engine.enableTilt();
        if (ok) { tiltBtn.textContent = 'Tilt on'; tiltBtn.classList.add('on'); }
        else say('Tilt permission denied \u2014 check Settings \u2192 Safari \u2192 Motion & Orientation Access.', true);
      }
    });
  }
})();
