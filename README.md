# Collage

An infinite, panning parallax collage made from transparent PNGs. Drag (touch or
mouse) or scroll to explore. Layers with a higher `depth` sweep past faster and
read as closer.

There are two pages:

- **`index.html`** — the viewer. This is the piece. Works on phone and desktop.
- **`console.html`** — where you add images and tweak the piece. Works on desktop
  (with a live preview) and on a phone (controls only, no preview).

The viewer reads layers from Supabase, and **falls back to the static images in
`manifest.json`** if Supabase is empty, unreachable, or not configured. So the
site can't go blank.

## Files

```
index.html        the viewer
console.html      the console
manifest.json     the static fallback set (settings + list of layers)
images/01-08.png  the static test images
css/style.css     viewer styles       css/console.css   console styles
js/collage.js     the parallax engine (no dependencies)
js/backend.js     tiny Supabase client using plain fetch (no library, no CDN)
js/config.js      YOUR Supabase URL + public key go here
js/viewer.js      viewer logic        js/console.js     console logic
SUPABASE-SETUP.md how the Supabase side is set up
```

## Turning on Supabase

1. Do `SUPABASE-SETUP.md` (project, `layers` bucket, SQL).
2. Open `js/config.js` and fill in the two values:

   ```js
   window.CONFIG = {
     SUPABASE_URL: 'https://abcdxyz.supabase.co',
     SUPABASE_KEY: 'sb_publishable_...'      // or the older "anon" key
   };
   ```

   Both are safe to publish. **Never** paste the `secret` / `service_role` key —
   both pages refuse to run if they detect one.
3. Commit and push. Open `/console.html`, add a few PNGs, then open `/`.

Blank config = static site only, exactly as before.

## Using the console

- **Add images:** tap the box (phone) or drop files on it (desktop). PNGs only for
  now. Anything larger than 1200px is shrunk before upload so the viewer stays fast.
- **Scene:** *Apparent depth* (overall parallax strength), *Scroll speed*, and
  *Density* (bigger = images further apart).
- **Layers:** the list shows the front-most layer first. Per layer: *Size*, *Depth*
  (how fast it moves: small = far/slow, large = near/fast), show/hide, ▲ bring
  forward, ▼ send back, ✕ delete.
- Sliders update the preview as you drag and save when you let go. A green
  "Saved" or a red error appears at the top of the panel.

## Static fallback

Drop PNGs in `images/` and list them in `manifest.json`:

```json
{ "file": "images/mine.png", "depth": 1.0, "scale": 1.0, "opacity": 1 }
```

Last in the list is drawn on top.

## Deploying (GitHub Pages)

Push to the `main` branch (Settings → Pages → root folder). **Keep the `CNAME`
file** if you use a custom domain. The viewer shows its version bottom-right
(`v2`) and a short status line at the top when it loads.

## Heads up

Right now anyone who finds `/console.html` can add, edit and delete layers (no
login yet). Nothing links to it and it's marked `noindex`, but it isn't secure.
See "What the permissions mean" in `SUPABASE-SETUP.md` for how we'll lock it down.
