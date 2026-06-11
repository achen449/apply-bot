import { createConfigurationError } from './gist-customer-data-service.js'

function normalizeApiHost(apiHost) {
  return String(apiHost || '').replace(/\/+$/, '')
}

function extractJsonObject(text) {
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/)
    if (!match) {
      return null
    }
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

export function createAiAnalysisService({ apiHost, apiKey, model, timeoutMs = 60000, maxTokens = 4000, fetchImpl = fetch }) {
  function getConfigurationStatus() {
    const missingEnvVars = []
    if (!apiHost) missingEnvVars.push('AI_API_HOST')
    if (!apiKey) missingEnvVars.push('AI_API_KEY')
    if (!model) missingEnvVars.push('AI_MODEL')
    return {
      configured: missingEnvVars.length === 0,
      missingEnvVars,
      model: model || ''
    }
  }

  function assertConfigured() {
    const config = getConfigurationStatus()
    if (!config.configured) {
      throw createConfigurationError('AI analysis service is not configured.', config.missingEnvVars)
    }
  }

  async function generateJson({ systemPrompt, userPrompt, temperature = 0.2, fallback = null }) {
    const config = getConfigurationStatus()
    if (!config.configured) {
      return fallback
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 60000)

    try {
      const response = await fetchImpl(`${normalizeApiHost(apiHost)}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' }
        })
      })

      if (!response.ok) {
        const error = new Error(`AI request failed with status ${response.status}`)
        error.code = 'ai_request_failed'
        error.status = response.status === 401 || response.status === 403 ? 502 : response.status
        throw error
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content || ''
      return extractJsonObject(content) || fallback
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    getConfigurationStatus,
    assertConfigured,
    generateJson
  }
}
