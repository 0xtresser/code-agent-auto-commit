import type { AIConfig, AIGenerateResult, AIProviderConfig, AITestResult, CommitSummary, TokenUsage } from "../types"

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

const MINIMAX_MODEL_ALIASES: Record<string, string> = {
  "minimax-m2.5": "MiniMax-M2.5",
  "minimax-m2.5-highspeed": "MiniMax-M2.5-highspeed",
  "minimax-m2.1": "MiniMax-M2.1",
  "minimax-m2.1-highspeed": "MiniMax-M2.1-highspeed",
  "minimax-m2": "MiniMax-M2",
  "minimax-text-01": "MiniMax-Text-01",
  "text-01": "MiniMax-Text-01",
}

function normalizeProviderModel(provider: string, model: string): string {
  const trimmed = model.trim()
  const raw = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed

  if (provider !== "minimax") {
    return raw
  }

  return MINIMAX_MODEL_ALIASES[raw.toLowerCase()] ?? raw
}

function minimaxFallbackModel(model: string): string | undefined {
  return model === "MiniMax-Text-01" ? undefined : "MiniMax-Text-01"
}

function isUnknownModelError(status: number, body: string): boolean {
  if (status < 400 || status >= 500) {
    return false
  }

  return /unknown\s+model|invalid\s+model|model.*not\s+found|does\s+not\s+exist|not\s+supported/i.test(body)
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

function validateAIConfig(ai: AIConfig): string | undefined {
  if (!ai.enabled) {
    return "ai.enabled is false"
  }
  const { provider, model } = splitModelRef(ai.model, ai.defaultProvider)
  if (!provider || !model) {
    return `invalid ai.model "${ai.model}" — expected "provider/model" format`
  }
  const providerConfig = ai.providers[provider]
  if (!providerConfig) {
    return `provider "${provider}" not found in ai.providers (available: ${Object.keys(ai.providers).join(", ") || "none"})`
  }
  const apiKey = getApiKey(providerConfig)
  if (!apiKey) {
    const envName = providerConfig.apiKeyEnv
    if (envName) {
      return `API key not found — env var "${envName}" is not set. Run: export ${envName}='your-key'`
    }
    return `no API key configured for provider "${provider}" — set apiKeyEnv or apiKey in config`
  }
  return undefined
}

async function generateOpenAiStyleMessage(
  providerName: string,
  provider: AIProviderConfig,
  model: string,
  summary: CommitSummary,
  maxLength: number,
  signal: AbortSignal,
): Promise<{ content: string | undefined; usage: TokenUsage | undefined; error?: string }> {
  const apiKey = getApiKey(provider)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(provider.headers ?? {}),
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  async function requestModel(modelName: string): Promise<
    { ok: true; content: string | undefined; usage: TokenUsage | undefined }
    | { ok: false; status: number; body: string }
  > {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName,
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
      const body = await response.text().catch(() => "")
      return { ok: false, status: response.status, body }
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
    return { ok: true, content: payload.choices?.[0]?.message?.content, usage }
  }

  const first = await requestModel(model)
  if (first.ok) {
    return { content: first.content, usage: first.usage }
  }

  if (providerName === "minimax" && isUnknownModelError(first.status, first.body)) {
    const fallback = minimaxFallbackModel(model)
    if (fallback) {
      const retry = await requestModel(fallback)
      if (retry.ok) {
        return { content: retry.content, usage: retry.usage }
      }

      return {
        content: undefined,
        usage: undefined,
        error: `HTTP ${first.status}: ${first.body.slice(0, 200)} | retry(${fallback}) HTTP ${retry.status}: ${retry.body.slice(0, 120)}`,
      }
    }
  }

  return { content: undefined, usage: undefined, error: `HTTP ${first.status}: ${first.body.slice(0, 200)}` }
}

async function generateAnthropicStyleMessage(
  provider: AIProviderConfig,
  model: string,
  summary: CommitSummary,
  maxLength: number,
  signal: AbortSignal,
): Promise<{ content: string | undefined; usage: TokenUsage | undefined; error?: string }> {
  const apiKey = getApiKey(provider)
  if (!apiKey) {
    return { content: undefined, usage: undefined, error: "no API key" }
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
    const body = await response.text().catch(() => "")
    return { content: undefined, usage: undefined, error: `HTTP ${response.status}: ${body.slice(0, 200)}` }
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
  if (!ai.enabled) {
    return { message: undefined, usage: undefined }
  }

  const configError = validateAIConfig(ai)
  if (configError) {
    return { message: undefined, usage: undefined, warning: configError }
  }

  const { provider, model } = splitModelRef(ai.model, ai.defaultProvider)
  const resolvedModel = normalizeProviderModel(provider, model)
  const providerConfig = ai.providers[provider]

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ai.timeoutMs)

  try {
    let result: { content: string | undefined; usage: TokenUsage | undefined; error?: string }
    if (providerConfig.api === "openai-completions") {
      result = await generateOpenAiStyleMessage(provider, providerConfig, resolvedModel, summary, maxLength, controller.signal)
    } else {
      result = await generateAnthropicStyleMessage(providerConfig, resolvedModel, summary, maxLength, controller.signal)
    }

    if (result.error) {
      return { message: undefined, usage: result.usage, warning: result.error }
    }

    const normalized = normalizeMessage(result.content ?? "", maxLength)
    return { message: normalized || undefined, usage: result.usage }
  } catch (err) {
    const msg = err instanceof Error && err.name === "AbortError"
      ? `AI request timed out after ${ai.timeoutMs}ms`
      : `AI request failed: ${err instanceof Error ? err.message : String(err)}`
    return { message: undefined, usage: undefined, warning: msg }
  } finally {
    clearTimeout(timeout)
  }
}

export async function testAI(ai: AIConfig, userMessage: string): Promise<AITestResult> {
  const configError = validateAIConfig(ai)
  if (configError) {
    return { ok: false, error: configError }
  }

  const { provider, model } = splitModelRef(ai.model, ai.defaultProvider)
  const resolvedModel = normalizeProviderModel(provider, model)
  const providerConfig = ai.providers[provider]
  const apiKey = getApiKey(providerConfig)!

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ai.timeoutMs)

  try {
    if (providerConfig.api === "openai-completions") {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(providerConfig.headers ?? {}),
      }

      async function requestModel(modelName: string): Promise<
        { ok: true; reply: string; usage: TokenUsage | undefined }
        | { ok: false; status: number; body: string }
      > {
        const response = await fetch(`${providerConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelName,
            temperature: 0.2,
            messages: [{ role: "user", content: userMessage }],
          }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const body = await response.text().catch(() => "")
          return { ok: false, status: response.status, body }
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
        return { ok: true, reply: payload.choices?.[0]?.message?.content ?? "", usage }
      }

      const first = await requestModel(resolvedModel)
      if (first.ok) {
        return { ok: true, reply: first.reply, usage: first.usage }
      }

      if (provider === "minimax" && isUnknownModelError(first.status, first.body)) {
        const fallback = minimaxFallbackModel(resolvedModel)
        if (fallback) {
          const retry = await requestModel(fallback)
          if (retry.ok) {
            return { ok: true, reply: retry.reply, usage: retry.usage }
          }
          return {
            ok: false,
            error: `HTTP ${first.status}: ${first.body.slice(0, 300)} | retry(${fallback}) HTTP ${retry.status}: ${retry.body.slice(0, 200)}`,
          }
        }
      }

      return { ok: false, error: `HTTP ${first.status}: ${first.body.slice(0, 300)}` }
    } else {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        ...(providerConfig.headers ?? {}),
      }
      const response = await fetch(`${providerConfig.baseUrl.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: resolvedModel,
          max_tokens: 256,
          messages: [{ role: "user", content: userMessage }],
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.text().catch(() => "")
        return { ok: false, error: `HTTP ${response.status}: ${body.slice(0, 300)}` }
      }
      const payload = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      const reply = payload.content?.find((item) => item.type === "text")?.text ?? ""
      const usage: TokenUsage | undefined = payload.usage
        ? { promptTokens: payload.usage.input_tokens ?? 0, completionTokens: payload.usage.output_tokens ?? 0, totalTokens: (payload.usage.input_tokens ?? 0) + (payload.usage.output_tokens ?? 0) }
        : undefined
      return { ok: true, reply, usage }
    }
  } catch (err) {
    const msg = err instanceof Error && err.name === "AbortError"
      ? `request timed out after ${ai.timeoutMs}ms`
      : `request failed: ${err instanceof Error ? err.message : String(err)}`
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timeout)
  }
}
