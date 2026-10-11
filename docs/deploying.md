# Deploying zones to zbcad.com/zones

This project (`apps/web`, Vite + React + Three.js) builds to a static SPA
that gets served as part of the `zbCAD` GitHub Pages site, under a `/zones`
subfolder.

## Key facts about this setup

- **Two repos.** `zones` (this repo, `divincentis/zones`, branch `main`) holds
  the source. `zbCAD` (`divincentis/zbCAD`, branch `main`, local clone at
  `../zbCAD`) is the GitHub Pages site; the built app lives in its `zones/`
  folder.
- **zbCAD is served by GitHub Pages** off `main` at the repo root: plain
  static files, no build step, no workflows.
- **Vite is configured for the `/zones/` subpath** (`base` in
  `apps/web/vite.config.ts`). The entry files keep fixed names (`index.js`,
  `index.css`), so `index.html` never changes between deploys. The chunks
  loaded later — the 3D view and the PDF writer — carry a content hash in
  their names, so a browser can never pair a cached chunk with an `index.js`
  from a different build. `rsync --delete` removes the previous build's
  chunks, so they do not accumulate.
- **GoatCounter analytics** is part of `apps/web/index.html`, so builds keep it.

## Deploy steps

1. From this repo: `scripts/deploy.sh`. It builds the engine and web app and
   rsyncs `apps/web/dist/` into `../zbCAD/zones/` (deleting files a build no
   longer produces). Set `ZBCAD_DIR` if the clone lives elsewhere.
2. In zbCAD, review and ship:
   ```bash
   cd ../zbCAD
   git status
   git add zones && git commit -m "Deploy zones" && git push
   ```
3. Pages updates `https://zbcad.com/zones/` within about a minute.

## Not currently done, but could be later

A GitHub Actions workflow in the `zones` repo could build and push straight
into `zbCAD` on every push to `main`, removing the manual
build/rename/upload steps. This needs a personal access token with
`contents:write` on `zbCAD`, stored as a secret in the `zones` repo (the
default `GITHUB_TOKEN` can't write to a different repo). Worth revisiting
if updates become frequent enough that the manual copy gets tedious — not
needed for occasional releases.
