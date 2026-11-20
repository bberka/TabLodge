#!/usr/bin/env bash
# Builds the commit that the Release workflow force-pushes to the `release` branch: the stamped
# apps/server/cloudflare-deploy/ folder and nothing else, with no history. The Deploy to Cloudflare button points at
# that branch, so a button deploy runs the release and reports its version.
#
# The folder keeps its path in the branch because GitHub refuses a push made with the workflow token that adds a file
# under the root .github/workflows, and the button's URL names the folder either way.
#
# Usage: scripts/release-branch.sh <version> <empty-directory>
# Run it after `node scripts/release-version.ts set-server <version>` and `pnpm run cf:bundle`. It leaves a git
# repository with one commit on `release` in <empty-directory>; the caller pushes it.
set -euo pipefail

version="${1:?usage: release-branch.sh <version> <empty-directory>}"
target="${2:?usage: release-branch.sh <version> <empty-directory>}"
source="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/server/cloudflare-deploy"

if [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
	echo "$target is not empty." >&2
	exit 1
fi
# A worker.js that does not report the release would send button deploys back to "an unreleased build".
grep -q "var version = \"$version\";" "$source/worker.js" || {
	echo "worker.js does not report version $version. Stamp it with set-server and cf:bundle first." >&2
	exit 1
}

mkdir -p "$target/apps/server"
cp -R "$source" "$target/apps/server/cloudflare-deploy"
git -C "$target" init --quiet --initial-branch=release
git -C "$target" add --all
git -C "$target" \
	-c user.name='github-actions[bot]' \
	-c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
	commit --quiet -m "TabLodge $version Cloudflare deploy folder"
