function runViewer(slug) {
  const canvas = document.getElementById('canvas');
  const statusEl = document.getElementById('status');
  const hintEl = document.getElementById('hint');

  function say(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = isError ? 'error' : '';
  }

  const engine = CollageEngine(canvas, { scroller: document.getElementById('scroller') });
  engine.onFirstInteract(() => hintEl.classList.add('gone'));
  engine.start();

  // ---- the two places the layers can come from ----
  async function fromSupabase(collage) {
    const rows = await Backend.listLayers(collage.id, true);
    return {
      settings: { depthScale: collage.depth_scale, speed: collage.speed, density: collage.density, tiltSensitivity: collage.tilt_sensitivity },
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

  say('Loading...');
  const problems = [];   // things that went wrong (shown in red)
  let info = '';         // things that are merely worth knowing
  let result = null;
  let source = 'static';
  let collage = null;

  (async () => {
    try {
      if (Backend.problem) {
        problems.push(Backend.problem);
      } else if (Backend.configured) {
        try {
          collage = await Backend.getCollageBySlug(slug);
          if (!collage) {
            problems.push('No collage found for "' + slug + '".');
          } else {
            const r = await load(() => fromSupabase(collage));
            if (r.layers.length === 0 && r.total > 0) problems.push('Images failed to load:\n' + r.failures.join('\n'));
            else { result = r; source = collage.title || slug; }
          }
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
        say('Loaded ' + result.layers.length + ' layers - ' + source);
        setTimeout(() => statusEl.classList.add('gone'), 2500);
      }
    } catch (e) {
      problems.push('Error: ' + (e && e.message ? e.message : e));
      say(problems.join('\n'), true);
    }

    const galleryLink = document.getElementById('galleryLink');
    if (galleryLink && Backend.configured) {
      galleryLink.href = location.pathname;
      galleryLink.classList.remove('gone');
    }

    const hasEditAccess = !!getRememberedEditToken(slug);
    if (typeof initEditor === 'function' && collage) initEditor(engine, collage, hasEditAccess);
    setupShare(collage, hasEditAccess);
  })();

  // ---- share button: read-only link always, collaborate link only if this
  // browser already has edit access (otherwise we don't have the token) ----
  function setupShare(collage, hasEditAccess) {
    const btn = document.getElementById('shareBtn');
    if (!btn || !collage) return;
    btn.classList.remove('gone');

    function linkFor(withEdit) {
      const u = new URL(location.href);
      u.search = '';
      u.searchParams.set('c', slug);
      if (withEdit) u.searchParams.set('edit', getRememberedEditToken(slug));
      return u.toString();
    }

    async function copy(text, label) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
        else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
        say(label + ' copied to clipboard'); setTimeout(() => statusEl.classList.add('gone'), 2000);
        statusEl.classList.remove('gone');
      } catch (e) { say('Could not copy: ' + e.message, true); }
    }

    const menu = document.getElementById('shareMenu');
    btn.addEventListener('click', () => menu.classList.toggle('hidden'));
    document.getElementById('shareReadOnly').addEventListener('click', () => { menu.classList.add('hidden'); copy(linkFor(false), 'Read-only link'); });
    const collabBtn = document.getElementById('shareCollab');
    if (hasEditAccess) {
      collabBtn.classList.remove('gone');
      collabBtn.addEventListener('click', () => { menu.classList.add('hidden'); copy(linkFor(true), 'Collaborate link'); });
    }
  }

  const versionEl = document.getElementById('version');
  if (versionEl) {
    setInterval(() => {
      const r = canvas.getBoundingClientRect();
      const vv = window.visualViewport;
      versionEl.textContent = 'v9 - canvas ' + Math.round(r.width) + '\u00d7' + Math.round(r.height)
        + ' - screen ' + window.screen.width + '\u00d7' + window.screen.height
        + ' - inner ' + window.innerWidth + '\u00d7' + window.innerHeight
        + (vv ? ' - vv ' + Math.round(vv.width) + '\u00d7' + Math.round(vv.height) : '');
    }, 500);
  }

  const tiltBtn = document.getElementById('tiltBtn');
  if ('ontouchstart' in window && engine.tiltSupported) {
    tiltBtn.classList.remove('gone');
    tiltBtn.addEventListener('click', async () => {
      if (engine.isTiltEnabled()) {
        engine.disableTilt();
        tiltBtn.textContent = 'Enable tilt';
        tiltBtn.classList.remove('on');
      } else {
        const ok = await engine.enableTilt();
        if (ok) { tiltBtn.textContent = 'Tilt on'; tiltBtn.classList.add('on'); }
        else say('Tilt permission denied -- check Settings -> Safari -> Motion & Orientation Access.', true);
      }
    });
  }
}
