# code-agent-auto-commit

`code-agent-auto-commit` (`cac`) provides configurable code-agent-end auto-commit(using your git account) for:

- OpenCode
- Claude Code
- OpenAI Codex CLI

## Features

- Auto-commit when a chat/agent turn ends
- Commit strategies:
  - `single`: all changed files in one commit
  - `per-file`: one file per commit
- AI-generated commit messages with multi-provider model configuration
  - OpenAI-compatible mode (`openai-completions`)
  - Anthropic-compatible mode (`anthropic-messages`)
- Optional auto-push to GitHub, GitLab, or generic remotes
- Tool installers for OpenCode, Codex, and Claude Code

## Installation

```bash
pnpm add -g code-agent-auto-commit@latest
```

To update to the latest version:

```bash
pnpm update -g code-agent-auto-commit
OR:
pnpm add -g code-agent-auto-commit@latest
```

Then use the short command:

```bash
cac --help
```

## Quick Start

```bash
# 1. Initialize config
cac init

# 2. Configure AI API key for commit messages
#    Edit .cac/.code-agent-auto-commit.json — set your model and defaultProvider.
#    Fill keys in .cac/.env and load them:
source .cac/.env
#    OR:
cac ai set-key <provider|ENV_VAR> <api-key> [--config <path>]

# 3. Install hooks
cac install --tool all --scope project

# 4. Verify
cac status --scope project

# 5. Git config
git init

# 6. Agentic coding
opencode / claude / codex
```

> **Important:** After `cac init`, you **must** configure an AI provider API key.
> Without a valid key, AI commit messages will not work and `cac` falls back to
> generic `chore(auto): ...` prefixed messages.
>
> **Model tip:** Choose a fast, lightweight model (e.g. `gpt-4.1-mini`,
> `MiniMax-M2.1-highspeed`). Commit messages are short — speed matters more
> than intelligence here.

## Commands

```bash
cac init [--worktree <path>] [--config <path>]
cac install [--tool all|opencode|codex|claude] [--scope project|global] [--worktree <path>] [--config <path>]
cac uninstall [--tool all|opencode|codex|claude] [--scope project|global] [--worktree <path>]
cac status [--scope project|global] [--worktree <path>] [--config <path>]
cac run [--tool opencode|codex|claude|manual] [--worktree <path>] [--config <path>] [--event-json <json>] [--event-stdin]
cac set-worktree <path> [--config <path>]
cac ai <message> [--config <path>]
cac ai set-key <provider|ENV_VAR> <api-key> [--config <path>]
cac ai get-key <provider|ENV_VAR> [--config <path>]
```

### Command Details

- `cac init`: creates `.cac/.code-agent-auto-commit.json` under the worktree (unless `--config` is provided), and also writes `.cac/.env.example` and `.cac/.env` with default provider API key env vars.
- `cac install`: installs adapters/hooks for selected tools (`opencode`, `codex`, `claude`) in `project` or `global` scope. If no config exists at the resolved path, it creates one first.
- `cac uninstall`: removes previously installed adapters/hooks for selected tools and scope.
- `cac status`: prints resolved config path, worktree, commit mode, AI/push toggles, and install status of each adapter.
- `cac run`: executes one auto-commit pass (manual or hook-triggered). It reads config, filters changed files, stages/commits by configured mode, and optionally pushes. Hook-triggered runs also write logs to `.cac/run-<timestamp>.log`.
- `cac set-worktree`: updates only the `worktree` field in the resolved config file.
- `cac ai`: tests AI request (`cac ai "hi"`) or manages global keys (`set-key` / `get-key`).

## Config File

Default project config file:

`.cac/.code-agent-auto-commit.json`

Generated env templates:

- `.cac/.env.example`
- `.cac/.env`

You can copy from:

`.code-agent-auto-commit.example.json`

Full schema and options:

- `doc/CONFIG.md`
- `doc/zh-CN.md`

### AI Key Fields

- `ai.providers.<name>.apiKeyEnv` expects an environment variable name (for example, `MINIMAX_API_KEY`), not the raw key value.
- If you prefer storing a key directly in config, use `ai.providers.<name>.apiKey`.
- If AI request fails (missing key, invalid provider/model, or non-2xx response), `cac` falls back to `commit.fallbackPrefix`-style messages.

## AI Models (Multi-Provider)

Model format follows `provider/model` (OpenClaw-style). Example:

```json
{
  "ai": {
    "enabled": true,
    "model": "openai/gpt-4.1-mini",
    "defaultProvider": "openai",
    "providers": {
      "openai": {
        "api": "openai-completions",
        "baseUrl": "https://api.openai.com/v1",
        "apiKeyEnv": "OPENAI_API_KEY"
      },
      "anthropic": {
        "api": "anthropic-messages",
        "baseUrl": "https://api.anthropic.com/v1",
        "apiKeyEnv": "ANTHROPIC_API_KEY"
      },
      "moonshot": {
        "api": "openai-completions",
        "baseUrl": "https://api.moonshot.ai/v1",
        "apiKeyEnv": "MOONSHOT_API_KEY"
      }
    }
  }
}
```

## Integration Notes

- OpenCode: installs plugin under `.opencode/plugins/` or `~/.config/opencode/plugins/`
- Codex CLI: writes managed `notify` block in `.codex/config.toml` or `~/.codex/config.toml`
- Claude Code: installs `Stop` hook in `.claude/settings.json` or `~/.claude/settings.json`

If Codex config already has a custom `notify = ...`, installer stops and asks for manual merge.

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

## Open Source

- Contribution guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Code of conduct: `CODE_OF_CONDUCT.md`

## License

MIT
