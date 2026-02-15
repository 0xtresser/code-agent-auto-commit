import fs from "node:fs"
import os from "node:os"
import path from "node:path"

function formatTimestamp(date: Date): string {
  const pad = (value: number, size = 2): string => String(value).padStart(size, "0")
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    "-",
    pad(date.getMilliseconds(), 3),
  ].join("")
}

export function getUserConfigHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg && xdg.trim().length > 0) {
    return xdg
  }
  return path.join(os.homedir(), ".config")
}

export function getProjectConfigPath(worktree: string): string {
  return path.join(worktree, ".cac", ".code-agent-auto-commit.json")
}

export function getLegacyProjectConfigPath(worktree: string): string {
  return path.join(worktree, ".code-agent-auto-commit.json")
}

export function getProjectEnvExamplePath(worktree: string): string {
  return path.join(worktree, ".cac", ".env.example")
}

export function getProjectEnvPath(worktree: string): string {
  return path.join(worktree, ".cac", ".env")
}

export function getProjectRunLogPath(worktree: string, date = new Date()): string {
  return path.join(worktree, ".cac", `run-${formatTimestamp(date)}.log`)
}

export function getGlobalConfigPath(): string {
  return path.join(getUserConfigHome(), "code-agent-auto-commit", "config.json")
}

export function getGlobalKeysEnvPath(): string {
  return path.join(getUserConfigHome(), "code-agent-auto-commit", "keys.env")
}

export function ensureDirForFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

export function readJsonFile<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined
  }
  const content = fs.readFileSync(filePath, "utf8")
  return JSON.parse(content) as T
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureDirForFile(filePath)
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export function writeTextFile(filePath: string, content: string): void {
  ensureDirForFile(filePath)
  fs.writeFileSync(filePath, content, "utf8")
}
