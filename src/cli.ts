#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { claudeAdapterStatus, installClaudeAdapter, uninstallClaudeAdapter } from "./adapters/claude"
import { codexAdapterStatus, installCodexAdapter, uninstallCodexAdapter } from "./adapters/codex"
import { installOpenCodeAdapter, opencodeAdapterStatus, uninstallOpenCodeAdapter } from "./adapters/opencode"
import { testAI } from "./core/ai"
import { initConfigFile, loadConfig, resolveConfigPath, updateConfigWorktree } from "./core/config"
import {
  getGlobalKeysEnvPath,
  getProjectConfigPath,
  getProjectEnvExamplePath,
  getProjectEnvPath,
  getProjectRunLogPath,
  writeTextFile,
} from "./core/fs"
import { runAutoCommit } from "./core/run"
import type { AIConfig, InstallScope, ToolName } from "./types"

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

const ENV_NAME_REGEX = /^[A-Z_][A-Z0-9_]*$/

function resolveAiEnvName(target: string, aiConfig: AIConfig): string {
  if (ENV_NAME_REGEX.test(target)) {
    return target
  }

  const providerConfig = aiConfig.providers[target]
  const envName = providerConfig?.apiKeyEnv?.trim()
  if (envName && ENV_NAME_REGEX.test(envName)) {
    return envName
  }

  throw new Error(`Unknown provider or env var: ${target}`)
}

function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function parseExportValue(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/'"'"'/g, "'")
  }
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function readKeyFromEnvFile(filePath: string, envName: string): string | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) {
      continue
    }
    if (match[1] !== envName) {
      continue
    }
    return parseExportValue(match[2])
  }

  return undefined
}

function detectShellRcPath(): string {
  const shell = path.basename(process.env.SHELL ?? "")
  const home = os.homedir()

  if (shell === "zsh") {
    return path.join(home, ".zshrc")
  }
  if (shell === "bash") {
    return path.join(home, ".bashrc")
  }
  if (shell === "fish") {
    return path.join(home, ".config", "fish", "config.fish")
  }

  return path.join(home, ".profile")
}

function ensureGlobalKeysSource(shellRcPath: string, keysPath: string): boolean {
  const isFish = path.basename(shellRcPath) === "config.fish"
  const sourceLine = isFish
    ? `if test -f ${JSON.stringify(keysPath)}; source ${JSON.stringify(keysPath)}; end`
    : `[ -f ${JSON.stringify(keysPath)} ] && source ${JSON.stringify(keysPath)}`

  const existing = fs.existsSync(shellRcPath) ? fs.readFileSync(shellRcPath, "utf8") : ""
  if (existing.includes(keysPath)) {
    return false
  }

  const next = existing.trimEnd().length > 0
    ? `${existing.trimEnd()}\n\n# code-agent-auto-commit global AI keys\n${sourceLine}\n`
    : `# code-agent-auto-commit global AI keys\n${sourceLine}\n`

  writeTextFile(shellRcPath, next)
  return true
}

