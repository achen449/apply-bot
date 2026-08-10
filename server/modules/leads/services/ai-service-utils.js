function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function normalizeText(value, fallback = '') {
  return hasText(value) ? value.trim() : fallback
}

export function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(hasText)
    .map((item) => item.trim())
}

export function asPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function clampScore(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(0, Math.min(100, Math.round(parsed)))
}

export function normalizeMode(value) {
  const mode = normalizeText(value, 'standard').toLowerCase()
  return ['economy', 'standard', 'deep'].includes(mode) ? mode : 'standard'
}

export function getModeLimits(mode) {
  const normalizedMode = normalizeMode(mode)
  const limits = {
    economy: { maxIterations: 5, maxSearchCalls: 3, maxVerifications: 3, maxToolCalls: 6, maxResults: 5 },
    standard: { maxIterations: 8, maxSearchCalls: 5, maxVerifications: 5, maxToolCalls: 10, maxResults: 10 },
    deep: { maxIterations: 12, maxSearchCalls: 10, maxVerifications: 10, maxToolCalls: 20, maxResults: 20 }
  }

  return limits[normalizedMode]
}

export function renderPrompt(template, values = {}) {
  let rendered = normalizeText(template)

  for (const [key, value] of Object.entries(values)) {
    const replacement = Array.isArray(value) ? value.join(', ') : String(value ?? '')
    rendered = rendered.replaceAll(`{{${key}}}`, replacement)
  }

  return rendered
}

export async function resolvePrompt({ prompt, promptStorage, promptKey, defaultPrompt, values }) {
  let template = normalizeText(prompt)

  if (!template && promptStorage && hasText(promptKey)) {
    if (typeof promptStorage === 'function') {
      template = normalizeText(await promptStorage(promptKey))
    } else if (typeof promptStorage.getPrompt === 'function') {
      template = normalizeText(await promptStorage.getPrompt(promptKey))
    } else if (typeof promptStorage.readPrompt === 'function') {
      template = normalizeText(await promptStorage.readPrompt(promptKey))
    }
  }

  return renderPrompt(template || defaultPrompt, values)
}

export function extractJsonObject(text) {
  if (!hasText(text)) {
    return null
  }

  const trimmed = text.trim()

  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')

    if (start === -1 || end <= start) {
      return null
    }

    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

export function readAiJson(aiResult) {
  return aiResult?.parsedJson || extractJsonObject(aiResult?.finalText || aiResult?.result || '')
}

export function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function summarizeToolCalls(toolCalls = []) {
  const calls = Array.isArray(toolCalls) ? toolCalls : []

  return {
    searchCalls: calls
      .filter((call) => call?.name === 'search_web')
      .map((call) => ({
        provider: call.result?.provider || call.arguments?.provider || '',
        query: call.arguments?.query || call.result?.query || '',
        ok: call.result?.ok !== false,
        resultCount: Array.isArray(call.result?.results) ? call.result.results.length : 0,
        attempts: Array.isArray(call.result?.attempts) ? call.result.attempts : [],
        providerRequestCount: Number(call.result?.providerRequestCount || call.result?.attempts?.length || 1)
      })),
    verificationCalls: calls
      .filter((call) => call?.name === 'verify_company')
      .map((call) => ({
        companyName: call.arguments?.company_name || call.arguments?.companyName || '',
        address: call.arguments?.address || '',
        ok: call.result?.ok !== false,
        verified: Boolean(call.result?.verified),
        confidence: Number(call.result?.confidence || 0),
        candidate: call.result?.candidates?.[0] || null,
        candidates: Array.isArray(call.result?.candidates) ? call.result.candidates : [],
        error: call.result?.error || null
      })),
    toolCalls: calls
  }
}

export function buildAiMetadata(aiResult) {
  const toolMetadata = summarizeToolCalls(aiResult?.toolCalls || [])

  return {
    finalText: aiResult?.finalText || '',
    parsedJson: aiResult?.parsedJson || null,
    iterations: aiResult?.iterations || 0,
    status: aiResult?.status || 'completed',
    partial: Boolean(aiResult?.partial),
    error: aiResult?.error || null,
    prompt: aiResult?.prompt || null,
    ...toolMetadata
  }
}
