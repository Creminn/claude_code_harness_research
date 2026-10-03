# claude-harness

A plug-and-play layer over Claude Code. Install it once on a Mac, Linux or Windows machine,
open Claude Code in a project and say **"enable harness architecture"**. You get:

| What | How |
|---|---|
| **Model and effort defaults** | Balanced (Opus, medium effort) or Economy (Sonnet, medium effort), written to your settings |
| **A subagent roster, each with its own model and effort** | `explorer` (Haiku), `implementer` (Sonnet, medium), `architect` (Opus, high), `reviewer` (Opus, high), `test-runner` (Haiku) |
| **Context management done by the harness** | A delegation policy injected at session start, an auto-compact window, and a status line showing context use against that window |
| **Optional knowledge graph** | [Graphiti](https://github.com/getzep/graphiti) in Docker. Hooks save your decisions and Claude's conclusions, and bring the relevant ones back at the start of every session and after compaction |

It works in the terminal, the Desktop app and the IDE extensions: all of them load the
same Claude Code plugin. Why it is built this way is in
[docs/harness-decision.md](docs/harness-decision.md).

## Requirements

- [Claude Code](https://code.claude.com/docs)
- [Node.js](https://nodejs.org) 20 or newer (the hooks and status line run on it)
- [Docker](https://www.docker.com/products/docker-desktop/), only for the knowledge graph

## Install

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/Creminn/claude_code_harness_research/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/Creminn/claude_code_harness_research/main/install.ps1 | iex
```

The installer:
1. Checks the prerequisites.
2. Installs the plugin into Claude Code.
3. Asks whether you want the knowledge graph, and which mode. If you choose one that needs an
   API key, you type it with hidden input. The key is stored only in
   `~/.claude-harness/graph/.env`, readable only by you.

It does not change your Claude Code settings yet.

**Options**

| Option (bash / PowerShell) | What it does |
|---|---|
| `--mode` / `-Mode` | `anthropic`, `openai`, `local` or `off` |
| `--yes` / `-Yes` | No questions. Keys come from the `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` environment variable |
| `--ref` / `-Ref` | Install from a branch or tag |

```bash
curl -fsSL https://raw.githubusercontent.com/Creminn/claude_code_harness_research/main/install.sh | bash -s -- --mode local
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Creminn/claude_code_harness_research/main/install.ps1))) -Mode local
```

**Without the script**, inside Claude Code:

```
/plugin marketplace add Creminn/claude_code_harness_research
/plugin install harness@claude-harness
```

The knowledge graph can be set up later from a terminal:

```
node ~/.claude-harness/bin/harness.mjs graph setup
```

## Turn it on

Open Claude Code in a project and say:

> enable harness architecture

The first time, Claude Code asks permission to run the `harness:enable` skill and its
`node` commands. Approve them; choosing "don't ask again" avoids the prompt next time.

Claude then asks two things:
- **Scope.** "This project" is the best first try. "All projects" applies it everywhere.
- **Profile.** Balanced or Economy.

Start a new session afterwards, or run `/reload-plugins`, so the model, effort and status
line apply.

- **Promote** a project you liked to all projects: say "apply the harness to all projects".
- **Undo** it: say "disable the harness". Every setting it changed goes back to its previous
  value. A setting you changed yourself since then is left alone.

Other skills: `/harness:status`, `/harness:remember <decision>`, `/harness:uninstall`.

### What "enable" changes

| Where | What |
|---|---|
| `.claude/settings.local.json` (this project; also added to `.git/info/exclude`) or `~/.claude/settings.json` (all projects) | `model`, `effortLevel`, `autoCompactWindow`, `statusLine`, and a deny rule that keeps Claude from reading the graph keys file |
| `~/.claude-harness/` | Harness state, the status line and CLI entry points, and graph configuration |
| Claude Code MCP config | A `harness-graph` server, only when the knowledge graph is on |

`autoCompactWindow` is 150,000 tokens when the graph is on, so compaction happens earlier
because the graph keeps what it drops, and 200,000 when it is off. Your `CLAUDE.md` is never
touched: the delegation policy is added at session start instead.

The plugin's hooks do nothing in projects where the harness is not enabled. Set
`HARNESS_DISABLE=1` to switch them off everywhere for one session. Installing the plugin adds
about 800 tokens to each session for the agent and skill descriptions.

## Knowledge graph

| Mode | Extracts facts with | Embeddings | Needs | Your conversation text goes to |
|---|---|---|---|---|
| `anthropic` (recommended) | Claude Haiku | Ollama `nomic-embed-text` in Docker | Anthropic API key | Anthropic |
| `openai` | OpenAI `gpt-5-mini` | OpenAI `text-embedding-3-small` | OpenAI API key | OpenAI |
| `local` (experimental) | Ollama `qwen2.5:7b` | Ollama `nomic-embed-text` | No key; about 5 GB download and 8 GB RAM | Nowhere |
| `off` | | | | |

- **Ollama:** if Ollama is already running on your machine, the harness uses it instead of a
  container. That is much faster on a Mac.
- **Local mode is experimental.** In CI, a 1.5B model on CPU took about 5 minutes per
  episode and extracted irrelevant entities. Use at least a 7B model (the default), ideally
  on a host Ollama with a GPU or Apple Silicon. Choose another model with
  `harness graph setup --mode local --llm-model <model>`.
- **API keys:** these are API keys, separate from a Claude subscription. Extraction runs a few
  times per long session, on the cheapest model.

**What is stored.**
- **Stored:** your prompts and Claude's final answers, with secrets redacted, grouped per
  repository. Results from the architect and reviewer agents are stored too.
- **Not stored:** tool output, file contents, and the explorer and test-runner results.
- To turn graph writes off for one project, enable it with `--no-graph-write`.

**What comes back.**
- At every session start, a short briefing of current decisions, constraints and open tasks.
- After compaction, a digest of the last exchange.
- Agents and Claude can search the graph through the `harness-graph` MCP server.
- `"recall": true` in `~/.claude-harness/config.json` also adds related facts to each prompt.
  This is off by default.

**Compatibility shim.** Graphiti 1.1.0 calls the Anthropic SDK with an argument the bundled
SDK no longer accepts, which breaks extraction in `anthropic` mode. The harness mounts a
small `sitecustomize.py` that removes that argument
(`plugins/harness/graph/patches/sitecustomize.py`). It does nothing once Graphiti fixes the
call upstream.

**Safety.**
- The graph server listens only on `127.0.0.1:18000`.
- The database port is never published.
- The browser UI opens only when you ask: `harness graph ui`, at http://127.0.0.1:13000.

## Command line

All commands are `node ~/.claude-harness/bin/harness.mjs <command>`:

| Command | Does |
|---|---|
| `doctor` | Check prerequisites, show the setup and anything overriding it |
| `enable --scope project\|global --profile balanced\|economy` | What the enable skill runs |
| `disable --scope project\|global` | Restore the settings |
| `promote` | Apply a project's setup to all projects |
| `status` | Is the harness active here; graph state |
| `remember "<text>"` | Store a decision now |
| `graph setup` | Choose or change the graph mode and key (interactive) |
| `graph up` / `graph down [--purge]` | Start or stop the graph |
| `graph ui [--off]` | Open or close the graph browser |
| `graph logs` | Show the graph server logs |
| `uninstall [--purge]` | Remove everything; `--purge` also deletes the graph data |

## Update and uninstall

Third-party plugins do not auto-update, so update them yourself:

```bash
claude plugin marketplace update claude-harness && claude plugin update harness@claude-harness
```

To uninstall:

```bash
curl -fsSL https://raw.githubusercontent.com/Creminn/claude_code_harness_research/main/uninstall.sh | bash          # macOS / Linux
```

```powershell
irm https://raw.githubusercontent.com/Creminn/claude_code_harness_research/main/uninstall.ps1 | iex                  # Windows
```

## Troubleshooting

- **Hooks error with "node: command not found"**: install Node.js 20+.
  - On macOS, apps started from the Dock may not see a Node installed through nvm. Install
    Node with Homebrew or from nodejs.org.
- **The model or effort didn't change**: start a new session.
  - `harness doctor` lists anything that overrides the harness, such as `ANTHROPIC_MODEL` or
    a `model` in the project's `.claude/settings.json`.
- **Graph shows ○ in the status line**: start Docker, then run `harness graph up`.
  `harness graph logs` shows why it failed.
- **Switching graph modes**: modes with different embedding models use separate data volumes,
  so switching never mixes vectors. Facts from the other mode are not visible until you
  switch back.

## Development

```bash
cd plugins/harness && node --test        # unit and hook tests (no Docker needed)
claude plugin validate plugins/harness   # manifest, agents, skills
```

To try the installer against a local checkout or a fork, set `HARNESS_SOURCE` to a path or
an `owner/repo#ref`, for example `HARNESS_SOURCE=$PWD bash install.sh`. CI does this on
macOS, Linux and Windows (Windows PowerShell 5.1), then enables, disables and uninstalls.

Repository layout:
- `.claude-plugin/marketplace.json`: the marketplace
- `plugins/harness/`: the plugin
  - `agents/`, `skills/`, `hooks/`
  - `scripts/`: the Node CLI, hook dispatcher and status line, with no dependencies
  - `graph/`: Docker Compose for Graphiti and Ollama
  - `test/`
- `install.*` and `uninstall.*`: the bootstrap scripts
