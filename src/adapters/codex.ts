import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ensureDirForFile } from "../core/fs"
import type { InstallScope } from "../types"

export interface CodexInstallInput {
  scope: InstallScope
  worktree: string
  configPath: string
  runnerCommand: string
}

const START_MARKER = "# BEGIN code-agent-auto-commit"
const END_MARKER = "# END code-agent-auto-commit"

function codexConfigPath(scope: InstallScope, worktree: string): string {
  if (scope === "global") {
    return path.join(os.homedir(), ".codex", "config.toml")
  }
  return path.join(worktree, ".codex", "config.toml")
}

function tomlString(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")
  return `"${escaped}"`
}

function buildNotifyBlock(worktree: string, configPath: string, runnerCommand: string): string {
  const command = [runnerCommand, "run", "--tool", "codex", "--worktree", worktree, "--config", configPath]
  const rendered = command.map((item) => tomlString(item)).join(", ")
  return [
    START_MARKER,
    `notify = [${rendered}]`,
    END_MARKER,
  ].join("\n")
}

function stripManagedBlock(content: string): string {
  const blockRegex = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}\\n?`, "g")
  return content.replace(blockRegex, "")
}

export function installCodexAdapter(input: CodexInstallInput): string {
  const filePath = codexConfigPath(input.scope, path.resolve(input.worktree))
  ensureDirForFile(filePath)

  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
  const withoutBlock = stripManagedBlock(existing)

  if (/^\s*notify\s*=\s*/m.test(withoutBlock)) {
    throw new Error(`Codex config already contains notify=. Merge manually in ${filePath}`)
  }

  const block = buildNotifyBlock(path.resolve(input.worktree), path.resolve(input.configPath), input.runnerCommand)
  const output = withoutBlock.trimEnd().length > 0 ? `${withoutBlock.trimEnd()}\n\n${block}\n` : `${block}\n`
  fs.writeFileSync(filePath, output, "utf8")
  return filePath
}

export function uninstallCodexAdapter(scope: InstallScope, worktree: string): string {
  const filePath = codexConfigPath(scope, path.resolve(worktree))
  if (!fs.existsSync(filePath)) {
    return filePath
  }
  const existing = fs.readFileSync(filePath, "utf8")
  const updated = stripManagedBlock(existing).trimEnd()
  fs.writeFileSync(filePath, updated.length > 0 ? `${updated}\n` : "", "utf8")
  return filePath
}

export function codexAdapterStatus(scope: InstallScope, worktree: string): { path: string; installed: boolean } {
  const filePath = codexConfigPath(scope, path.resolve(worktree))
  if (!fs.existsSync(filePath)) {
    return { path: filePath, installed: false }
  }
  const content = fs.readFileSync(filePath, "utf8")
  return {
    path: filePath,
    installed: content.includes(START_MARKER),
  }
}
