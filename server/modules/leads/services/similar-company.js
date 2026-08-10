import {
  buildAiMetadata,
  clampScore,
  createId,
  normalizeStringArray,
  normalizeText,
  readAiJson,
  resolvePrompt
} from './ai-service-utils.js'
import {
  canonicalCompanyWebsite,
  dedupeCompanyCandidates,
  deriveCompanyNameFromSearchResult,
  isLikelyBuyerCandidate,
  isLikelyOfficialCompanyResult,
  matchesTargetCountry
} from '../shared/company-result-normalizer.js'
import { extractCompanyFacts } from '../shared/company-fact-extractors.js'

// Stage one intentionally does not use search tools. The model proposes a
// broad candidate-name pool quickly; code then verifies each identity against
// public search and Maps evidence before any result is displayed.
const SIMILAR_COMPANY_PROMPT = `You are a B2B market research analyst.

Generate a broad pool of real companies similar to the sample company. This is candidate generation only: do not browse, do not call tools, and do not claim that an address, phone number, employee count, or website has been verified.

Requirements:
- Return exactly one JSON object and no Markdown.
- Produce up to {{candidatePoolTarget}} distinct real company candidates. Aim to fill the target.
- Use official English company names, or the company's official local-language name when no English name is used.
- Prefer operating manufacturers, OEMs, system integrators, project developers, operators, installers, and equipment companies in the same or adjacent market.
- When a target market or region is supplied, prioritize companies with public operations or headquarters in that market and exclude companies known to operate only outside it.
- Exclude directories, marketplaces, rankings, articles, publications, associations, generic product names, and the sample company itself.
- Do not invent a website. The verification stage will find the official website programmatically.
- Give concise, specific similarity reasons and scores. Keep each reason under 240 characters.

Sample company:
- Name: {{companyName}}
- Website: {{website}}
- Description: {{description}}
- Industry: {{industry}}
- Target market: {{targetMarket}}
- Country/region: {{country}}
- Requested minimum results: {{requestedCount}}
- Candidate pool target: {{candidatePoolTarget}}

JSON schema:
{
  "companies": [
    {
      "companyName": "Official company name",
      "similarityScore": 85,
      "businessSimilarity": 35,
      "marketSimilarity": 25,
      "scaleSimilarity": 25,
      "industry": "Short industry label",
      "products": ["Relevant product or application"],
      "reason": "Why this is a similar or relevant B2B company"
    }
  ]
}`

const CANDIDATE_STAGE_RUNTIME_CONTRACT = `Runtime contract for this request:
- This is candidate generation only; no tools are available in this stage.
- Return one JSON object with a companies array and no Markdown.
- Do not provide or rely on unverified contact facts or URLs.
- Respect the supplied target market or region when proposing candidate names.
- Search and identity verification will be performed programmatically after this response.`

function normalizeCompany(company = {}, index) {
  const companyName = normalizeText(company.companyName || company.name, `AI candidate ${index + 1}`)
  const website = normalizeText(company.website || company.url)
  const similarityScore = clampScore(company.similarityScore || company.score, 0)
  const businessSimilarity = clampScore(company.businessSimilarity, 0)
  const marketSimilarity = clampScore(company.marketSimilarity, 0)
  const scaleSimilarity = clampScore(company.scaleSimilarity, 0)
  const reason = normalizeText(company.reason || company.whySimilar || company.description)

  return {
    id: createId('similar-company'),
    name: companyName,
    companyName,
    website,
    similarityScore,
    businessSimilarity,
    marketSimilarity,
    scaleSimilarity,
    companySize: normalizeText(company.companySize || company.employeeBand || company.size),
    companySizeSource: normalizeText(company.companySizeSource),
    employeeCount: normalizeText(company.employeeCount),
    employeeRange: normalizeText(company.employeeRange),
    scaleSignals: normalizeStringArray(company.scaleSignals),
    headquarters: normalizeText(company.headquarters),
    industry: normalizeText(company.industry),
    products: normalizeStringArray(company.products),
    source: normalizeText(company.source),
    sourceQuery: normalizeText(company.sourceQuery),
    identityGrounded: Boolean(company.identityGrounded),
    reason,
    address: normalizeText(company.address),
    phone: normalizeText(company.phone),
    contactEmails: normalizeStringArray(company.contactEmails || company.emails),
    contactPages: normalizeStringArray(company.contactPages),
    map: company.map || null,
    evidence: Array.isArray(company.evidence) ? company.evidence : [],
    verified: Boolean(company.verified || company.mapVerified),
    mapVerified: Boolean(company.mapVerified || company.verified),
    dataQuality: company.dataQuality || null
  }
}

const SIMILAR_DEFAULT_RESULT_COUNT = 10
const SIMILAR_MAX_RESULT_COUNT = 30
const SIMILAR_MAX_CANDIDATE_POOL = 40
const SIMILAR_MAX_DISPLAY_COUNT = 30
const SIMILAR_MAX_FALLBACK_SEARCH_CALLS = 6
const SIMILAR_MAX_RESULTS_PER_SEARCH = 20
const SIMILAR_CANDIDATE_SEARCH_RESULTS = 8
const SIMILAR_CANDIDATE_SEARCH_CONCURRENCY = 6

function normalizeResultCount(value, fallback = SIMILAR_DEFAULT_RESULT_COUNT) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), SIMILAR_MAX_RESULT_COUNT)
    : fallback
}

function buildSimilarSearchPlan(requestedCount, requestedInputCount = requestedCount) {
  const candidatePoolTarget = Math.min(
    SIMILAR_MAX_CANDIDATE_POOL,
    Math.max(requestedCount * 2 + 6, requestedCount + 10)
  )
  const maxFallbackSearchCalls = Math.min(
    SIMILAR_MAX_FALLBACK_SEARCH_CALLS,
    Math.max(4, Math.ceil(requestedCount / 3) + 1)
  )
  const maxCandidateVerificationCalls = candidatePoolTarget
  const maxSearchCalls = maxCandidateVerificationCalls + maxFallbackSearchCalls
  const perSearchResults = SIMILAR_MAX_RESULTS_PER_SEARCH

  return {
    requestedCount,
    requestedInputCount,
    maxAllowedResults: SIMILAR_MAX_RESULT_COUNT,
    requestTruncated: requestedInputCount > SIMILAR_MAX_RESULT_COUNT,
    candidatePoolTarget,
    displayLimit: Math.min(SIMILAR_MAX_DISPLAY_COUNT, candidatePoolTarget),
    minimumQualifiedResults: requestedCount,
    displayPolicy: 'all-qualified-up-to-display-limit',
    verificationTarget: candidatePoolTarget,
    maxCandidateVerificationCalls,
    maxFallbackSearchCalls,
    maxSearchCalls,
    perSearchResults,
    candidateSearchResults: SIMILAR_CANDIDATE_SEARCH_RESULTS,
    candidateSearchConcurrency: SIMILAR_CANDIDATE_SEARCH_CONCURRENCY
  }
}

