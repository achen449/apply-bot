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

function sendMissingAiResponse(res, providerAvailability) {
  return sendMissingEnvResponse(
    res,
    'AI_API_HOST, AI_API_KEY, and AI_MODEL are required for this AI workflow.',
    providerAvailability?.ai?.missingEnvVars || ['AI_API_HOST', 'AI_API_KEY', 'AI_MODEL']
  )
}

function toLegacyOsintReport(result) {
  const run = result?.researchRun || result || {}
  const subject = run.subject || {}
  const overview = run.report?.overview || {}

  return {
    companyName: subject.companyName || overview.canonicalName || '',
    website: subject.website || overview.officialWebsite || '',
    address: subject.address || '',
    capturedAt: run.createdAt || new Date().toISOString(),
    basicInfo: {
      legalName: overview.legalName || overview.canonicalName || '',
      businessType: overview.businessType || '',
      foundedDate: overview.foundedYear ? String(overview.foundedYear) : '',
      status: run.verification?.entityStatus || run.status || 'unknown'
    },
    onlinePresence: {
      officialWebsite: overview.officialWebsite || subject.website || ''
    },
    riskFlags: (run.report?.riskFlags || []).map((risk) => ({
      category: risk.riskType || 'inconsistency',
      severity: risk.severity || 'low',
      description: risk.description || '',
      source: risk.evidenceRefs?.join(', ') || ''
    })),
    associations: {
      locations: [subject.address].filter(Boolean)
    },
    sources: (run.evidence || []).map((evidence) => ({
      name: evidence.title || evidence.provider || 'Public source',
      url: evidence.sourceUrl || '',
      lastChecked: evidence.timestamp || run.createdAt || new Date().toISOString()
    })),
    research: run,
    metadata: result?.metadata || {}
  }
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

  return res.status(error?.status || 500).json({
    success: false,
    code: error?.code || 'request_failed',
    error: fallbackMessage
  })
}

