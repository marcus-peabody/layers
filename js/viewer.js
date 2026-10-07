function runViewer(slug) {
  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const statusEl = $('status');
  const hintEl = $('hint');

  function say(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = isError ? 'error' : '';
  }

  const engine = CollageEngine(canvas, { scroller: $('scroller') });
  engine.onFirstInteract(() => hintEl.classList.add('gone'));
  engine.start();

  // ---- the two places the layers can come from ----
  async function fromSupabase(collage) {
    const rows = await Backend.listLayers(collage.id, true);
    const depths = depthsInStackOrder(rows.map((r) => r.depth));   // front = fastest
    return {
      settings: { depthScale: collage.depth_scale, speed: collage.speed, density: collage.density, tiltSensitivity: collage.tilt_sensitivity },
      defs: rows.map((r, i) => ({
        url: Backend.publicUrl(r.storage_path),
        depth: depths[i],
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
    const results = await Promise.allSettled(defs.map((d) => loadLayerAsset(d.url)));
    const layers = [];
    const failures = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        layers.push({
          img: r.value.img,
          frames: r.value.frames || null,
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

    const hasEditAccess = !!getRememberedEditToken(slug);
    const editor = (typeof initEditor === 'function' && collage) ? initEditor(engine, collage, hasEditAccess) : null;
    if (collage) {
      markVisited(slug);
      // Also when leaving, so layers added during this visit don't show up as "new".
      window.addEventListener('pagehide', () => markVisited(slug));
    }
    setupDock(collage, hasEditAccess, editor);
    if (editor && window.openEditorOnLoad) $('dEdit').click();   // just created: go straight to the editor
  })();

  // ---- the settings dock: one round button that opens into a pill of actions ----
  function setupDock(collage, hasEditAccess, editor) {
    const dock = $('dock'), toggle = $('dToggle'), menu = $('shareMenu');

    function setOpen(open) {
      dock.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (!open) menu.classList.add('hidden');
      $('version').classList.toggle('show', open);
    }
    function syncToggleLabel() {
      toggle.setAttribute('aria-label', dock.classList.contains('open') || dock.classList.contains('editing') ? 'Close' : 'Settings');
    }

    // The one button on the right: gear -> X. While the editor is open it is
    // the editor's close button, in exactly the same spot.
    toggle.addEventListener('click', () => {
      if (editor && editor.isOpen()) { editor.close(); dock.classList.remove('editing'); }
      else setOpen(!dock.classList.contains('open'));
      syncToggleLabel();
    });

    // all collages
    if (Backend.configured) {
      const all = $('dMenu');
      all.href = location.pathname;
      all.classList.remove('gone');
      all.addEventListener('click', () => markVisited(slug));
    }

    // edit
    if (editor) {
      const btn = $('dEdit');
      btn.classList.remove('gone');
      btn.addEventListener('click', () => {
        setOpen(false);
        dock.classList.add('editing');
        syncToggleLabel();
        editor.open();
      });
    }

    // share: read-only link always, collaborate link only if this browser
    // already has edit access (otherwise we don't have the token)
    if (collage) {
      $('dShare').classList.remove('gone');

      function linkFor(withEdit) {
        const u = new URL(location.href);
        u.search = '';
        u.hash = '';
        u.searchParams.set('c', slug);
        if (withEdit) u.searchParams.set('edit', getRememberedEditToken(slug));
        return u.toString();
      }
      async function copy(text, label) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
          else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
          statusEl.classList.remove('gone');
          say(label + ' copied to clipboard');
          setTimeout(() => statusEl.classList.add('gone'), 2000);
        } catch (e) { say('Could not copy: ' + e.message, true); }
      }

      $('dShare').addEventListener('click', () => menu.classList.toggle('hidden'));
      $('shareReadOnly').addEventListener('click', () => { menu.classList.add('hidden'); copy(linkFor(false), 'Read-only link'); });
      if (hasEditAccess) {
        const collabBtn = $('shareCollab');
        collabBtn.classList.remove('gone');
        collabBtn.addEventListener('click', () => { menu.classList.add('hidden'); copy(linkFor(true), 'Collaborate link'); });
      }
    }

    // tilt (phones only)
    if ('ontouchstart' in window && engine.tiltSupported) {
      const btn = $('dTilt');
      btn.classList.remove('gone');
      btn.addEventListener('click', async () => {
        if (engine.isTiltEnabled()) {
          engine.disableTilt();
          btn.classList.remove('on');
        } else {
          const ok = await engine.enableTilt();
          if (ok) btn.classList.add('on');
          else say('Tilt permission denied -- check Settings -> Safari -> Motion & Orientation Access.', true);
        }
      });
    }
  }

  // Version marker top-right. Add ?debug to the address for live screen sizes.
  const versionEl = $('version');
  const debug = /[?&]debug\b/.test(location.search);
  versionEl.textContent = 'v12';
  if (debug) {
    setInterval(() => {
      const r = canvas.getBoundingClientRect();
      const vv = window.visualViewport;
      versionEl.textContent = 'v12 - canvas ' + Math.round(r.width) + 'x' + Math.round(r.height)
        + ' - screen ' + window.screen.width + 'x' + window.screen.height
        + ' - inner ' + window.innerWidth + 'x' + window.innerHeight
        + (vv ? ' - vv ' + Math.round(vv.width) + 'x' + Math.round(vv.height) : '');
    }, 500);
  }
}