function inferMarketContext(country = '', targetMarket = '', description = '') {
  const explicit = normalizeText([country, targetMarket].filter(Boolean).join(' '))
  if (explicit) return explicit

  const matches = normalizeText(description).match(/\b(?:Europe|European Union|EU|Spain|France|Germany|Italy|Netherlands|United Kingdom|UK|United States|USA|Canada|Mexico|Australia|India|Japan|South Korea|Middle East|Latin America|Southeast Asia)\b/gi) || []
  return [...new Set(matches.map((value) => value.trim()))].join(' ')
}

function websiteHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

const EUROPE_TARGET_PATTERN = /\b(?:europe|european union|eu)\b/i
const EUROPEAN_DOMAIN_PATTERN = /\.(?:at|be|bg|hr|cy|cz|dk|ee|fi|fr|de|gr|hu|ie|it|lv|lt|lu|mt|nl|no|pl|pt|ro|sk|si|es|se|ch|uk|eu)$/i
const EUROPEAN_LOCATION_PATTERN = /\b(?:europe|european union|austria|austrian|belgium|belgian|bulgaria|croatia|cyprus|czech|denmark|danish|estonia|finland|finnish|france|french|germany|german|greece|hungary|ireland|italy|italian|latvia|lithuania|luxembourg|malta|netherlands|dutch|norway|norwegian|poland|polish|portugal|romania|slovakia|slovenia|spain|spanish|sweden|swedish|switzerland|swiss|united kingdom|british|england|scotland|wales)\b/i

function evidenceText(result = {}) {
  return normalizeText([
    result.title,
    result.snippet,
    result.rawContent,
    result.address,
    result.headquarters,
    ...(result.evidence || []).flatMap((item) => [item?.title, item?.snippet])
  ].filter(Boolean).join(' '))
}

function matchesFinalTargetGeography(company = {}, sampleCompany = {}) {
  const targetGeography = normalizeText(sampleCompany.country || sampleCompany.targetMarket)
  if (!EUROPE_TARGET_PATTERN.test(targetGeography)) {
    return true
  }

  const host = websiteHost(company.website)
  if (/\.(?:us|cn|com\.cn|sg|au|in|jp|kr|ca|mx|br)$/i.test(host)) {
    return false
  }

  const authoritativeLocation = normalizeText([company.address, company.headquarters].filter(Boolean).join(' '))
  if (authoritativeLocation && !matchesTargetCountry(targetGeography, authoritativeLocation)) {
    return false
  }

  const observed = evidenceText(company)
  if (!matchesTargetCountry(targetGeography, observed)) {
    return false
  }

  const hasEuropeanEvidence = EUROPEAN_DOMAIN_PATTERN.test(host) || EUROPEAN_LOCATION_PATTERN.test(observed)
  if (/^\s*(?:\+|00)?1(?:\D|$)/.test(normalizeText(company.phone)) && !hasEuropeanEvidence) {
    return false
  }
  return true
}

const COMPANY_NAME_NOISE = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'company', 'co', 'limited', 'ltd', 'llc', 'plc', 'group',
  'holding', 'holdings', 'gmbh', 'ag', 'sa', 'sas', 'bv', 'nv', 'spa', 'srl', 'pte', 'pty', 'solutions',
  'technology', 'technologies', 'international', 'global', 'official', 'home'
])

const SIMILARITY_KEYWORD_NOISE = new Set([
  'and', 'the', 'for', 'with', 'from', 'into', 'that', 'this', 'company', 'companies', 'business', 'market',
  'markets', 'global', 'professional', 'commercial', 'products', 'product', 'services', 'service', 'solutions',
  'solution', 'systems', 'system', 'technology', 'technologies', 'providing', 'provides', 'applications',
  'application', 'energy', 'efficient', 'europe', 'european'
])

function companyNameTokens(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((token) => (token.length > 1 || /^\d+$/.test(token)) && !COMPANY_NAME_NOISE.has(token))
}

function normalizedCompanyIdentity(value) {
  return companyNameTokens(value).join('')
}

function similarityKeywords(sampleCompany = {}) {
  const values = [sampleCompany.industry, sampleCompany.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const tokens = values.match(/[a-z][a-z0-9-]{3,}/g) || []
  return [...new Set(tokens.filter((token) => !SIMILARITY_KEYWORD_NOISE.has(token)))]
}

function keywordMatchesText(keyword, text) {
  const stem = keyword
    .replace(/ies$/, 'y')
    .replace(/ing$/, '')
    .replace(/ers?$/, '')
    .replace(/s$/, '')
  return text.includes(keyword) || (stem.length >= 4 && text.includes(stem))
}

function resultMatchesSimilarityContext(result = {}, sampleCompany = {}) {
  const keywords = similarityKeywords(sampleCompany)
  if (keywords.length === 0) {
    return true
  }

  const sourceText = normalizeText([
    result.title,
    result.snippet,
    result.rawContent,
    result.metadata?.categories?.join?.(' ')
  ].filter(Boolean).join(' ')).toLowerCase()
  if (!sourceText || !keywords.some((keyword) => keywordMatchesText(keyword, sourceText))) {
    return false
  }

  const targetGeography = normalizeText(sampleCompany.country || sampleCompany.targetMarket).toLowerCase()
  const resultHost = websiteHost(result.url || result.website)
  if (/\b(?:europe|european union|eu)\b/.test(targetGeography)
    && /\.(?:us|cn|com\.cn|sg|au|in|jp|kr|ca|mx|br)$/i.test(resultHost)) {
    return false
  }

  const observedLocation = normalizeText([result.address, result.snippet].filter(Boolean).join(' '))
  return matchesTargetCountry(sampleCompany.country || sampleCompany.targetMarket, observedLocation)
}

function companyNameMatchesSearchResult(expectedName, result = {}) {
  const expectedKey = normalizedCompanyIdentity(expectedName)
  const derivedName = deriveCompanyNameFromSearchResult(result)
  const actualKey = normalizedCompanyIdentity(derivedName)
  const domainKey = normalizedCompanyIdentity(websiteHost(result.url || result.website).split('.')[0])

  if (!expectedKey || (!actualKey && !domainKey)) {
    return false
  }

  if ([actualKey, domainKey].some((key) => key && (
    key === expectedKey
      || (Math.min(key.length, expectedKey.length) >= 5 && (key.includes(expectedKey) || expectedKey.includes(key)))
  ))) {
    return true
  }

  const expectedTokens = new Set(companyNameTokens(expectedName))
  const actualTokens = new Set(companyNameTokens(`${derivedName} ${domainKey}`))
  const matchedTokens = [...expectedTokens].filter((token) => actualTokens.has(token))
  return expectedTokens.size > 0
    && matchedTokens.some((token) => token.length >= 4)
    && matchedTokens.length / expectedTokens.size >= 0.6
}

async function mapWithConcurrency(items = [], limit = 6, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(Number(limit) || 6, items.length || 1))

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  }))

  return results
}

