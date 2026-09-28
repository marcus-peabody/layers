# Collage

An infinite, panning parallax collage made from transparent PNGs. Drag (touch or
mouse) or scroll to explore. Layers with a higher `depth` sweep past faster and
read as closer.

**Phase 1 (this version): fully static.** No database, no login, no third-party
scripts. The images live in this repo, and `manifest.json` says which ones to use.
Supabase-backed uploads come in Phase 2 (see `SUPABASE-SETUP.md`).

## Files

```
index.html          the viewer page
manifest.json       settings + the list of layers (edit this to change the piece)
css/style.css
js/collage.js       the parallax engine
js/viewer.js        loads the manifest and images, shows status on screen
images/01.png ...   eight test PNGs (replace with your own)
```

## Deploy on GitHub Pages

1. In your repo, **delete the old files** (so nothing stale is left behind) —
   **but keep the `CNAME` file if you have one**, or your custom domain will
   stop working.
2. Add every file from this folder, keeping the same folder structure.
3. Commit and push. In the repo's **Settings → Pages**, the source should be the
   `main` branch, root folder.
4. Give it a minute, then open your site. In the bottom-right you should see
   **`v1 · static`**, and briefly at the top **`Loaded 8 layers`**.

To try it locally first: `python3 -m http.server 8000` in this folder, then open
`http://localhost:8000` (opening `index.html` directly from disk won't work,
because the page needs to `fetch` the manifest).

## Using your own images

Drop transparent PNGs into `images/` (around 512–1000px on the long side, ideally
under ~300KB each so it loads quickly on a phone), then list them in
`manifest.json`:

```json
{ "file": "images/mine.png", "depth": 1.0, "scale": 1.0, "opacity": 1 }
```

- `depth`: parallax speed. Small (0.2–0.5) = far away and slow; large (1.5–2) = close and fast.
- `scale`: size multiplier for that image.
- `opacity`: optional, 0–1 (default 1).
- Order matters: layers are drawn in list order, so the last one sits on top.
- `settings` at the top of the manifest: `depthScale` (overall parallax strength),
  `speed` (how far the world moves per pixel you drag/scroll), `density` (bigger =
  images spaced further apart).

## If something's wrong

The page reports what happened at the top of the screen. If you see red text, it
names the file or step that failed. If you see nothing but a dark screen and no
`v1 · static` label, the page you're looking at isn't this version.
