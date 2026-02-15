# Configuration Reference

`cac` reads JSON config from:

1. `--config <path>` if provided
2. `<worktree>/.cac/.code-agent-auto-commit.json` if it exists
3. `<worktree>/.code-agent-auto-commit.json` if it exists (legacy path)
4. `~/.config/code-agent-auto-commit/config.json`

## Schema

```json
{
  "version": 1,
  "enabled": true,
  "worktree": "/absolute/path",
  "commit": {
    "mode": "single",
    "fallbackPrefix": "chore(auto)",
    "maxMessageLength": 72
  },
  "ai": {
    "enabled": true,
    "timeoutMs": 15000,
    "model": "minimax/MiniMax-M2.5-highspeed",
    "defaultProvider": "minimax",
    "providers": {
      "openai": {
        "api": "openai-completions",
        "baseUrl": "https://api.openai.com/v1",
        "apiKeyEnv": "OPENAI_API_KEY"
      },
      "minimax": {
        "api": "openai-completions",
        "baseUrl": "https://api.minimaxi.chat/v1",
        "apiKeyEnv": "MINIMAX_API_KEY"
      }
    }
  },
  "push": {
    "enabled": true,
    "provider": "github",
    "remote": "origin",
    "branch": "main"
  },
  "filters": {
    "include": [],
    "exclude": [".env", ".env.*", "*.pem", "*.key", "*.p12"]
  }
}
```

## AI Provider Config (OpenClaw-style)

- `ai.model`: supports `provider/model` format (example: `openai/gpt-4.1-mini`, `anthropic/claude-3-5-sonnet-latest`).
- `ai.defaultProvider`: used when `ai.model` does not include a provider prefix.
- `ai.providers.<name>.api`:
  - `openai-completions` -> `POST /chat/completions`
  - `anthropic-messages` -> `POST /messages`
- `ai.providers.<name>.baseUrl`: provider endpoint base URL.
- `ai.providers.<name>.apiKey` or `apiKeyEnv`: API key source (env preferred).
- `ai.providers.<name>.headers`: optional custom headers.

## API Key Resolution

`cac` resolves API keys automatically in this order (first match wins, no override):

| Priority | Source | Description |
|----------|--------|-------------|
| 1 | `process.env` | Environment variable in current shell |
| 2 | `~/.config/code-agent-auto-commit/keys.env` | Global keys file (`cac ai set-key` writes here) |
| 3 | `.cac/.env` | Project-level env file (`cac init` generates this) |
| 4 | `ai.providers.<name>.apiKey` | Direct key in config JSON (not recommended) |

Both `export KEY='value'` and `KEY=value` formats are supported in env files.

This auto-loading ensures **hooks work without manual `source`** — the subprocess
reads keys from files even when shell env vars are not inherited.

## Notes

- `commit.mode`
  - `single`: stage and commit all selected files together
  - `per-file`: commit each selected file separately
- `push.provider`
  - `github`: remote URL must contain `github`
  - `gitlab`: remote URL must contain `gitlab`
  - `generic`: no provider URL validation
- `cac init` creates `.cac/.env.example` and `.cac/.env` with provider key variables.
- Hook-triggered `cac run` writes output logs to `.cac/run-<timestamp>.log`.
