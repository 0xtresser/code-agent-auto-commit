#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { claudeAdapterStatus, installClaudeAdapter, uninstallClaudeAdapter } from "./adapters/claude"
import { codexAdapterStatus, installCodexAdapter, uninstallCodexAdapter } from "./adapters/codex"
import { installOpenCodeAdapter, opencodeAdapterStatus, uninstallOpenCodeAdapter } from "./adapters/opencode"
import { initConfigFile, loadConfig, resolveConfigPath, updateConfigWorktree } from "./core/config"
import { getProjectConfigPath } from "./core/fs"
import { runAutoCommit } from "./core/run"
import type { InstallScope, ToolName } from "./types"

interface ParsedOptions {
  flags: Record<string, string | boolean>
  positionals: string[]
}

function parseOptions(args: string[]): ParsedOptions {
  const flags: Record<string, string | boolean> = {}
  const positionals: string[] = []

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }

    const trimmed = arg.slice(2)
    const eqIndex = trimmed.indexOf("=")
    if (eqIndex >= 0) {
      const key = trimmed.slice(0, eqIndex)
      const value = trimmed.slice(eqIndex + 1)
      flags[key] = value
      continue
    }

    const next = args[i + 1]
    if (!next || next.startsWith("--")) {
      flags[trimmed] = true
    } else {
      flags[trimmed] = next
      i += 1
    }
  }

  return { flags, positionals }
}

function getStringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key]
  if (typeof value === "string") {
    return value
  }
  return undefined
}

function getBooleanFlag(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true
}

function parseScope(value: string | undefined): InstallScope {
  if (!value || value === "project") {
    return "project"
  }
  if (value === "global") {
    return "global"
  }
  throw new Error(`Invalid scope: ${value}`)
}

function parseTools(value: string | undefined): Array<"opencode" | "codex" | "claude"> {
  if (!value || value === "all") {
    return ["opencode", "codex", "claude"]
  }

  const allowed = new Set(["opencode", "codex", "claude"])
  const tools = value.split(",").map((item) => item.trim()).filter(Boolean)
  for (const tool of tools) {
    if (!allowed.has(tool)) {
      throw new Error(`Invalid tool: ${tool}`)
    }
  }
  return tools as Array<"opencode" | "codex" | "claude">
}

async function readStdinText(): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of process.stdin) {
    chunks.push(String(chunk))
  }
  return chunks.join("")
}

function printHelp(): void {
  console.log(`cac (code-agent-auto-commit)

Usage:
  cac init [--worktree <path>] [--config <path>]
  cac install [--tool all|opencode|codex|claude] [--scope project|global] [--worktree <path>] [--config <path>]
  cac uninstall [--tool all|opencode|codex|claude] [--scope project|global] [--worktree <path>]
  cac status [--scope project|global] [--worktree <path>] [--config <path>]
  cac run [--tool opencode|codex|claude|manual] [--worktree <path>] [--config <path>] [--event-json <json>] [--event-stdin]
  cac set-worktree <path> [--config <path>]
  cac version
`)
}

async function commandInit(flags: Record<string, string | boolean>): Promise<void> {
  const worktree = path.resolve(getStringFlag(flags, "worktree") ?? process.cwd())
  const explicit = getStringFlag(flags, "config")
  const configPath = explicit ? path.resolve(explicit) : getProjectConfigPath(worktree)
  initConfigFile(configPath, worktree)
  console.log(`Initialized config: ${configPath}`)
}

async function commandInstall(flags: Record<string, string | boolean>): Promise<void> {
  const worktree = path.resolve(getStringFlag(flags, "worktree") ?? process.cwd())
  const scope = parseScope(getStringFlag(flags, "scope"))
  const runnerCommand = getStringFlag(flags, "runner") ?? "cac"

  const explicitConfig = getStringFlag(flags, "config")
  const configPath = explicitConfig
    ? path.resolve(explicitConfig)
    : fs.existsSync(getProjectConfigPath(worktree))
      ? getProjectConfigPath(worktree)
      : resolveConfigPath({ worktree })

  if (!fs.existsSync(configPath)) {
    initConfigFile(configPath, worktree)
  }

  const tools = parseTools(getStringFlag(flags, "tool"))

  for (const tool of tools) {
    if (tool === "opencode") {
      const pluginPath = installOpenCodeAdapter({
        scope,
        worktree,
        configPath,
        runnerCommand,
      })
      console.log(`OpenCode installed: ${pluginPath}`)
    }

    if (tool === "codex") {
      const codexPath = installCodexAdapter({
        scope,
        worktree,
        configPath,
        runnerCommand,
      })
      console.log(`Codex installed: ${codexPath}`)
    }

    if (tool === "claude") {
      const claude = installClaudeAdapter({
        scope,
        worktree,
        configPath,
        runnerCommand,
      })
      console.log(`Claude hook installed: ${claude.settingsPath}`)
      console.log(`Claude script installed: ${claude.scriptPath}`)
    }
  }
}

