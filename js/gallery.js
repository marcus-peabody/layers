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

  function row(c) {
    const el = document.createElement('div');
    el.className = 'collage-row';
    const canEdit = !!getRememberedEditToken(c.slug);
    const link = '?c=' + encodeURIComponent(c.slug);
    const when = c.created_at ? new Date(c.created_at).toLocaleDateString() : '';

    el.innerHTML =
      '<a class="collage-title" href="' + link + '">' + escapeHtml(c.title || c.slug) + '</a>' +
      '<span class="collage-meta">' + when + (canEdit ? ' - you can edit this' : '') + '</span>';

    const btns = document.createElement('div');
    btns.className = 'collage-btns';
    if (canEdit) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn del'; del.textContent = 'x'; del.title = 'Delete collage';
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
      btns.appendChild(del);
    }
    el.appendChild(btns);
    return el;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function load() {
    say('Loading...');
    try {
      const collages = await Backend.listCollages();
      listEl.textContent = '';
      if (!collages.length) {
        listEl.appendChild(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No collages yet.' }));
      } else {
        collages.forEach((c) => listEl.appendChild(row(c)));
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
        depth_scale: 1, speed: 1, density: 1.2, tilt_sensitivity: 0.5
      });
      rememberEditToken(slug, token);
      location.href = '?c=' + encodeURIComponent(c.slug) + '&edit=' + encodeURIComponent(token);
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
}
