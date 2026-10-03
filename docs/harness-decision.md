# A layer over Claude Code: which option?

> The recommended setup is implemented as an installable plugin in this repo: see the [README](../README.md).

Researched 2026-10-03. Claude Code facts are checked against <https://code.claude.com/docs>.
Facts about open-source projects (license, activity) come from GitHub on the same date.

## Requirements

1. Decide which model runs.
2. Decide which agent runs with which model.
3. Decide which effort level is used for each piece of work.
4. Keep context healthy and token use low, with the harness doing it, not the model.
5. Work from a GUI and from a terminal.
6. Keep a knowledge graph so project context is not lost between sessions.

## Verdict

Don't choose any of the three options as stated. Use a **configure-first hybrid**:

1. **Use Claude Code's own controls as the layer.** Settings, subagent frontmatter and hooks
   already cover requirements 1–4. Requirement 5 is covered by the official apps.
2. **Add one open-source knowledge graph.** This is the only real gap (requirement 6).
   Optionally add an open-source GUI as well.
3. **Build only a thin layer yourself.** Make it a plugin in this repo: agents, hooks, skills and a
   graph MCP server, plus project settings and a short CLAUDE.md.
   Add a small Agent SDK driver later, and only if you need the model and effort chosen
   automatically for every task.

| Option | Verdict | Why |
|---|---|---|
| Edit only CLAUDE.md | ❌ Not enough | CLAUDE.md is text the model reads, not configuration. It cannot switch models, set effort or run compaction. It is loaded every session, so a large CLAUDE.md *increases* token use. The docs recommend keeping it under 200 lines. |
| Adopt one open-source harness | ⚠️ Not alone | No single project covers all six requirements well. The closest is Ruflo (formerly claude-flow). It adds hundreds of MCP tools and dozens of hooks, which works against the token goal. |
| Build a harness from scratch | ❌ Not worth it | You would rebuild the agent loop, tools, permissions, compaction and UI that Claude Code already has. You would also have to keep up with a CLI that releases very often. |
| **Native config + 1–2 OSS pieces + thin custom layer** | ✅ **Recommended** | About 80% is configuration. The custom code is limited to hooks and a graph adapter. |

## Requirement → mechanism

| # | Requirement | Native mechanism | Gap | What fills the gap |
|---|---|---|---|---|
| 1 | Which model runs | `/model`, `--model`, `"model"` in settings.json, the `opusplan` alias (Opus for planning, Sonnet for execution), and `modelSettings` per model | The main session's model is not chosen automatically per task | Subagents (row 2). Optionally an SDK driver |
| 2 | Agent → model | `.claude/agents/*.md` frontmatter `model:` takes `sonnet`, `opus`, `haiku`, `fable`, a full model ID or `inherit`. `CLAUDE_CODE_SUBAGENT_MODEL` is the fallback | None | Your agent roster (below) |
| 3 | Effort | `/effort`, `--effort`, `effortLevel`, effort per model via `modelSettings`, a `maxEffortLevel` cap, and **subagent `effort:` (`low`…`max`)** | **Hooks cannot change model or effort.** `PreModelSwitch` can only allow or block a switch; hooks can read `$CLAUDE_EFFORT` | Put effort on each agent. Optionally an SDK driver |
| 4 | Context managed by the harness | Auto-compaction (`autoCompactEnabled`, `autoCompactWindow`), `/compact <focus>`, `/context`, subagent context isolation, MCP tools loaded on demand, path-scoped `.claude/rules/`, on-demand skills, `PreCompact`/`PostCompact`/`SessionStart(compact)` hooks, `statusLine` | Compaction loses detail and nothing stores it durably | Hooks plus the knowledge graph. Compress command output |
| 5 | GUI + terminal | Desktop app (Code tab), VS Code and JetBrains extensions, claude.ai/code, Remote Control. `--resume` and `--continue` reopen the same session | The official UIs are not open source | Optionally CloudCLI or Nimbalyst |
| 6 | Knowledge graph | CLAUDE.md and auto memory (`~/.claude/projects/<project>/memory/`; the first 200 lines or 25 KB of `MEMORY.md` load each session). **Markdown only: no graph, no semantic search** | **Real gap** | Graphiti, cognee or the MCP memory server, wired in through hooks |

## Recommended architecture

```
 GUI: Desktop app / VS Code / claude.ai/code ──┐
 Terminal: claude ─────────────────────────────┤  the same session (--resume / Remote Control)
                                               ▼
                         Claude Code  (unmodified harness)
                                               │ loads
   ┌──────────────── this repo ────────────────┴─────────────────────────────┐
   │ .claude/settings.json   model, effortLevel, auto-compact window, status │
   │ CLAUDE.md (<200 lines)  delegation policy only, no reference material   │
   │ plugin/                                                                 │
   │   agents/      role → model + effort   (the routing table)              │
   │   hooks/       SessionStart · UserPromptSubmit · PreCompact · SessionEnd│
   │   skills/      workflows that load only when used                       │
   │   graph/       knowledge-graph stack (Docker), registered when enabled  │
   └─────────────────────────────────────────────┬───────────────────────────┘
                                                 │ MCP
                                 Knowledge graph (Graphiti / cognee)
```

