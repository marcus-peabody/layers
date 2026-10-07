// Shown at the bare site URL (no ?c=). Lists every collage; if Supabase
// isn't configured at all, there's no gallery to show, so it just falls
// straight into the static single-collage viewer instead.
function runGallery() {
  const $ = (id) => document.getElementById(id);
  const listEl = $('galleryList');
  const msgEl = $('galleryMsg');

  function say(text, kind) {
    msgEl.textContent = text || '';
    msgEl.className = kind || '';
  }

  function randomSlug() {
    return Math.random().toString(36).slice(2, 10);
  }
  function randomToken() {
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  // One 4:5 tile per collage: its cover image, then its name. A red dot before
  // the name means layers were added since this device last opened it.
  // The picture is a 430x932 (CSS px) shot of the collage's first screen. The
  // overlay is a clip box holding that picture at natural size; box and picture
  // animate together, so it reads as a camera moving from the tile into the live
  // view. The viewer's veil shows the same picture at the end transform.
  const VIEW_W = 430, VIEW_H = 932;
  function endTransform() {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw <= VIEW_W && vh <= VIEW_H) return { scale: 1, tx: 0, ty: 0 };
    const k = Math.max(vw / VIEW_W, vh / VIEW_H);
    return { scale: k, tx: (vw - VIEW_W * k) / 2, ty: (vh - VIEW_H * k) / 2 };
  }
  function zoomInto(coverEl, src, slug, link) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const end = endTransform();
    try { sessionStorage.setItem('zoomCover', JSON.stringify({ slug, src, scale: end.scale, tx: end.tx, ty: end.ty, t: Date.now() })); } catch (e) { /* no handoff */ }
    if (reduce) { location.href = link; return; }
    const r = coverEl.getBoundingClientRect();
    const z = document.createElement('div');
    z.className = 'zoom';
    Object.assign(z.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    let hero = null, s0 = 1, x0 = 0, y0 = 0;
    if (src) {
      hero = document.createElement('img');
      hero.alt = '';
      hero.src = src;
      s0 = Math.max(r.width / VIEW_W, r.height / VIEW_H);   // same centre-crop the tile shows
      x0 = (r.width - VIEW_W * s0) / 2;
      y0 = (r.height - VIEW_H * s0) / 2;
      hero.style.transform = 'translate(' + x0 + 'px,' + y0 + 'px) scale(' + s0 + ')';
      z.appendChild(hero);
    }
    document.body.appendChild(z);
    void z.offsetWidth;   // commit the start state before animating
    z.classList.add('go');
    if (hero) hero.style.transform = 'translate(' + end.tx + 'px,' + end.ty + 'px) scale(' + end.scale + ')';
    setTimeout(() => { location.href = link; }, 320);
  }

  function tile(c, newest) {
    const el = document.createElement('div');
    el.className = 'collage-row';
    const canEdit = !!getRememberedEditToken(c.slug);
    const link = '?c=' + encodeURIComponent(c.slug);
    const isNew = newest > getVisited(c.slug);

    const cover = document.createElement('a');
    cover.className = 'cover';
    cover.href = link;
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());   // no cover yet: the empty tile stays
    img.src = Backend.coverUrl(c.id, newest);
    cover.appendChild(img);
    el.appendChild(cover);

    const name = document.createElement('a');
    name.className = 'collage-title';
    name.href = link;
    if (isNew) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.title = 'New since your last visit';
      name.appendChild(dot);
    }
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = c.title || c.slug;
    name.appendChild(label);
    el.appendChild(name);

    // Tapping a tile zooms its cover up to fill the screen, then opens the collage.
    [cover, name].forEach((a) => a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;   // let "open in new tab" work
      e.preventDefault();
      zoomInto(cover, img.parentNode ? img.src : '', c.slug, link);
    }));

    if (canEdit) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn del'; del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>'; del.title = 'Delete collage';
      del.setAttribute('aria-label', 'Delete collage');
      del.addEventListener('click', async () => {
        if (!window.confirm('Delete "' + (c.title || c.slug) + '" and all its images? This can\'t be undone.')) return;
        say('Deleting...');
        try {
          await Backend.deleteCollage(c.id);
          forgetEditToken(c.slug);
          load();
        } catch (e) {
          say('Could not delete: ' + e.message, 'error');
        }
      });
      el.appendChild(del);
    }
    return el;
  }

  async function load() {
    say('Loading...');
    try {
      const [collages, stamps] = await Promise.all([
        Backend.listCollages(),
        Backend.listLayerStamps().catch(() => [])   // only used for the "new" dot
      ]);
      // When did each collage last grow? (its newest layer, else its creation)
      const newestOf = {};
      for (const l of stamps) newestOf[l.collage_id] = Math.max(newestOf[l.collage_id] || 0, Date.parse(l.created_at) || 0);
      listEl.textContent = '';
      if (!collages.length) {
        listEl.appendChild(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No collages yet.' }));
      } else {
        collages.forEach((c) => listEl.appendChild(tile(c, newestOf[c.id] || Date.parse(c.created_at) || 0)));
      }
      say('');
    } catch (e) {
      say('Could not load collages: ' + e.message, 'error');
    }
  }

  $('newCollage').addEventListener('click', async () => {
    const title = window.prompt('Name this collage:', '');
    if (title === null) return;   // cancelled
    const slug = randomSlug();
    const token = randomToken();
    say('Creating...');
    try {
      const c = await Backend.insertCollage({
        slug, title: title.trim() || 'Untitled', edit_token: token,
        depth_scale: 1, speed: 1, density: 1.2, tilt_sensitivity: 0.15
      });
      rememberEditToken(slug, token);
      // open=editor: land straight in the editor panel, not on the collage
      location.href = '?c=' + encodeURIComponent(c.slug) + '&edit=' + encodeURIComponent(token) + '&open=editor';
    } catch (e) {
      say('Could not create collage: ' + e.message, 'error');
    }
  });

  if (Backend.problem) {
    say(Backend.problem, 'error');
    return;
  }
  if (!Backend.configured) {
    // Nothing to gallery over -- just show the one static collage directly.
    document.getElementById('galleryView').classList.add('gone');
    document.getElementById('viewerView').classList.remove('gone');
    if (typeof runViewer === 'function') runViewer(null);
    return;
  }
  load();
  // Coming back with the browser's back button restores the old page: refresh it.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    document.querySelectorAll('.zoom').forEach((z) => z.remove());   // back from a collage: drop the zoom overlay
    load();
  });
}
