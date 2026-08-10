import express from 'express'
import { createResearchRun, getPartStatus } from '../shared/research-run-contract.js'
import { createSimilarCompanyHandler } from './similar-company-handler.js'

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function toPositiveInteger(value, fallbackValue) {
  const normalized = Number.parseInt(value, 10)
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallbackValue
}

function sendMissingEnvResponse(res, message, missingEnvVars) {
  return res.status(503).json({
    success: false,
    code: 'missing_env',
    error: message,
    missingEnvVars
  })
}

function sendServiceError(res, error, fallbackMessage) {
  if (error?.code === 'missing_env') {
    return sendMissingEnvResponse(res, error.message, error.missingEnvVars || [])
  }

  if (error?.code === 'invalid_payload') {
    return res.status(400).json({
      success: false,
      code: 'invalid_payload',
      error: error.message || fallbackMessage
    })
  }

  if (error?.code === 'invalid_gist_json') {
    return res.status(error.status || 502).json({
      success: false,
      code: error.code,
      error: error.message || fallbackMessage
    })
  }

  return res.status(error?.status || 500).json({
    success: false,
    code: error?.code || 'request_failed',
    error: fallbackMessage
  })
}

function buildGoogleMapsParts({ query, location, results, searchCall, enrichmentCalls = [], status }) {
  return [
    {
      workflow: 'google-maps',
      part: 'discovery',
      title: 'Google Maps place discovery',
      status: searchCall.ok && results.length > 0 ? 'completed' : 'needs_review',
      searchCalls: [searchCall],
      queryInput: { query, location }
    },
    {
      workflow: 'google-maps',
      part: 'map-verification',
      title: 'Map result verification',
      status: results.length > 0 ? 'completed' : 'needs_review',
      results
    },
    {
      workflow: 'google-maps',
      part: 'contact-enrichment',
      title: 'Official website contact enrichment',
      status: enrichmentCalls.length === 0
        ? 'completed'
        : enrichmentCalls.some((call) => call.status === 'unavailable' || call.status === 'enrichment_failed')
          ? (enrichmentCalls.some((call) => call.status === 'completed' || call.status === 'no_public_email') ? 'partial' : 'failed')
          : 'completed',
      enrichmentCalls
    },
    {
      workflow: 'google-maps',
      part: 'report',
      title: 'Google Maps lead report',
      status,
      results
    }
  ]
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizedCompanyName(value) {
  return normalizeText(value)
    .replace(/\b(incorporated|inc|corporation|corp|limited|ltd|llc|gmbh|ag|bv|plc|company|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isGenericCompanyName(value) {
  const tokens = normalizedCompanyName(value).split(' ').filter(Boolean)
  const genericTokens = new Set(['solar', 'energy', 'power', 'systems', 'system', 'connector', 'connectors', 'technology', 'technologies', 'solutions', 'global', 'industrial', 'electric', 'equipment', 'group'])
  return tokens.length <= 1 || tokens.every((token) => genericTokens.has(token))
}

function mapNameMatches(expectedName, actualName) {
  const expected = normalizedCompanyName(expectedName)
  const actual = normalizedCompanyName(actualName)
  if (!expected || !actual) return { exact: false, strong: false }
  if (expected === actual) return { exact: true, strong: true }
  const expectedTokens = new Set(expected.split(' ').filter(Boolean))
  const actualTokens = new Set(actual.split(' ').filter(Boolean))
  const overlap = [...expectedTokens].filter((token) => actualTokens.has(token)).length
  return { exact: false, strong: overlap >= 2 && overlap / Math.max(expectedTokens.size, actualTokens.size) >= 0.75 }
}

function buildGoogleMapsMatch(candidate = {}) {
  const placeId = candidate.googlePlaceId || candidate.metadata?.googlePlaceId || ''
  const geo = candidate.geo || candidate.metadata?.geo || null

  return {
    provider: candidate.provider || 'google-maps',
    sourceUrl: placeId ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}` : candidate.url || '',
    query: candidate.query || '',
    queryLabel: candidate.queryLabel || 'company',
    name: candidate.title || '',
    address: candidate.address || candidate.snippet || '',
    phone: candidate.phone || '',
    website: candidate.url || '',
    rating: Number(candidate.googleRating || candidate.metadata?.googleRating || 0),
    reviewCount: Number(candidate.googleReviewCount || candidate.metadata?.googleReviewCount || 0),
    businessStatus: candidate.googleBusinessStatus || candidate.metadata?.googleBusinessStatus || 'UNKNOWN',
    primaryType: candidate.googlePrimaryType || candidate.metadata?.googlePrimaryType || '',
    types: candidate.googleTypes || candidate.metadata?.googleTypes || [],
    placeId,
    location: geo
      ? { lat: Number(geo.lat ?? geo.latitude), lng: Number(geo.lng ?? geo.longitude) }
      : null
  }
}

async function verifyCompanyWithMaps(googleMapsSearchService, company = {}) {
  const companyName = typeof company.companyName === 'string' ? company.companyName.trim() : typeof company.name === 'string' ? company.name.trim() : ''
  const address = typeof company.address === 'string' ? company.address.trim() : ''
  const response = await googleMapsSearchService.search({
    query: companyName || address,
    location: companyName ? address : '',
    filters: { maxResults: 5, requireOperational: false }
  })
  const candidates = Array.isArray(response.results) ? response.results : []
  const candidate = candidates
    .map((item) => {
      const nameMatch = mapNameMatches(companyName, item.title || item.name)
      const candidateAddress = normalizeText(item.address || item.snippet)
      const addressMatch = Boolean(address && candidateAddress && (candidateAddress.includes(normalizeText(address)) || normalizeText(address).includes(candidateAddress)))
      return { item, score: (nameMatch.exact ? 0.6 : nameMatch.strong ? 0.4 : 0) + (addressMatch ? 0.35 : 0) + (item.googlePlaceId || item.placeId ? 0.05 : 0) }
    })
    .sort((left, right) => right.score - left.score)[0]?.item || null

  if (!candidate) {
    return { verified: false, match: null, message: 'No matching Google Maps place was found.' }
  }

  const match = buildGoogleMapsMatch(candidate)
  const expectedName = normalizeText(companyName)
  const actualName = normalizeText(match.name)
  const expectedAddress = normalizeText(address)
  const actualAddress = normalizeText(match.address)
  const nameMatch = mapNameMatches(expectedName, actualName)
  const addressMatches = Boolean(expectedAddress && actualAddress && (actualAddress.includes(expectedAddress) || expectedAddress.includes(actualAddress)))
  const verified = Boolean(
    match.placeId
      && nameMatch.strong
      && (addressMatches || (nameMatch.exact && !isGenericCompanyName(expectedName) && !expectedAddress))
  )

  return {
    verified,
    match,
    message: verified ? 'Google Maps returned a matching business place.' : 'A place was found, but the name/address match needs manual review.'
  }
}

export function createLeadSupportRouter({
  addressClassificationService,
  companySimilarityService,
  googleMapsSearchService,
  researchRunsStorage,
  gistCustomerDataService,
  providerAvailability,
  websiteContactEnrichmentService
}) {
  const router = express.Router()

  async function persistResearchRun(run) {
    if (!researchRunsStorage || typeof researchRunsStorage.save !== 'function') {
      return { saved: false, reason: 'research_run_storage_unavailable' }
    }
    try {
      await researchRunsStorage.save(run)
      return { saved: true }
    } catch (error) {
      console.error('Failed to persist support research run:', error?.code || error?.status || 'persistence_failed')
      return { saved: false, reason: error?.code || 'research_run_persist_failed' }
    }
  }

  const handleSimilarCompany = createSimilarCompanyHandler({
    companySimilarityService,
    providerAvailability,
    persistRun: persistResearchRun,
    sendMissingEnvResponse,
    sendMissingService: (res) => sendMissingEnvResponse(
      res,
      'AI_API_HOST, AI_API_KEY, and AI_MODEL are required for similar company search.',
      providerAvailability?.ai?.missingEnvVars || ['AI_API_HOST', 'AI_API_KEY', 'AI_MODEL']
    ),
    sendServiceError
  })

  async function enrichMapResultContact(result) {
    const website = result?.url || result?.website || ''
    if (!websiteContactEnrichmentService || typeof websiteContactEnrichmentService.enrich !== 'function' || !hasText(website)) {
      return result
    }

    try {
      const contact = await websiteContactEnrichmentService.enrich({ website })
      return {
        ...result,
        emails: contact.contactEmails || [],
        emailDetails: contact.emails || [],
        contactPages: contact.contactPages || [],
        contactEmailStatus: contact.status,
        phone: result.phone || contact.phone || '',
        evidence: [
          ...(Array.isArray(result.evidence) ? result.evidence : []),
          ...(Array.isArray(contact.evidence) ? contact.evidence : [])
        ]
      }
    } catch (error) {
      return {
        ...result,
        emails: [],
        emailDetails: [],
        contactEmailStatus: 'enrichment_failed',
        enrichmentError: 'website_contact_enrichment_failed'
      }
    }
  }

  router.post('/google-maps/search', async (req, res) => {
    try {
      const { query, location = '', filters = {} } = req.body || {}

      if (!providerAvailability.googleMaps.available) {
        return sendMissingEnvResponse(res, 'GOOGLE_MAPS_API_KEY is required for Google Maps search.', providerAvailability.googleMaps.missingEnvVars)
      }

      if (!hasText(query)) {
        return res.status(400).json({ success: false, code: 'invalid_payload', error: 'query is required' })
      }

      const safeFilters = filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : {}
      const result = await googleMapsSearchService.search({ query, location, filters: safeFilters })
      const enrichedResults = safeFilters.includeEmails
        ? await Promise.all((result.results || []).map(enrichMapResultContact))
        : result.results || []

      const enrichmentCalls = safeFilters.includeEmails
        ? enrichedResults.map((item) => ({
            companyName: item.title || item.name || '',
            website: item.url || item.website || '',
            status: item.contactEmailStatus || 'not_requested',
            emailCount: item.emails?.length || 0,
            contactPages: item.contactPages || []
          }))
        : []
      const searchCall = {
        provider: 'google-maps',
        query: result.query || [query, location].filter(Boolean).join(' in '),
        ok: true,
        resultCount: enrichedResults.length
      }
      const runStatus = enrichedResults.length === 0
        ? 'needs_review'
        : enrichmentCalls.some((call) => ['unavailable', 'enrichment_failed'].includes(call.status))
          ? (enrichmentCalls.some((call) => ['completed', 'no_public_email'].includes(call.status)) ? 'partial' : 'failed')
          : 'completed'
      const run = createResearchRun({
        id: `google-maps-${Date.now()}`,
        workflow: 'google-maps',
        title: `Google Maps: ${query}`,
        status: runStatus,
        part: 'report',
        queryInput: { query, location, filters: safeFilters },
        searchCalls: [searchCall],
        results: enrichedResults,
        parts: buildGoogleMapsParts({ query, location, results: enrichedResults, searchCall, enrichmentCalls, status: runStatus })
      })
      const persistence = await persistResearchRun(run)

      return res.json({
        ...result,
        results: enrichedResults,
        count: enrichedResults.length,
        enrichment: safeFilters.includeEmails ? {
          requested: true,
          attempted: enrichedResults.length,
          publicEmailCount: enrichedResults.filter((item) => item.emails?.length).length
        } : { requested: false }
        ,runId: run.id,
        researchRun: run,
        persistence
      })
    } catch (error) {
      console.error('Error searching Google Maps:', error)
      return sendServiceError(res, error, 'Failed to search Google Maps')
    }
  })

  router.post('/lead-workspaces/verify-google-maps', async (req, res) => {
    try {
      if (!providerAvailability.googleMaps.available) {
        return sendMissingEnvResponse(res, 'GOOGLE_MAPS_API_KEY is required for Google Maps verification.', providerAvailability.googleMaps.missingEnvVars)
      }

      const { companyName = '', address = '', includeEmails = true } = req.body || {}
      if (!hasText(companyName) && !hasText(address)) {
        return res.status(400).json({ success: false, code: 'invalid_payload', error: 'companyName or address is required' })
      }

      const result = await verifyCompanyWithMaps(googleMapsSearchService, { companyName, address })
      if (result.match && includeEmails) {
        result.match = await enrichMapResultContact(result.match)
      }
      const verificationCall = {
        provider: 'google-maps',
        companyName,
        address,
        ok: Boolean(result.match),
        verified: Boolean(result.verified),
        candidate: result.match,
        error: result.verified ? null : 'map_match_needs_review'
      }
      const enrichmentCalls = result.match && includeEmails ? [{
        companyName,
        website: result.match.website || '',
        status: result.match.contactEmailStatus || 'not_configured',
        emailCount: result.match.emails?.length || 0,
        contactPages: result.match.contactPages || []
      }] : []
      const runStatus = result.verified ? 'completed' : result.match ? 'needs_review' : 'failed'
      const run = createResearchRun({
        id: `google-maps-verify-${Date.now()}`,
        workflow: 'google-maps',
        title: `Google Maps verify: ${companyName || address}`,
        status: runStatus,
        part: 'map-verification',
        queryInput: { companyName, address, includeEmails },
        verificationCalls: [verificationCall],
        results: result.match ? [result.match] : [],
        parts: [
          {
            workflow: 'google-maps',
            part: 'map-verification',
            title: 'Google Maps verification',
            status: runStatus,
            verificationCalls: [verificationCall],
            results: result.match ? [result.match] : []
          },
          {
            workflow: 'google-maps',
            part: 'contact-enrichment',
            title: 'Official website contact enrichment',
            status: enrichmentCalls[0]?.status || 'not_requested',
            enrichmentCalls
          }
        ]
      })
      const persistence = await persistResearchRun(run)
      result.runId = run.id
      result.researchRun = run
      result.persistence = persistence
      return res.json(result)
    } catch (error) {
      console.error('Error verifying company with Google Maps:', error)
      return sendServiceError(res, error, 'Failed to verify company with Google Maps')
    }
  })

  router.post('/lead-workspaces/batch-verify-csv', async (req, res) => {
    try {
      if (!providerAvailability.googleMaps.available) {
        return sendMissingEnvResponse(res, 'GOOGLE_MAPS_API_KEY is required for batch verification.', providerAvailability.googleMaps.missingEnvVars)
      }

      const { companies } = req.body || {}
      if (!Array.isArray(companies) || companies.length === 0) {
        return res.status(400).json({ success: false, code: 'invalid_payload', error: 'companies array is required and must not be empty' })
      }

      if (companies.length > 50) {
        return res.status(400).json({
          success: false,
          code: 'batch_limit_exceeded',
          error: 'A maximum of 50 companies can be verified per request.',
          requestedCount: companies.length,
          maxAllowed: 50
        })
      }

      const inputs = companies
      const results = []
      for (let index = 0; index < inputs.length; index += 5) {
        const batch = inputs.slice(index, index + 5)
        const batchResults = await Promise.all(batch.map(async (company) => {
          try {
            return { input: company, ...(await verifyCompanyWithMaps(googleMapsSearchService, company)) }
          } catch (error) {
            return { input: company, verified: false, match: null, error: error.message || 'Verification failed' }
          }
        }))
        results.push(...batchResults)
      }

      return res.json({ results })
    } catch (error) {
      console.error('Error batch verifying companies with Google Maps:', error)
      return sendServiceError(res, error, 'Failed to batch verify companies')
    }
  })

  router.post('/addresses/batch-classify', async (req, res) => {
    try {
      const { addresses } = req.body || {}

      if (!providerAvailability.googleMaps.available) {
        return sendMissingEnvResponse(
          res,
          'GOOGLE_MAPS_API_KEY is required for address classification.',
          providerAvailability.googleMaps.missingEnvVars
        )
      }

      if (!Array.isArray(addresses) || addresses.length === 0) {
        return res.status(400).json({
          success: false,
          code: 'invalid_addresses_payload',
          error: 'addresses array is required and must not be empty'
        })
      }

      const invalidItem = addresses.find((item) => !hasText(item?.name) || !hasText(item?.address))
      if (invalidItem) {
        return res.status(400).json({
          success: false,
          code: 'invalid_addresses_payload',
          error: 'Each address entry requires non-empty name and address fields.'
        })
      }

      const result = await addressClassificationService.batchClassify(addresses)
      return res.json({
        success: true,
        configured: true,
        results: result.results || []
      })
    } catch (error) {
      console.error('Error classifying addresses:', error)
      return sendServiceError(res, error, 'Failed to classify addresses')
    }
  })

  router.post('/companies/find-similar', handleSimilarCompany)

  router.get('/customer-data', async (req, res) => {
    try {
      const result = await gistCustomerDataService.readCustomerData()
      const configuration = gistCustomerDataService.getConfigurationStatus()

      return res.json({
        success: true,
        configured: configuration.configured,
        storage: result.storage,
        gistId: result.gistId,
        fileName: result.fileName,
        exists: result.exists,
        updatedAt: result.updatedAt,
        data: result.data
      })
    } catch (error) {
      console.error('Error reading customer data from Gist:', error)
      return sendServiceError(res, error, 'Failed to read customer data')
    }
  })

  router.put('/customer-data', async (req, res) => {
    try {
      const body = req.body
      if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, 'data')) {
        return res.status(400).json({
          success: false,
          code: 'invalid_customer_data_payload',
          error: 'Request body must be a JSON object with a data field.'
        })
      }

      const result = await gistCustomerDataService.updateCustomerData(body.data)
      const configuration = gistCustomerDataService.getConfigurationStatus()

      return res.json({
        success: true,
        configured: configuration.configured,
        storage: result.storage,
        gistId: result.gistId,
        fileName: result.fileName,
        exists: result.exists,
        updatedAt: result.updatedAt,
        data: result.data
      })
    } catch (error) {
      console.error('Error updating customer data in Gist:', error)
      return sendServiceError(res, error, 'Failed to update customer data')
    }
  })

  return router
}