function hasRequestBudget(deadlineAt, reserveMs = 0) {
  return !deadlineAt || Date.now() + Math.max(0, Number(reserveMs) || 0) < deadlineAt
}

function readCandidatePool(aiResult = {}, maxCandidates = SIMILAR_MAX_CANDIDATE_POOL) {
  const aiJson = readAiJson(aiResult)
  const candidates = Array.isArray(aiJson?.companies) ? aiJson.companies : []
  const seen = new Set()
  const normalized = []

  for (const candidate of candidates) {
    const companyName = normalizeText(candidate?.companyName || candidate?.name)
    const key = normalizedCompanyIdentity(companyName)
    if (!companyName || !key || seen.has(key)) {
      continue
    }
    seen.add(key)
    normalized.push({
      ...candidate,
      companyName,
      name: companyName,
      // Candidate-stage URLs are suggestions only and must never become
      // trusted identity fields before provider or Maps verification.
      suggestedWebsite: normalizeText(candidate.website || candidate.url),
      suggestedIndustry: normalizeText(candidate.industry),
      suggestedProducts: normalizeStringArray(candidate.products),
      website: '',
      address: '',
      phone: '',
      contactEmails: [],
      companySize: '',
      companySizeSource: '',
      employeeCount: '',
      employeeRange: '',
      scaleSignals: [],
      headquarters: '',
      industry: '',
      products: []
    })
    if (normalized.length >= maxCandidates) {
      break
    }
  }

  return normalized
}

function selectOfficialCandidateResult(companyName, results = [], sampleCompany = {}) {
  return (Array.isArray(results) ? results : [])
    .filter((item) => companyNameMatchesSearchResult(companyName, item))
    .map((item) => ({ ...item, originalTitle: item.title || '', title: companyName }))
    .filter((item) => isLikelyOfficialCompanyResult(item))
    .filter((item) => resultMatchesSimilarityContext(item, sampleCompany))
    .at(0) || null
}

async function runCandidateVerificationSearches(tools = [], candidates = [], {
  country = '',
  marketContext = '',
  sampleCompany = {},
  maxCalls = SIMILAR_MAX_CANDIDATE_POOL,
  maxResults = SIMILAR_CANDIDATE_SEARCH_RESULTS,
  concurrency = SIMILAR_CANDIDATE_SEARCH_CONCURRENCY,
  deadlineAt = 0,
  reserveMs = 0
} = {}) {
  const searchTool = tools.find((tool) => tool?.name === 'search_web' && typeof tool.execute === 'function')
  if (!searchTool || (Array.isArray(searchTool.availableProviders) && searchTool.availableProviders.length === 0)) {
    return []
  }

  const availableProviders = Array.isArray(searchTool.availableProviders) && searchTool.availableProviders.length > 0
    ? searchTool.availableProviders
    : ['tavily', 'brave']
  const market = normalizeText(marketContext || country)
  const selectedCandidates = candidates.slice(0, Math.max(0, maxCalls))

  const calls = await mapWithConcurrency(selectedCandidates, concurrency, async (candidate, index) => {
    if (!hasRequestBudget(deadlineAt, reserveMs)) {
      return null
    }
    const provider = availableProviders[index % availableProviders.length] || 'tavily'
    const query = `${candidate.companyName} ${market} official website company`.replace(/\s+/g, ' ').trim()
    const args = { query, provider, maxResults }

    try {
      let rawResult = await searchTool.execute(args)
      let selected = rawResult?.ok === false
        ? null
        : selectOfficialCandidateResult(candidate.companyName, rawResult?.results, sampleCompany)
      const attemptedProviders = new Set((rawResult?.attempts || []).map((attempt) => attempt.provider).filter(Boolean))
      attemptedProviders.add(rawResult?.provider || provider)

      if (!selected) {
        const alternateProvider = availableProviders.find((value) => !attemptedProviders.has(value))
        if (alternateProvider && hasRequestBudget(deadlineAt, reserveMs)) {
          const alternateResult = await searchTool.execute({ ...args, provider: alternateProvider })
          const alternateSelected = alternateResult?.ok === false
            ? null
            : selectOfficialCandidateResult(candidate.companyName, alternateResult?.results, sampleCompany)
          rawResult = {
            ...alternateResult,
            attempts: [...(rawResult?.attempts || []), ...(alternateResult?.attempts || [])],
            providerRequestCount: (rawResult?.attempts?.length || 1) + (alternateResult?.attempts?.length || 1)
          }
          selected = alternateSelected
        }
      }
      return {
        id: `candidate-search-${index + 1}`,
        name: 'search_web',
        arguments: {
          ...args,
          candidateName: candidate.companyName,
          queryLabel: 'candidate-verification'
        },
        result: rawResult?.ok === false
          ? rawResult
          : {
              ...rawResult,
              rawResultCount: rawResult?.results?.length || 0,
              results: selected ? [selected] : []
            }
      }
    } catch (error) {
      return {
        id: `candidate-search-${index + 1}`,
        name: 'search_web',
        arguments: {
          ...args,
          candidateName: candidate.companyName,
          queryLabel: 'candidate-verification'
        },
        result: {
          ok: false,
          error: {
            code: 'candidate_verification_search_failed',
            message: error.message || 'Candidate verification search failed.'
          }
        }
      }
    }
  })

  return calls.filter(Boolean)
}

