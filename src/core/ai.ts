import type { AIConfig, AIProviderConfig, CommitSummary } from "../types"

const DEFAULT_COMMIT_TYPE = "refector"

function normalizeCommitType(raw: string): "feat" | "fix" | "refector" | undefined {
  const value = raw.trim().toLowerCase()
  if (value === "feat" || value === "feature") {
    return "feat"
  }
  if (value === "fix" || value === "bugfix" || value === "hotfix") {
    return "fix"
  }
  if (
    value === "refector"
    || value === "refactor"
    || value === "refactoring"
    || value === "chore"
    || value === "docs"
    || value === "style"
    || value === "test"
    || value === "perf"
    || value === "build"
    || value === "ci"
    || value === "revert"
  ) {
    return "refector"
  }
  return undefined
}

function formatTypedMessage(raw: string, maxLength: number): string {
  const conventional = raw.match(/^([a-zA-Z-]+)(?:\([^)]*\))?\s*:\s*(.+)$/)
  const shorthand = raw.match(/^(feat|feature|fix|bugfix|hotfix|refactor|refector)\b[\s:-]+(.+)$/i)

  const detectedType = normalizeCommitType(conventional?.[1] ?? shorthand?.[1] ?? "")
  const type = detectedType ?? DEFAULT_COMMIT_TYPE
  const subjectCandidate = (conventional?.[2] ?? shorthand?.[2] ?? raw)
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/^[-:]+/, "")
    .trim()

  if (subjectCandidate.length === 0) {
    return ""
  }

  const prefix = `${type}: `
  const full = `${prefix}${subjectCandidate}`
  if (full.length <= maxLength) {
    return full
  }

  const available = maxLength - prefix.length
  if (available <= 1) {
    return prefix.trimEnd().slice(0, maxLength)
  }
  return `${prefix}${subjectCandidate.slice(0, available - 1).trimEnd()}…`
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
): Promise<string | undefined> {
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
    return undefined
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return payload.choices?.[0]?.message?.content
}

async function generateAnthropicStyleMessage(
  provider: AIProviderConfig,
  model: string,
  summary: CommitSummary,
  maxLength: number,
  signal: AbortSignal,
): Promise<string | undefined> {
  const apiKey = getApiKey(provider)
  if (!apiKey) {
    return undefined
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
    return undefined
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>
  }
  const firstText = payload.content?.find((item) => item.type === "text")?.text
  return firstText
}

export async function generateCommitMessage(
  ai: AIConfig,
  summary: CommitSummary,
  maxLength: number,
): Promise<string | undefined> {
  if (!ai.enabled) {
    return undefined
  }

  const { provider, model } = splitModelRef(ai.model, ai.defaultProvider)
  if (!provider || !model) {
    return undefined
  }

  const providerConfig = ai.providers[provider]
  if (!providerConfig) {
    return undefined
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ai.timeoutMs)

  try {
    let content: string | undefined
    if (providerConfig.api === "openai-completions") {
      content = await generateOpenAiStyleMessage(providerConfig, model, summary, maxLength, controller.signal)
    } else {
      content = await generateAnthropicStyleMessage(providerConfig, model, summary, maxLength, controller.signal)
    }

    const normalized = normalizeMessage(content ?? "", maxLength)
    return normalized || undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}
