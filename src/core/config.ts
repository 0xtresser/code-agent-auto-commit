import fs from "node:fs"
import path from "node:path"
import {
  getGlobalConfigPath,
  getLegacyProjectConfigPath,
  getProjectConfigPath,
  getProjectEnvExamplePath,
  getProjectEnvPath,
  readJsonFile,
  writeJsonFile,
  writeTextFile,
} from "./fs"
import type { AutoCommitConfig, LoadConfigOptions } from "../types"

const DEFAULT_CONFIG = (worktree: string): AutoCommitConfig => ({
  version: 1,
  enabled: true,
  worktree,
  commit: {
    mode: "single",
    fallbackPrefix: "chore(auto)",
    maxMessageLength: 72,
  },
  ai: {
    enabled: false,
    timeoutMs: 15000,
    model: "openai/gpt-4.1-mini",
    defaultProvider: "openai",
    providers: {
      openai: {
        api: "openai-completions",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      anthropic: {
        api: "anthropic-messages",
        baseUrl: "https://api.anthropic.com/v1",
        apiKeyEnv: "ANTHROPIC_API_KEY",
      },
      openrouter: {
        api: "openai-completions",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
      },
      moonshot: {
        api: "openai-completions",
        baseUrl: "https://api.moonshot.ai/v1",
        apiKeyEnv: "MOONSHOT_API_KEY",
      },
      minimax: {
        api: "openai-completions",
        baseUrl: "https://api.minimaxi.chat/v1",
        apiKeyEnv: "MINIMAX_API_KEY",
      },
      "kimi-coding": {
        api: "anthropic-messages",
        baseUrl: "https://api.moonshot.ai/anthropic",
        apiKeyEnv: "KIMI_API_KEY",
      },
      ollama: {
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKeyEnv: "OLLAMA_API_KEY",
      },
    },
  },
  push: {
    enabled: false,
    provider: "github",
    remote: "origin",
    branch: "",
  },
  filters: {
    include: [],
    exclude: [".env", ".env.*", "*.pem", "*.key", "*.p12"],
  },
})

function mergeConfig(base: AutoCommitConfig, override: Partial<AutoCommitConfig>): AutoCommitConfig {
  const mergedAiProviders: AutoCommitConfig["ai"]["providers"] = {
    ...base.ai.providers,
  }

  const overrideProviders = override.ai?.providers ?? {}
  for (const [providerName, providerConfig] of Object.entries(overrideProviders)) {
    mergedAiProviders[providerName] = {
      ...(base.ai.providers[providerName] ?? {}),
      ...providerConfig,
    }
  }

  return {
    ...base,
    ...override,
    commit: {
      ...base.commit,
      ...override.commit,
    },
    ai: {
      ...base.ai,
      ...override.ai,
      providers: mergedAiProviders,
    },
    push: {
      ...base.push,
      ...override.push,
    },
    filters: {
      ...base.filters,
      ...override.filters,
      include: override.filters?.include ?? base.filters.include,
      exclude: override.filters?.exclude ?? base.filters.exclude,
    },
  }
}

function normalizeConfig(config: AutoCommitConfig): AutoCommitConfig {
  if (config.commit.mode !== "single" && config.commit.mode !== "per-file") {
    throw new Error(`Invalid commit.mode: ${config.commit.mode}`)
  }
  if (config.push.provider !== "github" && config.push.provider !== "gitlab" && config.push.provider !== "generic") {
    throw new Error(`Invalid push.provider: ${config.push.provider}`)
  }
  if (config.commit.maxMessageLength < 20) {
    config.commit.maxMessageLength = 20
  }

  if (config.ai.timeoutMs < 1000) {
    config.ai.timeoutMs = 1000
  }

  if (!config.ai.model.trim()) {
    config.ai.model = "openai/gpt-4.1-mini"
  }

  if (!config.ai.defaultProvider.trim()) {
    config.ai.defaultProvider = "openai"
  }

  const allowedApis = new Set(["openai-completions", "anthropic-messages"])
  for (const [provider, providerConfig] of Object.entries(config.ai.providers)) {
    if (!providerConfig.baseUrl?.trim()) {
      throw new Error(`Invalid ai.providers.${provider}.baseUrl`)
    }
    if (!allowedApis.has(providerConfig.api)) {
      throw new Error(`Invalid ai.providers.${provider}.api: ${providerConfig.api}`)
    }
  }

  if (!config.ai.providers[config.ai.defaultProvider]) {
    throw new Error(`Missing ai.providers.${config.ai.defaultProvider}`)
  }

  return config
}

function buildProjectEnvContent(config: AutoCommitConfig): string {
  const envNames = Array.from(new Set(
    Object.values(config.ai.providers)
      .map((provider) => provider.apiKeyEnv?.trim())
      .filter((name): name is string => Boolean(name)),
  )).sort()

  const lines = [
    "# code-agent-auto-commit local AI keys",
    "# Fill values and run: source .cac/.env",
    "",
  ]

  for (const envName of envNames) {
    lines.push(`${envName}=`)
  }

  lines.push("")
  return lines.join("\n")
}

export function resolveConfigPath(options: LoadConfigOptions): string {
  if (options.explicitPath) {
    return path.resolve(options.explicitPath)
  }

  const cwd = path.resolve(options.worktree ?? process.cwd())
  const projectPath = getProjectConfigPath(cwd)
  if (fs.existsSync(projectPath)) {
    return projectPath
  }

  const legacyProjectPath = getLegacyProjectConfigPath(cwd)
  if (fs.existsSync(legacyProjectPath)) {
    return legacyProjectPath
  }

  return getGlobalConfigPath()
}

export function loadConfig(options: LoadConfigOptions): { config: AutoCommitConfig; path: string } {
  const cwd = path.resolve(options.worktree ?? process.cwd())
  const configPath = resolveConfigPath(options)
  const raw = readJsonFile<Partial<AutoCommitConfig>>(configPath)

  const merged = mergeConfig(DEFAULT_CONFIG(cwd), raw ?? {})
  if (!merged.worktree) {
    merged.worktree = cwd
  }
  return {
    config: normalizeConfig(merged),
    path: configPath,
  }
}

export function initConfigFile(targetPath: string, worktree: string): AutoCommitConfig {
  const resolvedWorktree = path.resolve(worktree)
  const config = DEFAULT_CONFIG(resolvedWorktree)
  writeJsonFile(targetPath, config)

  const envExamplePath = getProjectEnvExamplePath(resolvedWorktree)
  writeTextFile(envExamplePath, buildProjectEnvContent(config))

  const envPath = getProjectEnvPath(resolvedWorktree)
  if (!fs.existsSync(envPath)) {
    writeTextFile(envPath, buildProjectEnvContent(config))
  }

  return config
}

export function updateConfigWorktree(configPath: string, worktree: string): AutoCommitConfig {
  const resolved = path.resolve(worktree)
  const raw = readJsonFile<Partial<AutoCommitConfig>>(configPath) ?? {}
  const merged = mergeConfig(DEFAULT_CONFIG(resolved), raw)
  merged.worktree = resolved
  const normalized = normalizeConfig(merged)
  writeJsonFile(configPath, normalized)
  return normalized
}