function writeRunLog(worktree: string, lines: string[]): string {
  const logPath = getProjectRunLogPath(worktree)
  const content = [
    `time=${new Date().toISOString()}`,
    ...lines,
    "",
  ].join("\n")
  writeTextFile(logPath, content)
  return logPath
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
  cac ai <message> [--config <path>]
  cac ai set-key <provider|ENV_VAR> <api-key> [--config <path>]
  cac ai get-key <provider|ENV_VAR> [--config <path>]
  cac version
`)
}

async function commandInit(flags: Record<string, string | boolean>): Promise<void> {
  const worktree = path.resolve(getStringFlag(flags, "worktree") ?? process.cwd())
  const explicit = getStringFlag(flags, "config")
  const configPath = explicit ? path.resolve(explicit) : getProjectConfigPath(worktree)
  initConfigFile(configPath, worktree)
  console.log(`Initialized config: ${configPath}`)
  console.log(`Generated env template: ${getProjectEnvExamplePath(worktree)}`)
  console.log(`Generated local env: ${getProjectEnvPath(worktree)}`)
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
  const shouldLogRun = tool !== "manual"
  const runLogLines: string[] = []

  const logInfo = (message: string): void => {
    console.log(message)
    runLogLines.push(message)
  }

  const logWarn = (message: string): void => {
    console.warn(message)
    runLogLines.push(message)
  }

  const flushRunLog = (resolvedWorktree: string): void => {
    if (!shouldLogRun) {
      return
    }
    const logPath = writeRunLog(resolvedWorktree, runLogLines)
    logInfo(`Run log: ${logPath}`)
  }

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
      logInfo(`Skipped: codex event ${eventType}`)
      return
    }
  }

  let result
  try {
    result = await runAutoCommit(
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logWarn(`Error: ${message}`)
    flushRunLog(path.resolve(worktree ?? process.cwd()))
    throw error
  }

  if (result.skipped) {
    logInfo(`Skipped: ${result.reason ?? "unknown"}`)
    flushRunLog(result.worktree)
    return
  }

  logInfo(`Committed: ${result.committed.length}`)
  for (const item of result.committed) {
    logInfo(`- ${item.hash.slice(0, 12)} ${item.message}`)
  }
  logInfo(`Pushed: ${result.pushed ? "yes" : "no"}`)
  if (result.tokenUsage) {
    logInfo(`AI tokens: ${result.tokenUsage.totalTokens} (prompt: ${result.tokenUsage.promptTokens}, completion: ${result.tokenUsage.completionTokens})`)
  }
  if (result.aiWarning) {
    logWarn("")
    logWarn(`Warning: AI commit message failed — ${result.aiWarning}`)
    logWarn(`Using fallback prefix instead. Run "cac ai hello" to test your AI config.`)
  }

  flushRunLog(result.worktree)
}

async function commandAI(flags: Record<string, string | boolean>, positionals: string[]): Promise<void> {
  const worktree = path.resolve(getStringFlag(flags, "worktree") ?? process.cwd())
  const explicitConfig = getStringFlag(flags, "config")
  const loaded = loadConfig({ explicitPath: explicitConfig, worktree })

  const subcommand = positionals[0]

  if (subcommand === "set-key") {
    const target = positionals[1]
    const key = positionals.slice(2).join(" ").trim()
    if (!target || !key) {
      console.error("Usage: cac ai set-key <provider|ENV_VAR> <api-key>")
      process.exitCode = 1
      return
    }

    const envName = resolveAiEnvName(target, loaded.config.ai)
    const keysPath = getGlobalKeysEnvPath()
    const line = `export ${envName}=${shellQuoteSingle(key)}`

    const existing = fs.existsSync(keysPath) ? fs.readFileSync(keysPath, "utf8") : ""
    const lines = existing.split(/\r?\n/)
    let found = false
    const updated = lines.map((entry) => {
      const match = entry.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=/)
      if (match && match[1] === envName) {
        found = true
        return line
      }
      return entry
    })

    if (!found) {
      if (updated.length === 1 && updated[0] === "") {
        updated.splice(0, 1)
      }
      if (updated.length === 0) {
        updated.push("# code-agent-auto-commit global AI keys")
      }
      updated.push(line)
    }

    writeTextFile(keysPath, `${updated.filter((entry, idx, arr) => !(idx === arr.length - 1 && entry === "")).join("\n")}\n`)
    process.env[envName] = key

    const shellRcPath = detectShellRcPath()
    const inserted = ensureGlobalKeysSource(shellRcPath, keysPath)

    console.log(`Set ${envName} in ${keysPath}`)
    if (inserted) {
      console.log(`Added source line to ${shellRcPath}`)
    }
    console.log(`Global key configured. Open a new shell or run: source ${shellRcPath}`)
    return
  }

  if (subcommand === "get-key") {
    const target = positionals[1]
    if (!target) {
      console.error("Usage: cac ai get-key <provider|ENV_VAR>")
      process.exitCode = 1
      return
    }

    const envName = resolveAiEnvName(target, loaded.config.ai)
    const fromProcess = process.env[envName]?.trim()
    const fromFile = readKeyFromEnvFile(getGlobalKeysEnvPath(), envName)
    const value = fromProcess || fromFile

    if (!value) {
      console.log(`${envName} is not set`)
      process.exitCode = 1
      return
    }

    const masked = value.length <= 8
      ? `${value.slice(0, 2)}***`
      : `${value.slice(0, 4)}***${value.slice(-4)}`

    console.log(`Env: ${envName}`)
    console.log(`Value: ${masked}`)
    console.log(`Source: ${fromProcess ? "process env" : getGlobalKeysEnvPath()}`)
    return
  }

  const message = positionals.join(" ").trim()
  if (!message) {
    console.error(`Usage: cac ai <message>`)
    console.error(`Example: cac ai "hello, are you there?"`)
    process.exitCode = 1
    return
  }

  console.log(`Provider: ${loaded.config.ai.defaultProvider}`)
  console.log(`Model: ${loaded.config.ai.model}`)
  console.log(`Sending: "${message}"`)
  console.log()

  const result = await testAI(loaded.config.ai, message)

  if (!result.ok) {
    console.error(`AI test failed: ${result.error}`)
    process.exitCode = 1
    return
  }

  console.log(`Reply: ${result.reply}`)
  if (result.usage) {
    console.log(`Tokens: ${result.usage.totalTokens} (prompt: ${result.usage.promptTokens}, completion: ${result.usage.completionTokens})`)
  }
  console.log(`\nAI is configured correctly.`)
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

  if (command === "ai") {
    await commandAI(parsed.flags, parsed.positionals)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Error: ${message}`)
  process.exitCode = 1
})