function buildPartialAiJson(toolCalls = [], sampleCompany = {}, maxResults = 5) {
  const normalized = buildProviderCandidates(toolCalls, sampleCompany)
    .slice(0, Math.max(1, Number(maxResults) || 5))

  return {
    companies: normalized.map((candidate) => ({
      ...candidate,
      companyName: candidate.name
    }))
  }
}

function buildProviderCandidates(toolCalls = [], sampleCompany = {}) {
  const sampleHost = websiteHost(sampleCompany.website)
  const candidates = []

  for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
    if (call?.name !== 'search_web' || call.result?.ok === false) {
      continue
    }

    for (const item of call.result?.results || []) {
      const rawTitle = normalizeText(item.originalTitle || item.title || item.name)
      const website = canonicalCompanyWebsite(item.url || item.website)
      const name = deriveCompanyNameFromSearchResult({ ...item, title: rawTitle })
      const facts = extractCompanyFacts(item.rawContent || item.snippet || '', rawTitle)

      if (!name
        || !website
        || !isLikelyOfficialCompanyResult(item)
        || !resultMatchesSimilarityContext(item, sampleCompany)
        || (sampleHost && websiteHost(website) === sampleHost)) {
        continue
      }

      candidates.push({
        name,
        companyName: name,
        website,
        similarityScore: 60,
        businessSimilarity: 24,
        marketSimilarity: 18,
        scaleSimilarity: 18,
        ...facts,
        address: normalizeText(item.address || facts.address),
        phone: normalizeText(item.phone),
        reason: normalizeText(item.snippet, 'The company appeared in a related public search result.').slice(0, 420),
        source: item.provider || call.arguments?.provider || 'web-search',
        sourceQuery: call.result?.query || call.arguments?.query || '',
        sourceUrl: website,
        evidence: [{
          type: 'public_web',
          sourceUrl: website,
          title: rawTitle,
          snippet: item.snippet || '',
          provider: item.provider || call.arguments?.provider || 'web-search',
          query: call.result?.query || call.arguments?.query || ''
        }]
      })
    }
  }

  return dedupeCompanyCandidates(candidates).filter(isLikelyBuyerCandidate)
}

function countQualifiedProviderCandidates(toolCalls = [], sampleCompany = {}) {
  return dedupeCompanyCandidates(buildProviderCandidates(toolCalls, sampleCompany))
    .filter(isLikelyBuyerCandidate)
    .length
}

function countSearchCalls(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : []).filter((call) => call?.name === 'search_web').length
}

function remainingFallbackCalls(searchPlan, toolCalls = []) {
  return Math.max(0, Math.min(
    searchPlan.maxFallbackSearchCalls,
    searchPlan.maxSearchCalls - countSearchCalls(toolCalls)
  ))
}

function normalizeEntityKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function buildEvidenceIndex(aiResult = {}, sampleCompany = {}) {
  const hosts = new Set()
  const names = new Set()
  const entries = []

  for (const call of Array.isArray(aiResult.toolCalls) ? aiResult.toolCalls : []) {
    if (call?.name === 'search_web' && call.result?.ok !== false) {
      for (const item of call.result?.results || []) {
        if (!isLikelyOfficialCompanyResult(item) || !resultMatchesSimilarityContext(item, sampleCompany)) {
          continue
        }
        const host = websiteHost(item.url || item.website)
        if (host) hosts.add(host)
        const sourceTitle = item.originalTitle || item.title || item.name || ''
        const companyName = deriveCompanyNameFromSearchResult({ ...item, title: sourceTitle })
        const name = normalizeEntityKey(companyName)
        if (name) names.add(name)
        const facts = extractCompanyFacts(item.rawContent || item.snippet || '', item.title || item.name || '')
        entries.push({
          host,
          name,
          companyName,
          website: canonicalCompanyWebsite(item.url || item.website),
          ...facts,
          address: item.address || facts.address || '',
          phone: item.phone || '',
          provider: item.provider || call.arguments?.provider || 'web-search',
          query: call.result?.query || call.arguments?.query || '',
          evidence: [{
            type: 'public_web',
            sourceUrl: item.url || item.website || '',
            title: sourceTitle,
            snippet: item.snippet || '',
            provider: item.provider || call.arguments?.provider || 'web-search',
            query: call.result?.query || call.arguments?.query || ''
          }]
        })
      }
    }

    if (call?.name === 'verify_company' && call.result?.ok !== false) {
      for (const candidate of call.result?.candidates || []) {
        const host = websiteHost(candidate.website || candidate.url)
        if (host) hosts.add(host)
        const name = normalizeEntityKey(candidate.name || candidate.title)
        if (name) names.add(name)
        entries.push({
          host,
          name,
          website: candidate.website || candidate.url || '',
          address: candidate.address || '',
          phone: candidate.phone || '',
          evidence: [{
            type: 'google_maps',
            sourceUrl: candidate.placeId ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(candidate.placeId)}` : '',
            title: candidate.name || candidate.title || '',
            snippet: candidate.address || ''
          }]
        })
      }
    }
  }

  return { hosts, names, entries }
}

function isGroundedCompany(company = {}, evidenceIndex) {
  const host = websiteHost(company.website)
  if (host && evidenceIndex.hosts.has(host)) {
    return true
  }

  const entityKey = normalizeEntityKey(company.companyName || company.name)
  if (!entityKey) {
    return false
  }

  return evidenceIndex.names.has(entityKey)
}

function findProviderEvidence(company = {}, evidenceIndex = {}) {
  const host = websiteHost(company.website)
  const entityKey = normalizeEntityKey(company.companyName || company.name)
  return (evidenceIndex.entries || []).find((entry) => (
    (host && entry.host === host)
      || (entityKey && entry.name === entityKey)
  )) || null
}

function candidateIdentity(company = {}) {
  const host = websiteHost(company.website)
  if (host) {
    return `host:${host}`
  }

  const name = normalizeEntityKey(company.companyName || company.name)
  return name ? `name:${name}` : ''
}

function dedupeFinalCompanies(companies = []) {
  const byIdentity = new Map()
  for (const company of companies) {
    const host = websiteHost(company.website)
    const name = normalizeEntityKey(company.companyName || company.name)
    const key = host ? `host:${host}` : name ? `name:${name}` : ''
    if (!key) continue
    if (!byIdentity.has(key)) {
      byIdentity.set(key, company)
      continue
    }

    const existing = byIdentity.get(key)
    const existingScore = [existing.address, existing.phone, existing.companySize, existing.mapVerified].filter(Boolean).length
    const candidateScore = [company.address, company.phone, company.companySize, company.mapVerified].filter(Boolean).length
    const preferred = candidateScore > existingScore ? company : existing
    const fallback = preferred === existing ? company : existing
    byIdentity.set(key, {
      ...fallback,
      ...preferred,
      address: preferred.address || fallback.address || '',
      phone: preferred.phone || fallback.phone || '',
      companySize: preferred.companySize || fallback.companySize || '',
      contactEmails: normalizeStringArray([...(preferred.contactEmails || []), ...(fallback.contactEmails || [])]),
      contactPages: normalizeStringArray([...(preferred.contactPages || []), ...(fallback.contactPages || [])]),
      scaleSignals: normalizeStringArray([...(preferred.scaleSignals || []), ...(fallback.scaleSignals || [])]),
      evidence: [...(preferred.evidence || []), ...(fallback.evidence || [])]
    })
  }
  return [...byIdentity.values()]
}

function mergeGroundedCandidates(aiCandidates = [], providerCandidates = [], evidenceIndex = {}) {
  const merged = []
  const byIdentity = new Map()

  function addCandidate(candidate, providerEvidence = null) {
    const identity = candidateIdentity({
      ...candidate,
      website: candidate.website || providerEvidence?.website || ''
    })
    if (!identity) {
      return
    }

    const existing = byIdentity.get(identity)
    if (!existing) {
      const next = { ...candidate, _providerEvidence: providerEvidence }
      byIdentity.set(identity, next)
      merged.push(next)
      return
    }

    existing.website = existing.website || candidate.website
    existing.reason = existing.reason || candidate.reason
    existing.similarityScore = Math.max(existing.similarityScore || 0, candidate.similarityScore || 0)
    existing.businessSimilarity = Math.max(existing.businessSimilarity || 0, candidate.businessSimilarity || 0)
    existing.marketSimilarity = Math.max(existing.marketSimilarity || 0, candidate.marketSimilarity || 0)
    existing.scaleSimilarity = Math.max(existing.scaleSimilarity || 0, candidate.scaleSimilarity || 0)
    existing.companySize = existing.companySize || candidate.companySize || ''
    existing.companySizeSource = existing.companySizeSource || candidate.companySizeSource || ''
    existing.employeeCount = existing.employeeCount || candidate.employeeCount || ''
    existing.employeeRange = existing.employeeRange || candidate.employeeRange || ''
    existing.scaleSignals = normalizeStringArray([...(existing.scaleSignals || []), ...(candidate.scaleSignals || [])])
    existing.headquarters = existing.headquarters || candidate.headquarters || ''
    existing.industry = existing.industry || candidate.industry || ''
    existing.products = normalizeStringArray([...(existing.products || []), ...(candidate.products || [])])
    existing.source = existing.source || candidate.source || ''
    existing.sourceQuery = existing.sourceQuery || candidate.sourceQuery || ''
    existing.identityGrounded = Boolean(existing.identityGrounded || candidate.identityGrounded)
    existing._providerEvidence = existing._providerEvidence || providerEvidence
  }

  for (const candidate of aiCandidates) {
    const providerEvidence = findProviderEvidence(candidate, evidenceIndex)
    const identityGrounded = isGroundedCompany(candidate, evidenceIndex)
    addCandidate({
      ...candidate,
      website: identityGrounded ? (providerEvidence?.website || candidate.website || '') : '',
      suggestedWebsite: identityGrounded ? '' : candidate.website,
      identityGrounded
    }, identityGrounded ? providerEvidence : null)
  }

  for (const candidate of providerCandidates) {
    addCandidate({ ...candidate, identityGrounded: true }, findProviderEvidence(candidate, evidenceIndex) || {
      website: candidate.website,
      address: candidate.address || '',
      phone: candidate.phone || '',
      companySize: candidate.companySize || '',
      companySizeSource: candidate.companySizeSource || '',
      employeeCount: candidate.employeeCount || '',
      employeeRange: candidate.employeeRange || '',
      scaleSignals: candidate.scaleSignals || [],
      headquarters: candidate.headquarters || '',
      provider: candidate.source || '',
      query: candidate.sourceQuery || '',
      evidence: candidate.evidence || []
    })
  }

  return merged
}

async function runProviderFallback(tools = [], {
  companyName,
  industry,
  country,
  marketContext,
  maxResults,
  maxCalls = 4,
  existingQueries = [],
  deadlineAt = 0,
  reserveMs = 0
} = {}) {
  const searchTool = tools.find((tool) => tool?.name === 'search_web' && typeof tool.execute === 'function')
  if (!searchTool) {
    return []
  }

  if (Array.isArray(searchTool.availableProviders) && searchTool.availableProviders.length === 0) {
    return []
  }

  const market = marketContext || country || ''
  const industryContext = industry || 'renewable energy'
  const queries = EUROPE_TARGET_PATTERN.test(market)
    ? [
        `${industryContext} companies ${market} official website`,
        `${industryContext} manufacturers ${market} official website`,
        `site:.es ${industryContext} manufacturer company`,
        `site:.de ${industryContext} manufacturer company`,
        `site:.it ${industryContext} manufacturer company`,
        `site:.fr ${industryContext} manufacturer company`
      ]
    : [
        `${companyName} competitors ${industryContext} ${market} official website`,
        `${industryContext} companies ${market} official website`.trim(),
        `${industryContext} manufacturers ${market} official website`.trim(),
        `${industryContext} system integrators ${market} official website`.trim(),
        `${companyName} alternatives ${market} official company website`.trim(),
        `${industryContext} OEM companies ${market} official website`.trim()
      ]
  const availableProviders = Array.isArray(searchTool.availableProviders) && searchTool.availableProviders.length > 0
    ? searchTool.availableProviders
    : ['tavily', 'brave']
  const providers = queries.map((_, index) => availableProviders[index % availableProviders.length])
  const calls = []
  const seenQueries = new Set(existingQueries.filter(Boolean).map((query) => query.toLowerCase()))

  const pending = []
  for (let index = 0; index < queries.length && pending.length < maxCalls; index += 1) {
    if (!hasRequestBudget(deadlineAt, reserveMs)) {
      break
    }
    if (!seenQueries.has(queries[index].toLowerCase())) {
      pending.push({ index, query: queries[index], provider: providers[index] || 'tavily' })
      seenQueries.add(queries[index].toLowerCase())
    }
  }

  const completed = await Promise.all(pending.map(async ({ index, query, provider }) => {
    const args = { query, provider, maxResults, queryLabel: 'broad-discovery' }
    try {
      return {
        id: `fallback-search-${index + 1}`,
        name: 'search_web',
        arguments: args,
        result: await searchTool.execute(args)
      }
    } catch (error) {
      return {
        id: `fallback-search-${index + 1}`,
        name: 'search_web',
        arguments: args,
        result: {
          ok: false,
          error: {
            code: 'provider_search_failed',
            message: error.message || 'Provider fallback search failed.'
          }
        }
      }
    }
  }))
  calls.push(...completed)

  return calls
}

async function normalizeResult({
  payload,
  aiJson,
  aiResult,
  companyEnrichmentService,
  searchPlan,
  deadlineAt = 0
}) {
  const sampleHost = websiteHost(payload.website)
  const aiCandidates = Array.isArray(aiJson?.companies)
    ? aiJson.companies
        .map((company, index) => normalizeCompany(company, index))
        .filter((company) => company.similarityScore >= 60)
        .filter((company) => isLikelyBuyerCandidate(company))
        .filter((company) => !sampleHost || websiteHost(company.website) !== sampleHost)
    : []

  const metadata = buildAiMetadata(aiResult)
  metadata.candidateGeneration = aiResult?.candidateGeneration || null
  metadata.discoveryBudgetExhausted = Boolean(aiResult?.budgetExhausted)
  const evidenceIndex = buildEvidenceIndex(aiResult, payload)
  const providerCandidates = buildProviderCandidates(aiResult?.toolCalls, payload)
  const mergedCandidates = mergeGroundedCandidates(aiCandidates, providerCandidates, evidenceIndex)
  let companies = mergedCandidates
    .filter((company) => isLikelyBuyerCandidate(company))
    .sort((a, b) => (
      Number(Boolean(b.identityGrounded)) - Number(Boolean(a.identityGrounded))
        || (b.similarityScore || 0) - (a.similarityScore || 0)
    ))
    .slice(0, searchPlan.displayLimit)
    .map((company, index) => {
      const providerEvidence = company._providerEvidence || findProviderEvidence(company, evidenceIndex)
      const normalized = normalizeCompany({
        ...company,
        companyName: providerEvidence?.companyName || company.companyName || company.name,
        website: canonicalCompanyWebsite(providerEvidence?.website || company.website || '')
      }, index)
      return {
        ...normalized,
        // AI controls ranking and explanation only. Identity/contact fields
        // must come from the matched provider evidence or later enrichment.
        website: normalized.identityGrounded ? (providerEvidence?.website || normalized.website || '') : '',
        address: providerEvidence?.address || '',
        phone: providerEvidence?.phone || '',
        companySize: providerEvidence?.companySize || normalized.companySize || '',
        companySizeSource: providerEvidence?.companySizeSource || normalized.companySizeSource || '',
        employeeCount: providerEvidence?.employeeCount || normalized.employeeCount || '',
        employeeRange: providerEvidence?.employeeRange || normalized.employeeRange || '',
        scaleSignals: normalizeStringArray([...(providerEvidence?.scaleSignals || []), ...(normalized.scaleSignals || [])]),
        headquarters: providerEvidence?.headquarters || normalized.headquarters || '',
        industry: normalized.industry || '',
        products: normalized.products || [],
        source: providerEvidence?.provider || normalized.source || '',
        sourceQuery: providerEvidence?.query || normalized.sourceQuery || '',
        contactEmails: [],
        contactPages: [],
        map: null,
        verified: false,
        mapVerified: false,
        evidence: providerEvidence?.evidence || normalized.evidence || []
      }
    })

  const groundedIdentityCount = companies.filter((company) => company.identityGrounded).length
  if ((aiCandidates.length > 0 || providerCandidates.length > 0)
    && groundedIdentityCount === 0
    && (!companyEnrichmentService || typeof companyEnrichmentService.enrichCompanies !== 'function')) {
    metadata.status = 'needs_review'
    metadata.partial = false
    metadata.error = {
      code: 'no_grounded_company_evidence',
      message: 'AI returned companies that could not be matched to successful public search or map evidence.'
    }
  }

  metadata.grounding = {
    aiCandidateCount: aiCandidates.length,
    providerCandidateCount: providerCandidates.length,
    candidateCount: mergedCandidates.length,
    groundedCount: companies.filter((company) => company.identityGrounded).length,
    provisionalAiCount: companies.filter((company) => !company.identityGrounded).length,
    evidenceHostCount: evidenceIndex.hosts.size,
    evidenceNameCount: evidenceIndex.names.size
  }

  metadata.resultPolicy = {
    requestedCount: searchPlan.requestedCount,
    requestedInputCount: searchPlan.requestedInputCount,
    maxAllowedResults: searchPlan.maxAllowedResults,
    requestTruncated: searchPlan.requestTruncated,
    candidatePoolTarget: searchPlan.candidatePoolTarget,
    displayLimit: searchPlan.displayLimit,
    minimumQualifiedResults: searchPlan.minimumQualifiedResults,
    displayPolicy: searchPlan.displayPolicy,
    displayedCount: companies.length,
    maxCandidateVerificationCalls: searchPlan.maxCandidateVerificationCalls,
    maxFallbackSearchCalls: searchPlan.maxFallbackSearchCalls,
    maxSearchCalls: searchPlan.maxSearchCalls
  }

  // Provisional AI-only names cannot be promoted by Maps because a name match
  // does not prove target-industry relevance. Do not spend enrichment budget on
  // candidates that will necessarily be removed afterwards.
  companies = companies.filter((company) => company.identityGrounded)
  metadata.resultPolicy.displayedCount = companies.length

  if (companyEnrichmentService && typeof companyEnrichmentService.enrichCompanies === 'function') {
    const enrichment = await companyEnrichmentService.enrichCompanies(companies, {
      country: payload.country || payload.targetMarket,
      maxResults: companies.length,
      existingVerificationCalls: metadata.verificationCalls || [],
      deadlineAt,
      minimumRemainingMs: 5000
    })
    companies = enrichment.companies.map((company) => ({
      ...company,
      companyName: company.companyName || company.name,
      verified: Boolean(company.mapVerified || company.verified)
    }))
    metadata.verificationCalls = [
      ...(metadata.verificationCalls || []),
      ...enrichment.verificationCalls
    ]
    metadata.enrichmentCalls = enrichment.enrichmentCalls
    metadata.enrichmentBudgetExhausted = Boolean(enrichment.budgetExhausted)
    const enrichedCount = companies.length
    // Maps can strengthen an already relevant company identity, but a name-only
    // Maps match cannot prove that an AI candidate belongs to the target market.
    companies = companies.filter((company) => company.identityGrounded)
    metadata.resultPolicy.displayedCount = companies.length
    metadata.resultPolicy.enrichedCount = enrichedCount
    metadata.resultPolicy.provisionalVerifiedCount = companies.filter((company) => !company.identityGrounded && company.mapVerified).length
    metadata.grounding.verifiedProvisionalCount = metadata.resultPolicy.provisionalVerifiedCount
    metadata.grounding.finalCount = companies.length
    const providerEnrichmentFailed = (enrichment.verificationCalls || []).some((call) => call.ok === false)
      || (enrichment.enrichmentCalls || []).some((call) => ['unavailable', 'enrichment_failed'].includes(call.status))
    if (providerEnrichmentFailed && !enrichment.budgetExhausted && companies.length > 0 && metadata.status === 'completed') {
      metadata.status = 'partial'
      metadata.partial = true
      metadata.error = {
        code: 'provider_enrichment_incomplete',
        message: 'Company identities were verified, but one or more map or official-website enrichment calls failed.'
      }
    }
    if (enrichment.budgetExhausted && companies.length > 0 && metadata.status === 'completed') {
      metadata.status = 'partial'
      metadata.partial = true
      metadata.error = {
        code: 'request_budget_exhausted',
        message: 'The request returned verified company results, but the enrichment budget ended before every field could be checked.'
      }
    }
  } else {
    companies = companies.filter((company) => company.identityGrounded)
    metadata.resultPolicy.displayedCount = companies.length
    metadata.grounding.verifiedProvisionalCount = 0
    metadata.grounding.finalCount = companies.length
  }

  companies = dedupeFinalCompanies(companies)
  const beforeGeographyFilter = companies.length
  companies = companies.filter((company) => matchesFinalTargetGeography(company, payload))
  metadata.resultPolicy.geographyRejectedCount = beforeGeographyFilter - companies.length
  metadata.resultPolicy.displayedCount = companies.length
  metadata.grounding.finalCount = companies.length

  if (metadata.discoveryBudgetExhausted && companies.length > 0 && metadata.status === 'completed') {
    metadata.status = 'partial'
    metadata.partial = true
    metadata.error = {
      code: 'request_budget_exhausted',
      message: 'The request returned verified company results before the discovery budget ended; remaining candidates were not searched.'
    }
  }

  if (companies.length === 0 && !['failed', 'needs_review'].includes(metadata.status)) {
    metadata.status = 'needs_review'
    metadata.partial = false
    metadata.error = {
      code: 'no_qualified_results',
      message: 'Search completed, but no official company pages passed identity, relevance, and evidence screening.'
    }
  } else if (companies.length > 0 && companies.length < searchPlan.requestedCount && metadata.status === 'completed') {
    metadata.status = 'partial'
    metadata.partial = true
    metadata.error = {
      code: 'qualified_results_below_request',
      message: `Found ${companies.length} qualified companies after screening; ${searchPlan.requestedCount} were requested.`
    }
  }

  const createdAt = new Date().toISOString()
  const firstSearchCall = metadata.searchCalls[0] || {}
  const results = companies.map((company) => ({
    company: {
      title: company.companyName,
      url: company.website,
      snippet: company.reason,
      provider: company.source || firstSearchCall.provider || 'ai',
      query: company.sourceQuery || firstSearchCall.query || '',
      queryLabel: 'similar-company',
      capturedAt: createdAt
    },
    profile: {
      name: company.companyName,
      website: company.website,
      keywords: [],
      rawProfile: company.reason
    },
      similarity: company.similarityScore / 100,
    scores: {
      total: company.similarityScore,
      business: company.businessSimilarity,
      market: company.marketSimilarity,
      scale: company.scaleSimilarity
    },
    verified: company.verified,
    address: company.address,
    phone: company.phone,
    companySize: company.companySize,
    companySizeSource: company.companySizeSource,
    employeeCount: company.employeeCount,
    employeeRange: company.employeeRange,
    scaleSignals: company.scaleSignals,
    headquarters: company.headquarters,
    industry: company.industry,
    products: company.products,
    contactEmails: company.contactEmails,
    contactPages: company.contactPages,
    mapVerified: company.mapVerified,
    map: company.map,
    evidence: company.evidence,
    dataQuality: company.dataQuality
  }))

  return {
    companies,
    results,
    sampleCompany: {
      name: payload.companyName,
      website: payload.website,
      description: payload.description,
      industry: payload.industry,
      targetMarket: payload.targetMarket,
      country: payload.country
    },
    metadata,
    createdAt
  }
}

export function createSimilarCompanyService({
  aiAgent,
  tools = [],
  promptStorage,
  prompt = '',
  companyEnrichmentService,
  requestBudgetMs = 0,
  aiTimeoutMs = 0,
  maxTokens = 0
} = {}) {
  if (!aiAgent || typeof aiAgent.executeTask !== 'function') {
    throw new Error('createSimilarCompanyService requires an aiAgent with executeTask.')
  }

  return {
    async findSimilarCompanies(payload = {}) {
      const requestStartedAt = Date.now()
      const deadlineAt = requestBudgetMs > 0 ? requestStartedAt + requestBudgetMs : 0
      const companyName = normalizeText(payload.companyName || payload.name || payload.sampleCompany?.name)
      if (!companyName) {
        const error = new Error('companyName is required')
        error.code = 'invalid_payload'
        throw error
      }

      const website = normalizeText(payload.website || payload.sampleCompany?.website)
      const description = normalizeText(payload.description || payload.sampleCompany?.description)
      const industry = normalizeText(payload.industry || payload.sampleCompany?.industry)
      const targetMarket = normalizeText(payload.targetMarket || payload.sampleCompany?.targetMarket)
      const country = normalizeText(payload.country || payload.sampleCompany?.country)
      const marketContext = inferMarketContext(country, targetMarket, description)
      const effectiveTargetMarket = targetMarket || marketContext
      const parsedRequestedCount = Number.parseInt(payload.maxResults, 10)
      const requestedInputCount = Number.isFinite(parsedRequestedCount) && parsedRequestedCount > 0
        ? parsedRequestedCount
        : SIMILAR_DEFAULT_RESULT_COUNT
      const requestedCount = normalizeResultCount(requestedInputCount)
      const searchPlan = buildSimilarSearchPlan(requestedCount, requestedInputCount)
      const sampleContext = {
        companyName,
        website,
        description,
        industry,
        targetMarket: effectiveTargetMarket,
        country
      }

      const resolvedPrompt = await resolvePrompt({
        prompt,
        promptStorage,
        promptKey: 'similar-company',
        defaultPrompt: SIMILAR_COMPANY_PROMPT,
        values: {
          companyName,
          website,
          description,
          industry,
          targetMarket: effectiveTargetMarket,
          country,
          requestedCount,
          candidatePoolTarget: searchPlan.candidatePoolTarget,
          maxResults: searchPlan.candidatePoolTarget
        }
      })
      const systemPrompt = `${resolvedPrompt}\n\n${CANDIDATE_STAGE_RUNTIME_CONTRACT}`

      let aiResult
      let candidatePool = []
      let generationError = null
      let generationFailed = false
      let recoveredToolCalls = []

      try {
        aiResult = await aiAgent.executeTask({
          systemPrompt,
          userInput: JSON.stringify({
            sampleCompany: {
              name: companyName,
              website,
              description,
              industry,
              targetMarket: effectiveTargetMarket
            },
            country,
            requestedCount,
            candidatePoolTarget: searchPlan.candidatePoolTarget
          }),
          tools: [],
          maxIterations: 1,
          temperature: 0.15,
          reasoningEffort: 'low',
          deadlineMs: deadlineAt ? Math.max(1, deadlineAt - Date.now()) : 0,
          timeoutMs: aiTimeoutMs,
          maxTokens
        })
        candidatePool = readCandidatePool(aiResult, searchPlan.candidatePoolTarget)
        if (candidatePool.length === 0) {
          generationError = {
            code: 'ai_candidate_generation_empty',
            message: 'AI candidate generation returned no parseable company names.'
          }
        }
      } catch (error) {
        generationFailed = true
        recoveredToolCalls = Array.isArray(error?.toolCalls) ? error.toolCalls : []
        generationError = {
          code: error.code || 'ai_candidate_generation_failed',
          message: error.message || 'AI candidate generation failed.'
        }
        aiResult = {
          finalText: '',
          parsedJson: { companies: [] },
          toolCalls: recoveredToolCalls,
          iterations: error.iterations || 0,
          messages: error.messages || [],
          status: 'failed',
          partial: false,
          error: generationError
        }
      }

      const candidateVerificationCalls = await runCandidateVerificationSearches(tools, candidatePool, {
        country,
        marketContext,
        sampleCompany: sampleContext,
        maxCalls: searchPlan.maxCandidateVerificationCalls,
        maxResults: searchPlan.candidateSearchResults,
        concurrency: searchPlan.candidateSearchConcurrency,
        deadlineAt,
        reserveMs: 70000
      })
      let allToolCalls = [...recoveredToolCalls, ...candidateVerificationCalls]
      let budgetExhausted = candidateVerificationCalls.length < candidatePool.length && !hasRequestBudget(deadlineAt, 70000)
      const existingProviderCandidates = countQualifiedProviderCandidates(allToolCalls, sampleContext)
      const fallbackBudget = remainingFallbackCalls(searchPlan, allToolCalls)
      // Broad searches are a recovery path for a shortfall, not a way to fill
      // the optional display ceiling. Once the user's requested minimum is met,
      // preserve the cleaner individually verified pool.
      if (existingProviderCandidates < searchPlan.requestedCount && fallbackBudget > 0) {
        const fallbackCalls = await runProviderFallback(tools, {
          companyName,
          industry,
          country,
          marketContext,
          maxResults: searchPlan.perSearchResults,
          maxCalls: fallbackBudget,
          existingQueries: allToolCalls.map((call) => call.arguments?.query).filter(Boolean),
          deadlineAt,
          reserveMs: 65000
        })
        allToolCalls = [...allToolCalls, ...fallbackCalls]
        if (fallbackCalls.length < fallbackBudget && !hasRequestBudget(deadlineAt, 65000)) {
          budgetExhausted = true
        }
      }

      const providerCandidateCount = countQualifiedProviderCandidates(allToolCalls, sampleContext)
      const hasProviderEvidence = providerCandidateCount > 0
      const generationSucceeded = candidatePool.length > 0
      aiResult = {
        ...aiResult,
        parsedJson: { companies: candidatePool },
        toolCalls: allToolCalls,
        status: generationSucceeded
          ? (generationError ? 'partial' : 'completed')
          : hasProviderEvidence
            ? 'partial'
            : generationFailed
              ? 'failed'
              : 'completed',
        partial: Boolean((generationFailed && hasProviderEvidence) || (generationSucceeded && generationError)),
        error: generationFailed ? generationError : null,
        budgetExhausted,
        candidateGeneration: {
          requestedCount,
          targetCount: searchPlan.candidatePoolTarget,
          generatedCount: candidatePool.length,
          verificationSearchCount: candidateVerificationCalls.length,
          providerCandidateCount,
          error: generationError,
          budgetExhausted
        }
      }

      const result = await normalizeResult({
        payload: sampleContext,
        aiJson: readAiJson(aiResult) || buildPartialAiJson(aiResult?.toolCalls, sampleContext, searchPlan.candidatePoolTarget),
        aiResult: {
          ...aiResult,
          prompt: {
            key: 'similar-company',
            rendered: systemPrompt
          }
        },
        companyEnrichmentService,
        searchPlan,
        deadlineAt
      })

      return {
        ...result,
        status: result.metadata?.status || 'completed',
        partial: Boolean(result.metadata?.partial),
        error: result.metadata?.error || null
      }
    }
  }
}
