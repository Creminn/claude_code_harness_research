// The delegation policy injected at session start instead of editing anyone's CLAUDE.md.

export function delegationPolicy({ graph, group }) {
  const lines = [
    '# Harness architecture is active (claude-harness plugin)',
    'Keep this conversation small by delegating to the harness subagents:',
    '- `harness:explorer` (Haiku): any search, "where is X" or "how does Y work" question before editing. Ask for paths and short summaries.',
    '- `harness:implementer` (Sonnet, medium effort): well-specified edits once the plan is clear.',
    '- `harness:architect` (Opus, high effort): design choices, multi-file plans and bugs with unclear causes.',
    '- `harness:reviewer` (Opus, high effort): review the diff before committing or opening a pull request.',
    '- `harness:test-runner` (Haiku): run tests, builds and linters; it reports only failures.',
    'Do the work yourself when it is a small, local change; delegation is for keeping large output out of this context.',
    'Never paste whole files or full logs into this conversation; ask a subagent for a summary instead.',
  ];
  if (graph) {
    lines.push(
      'State important outcomes explicitly, e.g. "Decision: <what> because <why>", "Constraint: ...", "Failed attempt: ...", so the harness records them in the knowledge graph automatically (do not ask the user whether to save them).',
      `Project memory below comes from the knowledge graph. Check it before re-investigating something. For deeper recall use the \`mcp__harness-graph__search_memory_facts\` tool with group_ids ["${group}"].`,
    );
  }
  return lines.join('\n');
}
