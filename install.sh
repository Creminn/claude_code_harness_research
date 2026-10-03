#!/usr/bin/env bash
# claude-harness installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Creminn/claude_code_harness_research/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --mode anthropic|openai|local|off [--yes] [--ref BRANCH]
#
# What it does: checks the prerequisites, installs the plugin into Claude Code, and
# optionally sets up the knowledge graph. It never edits your Claude Code settings: that
# happens when you say "enable harness architecture" inside Claude Code.
set -euo pipefail

REPO="${HARNESS_REPO:-Creminn/claude_code_harness_research}"
MARKETPLACE="claude-harness"
PLUGIN="harness@claude-harness"
MIN_NODE=20
MODE=""
REF=""
ASSUME_YES=0

usage() {
  cat <<EOF
Usage: install.sh [--mode anthropic|openai|local|off] [--yes] [--ref BRANCH]

  --mode   Knowledge graph mode. Without it you are asked (default: off).
  --yes    Do not ask questions; use defaults and environment variables
           (ANTHROPIC_API_KEY / OPENAI_API_KEY for the graph key).
  --ref    Install from a branch or tag instead of the default branch.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --mode=*) MODE="${1#*=}"; shift ;;
    --ref) REF="${2:-}"; shift 2 ;;
    --ref=*) REF="${1#*=}"; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# When piped into bash, stdin is this script, so questions are read from the terminal.
can_prompt() { [ "$ASSUME_YES" -eq 0 ] && (exec </dev/tty) 2>/dev/null; }
ask() {
  local answer=""
  printf '%s' "$1" >/dev/tty
  IFS= read -r answer </dev/tty || answer=""
  printf '%s' "$answer"
}
ask_secret() {
  local answer=""
  printf '%s' "$1" >/dev/tty
  stty -echo </dev/tty 2>/dev/null || true
  IFS= read -r answer </dev/tty || answer=""
  stty echo </dev/tty 2>/dev/null || true
  printf '\n' >/dev/tty
  printf '%s' "$answer"
}

node_hint() {
  case "$(uname -s)" in
    Darwin) say "  Install it with:  brew install node   (or download it from https://nodejs.org)" ;;
    *) say "  Install it with your package manager (for example: sudo apt install nodejs)"
       say "  or with nvm: https://github.com/nvm-sh/nvm   (Node.js $MIN_NODE or newer)" ;;
  esac
}

say "claude-harness installer"
say ""

# 1. Prerequisites -----------------------------------------------------------
if ! have claude; then
  say "Claude Code is not installed. Install it first, then run this again:"
  say "  curl -fsSL https://claude.ai/install.sh | bash"
  exit 1
fi
if ! have node; then
  say "Node.js $MIN_NODE+ is required (the harness hooks and status line run on it)."
  node_hint
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE" ]; then
  say "Node.js $NODE_MAJOR is too old: $MIN_NODE or newer is required."
  node_hint
  exit 1
fi
DOCKER="none"
if have docker; then
  if docker info >/dev/null 2>&1; then DOCKER="running"; else DOCKER="stopped"; fi
fi
say "  Claude Code: $(claude --version 2>/dev/null | head -n1)"
say "  Node.js:     $(node --version)"
case "$DOCKER" in
  running) say "  Docker:      running" ;;
  stopped) say "  Docker:      installed, not running (start it to use the knowledge graph)" ;;
  none)    say "  Docker:      not installed (optional: needed only for the knowledge graph)" ;;
esac
say ""

# 2. Plugin ------------------------------------------------------------------
SOURCE="$REPO"
[ -n "$REF" ] && SOURCE="$REPO#$REF"
# HARNESS_SOURCE overrides the marketplace source (a local checkout or owner/repo#ref), for testing.
[ -n "${HARNESS_SOURCE:-}" ] && SOURCE="$HARNESS_SOURCE"
say "Installing the plugin ..."
claude plugin marketplace add "$SOURCE" >/dev/null
claude plugin marketplace update "$MARKETPLACE" >/dev/null 2>&1 || true
claude plugin install "$PLUGIN" --scope user >/dev/null
claude plugin update "$PLUGIN" >/dev/null 2>&1 || true

INSTALL_PATH="$(claude plugin list --json | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const p = JSON.parse(s).find((x) => x.id === "harness@claude-harness");
    if (p && p.installPath) console.log(p.installPath);
  });')"
if [ -z "$INSTALL_PATH" ] || [ ! -f "$INSTALL_PATH/scripts/harness.mjs" ]; then
  say "Could not find the installed plugin. Run: claude plugin list"
  exit 1
fi
HARNESS="$INSTALL_PATH/scripts/harness.mjs"
node "$HARNESS" status >/dev/null 2>&1 || true   # installs ~/.claude-harness/bin
say "  Plugin installed: v$(node -p "require(process.argv[1]).version" "$INSTALL_PATH/.claude-plugin/plugin.json")"
say ""

# 3. Knowledge graph ---------------------------------------------------------
if [ -z "$MODE" ]; then
  if can_prompt; then
    say "Knowledge graph (optional). It remembers decisions across sessions; it needs Docker."
    say "  1) anthropic  Claude Haiku extracts facts      (Anthropic API key, a few cents per session)"
    say "  2) openai     OpenAI extracts facts            (OpenAI API key)"
    say "  3) local      Ollama on this machine, no key   (experimental; ~5 GB download, 8 GB RAM)"
    say "  4) off        No knowledge graph (you can turn it on later)"
    DEFAULT_CHOICE=4
    [ "$DOCKER" != "none" ] && DEFAULT_CHOICE=1
    CHOICE="$(ask "Choose 1-4 [$DEFAULT_CHOICE]: ")"
    CHOICE="${CHOICE:-$DEFAULT_CHOICE}"
    case "$CHOICE" in
      1|anthropic) MODE="anthropic" ;;
      2|openai) MODE="openai" ;;
      3|local) MODE="local" ;;
      *) MODE="off" ;;
    esac
  else
    MODE="off"
  fi
fi

setup_with_key() {
  local mode="$1" var="$2" key=""
  if [ -n "${!var:-}" ]; then
    if [ "$ASSUME_YES" -eq 1 ] || ! can_prompt; then
      key="${!var}"
    else
      local use
      use="$(ask "Use the $var from your environment? [Y/n] ")"
      case "$use" in n|N|no|No) ;; *) key="${!var}" ;; esac
    fi
  fi
  if [ -z "$key" ] && can_prompt; then
    key="$(ask_secret "$var (input hidden): ")"
  fi
  if [ -z "$key" ]; then
    say "No $var given: skipping the knowledge graph. Set it up later with:"
    say "  node ~/.claude-harness/bin/harness.mjs graph setup"
    return 0
  fi
  printf '%s' "$key" | node "$HARNESS" graph setup --mode "$mode" --key-stdin
}

case "$MODE" in
  anthropic) setup_with_key anthropic ANTHROPIC_API_KEY ;;
  openai) setup_with_key openai OPENAI_API_KEY ;;
  local) node "$HARNESS" graph setup --mode local ;;
  off) say "Knowledge graph: off. Turn it on later with: node ~/.claude-harness/bin/harness.mjs graph setup" ;;
  *) say "Unknown mode '$MODE' (use anthropic, openai, local or off)"; exit 1 ;;
esac

say ""
say "Done. Next:"
say "  1. Open Claude Code in a project (restart it if it is already open)."
say "  2. Say: enable harness architecture"
say ""
say "Manage it from a terminal with: node ~/.claude-harness/bin/harness.mjs help"
