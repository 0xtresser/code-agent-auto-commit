# PROGRESS.md

Project progress tracking and lessons learned.

Format: `[Date] [Task] [Issue] [Solution]`

---

## 2026-02-15

### MiniMax API 401 Auth Error

- **Task**: Configure MiniMax AI provider for commit message generation
- **Issue**: API key from international platform (platform.minimax.io) returned `invalid api key (2049)` with HTTP 401
- **Solution**: MiniMax API key and host must be regionally aligned. International keys require `api.minimaxi.chat` (note the extra `i`), not `api.minimax.chat` (domestic). Updated default baseUrl in `config.ts` and example config.

### MiniMax Model Availability (International)

- **Task**: Use `MiniMax-M2.1-highspeed` model
- **Issue**: Model `MiniMax-M2.1-highspeed` does not exist on the international endpoint (`api.minimaxi.chat`)
- **Solution**: Switched default model to `MiniMax-M2.5-highspeed` which is available internationally. Available models on intl: `MiniMax-M2.5`, `MiniMax-M2.5-highspeed`, `MiniMax-M2.1`, `MiniMax-Text-01`.

### Project Structure Alignment

- **Task**: Align project structure with AGENTS.md conventions
- **Issue**: Multiple mismatches — `docs/` vs `doc/`, `src/test/` vs `tests/`, missing `.gitignore` entries, no `PROGRESS.md`
- **Solution**: Renamed `docs/` → `doc/`, moved tests to `tests/` with separate `tsconfig.test.json`, updated `.gitignore` with all required entries, created `PROGRESS.md` and `deploy/` directory.
