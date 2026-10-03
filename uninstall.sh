#!/usr/bin/env bash
# Removes claude-harness: restores the settings it changed in every project, stops the
# knowledge graph and uninstalls the plugin.
#
#   curl -fsSL https://raw.githubusercontent.com/Creminn/claude_code_harness_research/main/uninstall.sh | bash
#   ... | bash -s -- --purge     # also delete the knowledge graph data
set -euo pipefail

PURGE=""
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE="--purge" ;;
    -h|--help) echo "Usage: uninstall.sh [--purge]"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

SHIM="$HOME/.claude-harness/bin/harness.mjs"
# shellcheck disable=SC2086  # $PURGE is empty or one flag
if command -v node >/dev/null 2>&1 && [ -f "$SHIM" ] && node "$SHIM" uninstall --yes $PURGE; then
  exit 0
fi

echo "The harness command was not available; removing the plugin only."
if command -v claude >/dev/null 2>&1; then
  claude plugin uninstall harness@claude-harness --scope user || true
  claude plugin marketplace remove claude-harness || true
fi
if [ -n "$PURGE" ]; then rm -rf "$HOME/.claude-harness"; fi
echo "Done. If you had enabled the harness, check the model, effortLevel, autoCompactWindow and statusLine keys in your settings files."
