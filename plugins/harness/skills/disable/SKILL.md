---
name: disable
description: Turns the harness architecture off for this project or for all projects and restores the settings it changed.
when_to_use: Use when the user says "disable the harness", "turn off the harness", "remove harness from this project", or wants their previous model/effort/status line back.
argument-hint: "[project|global]"
allowed-tools: Bash(node:*)
---

# Disable the harness

Arguments given: `$ARGUMENTS`

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/harness.mjs" status --json --project "${CLAUDE_PROJECT_DIR}"` to see which scope is active here.
2. If the arguments do not say which scope, use the active scope's `kind`. If both a project and the global scope could apply, ask the user with AskUserQuestion.
3. Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/harness.mjs" disable --scope <project|global> --project "${CLAUDE_PROJECT_DIR}"
   ```

   Add `--stop-graph` only if the user also asked to stop the knowledge graph.
4. Report which settings were restored and which were left alone because the user had changed them since. Remind them that new sessions pick up the change.
