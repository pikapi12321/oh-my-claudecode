#!/usr/bin/env bash
# Sync local agent/skill source files to the plugin cache.
# Called automatically by post-commit hook; also runnable via: npm run sync-cache
set -e

CACHE_BASE="$HOME/.claude/plugins/cache/omc/oh-my-claudecode"

CACHED_VERSION=$(ls "$CACHE_BASE" 2>/dev/null | sort -V | tail -1)
if [ -z "$CACHED_VERSION" ]; then
  echo "[sync-cache] No cached version at $CACHE_BASE — skipping."
  exit 0
fi

CACHE="$CACHE_BASE/$CACHED_VERSION"
SRC="$(cd "$(dirname "$0")/.." && pwd)"

rsync -a --delete "$SRC/agents/"  "$CACHE/agents/"
rsync -a --delete "$SRC/skills/"  "$CACHE/skills/"

# Sync dist only if it exists and was recently built
if [ -d "$SRC/dist" ]; then
  rsync -a --delete "$SRC/dist/" "$CACHE/dist/"
fi

echo "[sync-cache] → $CACHE"
