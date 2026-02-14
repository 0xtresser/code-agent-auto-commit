import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ensureDirForFile, writeTextFile } from "../core/fs"
import type { InstallScope } from "../types"

interface ClaudeHookCommand {
  type: "command"
  command: string
}

interface ClaudeHookMatcher {
  matcher?: string
  hooks: ClaudeHookCommand[]
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookMatcher[]>
}

export interface ClaudeInstallInput {
  scope: InstallScope
  worktree: string
  configPath: string
  runnerCommand: string
}

function settingsPath(scope: InstallScope, worktree: string): string {
  if (scope === "global") {
    return path.join(os.homedir(), ".claude", "settings.json")
  }
  return path.join(worktree, ".claude", "settings.json")
}

function hookScriptPath(scope: InstallScope, worktree: string): string {
  if (scope === "global") {
    return path.join(os.homedir(), ".claude", "hooks", "code-agent-auto-commit.sh")
  }
  return path.join(worktree, ".claude", "hooks", "code-agent-auto-commit.sh")
}

function readSettings(filePath: string): ClaudeSettings {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  const raw = fs.readFileSync(filePath, "utf8")
  if (!raw.trim()) {
    return {}
  }
  return JSON.parse(raw) as ClaudeSettings
}

function writeSettings(filePath: string, settings: ClaudeSettings): void {
  ensureDirForFile(filePath)
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8")
}

function buildScript(configPath: string, runnerCommand: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

WORKTREE="\${CLAUDE_PROJECT_DIR:-$PWD}"
${runnerCommand} run --tool claude --worktree "$WORKTREE" --config ${JSON.stringify(configPath)} --event-stdin || true
`
}

export function installClaudeAdapter(input: ClaudeInstallInput): { settingsPath: string; scriptPath: string } {
  const resolvedWorktree = path.resolve(input.worktree)
  const resolvedConfig = path.resolve(input.configPath)

  const targetSettingsPath = settingsPath(input.scope, resolvedWorktree)
  const targetScriptPath = hookScriptPath(input.scope, resolvedWorktree)
  const command = `bash ${JSON.stringify(targetScriptPath)}`

  writeTextFile(targetScriptPath, buildScript(resolvedConfig, input.runnerCommand))
  fs.chmodSync(targetScriptPath, 0o755)

  const settings = readSettings(targetSettingsPath)
  if (!settings.hooks) {
    settings.hooks = {}
  }
  const stopHooks = settings.hooks.Stop ?? []
  const alreadyExists = stopHooks.some((entry) => entry.hooks.some((hook) => hook.command === command))

  if (!alreadyExists) {
    stopHooks.push({
      matcher: "",
      hooks: [
        {
          type: "command",
          command,
        },
      ],
    })
  }

  settings.hooks.Stop = stopHooks
  writeSettings(targetSettingsPath, settings)

  return {
    settingsPath: targetSettingsPath,
    scriptPath: targetScriptPath,
  }
}

export function uninstallClaudeAdapter(scope: InstallScope, worktree: string): { settingsPath: string; scriptPath: string } {
  const resolvedWorktree = path.resolve(worktree)
  const targetSettingsPath = settingsPath(scope, resolvedWorktree)
  const targetScriptPath = hookScriptPath(scope, resolvedWorktree)
  const command = `bash ${JSON.stringify(targetScriptPath)}`

  if (fs.existsSync(targetSettingsPath)) {
    const settings = readSettings(targetSettingsPath)
    const stopHooks = settings.hooks?.Stop ?? []
    const cleaned = stopHooks
      .map((entry) => ({
        ...entry,
        hooks: entry.hooks.filter((hook) => hook.command !== command),
      }))
      .filter((entry) => entry.hooks.length > 0)

    if (!settings.hooks) {
      settings.hooks = {}
    }

    if (cleaned.length > 0) {
      settings.hooks.Stop = cleaned
    } else {
      delete settings.hooks.Stop
    }

    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks
    }

    writeSettings(targetSettingsPath, settings)
  }

  if (fs.existsSync(targetScriptPath)) {
    fs.unlinkSync(targetScriptPath)
  }

  return {
    settingsPath: targetSettingsPath,
    scriptPath: targetScriptPath,
  }
}

export function claudeAdapterStatus(scope: InstallScope, worktree: string): {
  settingsPath: string
  scriptPath: string
  installed: boolean
} {
  const resolvedWorktree = path.resolve(worktree)
  const targetSettingsPath = settingsPath(scope, resolvedWorktree)
  const targetScriptPath = hookScriptPath(scope, resolvedWorktree)
  const command = `bash ${JSON.stringify(targetScriptPath)}`

  if (!fs.existsSync(targetSettingsPath)) {
    return {
      settingsPath: targetSettingsPath,
      scriptPath: targetScriptPath,
      installed: false,
    }
  }

  const settings = readSettings(targetSettingsPath)
  const hasHook = (settings.hooks?.Stop ?? []).some((entry) => entry.hooks.some((hook) => hook.command === command))

  return {
    settingsPath: targetSettingsPath,
    scriptPath: targetScriptPath,
    installed: hasHook && fs.existsSync(targetScriptPath),
  }
}
