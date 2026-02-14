import fs from "node:fs"
import path from "node:path"
import { ensureDirForFile, getUserConfigHome, writeTextFile } from "../core/fs"
import type { InstallScope } from "../types"

export interface AdapterInstallInput {
  scope: InstallScope
  worktree: string
  configPath: string
  runnerCommand: string
}

const PLUGIN_FILENAME = "code-agent-auto-commit.ts"

function resolvePluginPath(scope: InstallScope, worktree: string): string {
  if (scope === "global") {
    return path.join(getUserConfigHome(), "opencode", "plugins", PLUGIN_FILENAME)
  }
  return path.join(worktree, ".opencode", "plugins", PLUGIN_FILENAME)
}

function pluginContent(worktree: string, configPath: string, runnerCommand: string): string {
  const target = JSON.stringify(worktree)
  const cfg = JSON.stringify(configPath)
  const runner = JSON.stringify(runnerCommand)

  return `import type { Plugin } from "@opencode-ai/plugin"

const TARGET_WORKTREE = ${target}
const CONFIG_PATH = ${cfg}
const RUNNER_COMMAND = ${runner}

export const ChatAutoCommitPlugin: Plugin = async ({ $, client, worktree }) => {
  const done = new Set<string>()

  return {
    event: async ({ event }) => {
      if (event.type !== "session.status") return
      if (worktree !== TARGET_WORKTREE) return

      if (event.properties.status.type === "busy") {
        done.delete(event.properties.sessionID)
        return
      }

      if (event.properties.status.type !== "idle") return
      if (done.has(event.properties.sessionID)) return

      const result = await $\`${"${RUNNER_COMMAND}"} run --tool opencode --worktree ${"${worktree}"} --config ${"${CONFIG_PATH}"} --session-id ${"${event.properties.sessionID}"}\`.quiet().nothrow()
      if (result.exitCode !== 0) {
        await client.app.log({
          body: {
            service: "code-agent-auto-commit",
            level: "warn",
            message: "auto-commit runner failed",
            extra: {
              sessionID: event.properties.sessionID,
              stderr: result.stderr.toString(),
            },
          },
        })
        done.add(event.properties.sessionID)
        return
      }

      done.add(event.properties.sessionID)
      await client.app.log({
        body: {
          service: "code-agent-auto-commit",
          level: "info",
          message: "auto-commit runner finished",
          extra: {
            sessionID: event.properties.sessionID,
          },
        },
      })
    },
  }
}

`
}

export function installOpenCodeAdapter(input: AdapterInstallInput): string {
  const targetPath = resolvePluginPath(input.scope, path.resolve(input.worktree))
  ensureDirForFile(targetPath)
  writeTextFile(targetPath, pluginContent(path.resolve(input.worktree), path.resolve(input.configPath), input.runnerCommand))
  return targetPath
}

export function uninstallOpenCodeAdapter(scope: InstallScope, worktree: string): string {
  const targetPath = resolvePluginPath(scope, path.resolve(worktree))
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath)
  }
  return targetPath
}

export function opencodeAdapterStatus(scope: InstallScope, worktree: string): { path: string; installed: boolean } {
  const targetPath = resolvePluginPath(scope, path.resolve(worktree))
  return {
    path: targetPath,
    installed: fs.existsSync(targetPath),
  }
}
