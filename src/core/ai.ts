import type { AIConfig, AIGenerateResult, AIProviderConfig, CommitSummary, TokenUsage } from "../types"

const VALID_TYPES = new Set([
  "feat", "fix", "refactor", "docs", "style", "test",
  "chore", "perf", "ci", "build", "revert",
])

const TYPE_ALIASES: Record<string, string> = {
  feature: "feat",
  bugfix: "fix",
  hotfix: "fix",
  refactoring: "refactor",
  refector: "refactor",
}

function normalizeCommitType(raw: string): string | undefined {
  const value = raw.trim().toLowerCase()
  if (VALID_TYPES.has(value)) {
    return value
  }
  return TYPE_ALIASES[value] ?? undefined
}

function formatTypedMessage(raw: string, maxLength: number): string {
  const conventional = raw.match(/^([a-zA-Z-]+)(\([^)]*\))?\s*:\s*(.+)$/)

  if (conventional) {
    const type = normalizeCommitType(conventional[1]) ?? "chore"
    const scope = conventional[2] ?? ""
    const subject = conventional[3]
      .replace(/^['"`]+|['"`]+$/g, "")
      .replace(/^[-:]+/, "")
      .trim()
    if (subject.length === 0) return ""
    const full = `${type}${scope}: ${subject}`
    if (full.length <= maxLength) return full
    const prefix = `${type}${scope}: `
    const available = maxLength - prefix.length
    if (available <= 1) return prefix.trimEnd().slice(0, maxLength)
    return `${prefix}${subject.slice(0, available - 1).trimEnd()}…`
  }

  const subject = raw.replace(/^['"`]+|['"`]+$/g, "").trim()
  if (subject.length === 0) return ""
  const prefix = "chore: "
  const full = `${prefix}${subject}`
  if (full.length <= maxLength) return full
  const available = maxLength - prefix.length
  if (available <= 1) return prefix.trimEnd().slice(0, maxLength)
  return `${prefix}${subject.slice(0, available - 1).trimEnd()}…`
}

function normalizeMessage(raw: string, maxLength: number): string {
  const withoutThinking = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "\n")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "\n")
    .replace(/<\/?(think|thinking)>/gi, "\n")
  const cleaned = withoutThinking
    .split(/\r?\n/)
    .map((line) => line.replace(/^['"`]+|['"`]+$/g, "").trim())
    .find((line) => line.length > 0 && line !== "```")
    ?? ""
  if (cleaned.length === 0) {
    return ""
  }
  return formatTypedMessage(cleaned, maxLength)
}

function getApiKey(config: AIProviderConfig): string | undefined {
  if (config.apiKey && config.apiKey.trim().length > 0) {
    return config.apiKey.trim()
  }
  if (!config.apiKeyEnv) {
    return undefined
  }
  const fromEnv = process.env[config.apiKeyEnv]
  if (!fromEnv) {
    return undefined
  }
  return fromEnv.trim()
}

function splitModelRef(modelRef: string, defaultProvider: string): { provider: string; model: string } {
  const trimmed = modelRef.trim()
  const slashIndex = trimmed.indexOf("/")
  if (slashIndex === -1) {
    return {
      provider: defaultProvider,
      model: trimmed,
    }
  }

  return {
    provider: trimmed.slice(0, slashIndex).trim(),
    model: trimmed.slice(slashIndex + 1).trim(),
  }
}

function buildUserPrompt(summary: CommitSummary, maxLength: number): string {
  return [
    `Generate a concise commit message (<= ${maxLength} chars) in Conventional Commits format: "<type>(<scope>): <description>".`,
    "Rules:",
    "- type: feat | fix | refactor | docs | style | test | chore | perf | ci | build",
    "- scope: optional, the module or file area affected (e.g. cli, ai, config)",
    "- description: imperative mood, lowercase, no period, explain WHAT and WHY briefly",
    "- Do NOT just say 'update <filename>' — describe the actual change",
    "- Output exactly one line, no quotes, no code block",
    "",
    "Changed files:",
    summary.nameStatus || "(none)",
    "Diff stat:",
    summary.diffStat || "(none)",
    "Patch excerpt:",
    summary.patch || "(none)",
  ].join("\n")
}

async function generateOpenAiStyleMessage(
  provider: AIProviderConfig,
  model: string,
  summary: CommitSummary,
  maxLength: number,
  signal: AbortSignal,
): Promise<{ content: string | undefined; usage: TokenUsage | undefined }> {
  const apiKey = getApiKey(provider)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(provider.headers ?? {}),
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You generate exactly one conventional commit message. Format: '<type>(<scope>): <description>'. Scope is optional. Allowed types: feat, fix, refactor, docs, style, test, chore, perf, ci, build. Description must be imperative, lowercase, no period. Describe the actual change, not just 'update <file>'. No quotes. No code block.",
        },
        {
          role: "user",
          content: buildUserPrompt(summary, maxLength),
        },
      ],
    }),
    signal,
  })

  if (!response.ok) {
    return { content: undefined, usage: undefined }
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  const usage: TokenUsage | undefined = payload.usage
    ? {
        promptTokens: payload.usage.prompt_tokens ?? 0,
        completionTokens: payload.usage.completion_tokens ?? 0,
        totalTokens: payload.usage.total_tokens ?? 0,
      }
    : undefined
  return { content: payload.choices?.[0]?.message?.content, usage }
}