### Agent roster: routing by task type

The main agent hands each task to a subagent by matching it against the subagent's
`description`. Each subagent always runs with its own model and effort. That gives you
routing by task type with no custom code.

| Agent | `model` | `effort` | Tools | Used for |
|---|---|---|---|---|
| `explorer` | haiku | low | Read, Grep, Glob | "Where is X?" and "How does Y work?" It keeps file dumps out of the main context |
| `implementer` | sonnet | medium | edit + Bash | Changes that are already well specified |
| `architect` | opus | high | read-only | Design, hard debugging, planning |
| `reviewer` | opus | high | read-only | Reviewing diffs before commit |
| `test-runner` | haiku | low | Bash, Read | Running tests and reporting only the failures |

Main session: `opusplan`, or a strong model at `medium` effort. Raise it with `/effort` or
`/model` only when a task needs more.

```markdown
---
name: explorer
description: Read-only codebase search. Use for "where is X" / "how does Y work" before editing.
model: haiku
effort: low
tools: Read, Grep, Glob
---
Return file paths with line numbers and a summary of at most 5 lines. Never paste whole files.
```

### Context management done by the harness

| Hook / setting | What it does |
|---|---|
| `SessionStart` (`startup`, `resume`, `compact`, `clear`) | Injects a short project-state block (about 1–2K tokens) from the graph: current goal, open decisions, recent failures |
| `PreCompact` | Writes decisions and facts from the transcript into the graph *before* the summary drops them |
| `UserPromptSubmit` | Optional. Adds only the few graph facts most relevant to the prompt, under a fixed size limit |
| `SessionEnd` | Final write to the graph |
| Auto-compact window + `/compact <focus>` | Compaction happens at your chosen threshold and keeps what matters |
| `statusLine` | Shows how full the context is at all times |
| Command-output compression ([rtk](https://github.com/rtk-ai/rtk)) | Cuts noisy test and build output before it reaches the model |
| Skills and `.claude/rules/` instead of a long CLAUDE.md | Instructions load only when they are relevant |

The principle: **the harness writes memory and reads it back through hooks.** You don't
rely on the model remembering to save or recall things.

### Where the knowledge graph sits

The graph runs **beside** Claude Code, not inside it. It is a local service, connected at the
plugin level. It is never loaded into context whole. A slice of it enters context only when a
hook or a tool call asks for it.

```
                    ┌──────────────── Claude Code session ────────────────┐
                    │  context window = working memory (gets compacted)   │
                    │      ▲ briefing        ▲ top-k facts      │ ▲       │
                    └──────┼─────────────────┼──────────────────┼─┼───────┘
  READ, pushed by hooks:   SessionStart      UserPromptSubmit   │ │ READ, pulled by the model:
  (deterministic,          (startup/resume/  (optional,         │ │ MCP tools search_facts /
   size-capped)             compact/clear)    ≤ ~500 tokens)    │ │ get_entity (deferred: no
                                                                │ │ cost until used)
  WRITE, by hooks:  PreCompact · SubagentStop · SessionEnd      │ │
     (async: true, so the session never waits)                  ▼ │
             prompt / last_assistant_message ──► extractor (cheap model, outside
                                                                     the main context)
                                                                  │ │
                                                                  ▼ │
                              Knowledge graph service (local Docker, one group per repo)
```

**Memory tiers.** Each tier has one job, and they don't overlap:

| Tier | Holds | Written by | Loaded |
|---|---|---|---|
| Context window | The current task | The session | Always, then compacted |
| CLAUDE.md / `.claude/rules/` | **Rules**: how to work here | You | Every session, or by path |
| Auto memory (`MEMORY.md`) | Claude's short notes on your preferences | Claude | First 200 lines |
| **Knowledge graph** | **Facts that code doesn't show**: decisions and their reasons, constraints, failed attempts, bug causes, task state, open questions | **Hooks plus an extractor** | **Only the slice a hook or query asks for** |
| Code and git | What the system *is* | You and the agents | Read on demand (grep, explorer agent) |

**What goes in and what stays out.**

- **In:** `Decision` (what, why, date, which decision it supersedes), `Constraint`, `Component`
  (modules only, not every function), `Task` (status), `Bug` (symptom, root cause, the commit that
  fixed it), `FailedAttempt`, `Convention`, `OpenQuestion`.
  Relations: `depends_on`, `decided_because`, `supersedes`, `fixed_by`, `blocks`.
- **Out:** code, whole transcripts, anything grep or git can answer, and secrets.
  A code-structure graph such as codebase-memory-mcp is a separate tool, because it can be
  regenerated from the code at any time.

**Why this placement serves the token goal.** `PreCompact` saves facts to the graph and
`SessionStart(compact)` brings back a short briefing, so compaction no longer loses them.
That makes it safe to compact *earlier*, with a lower auto-compact window, and to keep the
working context small. The tokens spent on extraction go to a cheap model, outside the
main conversation.

**Wiring.** One plugin ships both connections:

- `harness enable` registers the graph's MCP server only when a graph mode is configured.
  Only the agents that need it list its tools in their `tools:` field: `architect` and
  `reviewer`, but not `explorer`. Plugin agents cannot use the `mcpServers:` field.
- `hooks.json` holds the read and write hooks. They are `node` scripts (the cross-platform
  pattern from the docs), and the write hooks run with `"async": true` so the session never
  waits.

Because the graph is attached at the Claude Code level, the Desktop app, VS Code and the
terminal all share the same graph. Use the graph's own browser (FalkorDB or Neo4j) to
inspect and correct facts.

### Chosen: Graphiti MCP server on FalkorDB

| Part | Choice | Why |
|---|---|---|
| Graph engine | [Graphiti](https://github.com/getzep/graphiti) MCP server | It is **bi-temporal**: when a new fact contradicts an old one, the old one is marked no longer valid instead of being deleted. Project decisions change all the time, so this is the deciding feature. Its ingestion is built around *episodes*, which matches "one write per compaction, subagent or session". Search combines keyword, vector and graph search with no LLM call, so read hooks stay fast and free |
| Database | FalkorDB, the default. It ships in the same container as the server. Its web UI is published only on demand (`harness graph ui`, at `127.0.0.1:13000`) | A single container. The UI has no authentication, so it stays off by default. Neo4j is supported if you outgrow it |
| Extraction LLM | Chosen per machine at install: Anthropic Haiku (default), an OpenAI small model, or a local Ollama model (experimental) | Ingestion makes several LLM calls per episode, so use the cheapest model. Keep `SEMAPHORE_LIMIT` low |
| Embeddings | Local Ollama `nomic-embed-text` sidecar (Anthropic and local modes), or OpenAI `text-embedding-3-small` (OpenAI mode) | Graphiti's embedders are remote APIs only (OpenAI, Azure, Gemini, Voyage), and Anthropic has none. Ollama's OpenAI-compatible endpoint fills the gap with no key. Voyage is avoided because it makes Graphiti download a 2.3 GB reranker at startup |
| Namespacing | `group_id` = repo name plus a short hash of its remote URL, so each repo gets its own graph on FalkorDB and worktrees share it | Keeps projects separate |
| Entity types | `Decision`, `Constraint`, `Component`, `Task`, `Bug`, `FailedAttempt`, `Convention`, `OpenQuestion`, set in the server's `config.yaml` under `graphiti.entity_types` | Points extraction at facts the code can't tell you |
| Transport | HTTP at `http://127.0.0.1:18000/mcp`, bound to localhost only. Claude Code supports HTTP MCP servers natively | No bridge needed. `127.0.0.1` avoids IPv6 `::1` mismatches |

**Tools used.**

- Write hooks use `add_memory`. They send only your prompts and Claude's final answers,
  with secrets redacted, never tool output. The transcript file is not parsed, because its
  format is internal to Claude Code.
- Read hooks and agents use `search_memory_facts` and `search_nodes`.
- No delete tools are used in v1: in image 1.1.0 they only reach the default graph.
- Never expose `clear_graph` to agents.

**MCP registration.** Because the graph is optional, the plugin does not ship a static
`.mcp.json`. Enabling the harness runs
`claude mcp add --transport http harness-graph http://127.0.0.1:18000/mcp` only when a graph mode
is configured, so machines without Docker never see a failing MCP server.

**Rejected options.**

- **cognee:** a good graph-plus-vector store with an official Claude Code plugin, but it does
  not invalidate outdated facts over time. Its verbs (`remember`, `recall`, `improve`,
  `forget`) are built for the model calling them, not for hooks.
- **MCP memory server:** no deduplication, no semantic search and no time model, and the
  model has to write to it by hand.
- **claude-mem:** not a graph.
- **mem0:** built for chat personalization.

Revisit cognee if you later want documents such as PDFs and wikis in the same memory.

### Knowledge graph options

| Option | Type | Infrastructure | When to choose it |
|---|---|---|---|
| [Graphiti MCP](https://github.com/getzep/graphiti) | Temporal knowledge graph that marks outdated facts as no longer valid | Docker, FalkorDB or Neo4j, and an LLM key for extraction | Project facts and decisions change over time. **This is the best fit for "don't lose context".** |
| [cognee](https://github.com/topoteretes/cognee) | Graph plus vector store. Has a Claude Code plugin and can extract locally | A Python service | You want an all-rounder that includes a code graph |
| [MCP memory server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | Minimal graph of entities and relations in a JSONL file | None | Start here to prove the hooks work, then move to one of the above |
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | Graph of code structure | One binary | Add-on that reduces file reads. It does not replace project memory |

**Choose one memory system.** Memory plugins all hook the same events, so they conflict, and
every injection costs tokens. `claude-mem` is popular but it is vector and keyword search,
not a graph.

## Open-source landscape (summary)

| Category | Worth a look | Notes |
|---|---|---|
| GUI | [CloudCLI](https://github.com/siteboon/claudecodeui) (web and mobile, built-in shell, AGPL-3.0), [Nimbalyst](https://github.com/nimbalyst/nimbalyst) (desktop, worktrees, terminal, MIT), [Orca](https://github.com/stablyai/orca) (MIT) | opcode/Claudia has had no code commits since Oct 2025. Vibe Kanban's company shut down and the project is now community-maintained. CUI and claude-code-webui are archived |
| Orchestration | [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) (automatic model tiering), [wshobson/agents](https://github.com/wshobson/agents) (agent library with models set explicitly; take only what you need) | [Ruflo / claude-flow](https://github.com/ruvnet/ruflo) is the closest to all-in-one, but heavy and full of claims. SuperClaude, BMAD and spec-kit are methods, not harnesses |
| Model gateways | [claude-code-router](https://github.com/musistudio/claude-code-router), [LiteLLM](https://github.com/BerriAI/litellm) | Only needed for non-Anthropic models or central budgets |
| Token hygiene | [rtk](https://github.com/rtk-ai/rtk), [claude-hud](https://github.com/jarrodwatts/claude-hud), [ccusage](https://github.com/ccusage/ccusage) | Native `/context` and `/usage` cover much of this |

## When to build more yourself

Write a thin driver on the Claude Agent SDK only if you need one of these:

- The model and effort chosen automatically for **every** task in the main loop. For example,
  classify the request first, then call `query({ model, effort, agents })`.
- A UI of your own design.
- Unattended pipelines, for example
  `claude -p --model … --effort … --agents '<json>' --output-format stream-json`.

The SDK is `@anthropic-ai/claude-agent-sdk` for TypeScript and `claude-agent-sdk` for Python.
Keep the driver thin: it chooses settings and launches Claude Code. It does not reimplement the
agent loop. Check how SDK usage is billed for your account before relying on it.

## Phased plan

1. **Native config (1–2 days).** Agent roster, settings, a CLAUDE.md under 200 lines, a status line.
   Record baseline token use with `/context` and `/usage`.
2. **Knowledge graph.** Add the MCP server plus `SessionStart`, `PreCompact` and `SessionEnd` hooks.
   Compare token use and session continuity with the baseline.
3. **Token hygiene.** Output compression, path-scoped rules, and skills in place of CLAUDE.md text.
4. **Optional.** An open-source GUI, and an SDK driver for automatic routing.

Package steps 1–3 as a plugin in this repo so the layer is versioned and installs the same way
on every machine.

## Risks

- **Claude Code releases often.** Build on the plugin, hook and SDK interfaces. Tools that scrape
  CLI output or session logs break first.
- **Star counts are unreliable.** They grew abnormally fast in 2026, so check commit activity instead.
- **Licenses.** AGPL-3.0: CloudCLI, opcode. ELv2: context-mode, Superset. PolyForm Noncommercial: GitNexus.
- **Third-party gateways or relays** used with a Claude subscription may conflict with Anthropic's terms.
- **Memory injection costs tokens.** Cap it and measure it.

## Sources

- Model and effort: <https://code.claude.com/docs/en/model-config>
- Subagents (`model`, `effort`, `memory`, `isolation` frontmatter): <https://code.claude.com/docs/en/sub-agents>
- Settings (`effortLevel`, `maxEffortLevel`, `modelSettings`, `autoCompactEnabled`, `autoCompactWindow`, `autoMemoryEnabled`, `statusLine`): <https://code.claude.com/docs/en/settings-reference>
- Hooks (event list, `PreModelSwitch`, `SessionStart` sources): <https://code.claude.com/docs/en/hooks>
- Memory (CLAUDE.md, `@path` imports, auto memory): <https://code.claude.com/docs/en/memory>
- Context window: <https://code.claude.com/docs/en/context-window>
- Plugins: <https://code.claude.com/docs/en/plugins>
- Agent SDK: <https://code.claude.com/docs/en/agent-sdk/typescript>, <https://code.claude.com/docs/en/agent-sdk/python>
