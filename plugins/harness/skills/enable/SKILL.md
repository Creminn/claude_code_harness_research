---
name: enable
description: Turns on the harness architecture (model and effort defaults, subagent roster, context management hooks, status line and the optional knowledge graph) for this project or for all projects.
when_to_use: Use when the user says "enable harness architecture", "enable the harness", "turn on the harness", "set up the harness", "activate claude-harness", or asks to apply the harness globally / to all projects (promote).
argument-hint: "[project|global] [balanced|economy]"
allowed-tools: Bash(node:*)
---

# Enable the harness architecture

Arguments given: `$ARGUMENTS`

Follow these steps exactly.

1. Check the machine:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/harness.mjs" doctor --json --project "${CLAUDE_PROJECT_DIR}"
   ```

   - If `node.ok` is false, stop and tell the user to install Node.js 20 or newer (https://nodejs.org), then try again.
   - Remember `scopes.activeHere`, `existingStatusLine`, `graph` and `docker` for the next steps.

2. Decide the scope, profile and status line. Use the arguments when they say it; otherwise ask with **one** AskUserQuestion call containing these questions (skip any that do not apply):
   - **Scope**: "This project" (recommended the first time: try it here first) or "All projects" (writes to the user settings). If `scopes.activeHere.kind` is already `project` and the user asked to apply it globally, use `promote` in step 3 instead of asking.
   - **Profile**: "Balanced: Opus, medium effort (Recommended)" or "Economy: Sonnet, medium effort".
   - **Status line**: only if `existingStatusLine.project` (for project scope) or `existingStatusLine.global` (for all projects) is not null: "Keep my status line" or "Use the harness status line".

3. Run one of these (add `--statusline replace` only if the user chose the harness status line):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/harness.mjs" enable --scope project --profile <balanced|economy> --project "${CLAUDE_PROJECT_DIR}"
   node "${CLAUDE_PLUGIN_ROOT}/scripts/harness.mjs" enable --scope global --profile <balanced|economy> --project "${CLAUDE_PROJECT_DIR}"
   node "${CLAUDE_PLUGIN_ROOT}/scripts/harness.mjs" promote --profile <balanced|economy> --project "${CLAUDE_PROJECT_DIR}"
   ```

   Starting the knowledge graph the first time can take a few minutes while Docker downloads images; use a long timeout for this command.

4. Report back briefly:
   - What was enabled and where the settings were written.
   - The knowledge graph state. If the graph mode is `off` and Docker is installed, tell the user they can turn it on by running this **in their own terminal** (never ask them to paste an API key into this chat):
     `node ~/.claude-harness/bin/harness.mjs graph setup`
   - That the model, effort and status line apply to new sessions: they should restart Claude Code or run `/reload-plugins`.
   - How to undo it: say "disable the harness" (or `/harness:disable`).
