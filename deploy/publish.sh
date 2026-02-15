#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CURRENT=$(node -p "require('./package.json').version")
echo ""
echo "  📦 code-agent-auto-commit"
echo "  Current version: $CURRENT"
echo ""

echo "  Select version bump:"
echo ""
echo "    1) patch   (bug fixes)"
echo "    2) minor   (new features, backward compatible)"
echo "    3) major   (breaking changes)"
echo "    4) custom  (enter manually)"
echo ""

read -rp "  Choice [1-4]: " choice

case "$choice" in
  1) BUMP="patch" ;;
  2) BUMP="minor" ;;
  3) BUMP="major" ;;
  4)
    read -rp "  Enter version (e.g. 2.0.0): " CUSTOM_VERSION
    if [[ ! "$CUSTOM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
      echo "  ❌ Invalid version format"
      exit 1
    fi
    BUMP="$CUSTOM_VERSION"
    ;;
  *)
    echo "  ❌ Invalid choice"
    exit 1
    ;;
esac

echo ""
echo "  ── Pre-publish checks ──"
echo ""

echo "  → typecheck..."
pnpm run typecheck
echo "  ✓ typecheck passed"

echo "  → build..."
pnpm run build
echo "  ✓ build passed"

echo "  → test..."
pnpm test
echo "  ✓ tests passed"

echo ""

if [[ "$choice" == "4" ]]; then
  npm version "$BUMP" --no-git-tag-version
else
  npm version "$BUMP" --no-git-tag-version
fi

NEXT=$(node -p "require('./package.json').version")

echo ""
echo "  ── Publish Preview ──"
echo ""
echo "  Version:  $CURRENT → $NEXT"
echo "  Registry: https://registry.npmjs.org"
echo "  Package:  code-agent-auto-commit"
echo ""

read -rp "  Publish v$NEXT? [y/N]: " confirm

if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo ""
  echo "  Aborted. Reverting version..."
  npm version "$CURRENT" --no-git-tag-version > /dev/null 2>&1
  echo "  Reverted to $CURRENT"
  exit 0
fi

echo ""
echo "  → publishing..."
pnpm publish --no-git-checks
echo ""
echo "  ✅ Published v$NEXT"

git add package.json
git commit -m "chore: release v$NEXT"
git tag "v$NEXT"
echo "  ✅ Committed & tagged v$NEXT"

read -rp "  Push to remote? [y/N]: " push_confirm
if [[ "$push_confirm" == "y" || "$push_confirm" == "Y" ]]; then
  git push && git push --tags
  echo "  ✅ Pushed"
fi

echo ""
echo "  Done! 🎉"
echo ""
