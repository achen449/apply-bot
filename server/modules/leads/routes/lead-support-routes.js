import express from 'express'

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

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
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
  const candidate = response.results?.[0] || null

  if (!candidate) {
    return { verified: false, match: null, message: 'No matching Google Maps place was found.' }
  }

  const match = buildGoogleMapsMatch(candidate)
  const expectedName = normalizeText(companyName)
  const actualName = normalizeText(match.name)
  const expectedAddress = normalizeText(address)
  const actualAddress = normalizeText(match.address)
  const nameMatches = !expectedName || actualName.includes(expectedName) || expectedName.includes(actualName)
  const addressMatches = !expectedAddress || actualAddress.includes(expectedAddress) || expectedAddress.includes(actualAddress)
  const verified = Boolean(match.placeId && (nameMatches || addressMatches))

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
  providerAvailability
}) {
  const router = express.Router()

  router.post('/google-maps/search', async (req, res) => {
    try {
      const { query, location = '', filters = {} } = req.body || {}

      if (!providerAvailability.googleMaps.available) {
        return sendMissingEnvResponse(res, 'GOOGLE_MAPS_API_KEY is required for Google Maps search.', providerAvailability.googleMaps.missingEnvVars)
      }

      if (!hasText(query)) {
        return res.status(400).json({ success: false, code: 'invalid_payload', error: 'query is required' })
      }

      const result = await googleMapsSearchService.search({ query, location, filters })
      return res.json(result)
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

      const { companyName = '', address = '' } = req.body || {}
      if (!hasText(companyName) && !hasText(address)) {
        return res.status(400).json({ success: false, code: 'invalid_payload', error: 'companyName or address is required' })
      }

      return res.json(await verifyCompanyWithMaps(googleMapsSearchService, { companyName, address }))
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

      const inputs = companies.slice(0, 50)
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

  router.post('/companies/find-similar', async (req, res) => {
    try {
      const { company, topN = 10 } = req.body || {}

      if (!providerAvailability.tavily.available) {
        return sendMissingEnvResponse(
          res,
          'TAVILY_API_KEY is required for similar company search.',
          providerAvailability.tavily.missingEnvVars
        )
      }

      if (!companySimilarityService) {
        return sendMissingEnvResponse(
          res,
          'AI_API_HOST, AI_API_KEY, and AI_MODEL are required for similar company search.',
          providerAvailability.ai?.missingEnvVars || ['AI_API_HOST', 'AI_API_KEY', 'AI_MODEL']
        )
      }

      if (!hasText(company?.name)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_company_payload',
          error: 'company.name is required'
        })
      }

      const result = await companySimilarityService.findSimilarCompanies({
        ...company,
        maxResults: Math.min(toPositiveInteger(topN, 10), 8)
      })

      if (researchRunsStorage && typeof researchRunsStorage.save === 'function') {
        await researchRunsStorage.save({
          id: `similar-company-${Date.now()}`,
          workflow: 'similar-company',
          title: `Similar Company: ${company.name}`,
          createdAt: new Date().toISOString(),
          prompt: result.metadata?.prompt || null,
          searchCalls: result.metadata?.searchCalls || [],
          verificationCalls: result.metadata?.verificationCalls || [],
          sampleCompany: result.sampleCompany,
          results: result.results || []
        })
      }

      return res.json({
        success: true,
        configured: true,
        runId: result.runId || null,
        recommendations: result.results || [],
        results: result.results || [],
        companies: result.companies || [],
        metadata: result.metadata || {}
      })
    } catch (error) {
      console.error('Error finding similar companies:', error)
      return sendServiceError(res, error, 'Failed to find similar companies')
    }
  })

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