export function createApiRouter({
  leadFinderService,
  similarCompanyService,
  osintService,
  fallbackOsintService,
  promptStorage,
  researchRunsStorage,
  usageStatsStorage,
  providerAvailability,
  aiConfiguration
}) {
  const router = express.Router()

  async function persistRun(run) {
    if (researchRunsStorage && typeof researchRunsStorage.save === 'function') {
      try {
        await researchRunsStorage.save(run)
      } catch (error) {
        console.error('Failed to persist research run:', error)
      }
    }
  }

  router.get('/ai-config', (_req, res) => {
    return res.json({
      success: true,
      ...aiConfiguration
    })
  })

  // POST /api/lead-finder
  router.post('/lead-finder', async (req, res) => {
    try {
      const { industry, country, keywords, targetTypes, excludeTypes, mode } = req.body || {}

      if (!hasText(industry)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_payload',
          error: 'industry is required'
        })
      }

      if (!leadFinderService) {
        return sendMissingAiResponse(res, providerAvailability)
      }

      const result = await leadFinderService.discoverWorkspace({
        industry,
        country,
        keywords,
        targetTypes,
        excludeTypes,
        mode
      })

      const payload = {
        success: true,
        workspace: result.workspace,
        results: result.results,
        companies: result.companies,
        toolCalls: result.toolCalls,
        candidatePool: result.candidatePool,
        shortlist: result.shortlist,
        metadata: result.metadata
      }

      await persistRun({
        id: `lead-finder-${result.workspace?.id || Date.now()}`,
        workflow: 'lead-finder',
        title: `Lead Finder: ${industry}`,
        createdAt: new Date().toISOString(),
        prompt: result.metadata?.prompt || null,
        searchCalls: result.metadata?.searchCalls || [],
        verificationCalls: result.metadata?.verificationCalls || [],
        workspace: result.workspace,
        queryInput: {
          industry,
          country: country || '',
          keywords: Array.isArray(keywords) ? keywords : [],
          targetTypes: Array.isArray(targetTypes) ? targetTypes : [],
          excludeTypes: Array.isArray(excludeTypes) ? excludeTypes : [],
          mode: mode || 'standard'
        }
      })

      return res.json(payload)
    } catch (error) {
      console.error('Error in lead-finder:', error)
      return sendServiceError(res, error, 'Failed to discover leads')
    }
  })

  // POST /api/similar-company
  router.post('/similar-company', async (req, res) => {
    try {
      const { company, topN = 10 } = req.body || {}

      if (!providerAvailability?.tavily?.available) {
        return sendMissingEnvResponse(
          res,
          'TAVILY_API_KEY is required for similar company search.',
          providerAvailability?.tavily?.missingEnvVars || ['TAVILY_API_KEY']
        )
      }

      if (!similarCompanyService) {
        return sendMissingAiResponse(res, providerAvailability)
      }

      if (!hasText(company?.name)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_payload',
          error: 'company.name is required'
        })
      }

      const result = await similarCompanyService.findSimilarCompanies({
        ...company,
        maxResults: toPositiveInteger(topN, 10)
      })

      await persistRun({
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
      console.error('Error in similar-company:', error)
      return sendServiceError(res, error, 'Failed to find similar companies')
    }
  })

  // POST /api/osint
  router.post('/osint', async (req, res) => {
    const { company, companyName, website, address, country, clues, researchQuestions, mode } = req.body || {}
    const subject = company || {
      name: companyName,
      companyName,
      website,
      address,
      country,
      clues,
      researchQuestions
    }

    try {
      if (!hasText(subject?.name || subject?.companyName)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_payload',
          error: 'company.name is required'
        })
      }

      if (!osintService) {
        return sendMissingAiResponse(res, providerAvailability)
      }

      const result = await osintService.investigateCompany({
        ...subject,
        companyName: subject.companyName || subject.name,
        mode
      })

      return res.json(toLegacyOsintReport(result))
    } catch (error) {
      console.error('Error in osint:', error)

      if (fallbackOsintService && (error?.code === 'ai_request_timeout' || error?.code === 'ai_request_failed')) {
        try {
          const fallback = await fallbackOsintService.research({
            ...(company || {}),
            companyName: subject.companyName || subject.name,
            website: subject.website,
            address: subject.address,
            country: subject.country,
            mode
          })
          return res.json(toLegacyOsintReport(fallback))
        } catch (fallbackError) {
          console.error('Fallback OSINT research failed:', fallbackError)
        }
      }

      return sendServiceError(res, error, 'Failed to investigate company')
    }
  })

  // GET /api/prompts/:type
  router.get('/prompts/:type', async (req, res) => {
    try {
      const { type } = req.params

      if (!hasText(type)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_payload',
          error: 'type parameter is required'
        })
      }

      const prompt = await promptStorage.read(type)

      if (prompt == null) {
        return res.status(404).json({
          success: false,
          code: 'not_found',
          error: `Prompt type '${type}' not found`
        })
      }

      return res.json({
        success: true,
        type,
        prompt
      })
    } catch (error) {
      console.error('Error reading prompt:', error)
      return sendServiceError(res, error, 'Failed to read prompt')
    }
  })

  // PUT /api/prompts/:type
  router.put('/prompts/:type', async (req, res) => {
    try {
      const { type } = req.params
      const { prompt, content } = req.body || {}
      const nextPrompt = hasText(prompt) ? prompt : content

      if (!hasText(type)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_payload',
          error: 'type parameter is required'
        })
      }

      if (!hasText(nextPrompt)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_payload',
          error: 'prompt is required'
        })
      }

      await promptStorage.write(type, nextPrompt)

      return res.json({
        success: true,
        type,
        prompt: nextPrompt
      })
    } catch (error) {
      console.error('Error updating prompt:', error)
      return sendServiceError(res, error, 'Failed to update prompt')
    }
  })

  router.delete('/prompts/:type', async (req, res) => {
    try {
      const { type } = req.params

      if (!hasText(type)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_payload',
          error: 'type parameter is required'
        })
      }

      await promptStorage.delete(type)

      return res.json({
        success: true,
        type
      })
    } catch (error) {
      console.error('Error deleting prompt:', error)
      return sendServiceError(res, error, 'Failed to delete prompt')
    }
  })

  // GET /api/research-runs
  router.get('/research-runs', async (req, res) => {
    try {
      const { limit = 100, offset = 0 } = req.query

      const runs = await researchRunsStorage.list({
        limit: toPositiveInteger(limit, 100),
        offset: toPositiveInteger(offset, 0)
      })

      return res.json({
        success: true,
        runs: runs || [],
        count: runs?.length || 0
      })
    } catch (error) {
      console.error('Error listing research runs:', error)
      return sendServiceError(res, error, 'Failed to list research runs')
    }
  })

  // GET /api/usage-stats
  router.get('/usage-stats', async (req, res) => {
    try {
      const { period = 'day' } = req.query

      const stats = await usageStatsStorage.get(period)

      return res.json({
        success: true,
        period,
        stats: stats || {}
      })
    } catch (error) {
      console.error('Error retrieving usage stats:', error)
      return sendServiceError(res, error, 'Failed to retrieve usage stats')
    }
  })

  return router
}
