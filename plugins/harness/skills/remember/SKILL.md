---
name: remember
description: Stores a decision, constraint or fact in the project's knowledge graph right away.
when_to_use: Use when the user says "remember that ...", "record this decision", "add this to the knowledge graph", or "note for the project: ...".
argument-hint: "<decision or fact>"
allowed-tools: Bash(node:*)
---

# Remember in the knowledge graph

Text to store: `$ARGUMENTS`

1. Rewrite the text as one or two clear sentences, for example "Decision: use PostgreSQL for job storage because the queue needs transactions." Keep names and reasons. Do not include secrets.
2. Run, passing the sentence through stdin so quoting is safe:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/harness.mjs" remember --stdin --project "${CLAUDE_PROJECT_DIR}"
   ```

   with the sentence as the command's standard input (for example with a heredoc).
3. If it reports that the graph is off or unreachable, tell the user how to turn it on: run `node ~/.claude-harness/bin/harness.mjs graph setup` (or `graph up`) in their terminal.
