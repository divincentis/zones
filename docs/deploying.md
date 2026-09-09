# Deploying to zbcad.com/zones

This project builds to a static SPA (`apps/web`, Vite + React + Three.js).
zbcad.com is served by GitHub Pages directly off the `master` branch root of
the `zbCAD` repo (plain `index.html`/`cad.html` files, no build step, no
`.github/workflows`). Since Pages serves everything under that branch root,
the wind-zones app just needs its built output dropped into a `zones/`
folder inside the `zbCAD` repo — no changes to zbCAD's Pages settings are
needed.

There are two parts: (1) create the new `zones` GitHub repo for this
project's source, and (2) get its production build into `zbCAD/zones/`.

## 1. Create the GitHub repo for this project

```bash
cd /home/matt/projects/zones
gh repo create zbcad-zones --private --source=. --remote=origin
# or --public, depending on your preference
git add -A
git commit -m "Initial commit"
git push -u origin main
```

(Pick whatever repo name you like — it doesn't have to match the URL path.
`/zones` in the URL comes from the folder name inside `zbCAD`, set in step 3,
not from this repo's name.)

## 2. Set the Vite base path

Because the app will be served from `zbcad.com/zones/` instead of the
domain root, Vite needs to know the subpath so built asset URLs
(`/assets/...`) resolve correctly instead of 404ing at the domain root.

This is already done in `apps/web/vite.config.ts` — `base` is set to
`/zones/` for production builds only (dev server URLs stay at `/` so `npm
run dev` is unaffected):

```ts
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/zones/' : '/',
  ...
}));
```

## 3. Build and copy into zbCAD

Since neither repo currently has CI, the simplest approach is a manual build
+ copy, matching how zbCAD itself is already deployed (committed static
files, no pipeline). This takes under a minute per release.

```bash
# From the zones repo
cd /home/matt/projects/zones
npm run build --workspace=packages/engine
npm run build --workspace=apps/web

# Copy the build output into zbCAD
rm -rf /home/matt/projects/zbCAD/zones
cp -r apps/web/dist /home/matt/projects/zbCAD/zones

# Commit and push from zbCAD as usual
cd /home/matt/projects/zbCAD
git add zones
git commit -m "Deploy wind zones app to /zones"
git push
```

GitHub Pages will rebuild automatically and the app will be live at
`https://zbcad.com/zones/` shortly after the push (usually under a minute).

Add a link to it from `zbCAD/index.html` or `docs.html` whenever you're
ready to surface it to visitors.

## 4. (Optional) Automate the copy step later

If you start updating the zones app often enough that the manual copy gets
tedious, a GitHub Actions workflow in the `zones` repo can build it and push
the `dist/` output straight into `zbCAD` on every push to `main`. That needs
a personal access token with `contents:write` on `zbCAD`, stored as a repo
secret (e.g. `ZBCAD_DEPLOY_TOKEN`) in the `zones` repo, since the default
`GITHUB_TOKEN` can't write to a different repo. Ask for this when you're
ready to set it up — it's a bigger jump in moving parts (secrets, a token to
rotate, a cross-repo push) than the current setup warrants for occasional
releases.

## Notes

- The app has no client-side router, so there's no need for the GitHub
  Pages SPA-fallback (`404.html`) trick — a plain static folder is enough.
- `apps/web/dist/` is gitignored in this repo (as it should be) but the copy
  *into* `zbCAD/zones/` is a normal tracked directory there — it's a build
  artifact from this repo's perspective, but source-of-truth-for-Pages from
  zbCAD's.
