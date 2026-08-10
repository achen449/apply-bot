import { createResearchRun, getPartStatus } from '../shared/research-run-contract.js'

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function toPositiveInteger(value, fallbackValue) {
  const normalized = Number.parseInt(value, 10)
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallbackValue
}

function countCallFailures(calls = []) {
  return calls.filter((call) => call?.ok === false || call?.error).length
}

function buildSimilarCompanyParts(result = {}, queryInput = {}) {
  const metadata = result.metadata || {}
  const searchCalls = metadata.searchCalls || []
  const verificationCalls = metadata.verificationCalls || []
  const enrichmentCalls = metadata.enrichmentCalls || []

  return [
    {
      workflow: 'similar-company',
      part: 'discovery',
      title: 'Similar-company discovery',
      status: getPartStatus({
        attempted: searchCalls.length,
        succeeded: searchCalls.filter((call) => call.ok !== false).length,
        failed: countCallFailures(searchCalls),
        empty: searchCalls.length === 0
      }),
      prompt: metadata.prompt || null,
      searchCalls,
      queryInput
    },
    {
      workflow: 'similar-company',
      part: 'map-verification',
      title: 'Google Maps verification',
      status: getPartStatus({
        attempted: verificationCalls.length,
        succeeded: verificationCalls.filter((call) => call.ok !== false).length,
        failed: countCallFailures(verificationCalls),
        empty: verificationCalls.length === 0
      }),
      verificationCalls
    },
    {
      workflow: 'similar-company',
      part: 'contact-enrichment',
      title: 'Official website contact enrichment',
      status: getPartStatus({
        attempted: enrichmentCalls.length,
        succeeded: enrichmentCalls.filter((call) => ['completed', 'no_public_email'].includes(call.status)).length,
        failed: enrichmentCalls.filter((call) => ['unavailable', 'enrichment_failed'].includes(call.status)).length,
        empty: enrichmentCalls.length === 0
      }),
      enrichmentCalls
    },
    {
      workflow: 'similar-company',
      part: 'report',
      title: 'Similar-company report',
      status: result.status || metadata.status || 'needs_review',
      resultPolicy: metadata.resultPolicy || null,
      results: result.results || [],
      errors: result.error ? [result.error] : []
    }
  ]
}

function hasSimilarSearchProvider(providerAvailability = {}) {
  return Boolean(providerAvailability?.tavily?.available || providerAvailability?.brave?.available)
}

function getMissingProviderEnvVars(providerAvailability = {}) {
  const values = [
    ...(providerAvailability?.tavily?.missingEnvVars || []),
    ...(providerAvailability?.brave?.missingEnvVars || [])
  ].filter(Boolean)

  return values.length > 0
    ? [...new Set(values)]
    : ['TAVILY_API_KEY', 'BRAVE_API_KEY']
}

export function createSimilarCompanyHandler({
  companySimilarityService,
  providerAvailability = {},
  persistRun,
  sendMissingEnvResponse,
  sendMissingService,
  sendServiceError
} = {}) {
  return async function handleSimilarCompany(req, res) {
    try {
      const { company, topN = 10 } = req.body || {}

      if (!hasSimilarSearchProvider(providerAvailability)) {
        return sendMissingEnvResponse(
          res,
          'TAVILY_API_KEY or BRAVE_API_KEY is required for similar company search.',
          getMissingProviderEnvVars(providerAvailability)
        )
      }

      if (!companySimilarityService) {
        return sendMissingService(res)
      }

      if (!hasText(company?.name)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_payload',
          error: 'company.name is required'
        })
      }

      const requestedCount = toPositiveInteger(topN, 10)
      const result = await companySimilarityService.findSimilarCompanies({
        ...company,
        maxResults: requestedCount
      })
      const queryInput = {
        sampleCompany: company,
        topN: requestedCount
      }
      const run = createResearchRun({
        id: `similar-company-${Date.now()}`,
        workflow: 'similar-company',
        title: `Similar Company: ${company.name}`,
        status: result.status || result.metadata?.status || (result.error ? 'needs_review' : 'completed'),
        part: 'report',
        prompt: result.metadata?.prompt || null,
        searchCalls: result.metadata?.searchCalls || [],
        verificationCalls: result.metadata?.verificationCalls || [],
        enrichmentCalls: result.metadata?.enrichmentCalls || [],
        queryInput,
        resultPolicy: result.metadata?.resultPolicy || null,
        sampleCompany: result.sampleCompany || company,
        results: result.results || [],
        errors: result.error ? [result.error] : [],
        parts: buildSimilarCompanyParts(result, queryInput)
      })
      const persistence = await persistRun(run)

      return res.json({
        success: true,
        configured: true,
        status: run.status,
        partial: Boolean(result.partial),
        runId: run.id,
        researchRun: run,
        recommendations: result.results || [],
        results: result.results || [],
        companies: result.companies || [],
        metadata: result.metadata || {},
        error: result.error || null,
        persistence
      })
    } catch (error) {
      console.error('Error finding similar companies:', error)
      return sendServiceError(res, error, 'Failed to find similar companies')
    }
  }
}
