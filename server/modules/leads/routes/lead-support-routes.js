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

export function createLeadSupportRouter({
  addressClassificationService,
  companySimilarityService,
  gistCustomerDataService,
  providerAvailability
}) {
  const router = express.Router()

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

      if (!hasText(company?.name)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_company_payload',
          error: 'company.name is required'
        })
      }

      const result = await companySimilarityService.findSimilarCompanies(company, toPositiveInteger(topN, 10))
      return res.json({
        success: true,
        configured: true,
        runId: result.runId || null,
        recommendations: result.recommendations || [],
        results: result.results || []
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
