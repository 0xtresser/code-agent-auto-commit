export type CommitMode = "single" | "per-file"
export type PushProvider = "github" | "gitlab" | "generic"
export type ToolName = "opencode" | "codex" | "claude" | "manual"
export type InstallScope = "project" | "global"
export type AIProviderApi = "openai-completions" | "anthropic-messages"

export interface CommitConfig {
  mode: CommitMode
  fallbackPrefix: string
  maxMessageLength: number
}

export interface AIConfig {
  enabled: boolean
  timeoutMs: number
  model: string
  defaultProvider: string
  providers: Record<string, AIProviderConfig>
}

export interface AIProviderConfig {
  api: AIProviderApi
  baseUrl: string
  apiKey?: string
  apiKeyEnv?: string
  headers?: Record<string, string>
}

export interface PushConfig {
  enabled: boolean
  provider: PushProvider
  remote: string
  branch: string
}

export interface FilterConfig {
  include: string[]
  exclude: string[]
}

export interface AutoCommitConfig {
  version: 1
  enabled: boolean
  worktree: string
  commit: CommitConfig
  ai: AIConfig
  push: PushConfig
  filters: FilterConfig
}

export interface ChangedFile {
  path: string
  originalPath?: string
  indexStatus: string
  worktreeStatus: string
}

export interface CommitSummary {
  nameStatus: string
  diffStat: string
  patch: string
}

export interface CommitRecord {
  hash: string
  message: string
  files: string[]
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AIGenerateResult {
  message: string | undefined
  usage: TokenUsage | undefined
  warning?: string
}

export interface AITestResult {
  ok: boolean
  reply?: string
  usage?: TokenUsage
  error?: string
}

export interface RunResult {
  skipped: boolean
  reason?: string
  worktree: string
  committed: CommitRecord[]
  pushed: boolean
  tokenUsage?: TokenUsage
  aiWarning?: string
}

export interface RunContext {
  tool: ToolName
  worktree?: string
  sessionID?: string
  event?: unknown
}

export interface LoadConfigOptions {
  explicitPath?: string
  worktree?: string
}
