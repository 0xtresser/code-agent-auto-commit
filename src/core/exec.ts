import { spawnSync } from "node:child_process"

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export function runCommand(command: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  })

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

export function runCommandOrThrow(command: string, args: string[], cwd: string): string {
  const result = runCommand(command, args, cwd)
  if (result.exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim() || "unknown error"}`)
  }
  return result.stdout
}
