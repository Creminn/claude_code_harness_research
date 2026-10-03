---
name: status
description: Shows whether the harness architecture is active here, which settings it applied, the knowledge graph state and any problems with the setup.
when_to_use: Use when the user asks "is the harness on", "harness status", "check the harness", "is the knowledge graph running", or something about the harness looks broken.
allowed-tools: Bash(node:*)
---

# Harness status

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/harness.mjs" doctor --json --project "${CLAUDE_PROJECT_DIR}"`.
2. Summarise in a few lines: active scope and profile, graph mode and health, project group, and every item in `shadows` (settings or environment variables that override the harness).
3. For each problem, give the fix:
   - Node too old: install Node.js 20+.
   - Graph mode set but `healthy` is false: start Docker, then run `node ~/.claude-harness/bin/harness.mjs graph up` in a terminal; `graph logs` shows errors.
   - `missingKey` set: run `node ~/.claude-harness/bin/harness.mjs graph setup` in a terminal (keys are never typed into this chat).
