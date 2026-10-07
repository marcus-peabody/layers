// Entry point. ?c=<slug> shows that collage (viewer + in-situ editor); no
// slug shows the gallery of all collages. A matching ?edit=<token> unlocks
// editing and is remembered on this device from then on, then stripped from
// the visible URL so it doesn't linger in the address bar or browser history.
(function () {
  const galleryView = document.getElementById('galleryView');
  const viewerView = document.getElementById('viewerView');
  const params = new URLSearchParams(location.search);
  const slug = params.get('c');

  if (!slug) {
    viewerView.classList.add('gone');
    if (typeof runGallery === 'function') runGallery();
    return;
  }

  galleryView.classList.add('gone');
  viewerView.classList.remove('gone');
  document.documentElement.classList.add('viewer');   // the page itself scrolls in the viewer

  const urlToken = params.get('edit');
  window.openEditorOnLoad = params.get('open') === 'editor';
  if (urlToken) rememberEditToken(slug, urlToken);
  if (urlToken || params.has('open')) {
    params.delete('edit');
    params.delete('open');
    const clean = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
    try { history.replaceState(null, '', clean); } catch (e) { /* token is remembered regardless; a tidy URL is a bonus */ }
  }

  // Arrived by zooming in from the gallery: hold the cover on screen until the
  // real collage has drawn its first frame, then fade it away.
  window.dismissVeil = function () {};
  try {
    const z = JSON.parse(sessionStorage.getItem('zoomCover') || 'null');
    sessionStorage.removeItem('zoomCover');
    if (z && z.slug === slug && Date.now() - z.t < 15000) {
      const veil = document.createElement('div');
      veil.id = 'veil';
      if (z.src) {
        // the same picture at the same place the gallery zoom ended on
        const pic = document.createElement('img');
        pic.alt = '';
        pic.src = z.src;
        pic.style.transform = 'translate(' + (z.tx || 0) + 'px,' + (z.ty || 0) + 'px) scale(' + (z.scale || 1) + ')';
        veil.appendChild(pic);
      }
      viewerView.appendChild(veil);
      let done = false;
      window.dismissVeil = function () {
        if (done) return;
        done = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          veil.classList.add('fade');
          setTimeout(() => veil.remove(), 450);
        }));
      };
      setTimeout(window.dismissVeil, 6000);   // never get stuck behind it
    }
  } catch (e) { /* no sessionStorage: just no zoom handoff */ }

  if (typeof runViewer === 'function') runViewer(slug);
})();
