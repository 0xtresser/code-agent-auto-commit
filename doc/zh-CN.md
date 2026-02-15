# code-agent-auto-commit User Guide

`code-agent-auto-commit` (`cac`) is a TypeScript-based auto-commit tool for:

- OpenCode
- Codex CLI
- Claude Code

It runs commits automatically when a chat/agent turn ends.

## Quick Start

```bash
# 1. 初始化配置
cac init

# 2. 配置 AI API Key（必须，否则无法生成 AI commit message）
#    编辑 .cac/.code-agent-auto-commit.json，设置 model 和 defaultProvider。
#    在 .cac/.env 中填入 API Key 后加载：
source .cac/.env
#    或者:
cac ai set-key <provider|ENV_VAR> <api-key> [--config <path>]

# 3. 安装钩子
cac install --tool all --scope project

# 4. 验证状态
cac status --scope project
```

> **重要：** `cac init` 之后**必须**配置 AI provider 的 API Key。
> 没有有效的 Key，AI 生成 commit message 会失败，`cac` 会退回到
> `chore(auto): ...` 格式的通用消息。
>
> **模型选择建议：** 推荐选择速度快、轻量的模型（如 `gpt-4.1-mini`、
> `MiniMax-M2.1-highspeed`）。Commit message 内容很短，速度比智能更重要。

## Command Reference

- `cac init [--worktree <path>] [--config <path>]`
  - Initializes a config file.
  - 默认写入 `<worktree>/.cac/.code-agent-auto-commit.json`；也会生成 `.cac/.env.example` 和 `.cac/.env`。
  - 可通过 `--config` 指定自定义路径。

- `cac install [--tool all|opencode|codex|claude] [--scope project|global] [--worktree <path>] [--config <path>]`
  - Installs auto-commit adapters for selected tools (OpenCode/Codex/Claude).
  - `--scope project` writes project-level config, `--scope global` writes user-level config.
  - Creates the target config file automatically when it does not exist.

- `cac uninstall [--tool all|opencode|codex|claude] [--scope project|global] [--worktree <path>]`
  - Uninstalls adapters/hooks for selected tools.

- `cac status [--scope project|global] [--worktree <path>] [--config <path>]`
  - Shows active config and install status.
  - Output includes config path, worktree, commit mode, AI/Push toggles, and adapter install status for each tool.

- `cac run [--tool opencode|codex|claude|manual] [--worktree <path>] [--config <path>] [--event-json <json>] [--event-stdin]`
  - Executes one auto-commit pass (manual trigger or hook trigger).
  - Runs the configured pipeline: filter files -> stage -> commit -> optional push.
  - 由聊天结束自动触发时，会把本次输出写到 `.cac/run-<timestamp>.log`。

- `cac ai <message> [--config <path>]`
  - 发送一条测试消息到当前 AI 配置并打印回复。

- `cac ai set-key <provider|ENV_VAR> <api-key> [--config <path>]`
  - 全局设置 API Key（写入 `~/.config/code-agent-auto-commit/keys.env`），并自动尝试把 source 语句加入 shell rc。

- `cac ai get-key <provider|ENV_VAR> [--config <path>]`
  - 查看当前 key 是否已配置（以脱敏形式显示）。

- `cac set-worktree <path> [--config <path>]`
  - Updates only the `worktree` field in config and leaves other settings unchanged.

## Configurable Options

- Commit modes:
  - `single`: commit all files in one commit
  - `per-file`: one commit per file
- AI commit messages: supports `provider/model` with multiple providers (OpenAI-compatible and Anthropic-compatible)
- Auto-push: configurable for GitHub/GitLab

## Config File

Default location in repository root: `.cac/.code-agent-auto-commit.json`

For full field details, see `doc/CONFIG.md`.

## Important Notes

- `.env` and key-like files are excluded by default.
- `per-file` mode requires a clean staging area.
- Push is disabled by default; verify remote and branch settings before enabling.
- `ai.providers.<name>.apiKeyEnv` must be an environment variable name (for example, `MINIMAX_API_KEY`), not the raw key.
- If you want to store the key directly in config, use `ai.providers.<name>.apiKey`.
