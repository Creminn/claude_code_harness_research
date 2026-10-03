---
name: uninstall
description: Completely removes the harness: restores settings in every project, stops the knowledge graph and uninstalls the plugin.
when_to_use: Use only when the user explicitly asks to uninstall or completely remove the harness / claude-harness.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

# Uninstall the harness

1. Confirm with the user (AskUserQuestion) whether to also delete the knowledge graph data (`--purge`) or keep it.
2. Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/harness.mjs" uninstall --yes [--purge]
   ```

3. Report what was restored. Tell the user to restart Claude Code.
