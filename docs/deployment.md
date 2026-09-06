# Deploying to zbcad.com/zones

This app is a separate repo from the one serving `zbcad.com` (index.html at
the root). The plan below publishes `apps/web`'s build output into a
`zones/` subfolder of the *existing* zbcad.com site's Pages branch, without
touching anything else on that site.

## 0. Push this repo to GitHub

If not already done: create a GitHub repo (e.g. `<you>/zones`) and push
`main` to it.

## 1. Set the Vite base path

Built asset URLs need to resolve under `/zones/`, but local `npm run dev`
should keep running at the root. Edit `apps/web/vite.config.ts`:

```ts
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/zones/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@zones/engine': path.resolve(import.meta.dirname, '../../packages/engine/src/index.ts'),
    },
  },
}));
```

No router/basename changes needed — the app has no client-side routing and
no hardcoded absolute paths beyond the script tag Vite already rewrites.

## 2. Give this repo push access to the zbcad.com site repo

Use a dedicated SSH deploy key (scoped to just that one repo) rather than a
personal access token:

```bash
ssh-keygen -t ed25519 -C "zones-deploy" -f zones_deploy_key -N ""
```

- Add `zones_deploy_key.pub` to the **zbcad.com site repo** → Settings →
  Deploy keys → "Allow write access".
- Add the contents of `zones_deploy_key` (private key) as a secret named
  `DEPLOY_KEY` in **this** repo → Settings → Secrets and variables →
  Actions.
- Delete both local key files once added.

## 3. Add the workflow

`.github/workflows/deploy.yml`:

```yaml
name: Deploy to zbcad.com/zones

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build --workspace=apps/web
      - uses: peaceiris/actions-gh-pages@v4
        with:
          deploy_key: ${{ secrets.DEPLOY_KEY }}
          external_repository: <owner>/<zbcad-site-repo>
          publish_branch: <branch that repo's Pages is set to serve>
          publish_dir: apps/web/dist
          destination_dir: zones
          keep_files: true
          user_name: 'github-actions[bot]'
          user_email: 'github-actions[bot]@users.noreply.github.com'
```

Fill in `<owner>/<zbcad-site-repo>` and `publish_branch` from the site
repo's Settings → Pages. The combination of `destination_dir: zones` +
`keep_files: true` is what makes this safe: the action only writes/updates
files under `zones/` in that branch and leaves the existing root
`index.html` and everything else untouched.

## 4. First deploy

Push to `main`, watch the Actions tab go green, then check
`https://zbcad.com/zones/` (keep the trailing slash — with
`base: '/zones/'` the app expects to be served from that exact path).

## 5. After that

Every push to `main` rebuilds and republishes automatically — nothing
manual to repeat.

### Optional

If the zbcad.com repo later hosts other subpaths deployed the same way and
you want to avoid unrelated rebuilds, add a `paths:` filter to the
workflow's `push` trigger (e.g. `apps/web/**`, `packages/engine/**`).
