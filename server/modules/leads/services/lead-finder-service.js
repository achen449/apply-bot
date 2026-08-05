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
    workspace: {
      id: createId('workspace'),
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

export function createLeadFinderService({ aiAgent, tools = [], promptStorage, prompt = LEAD_FINDER_PROMPT } = {}) {
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

      const aiResult = await aiAgent.executeTask({
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
        maxIterations: limits.maxIterations,
        temperature: 0.2
      })

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
