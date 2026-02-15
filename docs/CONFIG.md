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
    "enabled": false,
    "timeoutMs": 15000,
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
      }
    }
  },
  "push": {
    "enabled": false,
    "provider": "github",
    "remote": "origin",
    "branch": ""
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

## Notes

- `commit.mode`
  - `single`: stage and commit all selected files together
  - `per-file`: commit each selected file separately
- `push.provider`
  - `github`: remote URL must contain `github`
  - `gitlab`: remote URL must contain `gitlab`
  - `generic`: no provider URL validation
- Keep API keys in environment variables when possible.
- `cac init` also creates `.cac/.env.example` and `.cac/.env` with provider key variables.
- Hook-triggered `cac run` writes output logs to `.cac/run-<timestamp>.log`.
