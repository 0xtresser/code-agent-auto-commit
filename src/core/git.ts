import { runCommand, runCommandOrThrow } from "./exec"
import type { ChangedFile, CommitSummary, PushProvider } from "../types"

function assertGitRepo(worktree: string): void {
  const result = runCommand("git", ["-C", worktree, "rev-parse", "--is-inside-work-tree"], worktree)
  if (result.exitCode !== 0 || result.stdout.trim() !== "true") {
    throw new Error(`Not a git repository: ${worktree}`)
  }
}

export function ensureGitRepository(worktree: string): void {
  assertGitRepo(worktree)
}

export function listChangedFiles(worktree: string): ChangedFile[] {
  assertGitRepo(worktree)
  const output = runCommandOrThrow("git", ["-C", worktree, "status", "--porcelain", "-z"], worktree)
  if (!output) {
    return []
  }

  const files: ChangedFile[] = []
  let offset = 0

  while (offset < output.length) {
    const statusPair = output.slice(offset, offset + 2)
    offset += 3

    const firstNull = output.indexOf("\0", offset)
    if (firstNull === -1) {
      break
    }
    const firstPath = output.slice(offset, firstNull)
    offset = firstNull + 1

    const indexStatus = statusPair[0]
    const worktreeStatus = statusPair[1]
    const isRenameOrCopy = indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C"

    if (isRenameOrCopy) {
      const secondNull = output.indexOf("\0", offset)
      if (secondNull === -1) {
        break
      }
      const renamedFrom = output.slice(offset, secondNull)
      offset = secondNull + 1
      files.push({
        path: firstPath,
        originalPath: renamedFrom,
        indexStatus,
        worktreeStatus,
      })
    } else {
      files.push({
        path: firstPath,
        indexStatus,
        worktreeStatus,
      })
    }
  }

  return files
}

export function hasStagedChanges(worktree: string): boolean {
  const result = runCommand("git", ["-C", worktree, "diff", "--cached", "--quiet"], worktree)
  return result.exitCode !== 0
}

export function stagePath(worktree: string, filePath: string): void {
  runCommandOrThrow("git", ["-C", worktree, "add", "-A", "--", filePath], worktree)
}

export function commit(worktree: string, message: string): string {
  runCommandOrThrow("git", ["-C", worktree, "commit", "-m", message], worktree)
  return runCommandOrThrow("git", ["-C", worktree, "rev-parse", "HEAD"], worktree).trim()
}

export function getStagedSummary(worktree: string, onlyPath?: string): CommitSummary {
  const pathArgs = onlyPath ? ["--", onlyPath] : []
  const nameStatus = runCommandOrThrow("git", ["-C", worktree, "diff", "--cached", "--name-status", ...pathArgs], worktree).trim()
  const diffStat = runCommandOrThrow("git", ["-C", worktree, "diff", "--cached", "--stat", ...pathArgs], worktree).trim()
  const patchRaw = runCommandOrThrow("git", ["-C", worktree, "diff", "--cached", ...pathArgs], worktree)
  const patch = patchRaw.slice(0, 12000)
  return {
    nameStatus,
    diffStat,
    patch,
  }
}

export function getCurrentBranch(worktree: string): string {
  return runCommandOrThrow("git", ["-C", worktree, "rev-parse", "--abbrev-ref", "HEAD"], worktree).trim()
}

export function getRemoteUrl(worktree: string, remote: string): string {
  return runCommandOrThrow("git", ["-C", worktree, "remote", "get-url", remote], worktree).trim()
}

function validateProvider(provider: PushProvider, remoteUrl: string): void {
  const lower = remoteUrl.toLowerCase()
  if (provider === "github" && !lower.includes("github")) {
    throw new Error(`Remote URL does not look like GitHub: ${remoteUrl}`)
  }
  if (provider === "gitlab" && !lower.includes("gitlab")) {
    throw new Error(`Remote URL does not look like GitLab: ${remoteUrl}`)
  }
}

export function push(worktree: string, remote: string, branch: string, provider: PushProvider): void {
  const remoteUrl = getRemoteUrl(worktree, remote)
  validateProvider(provider, remoteUrl)
  runCommandOrThrow("git", ["-C", worktree, "push", remote, branch], worktree)
}
