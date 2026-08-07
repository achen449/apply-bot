import { LEAD_FINDER_PROMPT } from '../prompts/lead-finder.js'
import {
  asPositiveInteger,
  buildAiMetadata,
  clampScore,
  createId,
  getModeLimits,
  normalizeMode,
  normalizeStringArray,
  normalizeText,
  readAiJson,
  resolvePrompt
} from './ai-service-utils.js'

function normalizeCompany(company = {}, index, country) {
  const name = normalizeText(company.name || company.companyName, `AI candidate ${index + 1}`)
  const website = normalizeText(company.website || company.url)
  const score = clampScore(company.score || company.fitScore, 0)
  const reason = normalizeText(company.reason || company.whyFit || company.description)
  const signals = normalizeStringArray(company.signals).length ? normalizeStringArray(company.signals) : [reason].filter(Boolean)

  return {
    id: createId('company'),
    name,
    website,
    country: normalizeText(company.country, country),
    segment: normalizeText(company.segment || company.industry),
    profile: normalizeText(company.profile || company.description || reason),
    size: normalizeText(company.size),
    fitScore: score,
    signals,
    whyFit: reason,
    priority: score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low',
    source: normalizeText(company.source || company.provider || 'ai'),
    sourceUrl: normalizeText(company.sourceUrl || company.evidence?.[0]?.url || website),
    businessType: normalizeText(company.businessType),
    marketRole: normalizeText(company.marketRole),
    businessSummary: normalizeText(company.businessSummary || company.description),
    buyingRelevance: normalizeText(company.buyingRelevance || reason),
    mainProducts: normalizeStringArray(company.mainProducts || company.products),
    targetApplications: normalizeStringArray(company.targetApplications || company.applications),
    address: normalizeText(company.address),
    notes: normalizeText(company.notes),
    officialWebsiteLikely: Boolean(company.officialWebsiteLikely || website),
    matchedProviders: normalizeStringArray(company.matchedProviders),
    matchedQueryLabels: normalizeStringArray(company.matchedQueryLabels),
    mapVerified: Boolean(company.mapVerified || company.verified)
  }
}

function createSummary(companies) {
  return {
    companyCount: companies.length,
    contactCount: 0,
    draftCount: 0,
    topProfiles: [...new Set(companies.map((company) => company.profile).filter(Boolean))].slice(0, 4)
  }
}

