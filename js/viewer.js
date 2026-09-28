(async function () {
  const canvas = document.getElementById('canvas');
  const statusEl = document.getElementById('status');
  const hintEl = document.getElementById('hint');

  function say(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = isError ? 'error' : '';
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => (img.naturalWidth ? resolve(img) : reject(new Error('zero-size image: ' + src)));
      img.onerror = () => reject(new Error('could not load ' + src));
      img.src = src;
    });
  }

  const engine = CollageEngine(canvas);
  engine.onFirstInteract(() => hintEl.classList.add('gone'));
  engine.start();

  say('Loading…');
  try {
    const res = await fetch('manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest.json: HTTP ' + res.status);
    const manifest = await res.json();
    engine.setSettings(manifest.settings || {});

    const defs = manifest.layers || [];
    const results = await Promise.allSettled(defs.map((d) => loadImage(d.file)));

    const layers = [];
    const failures = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        layers.push({
          img: r.value,
          depth: defs[i].depth ?? 1,
          scale: defs[i].scale ?? 1,
          opacity: defs[i].opacity ?? 1,
          seed: i + 1
        });
      } else {
        failures.push(r.reason.message);
      }
    });
    engine.setLayers(layers);

    if (failures.length) {
      say('Loaded ' + layers.length + ' of ' + defs.length + ' layers.\n' + failures.join('\n'), true);
    } else {
      say('Loaded ' + layers.length + ' layers');
      setTimeout(() => statusEl.classList.add('gone'), 2000);
    }
  } catch (e) {
    say('Error: ' + (e && e.message ? e.message : e), true);
  }
})();
