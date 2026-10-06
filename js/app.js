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

  const urlToken = params.get('edit');
  if (urlToken) {
    rememberEditToken(slug, urlToken);
    params.delete('edit');
    const clean = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
    try { history.replaceState(null, '', clean); } catch (e) { /* token is remembered regardless; a tidy URL is a bonus */ }
  }

  if (typeof runViewer === 'function') runViewer(slug);
})();
