import { industryProfiles } from '../../config/industry-profiles.js'

function extractKeywords(text) {
  if (!text) {
    return new Set()
  }

  const stopwords = new Set([
    'the', 'and', 'for', 'that', 'with', 'from', 'this', 'have', 'are', 'was', 'were', 'will', 'your',
    'you', 'our', 'their', 'they', 'but', 'not', 'can', 'has', 'had', 'its', 'about', 'into', 'through',
    'over', 'under', 'than', 'them', 'then', 'also', 'more', 'most', 'some', 'such', 'only', 'other',
    'each', 'many', 'much', 'any', 'all', 'out', 'off', 'who', 'how', 'why', 'what', 'when', 'where',
    'which', 'while', 'because', 'being', 'been', 'does', 'did', 'doing', 'after', 'before', 'during',
    'between', 'within', 'without', 'across', 'among', 'onto', 'upon', 'per', 'company', 'companies'
  ])

  const words = String(text).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []
  return new Set(words.filter((word) => !stopwords.has(word)))
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCompanyName(value) {
  return normalizeText(value).replace(/\s+/g, ' ')
}

function buildProfileText(companyName, websiteUrl, providerResults = []) {
  return [
    companyName,
    websiteUrl,
    ...providerResults.flatMap((result) => [result.title, result.snippet, result.rawContent, result.url])
  ].filter(Boolean).join(' ')
}

function calculateJaccard(keywords1, keywords2) {
  if (!keywords1.size || !keywords2.size) {
    return 0
  }

  const intersection = new Set([...keywords1].filter((keyword) => keywords2.has(keyword)))
  const union = new Set([...keywords1, ...keywords2])
  return intersection.size / union.size
}

function pickFallbackCompanies(inputCompany, topN) {
  const haystack = [inputCompany.industry, inputCompany.description, inputCompany.targetProduct, inputCompany.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const matchingProfile = Object.values(industryProfiles).find((profile) => {
    const profileText = [profile.label, profile.description, ...profile.upstreamIndustries, ...profile.searchTerms].join(' ').toLowerCase()
    return profileText.includes(haystack) || haystack.includes(profile.label.toLowerCase()) || profile.searchTerms.some((term) => haystack.includes(term))
  }) || industryProfiles['industrial connectors']

  return Object.entries(matchingProfile.companySeeds || {})
    .flatMap(([category, names]) => names.map((name) => ({
      name,
      category,
      countryHint: '',
      reason: `${name} appears in the ${category} target account seed list for ${matchingProfile.label}.`,
      expectedProducts: matchingProfile.searchTerms || []
    })))
    .slice(0, Math.max(topN, 20))
}

function buildRecommendationPrompt(inputCompany, topN) {
  return {
    systemPrompt: [
      'You are a B2B foreign-trade lead generation analyst.',
      'Recommend real companies that could be similar to or relevant buyer accounts for the user.',
      'Return JSON only. Do not include web pages, directories, marketplaces, blogs, or news articles as companies.',
      'Prefer manufacturers, system integrators, OEMs, project developers, operators, and hardware companies.',
      'Every recommendation must include name, category, countryHint, reason, and expectedProducts.'
    ].join('\n'),
    userPrompt: JSON.stringify({
      task: 'recommend_similar_or_relevant_buyer_companies',
      topN: Math.max(topN, 20),
      inputCompany
    }, null, 2)
  }
}

function normalizeRecommendations(aiOutput, fallbackCompanies, topN) {
  const fromAi = Array.isArray(aiOutput?.companies)
    ? aiOutput.companies
    : Array.isArray(aiOutput?.recommendedCompanies)
      ? aiOutput.recommendedCompanies
      : []
  const combined = [...fromAi, ...fallbackCompanies]
  const seen = new Set()
  const results = []

  for (const item of combined) {
    const name = normalizeCompanyName(item?.name || item?.companyName)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) {
      continue
    }
    seen.add(key)
    results.push({
      name,
      category: normalizeText(item.category || item.type || 'target company'),
      countryHint: normalizeText(item.countryHint || item.country || ''),
      reason: normalizeText(item.reason || item.whyFit || 'Relevant target account candidate.'),
      expectedProducts: Array.isArray(item.expectedProducts) ? item.expectedProducts.filter(Boolean).slice(0, 8) : []
    })
  }

  return results.slice(0, Math.max(topN, 20))
}

function summarizeEvidence(providerResults) {
  return providerResults.slice(0, 6).map((result) => ({
    provider: result.provider || 'search',
    title: result.title || '',
    url: result.url || '',
    snippet: result.snippet || '',
    sourceType: result.resultType || 'search_result'
  }))
}

export function createCompanySimilarityService({ tavilyAdapter, braveAdapter, aiAnalysisService, apiBudgetService, researchRunService }) {
  async function searchProvider(provider, payload, fetcher) {
    if (!apiBudgetService) {
      return { results: await fetcher(), provider, cacheHit: false, skipped: false }
    }
    return apiBudgetService.runProviderCall({ provider, payload, fetcher })
  }

  async function recommendCompanies(inputCompany, topN = 20) {
    const fallbackCompanies = pickFallbackCompanies(inputCompany, topN)
    const prompt = buildRecommendationPrompt(inputCompany, topN)
    const aiOutput = await aiAnalysisService?.generateJson?.({
      ...prompt,
      fallback: null,
      temperature: 0.15
    })
    return normalizeRecommendations(aiOutput, fallbackCompanies, topN)
  }

  async function extractCompanyProfile(companyName, websiteUrl = '', context = {}) {
    const queries = [
      websiteUrl || `${companyName} official website products company overview`,
      `${companyName} ${context.category || ''} products headquarters employees`,
      `${companyName} ${context.expectedProducts?.[0] || context.targetProduct || ''} official website`
    ].filter(Boolean)
    const providerCalls = []
    const providerResults = []

    for (const query of queries.slice(0, 2)) {
      const tavilyCall = await searchProvider('tavily', { query }, () => tavilyAdapter.search({ query, label: 'company_enrichment' }))
      providerCalls.push({ provider: 'tavily', query, cacheHit: tavilyCall.cacheHit, skipped: tavilyCall.skipped })
      providerResults.push(...tavilyCall.results)
    }

    if (braveAdapter) {
      const braveQuery = `${companyName} official website ${context.countryHint || ''}`.trim()
      const braveCall = await searchProvider('brave', { query: braveQuery }, () => braveAdapter.search({ query: braveQuery, label: 'company_enrichment' }))
      providerCalls.push({ provider: 'brave', query: braveQuery, cacheHit: braveCall.cacheHit, skipped: braveCall.skipped })
      providerResults.push(...braveCall.results)
    }

    const profileText = buildProfileText(companyName, websiteUrl, providerResults)
    return {
      name: companyName,
      website: websiteUrl || providerResults.find((result) => result.url)?.url || '',
      keywords: extractKeywords(profileText),
      rawProfile: profileText.slice(0, 1200),
      evidence: summarizeEvidence(providerResults),
      providerCalls
    }
  }

  function calculateSimilarity(profile1, profile2) {
    return calculateJaccard(profile1?.keywords || new Set(), profile2?.keywords || new Set())
  }

  async function enrichRecommendation(inputProfile, recommendation, inputCompany) {
    const profile = await extractCompanyProfile(recommendation.name, '', {
      ...recommendation,
      targetProduct: inputCompany.targetProduct || inputCompany.product || inputCompany.industry || ''
    })
    const similarity = calculateSimilarity(inputProfile, profile)
    const aiSummary = await aiAnalysisService?.generateJson?.({
      systemPrompt: [
        'You are an OSINT analyst for B2B lead qualification.',
        'Use only the provided public evidence. Do not invent facts.',
        'Return JSON with companyName, likelyWebsite, products, scaleSignals, buyerFitScore, buyerFitReasons, informationGaps.'
      ].join('\n'),
      userPrompt: JSON.stringify({ inputCompany, recommendation, evidence: profile.evidence }, null, 2),
      fallback: null,
      temperature: 0.1
    })

    return {
      companyName: recommendation.name,
      website: aiSummary?.likelyWebsite || profile.website,
      category: recommendation.category,
      countryHint: recommendation.countryHint,
      recommendationReason: recommendation.reason,
      expectedProducts: recommendation.expectedProducts,
      products: Array.isArray(aiSummary?.products) ? aiSummary.products : recommendation.expectedProducts,
      scaleSignals: Array.isArray(aiSummary?.scaleSignals) ? aiSummary.scaleSignals : [],
      buyerFitScore: Number.isFinite(aiSummary?.buyerFitScore) ? aiSummary.buyerFitScore : Math.round(60 + similarity * 35),
      buyerFitReasons: Array.isArray(aiSummary?.buyerFitReasons) ? aiSummary.buyerFitReasons : [recommendation.reason],
      informationGaps: Array.isArray(aiSummary?.informationGaps) ? aiSummary.informationGaps : [],
      similarity,
      evidence: profile.evidence,
      providerCalls: profile.providerCalls
    }
  }

  async function findSimilarCompanies(inputCompany, topN = 10) {
    const recommendations = await recommendCompanies(inputCompany, Math.max(topN, 20))
    const inputProfile = await extractCompanyProfile(inputCompany.name, inputCompany.website || '', inputCompany)
    
    // Limit to prevent timeout: max 5 companies, parallel processing
    const batchSize = Math.min(topN, 5)
    const batch = recommendations.slice(0, batchSize)
    
    // Parallel enrichment instead of sequential
    const enrichedResults = await Promise.all(
      batch.map(recommendation => enrichRecommendation(inputProfile, recommendation, inputCompany))
    )
    
    const providerCalls = [...inputProfile.providerCalls]
    enrichedResults.forEach(result => providerCalls.push(...result.providerCalls))

    const sorted = enrichedResults
      .sort((left, right) => right.buyerFitScore - left.buyerFitScore)
      .slice(0, topN)
    const run = await researchRunService?.saveCompletedRun?.({
      type: 'similar_company',
      input: { company: inputCompany, topN },
      providerCalls,
      results: sorted,
      evidence: sorted.flatMap((item) => item.evidence || []),
      summary: `Recommended and checked ${sorted.length} company candidates for ${inputCompany.name}.`
    })

    return {
      runId: run?.id || null,
      recommendations,
      results: sorted
    }
  }

  return {
    recommendCompanies,
    extractCompanyProfile,
    calculateSimilarity,
    findSimilarCompanies
  }
}
