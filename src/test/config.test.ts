import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import assert from "node:assert/strict"
import { initConfigFile, loadConfig, updateConfigWorktree } from "../core/config"
import { getProjectConfigPath } from "../core/fs"

test("init and update config file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-auto-commit-"))
  const configPath = getProjectConfigPath(tempDir)

  const created = initConfigFile(configPath, tempDir)
  assert.equal(created.version, 1)
  assert.equal(created.worktree, tempDir)
  assert.equal(fs.existsSync(path.join(tempDir, ".cac", ".env.example")), true)
  assert.equal(fs.existsSync(path.join(tempDir, ".cac", ".env")), true)

  const loaded = loadConfig({ explicitPath: configPath, worktree: tempDir })
  assert.equal(loaded.config.worktree, tempDir)

  const nextDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-auto-commit-next-"))
  const updated = updateConfigWorktree(configPath, nextDir)
  assert.equal(updated.worktree, nextDir)
})

test("loadConfig resolves new and legacy project paths", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-auto-commit-resolve-"))
  const newConfigPath = getProjectConfigPath(tempDir)
  initConfigFile(newConfigPath, tempDir)

  const loadedNew = loadConfig({ worktree: tempDir })
  assert.equal(loadedNew.path, newConfigPath)

  fs.rmSync(path.join(tempDir, ".cac"), { recursive: true, force: true })
  const legacyPath = path.join(tempDir, ".code-agent-auto-commit.json")
  fs.writeFileSync(legacyPath, JSON.stringify({ version: 1, enabled: true }, null, 2), "utf8")

  const loadedLegacy = loadConfig({ worktree: tempDir })
  assert.equal(loadedLegacy.path, legacyPath)
})
