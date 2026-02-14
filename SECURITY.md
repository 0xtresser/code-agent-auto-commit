# Security Policy

## Reporting a vulnerability

Please report security issues privately to project maintainers instead of opening a public issue.

Include:

- affected version
- reproduction steps
- impact assessment

## Secret handling

- Never commit API keys.
- Prefer environment variables (`OPENAI_API_KEY` by default).
- Keep `.code-agent-auto-commit.json` free of plaintext secrets when possible.
