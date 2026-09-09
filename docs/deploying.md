# Deploying zones to zbcad.com/zones

This project (`apps/web`, Vite + React + Three.js) builds to a static SPA
that gets served as part of the `zbCAD` GitHub Pages site, under a `/zones`
subfolder.

## Key facts about this setup

- **zbCAD has no local clone.** There is no `/home/matt/projects/zbCAD`
  folder on this machine. All updates to that repo happen through GitHub's
  web UI (github.com), not git push.
- **zbCAD is served by GitHub Pages** directly off the `master` branch root
  — plain static files, no build step, no `.github/workflows`.
- **The `zones` project (this repo) is a local git repo, not currently
  pushed to GitHub.** A `zbcad-zones` GitHub repo exists to mirror it
  eventually, but `git push` is currently failing there (auth/token issue,
  unresolved as of this writing) — so for now, commits stay local only.
  Source history lives on this machine; there is no GitHub backup of it
  yet. This is unrelated to the zbCAD repo except that this project's
  build output gets copied over to it.
- **Vite is configured for the `/zones/` subpath.** `apps/web/vite.config.ts`
  sets `base: command === 'build' ? '/zones/' : '/'` — already done, don't
  touch it unless the deploy path changes.
- **Vite build filenames are content-hashed** (`index-a1b2c3.js` etc), so
  re-uploading does not overwrite old files — stale files must be manually
  deleted from GitHub first or they'll accumulate.
- **`zones/index.html`** is what GitHub Pages serves by default at
  `zbcad.com/zones/`.

## Deploy steps (manual upload, current process)

1. Build:
   ```bash
   cd /home/matt/projects/zones
   npm run build --workspace=packages/engine
   npm run build --workspace=apps/web
   ```
   Output lands in `apps/web/dist/`.

2. Rename the output folder to `zones` locally:
   ```bash
   cd apps/web
   rm -rf zones && mv dist zones
   ```

3. On github.com, open the `zbCAD` repo, go into the existing `zones/`
   folder (if present), select all files, and delete them (commit the
   deletion). This clears out old hashed filenames before the new upload.

4. From the `zbCAD` repo root, **Add file → Upload files**, drag the local
   `zones` folder onto the drop area. GitHub preserves folder structure, so
   it lands at `zbCAD/zones/...`. Commit directly to `master`.

5. GitHub Pages rebuilds automatically — live at `https://zbcad.com/zones/`
   usually within a minute.

## Not currently done, but could be later

A GitHub Actions workflow in the `zones` repo could build and push straight
into `zbCAD` on every push to `main`, removing the manual
build/rename/upload steps. This needs a personal access token with
`contents:write` on `zbCAD`, stored as a secret in the `zones` repo (the
default `GITHUB_TOKEN` can't write to a different repo). Worth revisiting
if updates become frequent enough that the manual copy gets tedious — not
needed for occasional releases.
