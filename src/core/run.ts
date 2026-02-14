import path from "node:path"
import { generateCommitMessage } from "./ai"
import { loadConfig } from "./config"
import { shouldIncludePath } from "./filter"
import {
  commit,
  ensureGitRepository,
  getCurrentBranch,
  getStagedSummary,
  hasStagedChanges,
  listChangedFiles,
  push,
  stagePath,
} from "./git"
import type { AIConfig, ChangedFile, CommitRecord, LoadConfigOptions, RunContext, RunResult } from "../types"

function normalizeFallbackType(prefix: string): "feat" | "fix" | "refector" {
  const value = prefix.toLowerCase()
  if (/(^|[^a-z])(feat|feature)([^a-z]|$)/.test(value)) {
    return "feat"
  }
  if (/(^|[^a-z])(fix|bugfix|hotfix)([^a-z]|$)/.test(value)) {
    return "fix"
  }
  if (/(^|[^a-z])(refector|refactor|chore|docs|style|test|perf|build|ci|revert)([^a-z]|$)/.test(value)) {
    return "refector"
  }
  return "refector"
}

function fallbackSingleMessage(prefix: string, count: number): string {
  const suffix = count === 1 ? "file" : "files"
  return `${normalizeFallbackType(prefix)}: update ${count} ${suffix}`
}

function fallbackPerFileMessage(prefix: string, file: ChangedFile): string {
  const type = normalizeFallbackType(prefix)
  const primary = file.indexStatus !== " " ? file.indexStatus : file.worktreeStatus
  const name = path.basename(file.path)

  if (primary === "A") {
    return `${type}: add ${name}`
  }
  if (primary === "D") {
    return `${type}: remove ${name}`
  }
  if (primary === "R") {
    return `${type}: rename ${name}`
  }
  return `${type}: update ${name}`
}

function uniqueSorted(files: ChangedFile[]): ChangedFile[] {
  const seen = new Set<string>()
  const out: ChangedFile[] = []
  for (const file of files) {
    if (seen.has(file.path)) {
      continue
    }
    seen.add(file.path)
    out.push(file)
  }
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

function filterFiles(files: ChangedFile[], include: string[], exclude: string[]): ChangedFile[] {
  return files.filter((file) => shouldIncludePath(file.path, include, exclude))
}

async function buildMessage(
  prefix: string,
  maxLength: number,
  aiConfig: AIConfig,
  stagedPath: string | undefined,
  fallback: string,
  worktree: string,
): Promise<string> {
  const summary = getStagedSummary(worktree, stagedPath)
  const generated = await generateCommitMessage(aiConfig, summary, maxLength)
  if (generated) {
    return generated
  }
  if (fallback.length <= maxLength) {
    return fallback
  }
  return `${normalizeFallbackType(prefix)}: update changes`
}

export async function runAutoCommit(context: RunContext, configOptions: LoadConfigOptions): Promise<RunResult> {
  const { config } = loadConfig(configOptions)
  const worktree = path.resolve(context.worktree ?? config.worktree)

  if (!config.enabled) {
    return {
      skipped: true,
      reason: "disabled",
      worktree,
      committed: [],
      pushed: false,
    }
  }

  ensureGitRepository(worktree)

  const changed = uniqueSorted(filterFiles(listChangedFiles(worktree), config.filters.include, config.filters.exclude))
  if (changed.length === 0) {
    return {
      skipped: true,
      reason: "no changes",
      worktree,
      committed: [],
      pushed: false,
    }
  }

  const commits: CommitRecord[] = []

  if (config.commit.mode === "single") {
    for (const file of changed) {
      stagePath(worktree, file.path)
    }

    if (!hasStagedChanges(worktree)) {
      return {
        skipped: true,
        reason: "no staged changes",
        worktree,
        committed: [],
        pushed: false,
      }
    }

    const fallback = fallbackSingleMessage(config.commit.fallbackPrefix, changed.length)
    const message = await buildMessage(
      config.commit.fallbackPrefix,
      config.commit.maxMessageLength,
      config.ai,
      undefined,
      fallback,
      worktree,
    )

    const hash = commit(worktree, message)
    commits.push({
      hash,
      message,
      files: changed.map((item) => item.path),
    })
  } else {
    if (hasStagedChanges(worktree)) {
      throw new Error("per-file mode requires a clean staging area before auto-commit")
    }

    for (const file of changed) {
      stagePath(worktree, file.path)
      if (!hasStagedChanges(worktree)) {
        continue
      }

      const fallback = fallbackPerFileMessage(config.commit.fallbackPrefix, file)
      const message = await buildMessage(
        config.commit.fallbackPrefix,
        config.commit.maxMessageLength,
        config.ai,
        file.path,
        fallback,
        worktree,
      )

      const hash = commit(worktree, message)
      commits.push({
        hash,
        message,
        files: [file.path],
      })
    }
  }

  let pushed = false
  if (commits.length > 0 && config.push.enabled) {
    const branch = config.push.branch || getCurrentBranch(worktree)
    push(worktree, config.push.remote, branch, config.push.provider)
    pushed = true
  }

  return {
    skipped: false,
    worktree,
    committed: commits,
    pushed,
  }
}
