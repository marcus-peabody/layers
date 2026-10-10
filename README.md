# Collage

An infinite, panning parallax collage made from transparent PNGs. Drag (touch or
mouse) or scroll to explore. Layers with a higher `depth` sweep past faster and
read as closer.

It's a single page, `index.html`. A round settings button bottom-right opens
into a pill: share, edit, tilt (phones) and all collages, with an X to close it.
Edit opens the editor in place, right on top of the live piece -- there's no
separate page to edit on, and no separate preview to keep in sync with the real
thing. The bare site address shows a gallery of all collages (4:5 pictures of each collage, two
columns; a red dot marks collages that gained layers since you last opened them).

The page reads layers from Supabase, and **falls back to the static images in
`manifest.json`** if Supabase is empty, unreachable, or not configured. So the
site can't go blank, and the edit button simply doesn't appear if there's
nothing to save edits to.

## Files

```
index.html        the viewer + in-situ editor
manifest.json     the static fallback set (settings + list of layers)
images/01-08.png  the static test images
css/style.css     viewer styles
css/editor.css    editor panel styles
css/gallery.css   gallery grid styles
js/collage.js     the parallax engine (no dependencies)
js/backend.js     tiny Supabase client using plain fetch (no library, no CDN)
js/config.js      YOUR Supabase URL + public key go here
js/viewer.js      loads the piece, the settings dock (share, edit, tilt, menu)
js/gif.js         tiny GIF decoder: animated GIFs advance as you scroll
js/gifenc.js      tiny GIF encoder: short videos are converted to GIFs on upload
js/editor.js      the in-situ editor (upload, reorder, scene settings)
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

   Both are safe to publish. **Never** paste the `secret` / `service_role` key
   -- the page refuses to run if it detects one.
3. Commit and push. Open the site -- the round edit button appears bottom-right
   once Supabase is reachable. Tap it, add a few images, tap Close.

Blank config = static site only, and the edit button stays hidden.

## Using the editor

Tap the round button bottom-right, then the pencil. The same spot becomes an X
that closes the editor. It overlays the live collage rather than replacing it, so on desktop
you can keep seeing (and panning) the piece beside the panel; on a phone the
panel takes the full screen while open, but closing it shows the real,
already-updated result immediately.

- **Add images:** tap the box (phone) or drop files on it (desktop). Anything
  larger than 1200px is shrunk before upload so the viewer stays fast. GIFs are
  left untouched; in the collage a GIF steps through its frames as you scroll
  (it doesn't play by itself). Short video clips are converted to GIFs in the browser (first 4 seconds, at most 12 frames, small and 64 colours so it stays light).
- **Paste a sticker:** copy a subject cut out in Photos, tap the "Tap here to
  paste stickers" box, then paste.
- **Scene:** *Apparent depth* (overall parallax strength), *Scroll speed*,
  *Density* (bigger = images further apart), *Rotation* (0 = everything level, up to 30 degrees either way), *Tilt sensitivity* (0-0.3, default 0.15).
- **Layers:** the list shows the front-most layer first. Per layer: *Size*, show/hide,
  bring forward (^), send back (v), delete (x). Hidden layers still show,
  dimmed, while editing, so you can see what you're toggling.
- All sliders run 1-10. They update the live piece as you drag and save when you let go. A green
  "Saved" or a red error appears at the top of the panel.

## Static fallback

Drop PNGs in `images/` and list them in `manifest.json`:

```json
{ "file": "images/mine.png", "depth": 1.0, "scale": 1.0, "opacity": 1 }
```

Last in the list is drawn on top.

## Deploying (GitHub Pages)

Push to the `main` branch (Settings -> Pages -> root folder). **Keep the
`CNAME` file** if you use a custom domain. The page shows its version
bottom-right and a short status line at the top when it loads.

## Heads up

Right now anyone who finds the site and taps the edit button can add, edit and
delete layers (no login yet). See "What the permissions mean" in
`SUPABASE-SETUP.md` for how we'll lock this down.

## Full-bleed edge-to-edge on iPhone

A normal Safari tab reserves real screen space for the system status bar and
Safari's own chrome, even when minimized -- no CSS removes that. What does
work: panning now drives genuine native browser scrolling (via an invisible
scrollable element behind the canvas) instead of a simulated drag, which is
what actually gets Safari to auto-hide its own toolbar on a real scroll
gesture. Give it a proper drag, not just a glance at rest, to see the effect.
Status-bar space itself stays reserved at rest regardless; adding the site to
the Home Screen (Share -> Add to Home Screen) removes browser chrome entirely
if you want true full-screen with zero compromise.

## Many layers

Past about 8 layers the collage thins itself out: each layer is spread further
apart, and each one is also missing from some whole zones, so a screen shows
roughly the same number of images however many you add -- a varied handful,
with different layers turning up as you explore -- instead of the front few
covering everything. *Density* still scales the spacing on top of this.
