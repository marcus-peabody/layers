// Minimal Supabase client using plain fetch -- no library, no CDN.
// Three Supabase services are used:
//   /rest/v1/...     the database (tables `collages` and `layers`)
//   /storage/v1/...  file storage (bucket `layers`, files namespaced
//                     "<collageId>/<file>" so a whole collage's images can be
//                     listed and removed together)

// A collage's edit (collaborate) link is read once, then remembered on this
// device/browser so the plain read-only link can stay read-only for everyone,
// including its owner, without re-pasting the token on every visit.
function getRememberedEditToken(slug) {
  try { return localStorage.getItem('editToken:' + slug) || ''; } catch (e) { return ''; }
}
function rememberEditToken(slug, token) {
  try { localStorage.setItem('editToken:' + slug, token); } catch (e) { /* storage unavailable; token just won't persist */ }
}
function forgetEditToken(slug) {
  try { localStorage.removeItem('editToken:' + slug); } catch (e) { /* ignore */ }
}

// Resolves with a loaded <img>, or rejects with a readable error.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth ? resolve(img) : reject(new Error('zero-size image: ' + src)));
    img.onerror = () => reject(new Error('could not load ' + src));
    img.src = src;
  });
}

const Backend = (function () {
  const cfg = window.CONFIG || {};
  const base = String(cfg.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(cfg.SUPABASE_KEY || '').trim();

  // A secret/service key bypasses all permissions. It must never be in a public site.
  function looksSecret(k) {
    if (k.startsWith('sb_secret_')) return true;
    try {
      const payload = k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(payload)).role === 'service_role';
    } catch (e) {
      return false;
    }
  }

  const problem = key && looksSecret(key)
    ? 'js/config.js contains a SECRET key. Remove it now and use the public (publishable / anon) key instead.'
    : '';
  const configured = !!(base && key) && !problem;

  function headers(extra) {
    const h = { apikey: key };
    if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;   // legacy JWT-style keys only
    return Object.assign(h, extra);
  }

  async function request(url, init, what) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new Error(what + ': network error (' + e.message + ')');
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 160); } catch (e) { /* ignore */ }
      throw new Error(what + ': HTTP ' + res.status + (detail ? ' ' + detail : ''));
    }
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  function rest(path, what, method, body, prefer) {
    const h = {};
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (prefer) h.Prefer = prefer;
    return request(base + '/rest/v1/' + path, {
      method: method || 'GET',
      headers: headers(h),
      body: body === undefined ? undefined : JSON.stringify(body)
    }, what);
  }

  return {
    configured,
    problem,

    publicUrl(path) { return base + '/storage/v1/object/public/layers/' + path; },

    // ---------- collages ----------
    listCollages() {
      return rest('collages?select=*&order=created_at.asc', 'load collages');
    },
    async getCollageBySlug(slug) {
      const rows = await rest('collages?select=*&slug=eq.' + encodeURIComponent(slug), 'load collage');
      return (rows && rows[0]) || null;
    },
    async insertCollage(row) {
      const rows = await rest('collages?select=*', 'create collage', 'POST', row, 'return=representation');
      return rows[0];
    },
    updateCollage(id, patch) {
      return rest('collages?id=eq.' + encodeURIComponent(id), 'save collage', 'PATCH', patch, 'return=minimal');
    },
    deleteCollageRow(id) {
      return rest('collages?id=eq.' + encodeURIComponent(id), 'delete collage', 'DELETE', undefined, 'return=minimal');
    },

    // ---------- layers (scoped to one collage) ----------
    listLayers(collageId, activeOnly) {
      return rest('layers?select=*&collage_id=eq.' + encodeURIComponent(collageId)
        + '&order=sort_order.asc,created_at.asc' + (activeOnly ? '&active=eq.true' : ''), 'load layers');
    },
    async insertLayer(row) {
      const rows = await rest('layers?select=*', 'save layer', 'POST', row, 'return=representation');
      return rows[0];
    },
    updateLayer(id, patch) {
      return rest('layers?id=eq.' + encodeURIComponent(id), 'save layer', 'PATCH', patch, 'return=minimal');
    },
    deleteLayer(id) {
      return rest('layers?id=eq.' + encodeURIComponent(id), 'delete layer', 'DELETE', undefined, 'return=minimal');
    },

    // ---------- files ----------
    // Same request shape the official supabase-js library sends for uploads.
    uploadFile(path, blob) {
      const form = new FormData();
      form.append('cacheControl', '31536000');
      form.append('', blob);
      return request(base + '/storage/v1/object/layers/' + path, {
        method: 'POST',
        headers: headers({ 'x-upsert': 'false' }),   // no Content-Type: the browser sets the multipart boundary
        body: form
      }, 'upload');
    },
    deleteFile(path) {
      return request(base + '/storage/v1/object/layers/' + path, { method: 'DELETE', headers: headers() }, 'delete file');
    },
    async listFiles(prefix) {
      const result = await request(base + '/storage/v1/object/list/layers', {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefix, limit: 1000 })
      }, 'list files');
      return result || [];
    },
    async deleteFilesByPrefix(prefix) {
      const files = await this.listFiles(prefix);
      const paths = files.map((f) => prefix + f.name);
      if (!paths.length) return;
      await request(base + '/storage/v1/object/layers', {
        method: 'DELETE',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: paths })
      }, 'delete files');
    },

    // Deletes a collage's row (its layers cascade in the database) and every
    // file namespaced under its storage prefix.
    async deleteCollage(id) {
      await this.deleteFilesByPrefix(id + '/');
      await this.deleteCollageRow(id);
    }
  };
})();