async function generateAnthropicStyleMessage(
  provider: AIProviderConfig,
  model: string,
  summary: CommitSummary,
  maxLength: number,
  signal: AbortSignal,
): Promise<{ content: string | undefined; usage: TokenUsage | undefined }> {
  const apiKey = getApiKey(provider)
  if (!apiKey) {
    return { content: undefined, usage: undefined }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    ...(provider.headers ?? {}),
  }

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 120,
      temperature: 0.2,
      system: "Generate exactly one conventional commit message. Format: '<type>(<scope>): <description>'. Scope is optional. Allowed types: feat, fix, refactor, docs, style, test, chore, perf, ci, build. Description must be imperative, lowercase, no period. Describe the actual change, not just 'update <file>'. No quotes. No code block.",
      messages: [
        {
          role: "user",
          content: buildUserPrompt(summary, maxLength),
        },
      ],
    }),
    signal,
  })

  if (!response.ok) {
    return { content: undefined, usage: undefined }
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const firstText = payload.content?.find((item) => item.type === "text")?.text
  const usage: TokenUsage | undefined = payload.usage
    ? {
        promptTokens: payload.usage.input_tokens ?? 0,
        completionTokens: payload.usage.output_tokens ?? 0,
        totalTokens: (payload.usage.input_tokens ?? 0) + (payload.usage.output_tokens ?? 0),
      }
    : undefined
  return { content: firstText, usage }
}

export async function generateCommitMessage(
  ai: AIConfig,
  summary: CommitSummary,
  maxLength: number,
): Promise<AIGenerateResult> {
  const empty: AIGenerateResult = { message: undefined, usage: undefined }

  if (!ai.enabled) {
    return empty
  }

  const { provider, model } = splitModelRef(ai.model, ai.defaultProvider)
  if (!provider || !model) {
    return empty
  }

  const providerConfig = ai.providers[provider]
  if (!providerConfig) {
    return empty
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ai.timeoutMs)

  try {
    let result: { content: string | undefined; usage: TokenUsage | undefined }
    if (providerConfig.api === "openai-completions") {
      result = await generateOpenAiStyleMessage(providerConfig, model, summary, maxLength, controller.signal)
    } else {
      result = await generateAnthropicStyleMessage(providerConfig, model, summary, maxLength, controller.signal)
    }

    const normalized = normalizeMessage(result.content ?? "", maxLength)
    return { message: normalized || undefined, usage: result.usage }
  } catch {
    return empty
  } finally {
    clearTimeout(timeout)
  }
}