function buildPartialLeadFinderJson(toolCalls = []) {
  const companies = []
  const byKey = new Map()

  function upsertCompany(candidate = {}) {
    const name = normalizeText(candidate.name || candidate.companyName)
    const website = normalizeText(candidate.website || candidate.url)

    if (!name) {
      return
    }

    const key = (website || name).toLowerCase()
    const existing = byKey.get(key)

    if (existing) {
      Object.assign(existing, {
        website: existing.website || website,
        address: existing.address || normalizeText(candidate.address),
        reason: existing.reason || normalizeText(candidate.reason || candidate.description),
        source: existing.source || normalizeText(candidate.source || candidate.provider),
        sourceUrl: existing.sourceUrl || normalizeText(candidate.sourceUrl || candidate.url),
        mapVerified: existing.mapVerified || Boolean(candidate.mapVerified || candidate.verified),
        score: Math.max(existing.score || 0, Number(candidate.score) || 0)
      })
      return
    }

    const normalized = {
      name,
      website,
      address: normalizeText(candidate.address),
      score: Number(candidate.score) || 45,
      reason: normalizeText(candidate.reason || candidate.description || candidate.snippet, 'Collected from public provider evidence.'),
      source: normalizeText(candidate.source || candidate.provider, 'provider'),
      sourceUrl: normalizeText(candidate.sourceUrl || candidate.url || website),
      mapVerified: Boolean(candidate.mapVerified || candidate.verified),
      profile: normalizeText(candidate.profile || candidate.description || candidate.snippet)
    }

    byKey.set(key, normalized)
    companies.push(normalized)
  }

  for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
    if (call?.name === 'search_web' && call.result?.ok !== false) {
      for (const result of call.result?.results || []) {
        upsertCompany({
          name: result.title,
          website: result.url,
          address: result.address,
          snippet: result.snippet,
          provider: result.provider || call.arguments?.provider,
          sourceUrl: result.url
        })
      }
    }

    if (call?.name === 'verify_company' && call.result?.ok !== false) {
      const companyName = call.arguments?.company_name || call.arguments?.companyName
      const candidates = call.result?.candidates || []

      if (candidates.length > 0) {
        for (const candidate of candidates) {
          upsertCompany({
            name: candidate.name || companyName,
            website: candidate.website,
            address: candidate.address,
            score: Number(candidate.confidence || 0) * 100,
            reason: candidate.address ? `Google Maps candidate: ${candidate.address}` : 'Google Maps candidate.',
            provider: 'google-maps',
            sourceUrl: candidate.placeId ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(candidate.placeId)}` : '',
            verified: Number(candidate.confidence || 0) >= 0.5
          })
        }
      } else {
        upsertCompany({
          name: companyName,
          address: call.result?.address,
          score: Number(call.result?.confidence || 0) * 100,
          reason: call.result?.address ? `Google Maps candidate: ${call.result.address}` : 'Company verification was attempted.',
          provider: 'google-maps',
          verified: Boolean(call.result?.verified)
        })
      }
    }
  }

  const shortlist = companies.slice(0, 5)

  return {
    recommendedSegments: [],
    companies,
    candidatePool: companies,
    shortlist
  }
}

function toUiToolCalls(toolCalls = []) {
  return toolCalls.map((call, index) => ({
    id: call.id || `tool-${index + 1}`,
    type: 'function',
    function: {
      name: call.name || 'unknown_tool',
      arguments: JSON.stringify(call.arguments || {}, null, 2)
    },
    status: call.result?.ok === false ? 'error' : 'completed',
    result: JSON.stringify(call.result || {}, null, 2)
  }))
}

function toUiCompanies(companies = []) {
  return companies.map((company) => ({
    name: company.name,
    score: company.fitScore,
    reasoning: company.whyFit || company.buyingRelevance || company.profile,
    website: company.website,
    country: company.country,
    segment: company.segment
  }))
}

function normalizeWorkspace({ payload, mode, aiJson, aiResult }) {
  const companies = Array.isArray(aiJson?.companies)
    ? aiJson.companies.map((company, index) => normalizeCompany(company, index, payload.country))
    : []
  const metadata = buildAiMetadata(aiResult)
  const uiCompanies = toUiCompanies(companies)

  return {
    status: aiResult.status || 'completed',
    partial: Boolean(aiResult.partial),
    workspace: {
      id: createId('workspace'),
      status: aiResult.status || 'completed',
      industry: normalizeText(payload.industry),
      country: normalizeText(payload.country),
      keywords: normalizeStringArray(payload.keywords),
      createdAt: new Date().toISOString(),
      recommendedSegments: normalizeStringArray(aiJson?.recommendedSegments),
      providersUsed: [...new Set(metadata.searchCalls.map((call) => call.provider).filter(Boolean))],
      searchStrategy: {
        targetTypes: normalizeStringArray(payload.targetTypes),
        excludeTypes: normalizeStringArray(payload.excludeTypes),
        queryTemplates: metadata.searchCalls.map((call) => call.query).filter(Boolean),
        queryCount: metadata.searchCalls.length,
        evidenceMode: mode
      },
      companies,
      contacts: [],
      drafts: [],
      summary: createSummary(companies)
    },
    results: companies,
    companies: uiCompanies,
    toolCalls: toUiToolCalls(metadata.toolCalls),
    candidatePool: Array.isArray(aiJson?.candidatePool) ? aiJson.candidatePool : companies,
    shortlist: Array.isArray(aiJson?.shortlist) ? aiJson.shortlist : companies.slice(0, 5),
    metadata
  }
}

export function createLeadFinderService({
  aiAgent,
  tools = [],
  promptStorage,
  prompt = LEAD_FINDER_PROMPT,
  requestBudgetMs = 0,
  maxIterationsCap = 0,
  aiTimeoutMs = 0,
  maxTokens = 0,
  maxToolCalls = 0,
  toolTimeoutMs = 0
} = {}) {
  if (!aiAgent || typeof aiAgent.executeTask !== 'function') {
    throw new Error('createLeadFinderService requires an aiAgent with executeTask.')
  }

  return {
    async discoverWorkspace(payload = {}) {
      const industry = normalizeText(payload.industry)
      if (!industry) {
        const error = new Error('industry is required')
        error.code = 'invalid_payload'
        throw error
      }

      const mode = normalizeMode(payload.mode)
      const limits = getModeLimits(mode)
      const keywords = normalizeStringArray(payload.keywords)
      const systemPrompt = await resolvePrompt({
        prompt,
        promptStorage,
        promptKey: 'lead-finder',
        defaultPrompt: LEAD_FINDER_PROMPT,
        values: {
          industry,
          country: normalizeText(payload.country),
          keywords,
          mode,
          maxSearchCalls: limits.maxSearchCalls,
          maxVerifications: limits.maxVerifications,
          maxResults: limits.maxResults
        }
      })

      const effectiveMaxIterations = maxIterationsCap > 0
        ? Math.min(limits.maxIterations, maxIterationsCap)
        : limits.maxIterations

      let aiResult

      try {
        aiResult = await aiAgent.executeTask({
          systemPrompt,
          userInput: JSON.stringify({
            industry,
            country: normalizeText(payload.country),
            keywords,
            targetTypes: normalizeStringArray(payload.targetTypes),
            excludeTypes: normalizeStringArray(payload.excludeTypes),
            mode
          }),
          tools,
          maxIterations: effectiveMaxIterations,
          temperature: 0.2,
          deadlineMs: requestBudgetMs,
          timeoutMs: aiTimeoutMs,
          maxTokens,
          maxToolCalls,
          toolTimeoutMs
        })
      } catch (error) {
        const canReturnPartial = requestBudgetMs > 0 && [
          'ai_request_timeout',
          'ai_agent_max_iterations'
        ].includes(error?.code)

        if (!canReturnPartial) {
          throw error
        }

        const partialAiResult = {
          finalText: '',
          parsedJson: null,
          toolCalls: error.toolCalls || [],
          iterations: error.iterations || 0,
          messages: error.messages || [],
          status: 'needs_review',
          partial: true,
          error: {
            code: error.code,
            message: error.message
          },
          prompt: {
            key: 'lead-finder',
            rendered: systemPrompt
          }
        }

        return normalizeWorkspace({
          payload: { ...payload, industry, keywords },
          mode,
          aiJson: buildPartialLeadFinderJson(partialAiResult.toolCalls),
          aiResult: partialAiResult
        })
      }

      return normalizeWorkspace({
        payload: { ...payload, industry, keywords },
        mode,
        aiJson: readAiJson(aiResult),
        aiResult: {
          ...aiResult,
          prompt: {
            key: 'lead-finder',
            rendered: systemPrompt
          }
        }
      })
    }
  }
}
