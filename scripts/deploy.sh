#!/bin/sh
# Build zones and copy the output into the local zbCAD checkout's zones/ folder.
# Stops short of committing/pushing: review `git status` in zbCAD, then commit and push there.
set -e
cd "$(dirname "$0")/.."
SITE="${ZBCAD_DIR:-../zbCAD}"
[ -d "$SITE/.git" ] || { echo "zbCAD checkout not found at $SITE (set ZBCAD_DIR)"; exit 1; }
npm run build --workspace=packages/engine
npm run build --workspace=apps/web
# --delete drops chunks a build no longer produces, so stale files don't linger.
rsync -a --delete apps/web/dist/ "$SITE/zones/"
git -C "$SITE" status --short zones
echo "Review, then: cd $SITE && git add zones && git commit -m 'Deploy zones' && git push"
