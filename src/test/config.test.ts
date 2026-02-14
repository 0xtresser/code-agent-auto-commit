import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import assert from "node:assert/strict"
import { initConfigFile, loadConfig, updateConfigWorktree } from "../core/config"

test("init and update config file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-auto-commit-"))
  const configPath = path.join(tempDir, ".code-agent-auto-commit.json")

  const created = initConfigFile(configPath, tempDir)
  assert.equal(created.version, 1)
  assert.equal(created.worktree, tempDir)

  const loaded = loadConfig({ explicitPath: configPath, worktree: tempDir })
  assert.equal(loaded.config.worktree, tempDir)

  const nextDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-auto-commit-next-"))
  const updated = updateConfigWorktree(configPath, nextDir)
  assert.equal(updated.worktree, nextDir)
})