async function commandUninstall(flags: Record<string, string | boolean>): Promise<void> {
  const worktree = path.resolve(getStringFlag(flags, "worktree") ?? process.cwd())
  const scope = parseScope(getStringFlag(flags, "scope"))
  const tools = parseTools(getStringFlag(flags, "tool"))

  for (const tool of tools) {
    if (tool === "opencode") {
      console.log(`OpenCode removed: ${uninstallOpenCodeAdapter(scope, worktree)}`)
    }

    if (tool === "codex") {
      console.log(`Codex removed: ${uninstallCodexAdapter(scope, worktree)}`)
    }

    if (tool === "claude") {
      const result = uninstallClaudeAdapter(scope, worktree)
      console.log(`Claude hook updated: ${result.settingsPath}`)
      console.log(`Claude script removed: ${result.scriptPath}`)
    }
  }
}

async function commandStatus(flags: Record<string, string | boolean>): Promise<void> {
  const worktree = path.resolve(getStringFlag(flags, "worktree") ?? process.cwd())
  const scope = parseScope(getStringFlag(flags, "scope"))
  const explicitConfig = getStringFlag(flags, "config")
  const loaded = loadConfig({ explicitPath: explicitConfig, worktree })

  console.log(`Config path: ${loaded.path}`)
  console.log(`Worktree: ${loaded.config.worktree}`)
  console.log(`Commit mode: ${loaded.config.commit.mode}`)
  console.log(`AI message: ${loaded.config.ai.enabled ? "enabled" : "disabled"}`)
  console.log(`Auto push: ${loaded.config.push.enabled ? "enabled" : "disabled"}`)

  const opencode = opencodeAdapterStatus(scope, worktree)
  console.log(`OpenCode adapter: ${opencode.installed ? "installed" : "missing"} (${opencode.path})`)

  const codex = codexAdapterStatus(scope, worktree)
  console.log(`Codex adapter: ${codex.installed ? "installed" : "missing"} (${codex.path})`)

  const claude = claudeAdapterStatus(scope, worktree)
  console.log(`Claude adapter: ${claude.installed ? "installed" : "missing"} (${claude.settingsPath})`)
}

async function commandSetWorktree(flags: Record<string, string | boolean>, positionals: string[]): Promise<void> {
  const nextWorktree = positionals[0]
  if (!nextWorktree) {
    throw new Error("Missing worktree path")
  }

  const configPath = resolveConfigPath({
    explicitPath: getStringFlag(flags, "config"),
    worktree: process.cwd(),
  })

  const updated = updateConfigWorktree(configPath, nextWorktree)
  console.log(`Updated config: ${configPath}`)
  console.log(`New worktree: ${updated.worktree}`)
}

async function commandRun(flags: Record<string, string | boolean>, positionals: string[]): Promise<void> {
  const tool = (getStringFlag(flags, "tool") ?? "manual") as ToolName
  const worktree = getStringFlag(flags, "worktree")
  const configPath = getStringFlag(flags, "config")

  let event: unknown
  const eventJson = getStringFlag(flags, "event-json")
  if (eventJson) {
    event = JSON.parse(eventJson)
  }

  if (getBooleanFlag(flags, "event-stdin")) {
    const stdinText = (await readStdinText()).trim()
    if (stdinText) {
      event = JSON.parse(stdinText)
    }
  }

  if (!event && positionals.length > 0 && positionals[positionals.length - 1].startsWith("{")) {
    try {
      event = JSON.parse(positionals[positionals.length - 1])
    } catch {
      event = undefined
    }
  }

  if (tool === "codex" && event && typeof event === "object") {
    const eventType = (event as { type?: string }).type
    if (eventType && eventType !== "agent-turn-complete") {
      console.log(`Skipped: codex event ${eventType}`)
      return
    }
  }

  const result = await runAutoCommit(
    {
      tool,
      worktree,
      event,
      sessionID: getStringFlag(flags, "session-id"),
    },
    {
      explicitPath: configPath,
      worktree,
    },
  )

  if (result.skipped) {
    console.log(`Skipped: ${result.reason ?? "unknown"}`)
    return
  }

  console.log(`Committed: ${result.committed.length}`)
  for (const item of result.committed) {
    console.log(`- ${item.hash.slice(0, 12)} ${item.message}`)
  }
  console.log(`Pushed: ${result.pushed ? "yes" : "no"}`)
  if (result.tokenUsage) {
    console.log(`AI tokens: ${result.tokenUsage.totalTokens} (prompt: ${result.tokenUsage.promptTokens}, completion: ${result.tokenUsage.completionTokens})`)
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const parsed = parseOptions(argv.slice(1))

  if (!command || command === "help" || command === "--help") {
    printHelp()
    return
  }

  if (command === "version" || command === "--version" || command === "-v") {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"))
    console.log(pkg.version)
    return
  }

  if (command === "init") {
    await commandInit(parsed.flags)
    return
  }

  if (command === "install") {
    await commandInstall(parsed.flags)
    return
  }

  if (command === "uninstall") {
    await commandUninstall(parsed.flags)
    return
  }

  if (command === "status") {
    await commandStatus(parsed.flags)
    return
  }

  if (command === "set-worktree") {
    await commandSetWorktree(parsed.flags, parsed.positionals)
    return
  }

  if (command === "run") {
    await commandRun(parsed.flags, parsed.positionals)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Error: ${message}`)
  process.exitCode = 1
})
