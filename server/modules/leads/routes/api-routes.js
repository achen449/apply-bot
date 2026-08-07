import express from 'express'
import { createResearchRun, getPartStatus } from '../shared/research-run-contract.js'

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
  const publicContacts = Array.isArray(run.publicContacts)
    ? run.publicContacts
    : Array.isArray(run.report?.publicContacts) ? run.report.publicContacts : []
  const fallbackPhone = publicContacts.find((contact) => contact.contactType === 'public_phone')?.value || ''
  const fallbackEmails = publicContacts
    .filter((contact) => contact.contactType === 'public_email')
    .map((contact) => contact.value)

  return {
    companyName: subject.companyName || overview.canonicalName || '',
    website: subject.website || overview.officialWebsite || '',
    address: subject.address || '',
    phone: subject.phone || fallbackPhone,
    contactEmails: subject.contactEmails || fallbackEmails,
    map: subject.map || null,
    capturedAt: run.createdAt || new Date().toISOString(),
    basicInfo: {
      legalName: overview.legalName || overview.canonicalName || '',
      businessType: overview.businessType || '',
      foundedDate: overview.foundedYear ? String(overview.foundedYear) : '',
      status: run.verification?.entityStatus || run.status || 'unknown'
    },
    onlinePresence: {
      officialWebsite: overview.officialWebsite || subject.website || '',
      publicPhone: subject.phone || fallbackPhone,
      publicEmails: subject.contactEmails || fallbackEmails
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

function countCallFailures(calls = []) {
  return calls.filter((call) => call?.ok === false || call?.error).length
}

function buildLeadFinderParts(result, queryInput) {
  const metadata = result.metadata || {}
  const searchCalls = metadata.searchCalls || []
  const verificationCalls = metadata.verificationCalls || []
  const enrichmentCalls = metadata.enrichmentCalls || []
  const companies = result.workspace?.companies || result.companies || []
  const searchFailures = countCallFailures(searchCalls)
  const verificationFailures = countCallFailures(verificationCalls)
  const enrichmentFailures = enrichmentCalls.filter((call) => ['unavailable', 'enrichment_failed'].includes(call.status)).length

  return [
    {
      workflow: 'lead-finder',
      part: 'discovery',
      title: 'Buyer-side discovery',
      status: getPartStatus({ attempted: searchCalls.length, succeeded: searchCalls.length - searchFailures, failed: searchFailures, empty: searchCalls.length === 0 }),
      prompt: metadata.prompt,
      buyerQueries: searchCalls.map((call) => call.query).filter(Boolean),
      searchCalls,
      queryInput
    },
    {
      workflow: 'lead-finder',
      part: 'entity-normalization',
      title: 'Company entity normalization',
      status: companies.length ? 'completed' : 'needs_review',
      companyCount: companies.length,
      results: companies,
      errors: companies.length ? [] : ['No verified company entity survived normalization.']
    },
    {
      workflow: 'lead-finder',
      part: 'map-verification',
      title: 'Google Maps verification',
      status: getPartStatus({ attempted: verificationCalls.length, succeeded: verificationCalls.length - verificationFailures, failed: verificationFailures, empty: verificationCalls.length === 0 }),
      verificationCalls
    },
    {
      workflow: 'lead-finder',
      part: 'contact-enrichment',
      title: 'Official website contact enrichment',
      status: getPartStatus({ attempted: enrichmentCalls.length, succeeded: enrichmentCalls.length - enrichmentFailures, failed: enrichmentFailures, empty: enrichmentCalls.length === 0 }),
      enrichmentCalls
    },
    {
      workflow: 'lead-finder',
      part: 'report',
      title: 'Lead report',
      status: result.status || metadata.status || 'needs_review',
      companyCount: companies.length,
      results: companies,
      summary: result.workspace?.summary || {}
    }
  ]
}

function buildSimilarCompanyParts(result, queryInput) {
  const metadata = result.metadata || {}
  const searchCalls = metadata.searchCalls || []
  const verificationCalls = metadata.verificationCalls || []
  const enrichmentCalls = metadata.enrichmentCalls || []
  const reportStatus = result.status || metadata.status || (result.error ? 'needs_review' : 'completed')

  return [
    {
      workflow: 'similar-company',
      part: 'discovery',
      title: 'Similar-company discovery',
      status: getPartStatus({ attempted: searchCalls.length, succeeded: searchCalls.filter((call) => call.ok !== false).length, failed: countCallFailures(searchCalls), empty: searchCalls.length === 0 }),
      prompt: metadata.prompt,
      searchCalls,
      queryInput
    },
    {
      workflow: 'similar-company',
      part: 'map-verification',
      title: 'Google Maps verification',
      status: getPartStatus({ attempted: verificationCalls.length, succeeded: verificationCalls.filter((call) => call.ok !== false).length, failed: countCallFailures(verificationCalls), empty: verificationCalls.length === 0 }),
      verificationCalls
    },
    {
      workflow: 'similar-company',
      part: 'contact-enrichment',
      title: 'Official website contact enrichment',
      status: getPartStatus({ attempted: enrichmentCalls.length, succeeded: enrichmentCalls.filter((call) => call.status === 'completed' || call.status === 'no_public_email').length, failed: enrichmentCalls.filter((call) => call.status === 'unavailable' || call.status === 'enrichment_failed').length, empty: enrichmentCalls.length === 0 }),
      enrichmentCalls
    },
    {
      workflow: 'similar-company',
      part: 'report',
      title: 'Similar-company report',
      status: reportStatus,
      results: result.results || [],
      errors: result.error ? [result.error] : []
    }
  ]
}

function buildOsintParts(result) {
  const run = result?.researchRun || result || {}
  const metadata = result?.metadata || {}
  const providerAvailability = Array.isArray(run.providerAvailability) ? run.providerAvailability : []
  const fallbackSearchCalls = providerAvailability
    .filter((entry) => ['brave', 'tavily'].includes(entry.provider))
    .map((entry) => ({
      provider: entry.provider,
      query: run.subject?.companyName || '',
      ok: Boolean(entry.available),
      resultCount: entry.resultCount || 0,
      error: entry.available ? null : entry.reason || 'provider_unavailable'
    }))
  const fallbackMapEntry = providerAvailability.find((entry) => entry.provider === 'google-maps')
  const fallbackVerificationCalls = fallbackMapEntry
    ? [{
        provider: 'google-maps',
        companyName: run.subject?.companyName || '',
        address: run.subject?.address || '',
        ok: Boolean(fallbackMapEntry.available),
        verified: run.verification?.mapsMatchStatus === 'partially_verified',
        confidence: run.verification?.mapsMatchStatus === 'partially_verified' ? 0.6 : 0,
        error: fallbackMapEntry.available ? null : fallbackMapEntry.reason || 'provider_unavailable'
      }]
    : []
  const fallbackContactEntry = providerAvailability.find((entry) => entry.provider === 'official-website')
  const fallbackEnrichmentCalls = fallbackContactEntry
    ? [{
        companyName: run.subject?.companyName || '',
        website: run.subject?.website || '',
        status: fallbackContactEntry.available
          ? (run.publicContacts?.some((contact) => contact.contactType === 'public_email') ? 'completed' : 'no_public_email')
          : 'unavailable',
        emailCount: run.publicContacts?.filter((contact) => contact.contactType === 'public_email').length || 0,
        calls: []
      }]
    : []
  const verificationCalls = metadata.verificationCalls?.length ? metadata.verificationCalls : fallbackVerificationCalls
  const enrichmentCalls = metadata.enrichmentCalls?.length ? metadata.enrichmentCalls : fallbackEnrichmentCalls
  const searchCalls = metadata.searchCalls?.length ? metadata.searchCalls : fallbackSearchCalls

  return [
    {
      workflow: 'osint',
      part: 'discovery',
      title: 'Public-source discovery',
      status: run.status === 'completed' ? 'completed' : 'partial',
      prompt: metadata.prompt,
      searchCalls,
      evidence: run.evidence || []
    },
    {
      workflow: 'osint',
      part: 'map-verification',
      title: 'Google Maps verification',
      status: getPartStatus({ attempted: verificationCalls.length, succeeded: verificationCalls.filter((call) => call.ok !== false).length, failed: countCallFailures(verificationCalls), empty: verificationCalls.length === 0 }),
      verificationCalls
    },
    {
      workflow: 'osint',
      part: 'contact-enrichment',
      title: 'Official website contact enrichment',
      status: getPartStatus({ attempted: enrichmentCalls.length, succeeded: enrichmentCalls.filter((call) => call.status === 'completed' || call.status === 'no_public_email').length, failed: enrichmentCalls.filter((call) => call.status === 'unavailable' || call.status === 'enrichment_failed').length, empty: enrichmentCalls.length === 0 }),
      enrichmentCalls,
      publicContacts: run.publicContacts || run.report?.publicContacts || []
    },
    {
      workflow: 'osint',
      part: 'report',
      title: 'OSINT report',
      status: run.status || 'needs_review',
      report: run.report || {},
      unresolvedQuestions: run.report?.unresolvedQuestions || []
    }
  ]
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
  aiConfiguration,
  persistTimeoutMs = 0,
  leadWorkspaceRepository
}) {
  const router = express.Router()

  async function persistRun(run) {
    if (!researchRunsStorage || typeof researchRunsStorage.save !== 'function') {
      return { saved: false, reason: 'research_run_storage_unavailable' }
    }

    const savePromise = Promise.resolve()
      .then(() => researchRunsStorage.save(run))
      .then(() => ({ saved: true }))
      .catch((error) => {
        console.error('Failed to persist research run:', error?.code || error?.status || 'persistence_failed')
        return { saved: false, reason: error?.code || 'research_run_persist_failed' }
      })

    if (persistTimeoutMs > 0) {
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve({ saved: false, reason: 'research_run_persist_timeout' }), persistTimeoutMs)
      })
      return Promise.race([savePromise, timeoutPromise])
    }

    return savePromise
  }

  async function persistWorkspace(workspace) {
    if (!workspace || !leadWorkspaceRepository || typeof leadWorkspaceRepository.prependAndTrim !== 'function') {
      return { saved: false, reason: 'workspace_repository_unavailable' }
    }

    const savePromise = Promise.resolve()
      .then(() => leadWorkspaceRepository.prependAndTrim(workspace))
      .catch((error) => {
        console.error('Failed to persist lead workspace:', error?.code || error?.status || 'workspace_persist_failed')
        throw error
      })

    try {
      if (persistTimeoutMs > 0) {
        const timeoutPromise = new Promise((resolve) => {
          setTimeout(() => resolve('persist_timeout'), persistTimeoutMs)
        })
        const result = await Promise.race([savePromise, timeoutPromise])
        if (result === 'persist_timeout') {
          return { saved: false, reason: 'workspace_persist_timeout' }
        }
      } else {
        await savePromise
      }
      return { saved: true }
    } catch (error) {
      console.error('Failed to persist lead workspace:', error?.code || error?.status || 'workspace_persist_failed')
      return { saved: false, reason: error?.code || 'workspace_persist_failed' }
    }
  }

  async function investigateOsint(subject, mode) {
    if (!osintService) {
      if (fallbackOsintService && typeof fallbackOsintService.research === 'function') {
        return fallbackOsintService.research({
          ...(subject || {}),
          companyName: subject.companyName || subject.name,
          website: subject.website,
          address: subject.address,
          country: subject.country,
          mode
        })
      }
      const error = new Error('AI_API_HOST, AI_API_KEY, and AI_MODEL are required for this AI workflow.')
      error.code = 'missing_env'
      error.missingEnvVars = providerAvailability?.ai?.missingEnvVars || ['AI_API_HOST', 'AI_API_KEY', 'AI_MODEL']
      throw error
    }

    try {
      return await osintService.investigateCompany({
        ...subject,
        companyName: subject.companyName || subject.name,
        mode
      })
    } catch (error) {
      if (fallbackOsintService && (error?.code === 'ai_request_timeout' || error?.code === 'ai_request_failed')) {
        return fallbackOsintService.research({
          ...(subject || {}),
          companyName: subject.companyName || subject.name,
          website: subject.website,
          address: subject.address,
          country: subject.country,
          mode
        })
      }
      throw error
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

      const workspacePersistence = await persistWorkspace(result.workspace)
      if (result.workspace) {
        result.workspace.persistence = workspacePersistence
      }

      const payload = {
        success: true,
        status: result.status || result.metadata?.status || 'completed',
        partial: Boolean(result.partial || result.metadata?.partial),
        workspace: result.workspace,
        results: result.results,
        companies: result.companies,
        toolCalls: result.toolCalls,
        candidatePool: result.candidatePool,
        shortlist: result.shortlist,
        metadata: result.metadata
      }

      const queryInput = {
        industry,
        country: country || '',
        keywords: Array.isArray(keywords) ? keywords : [],
        targetTypes: Array.isArray(targetTypes) ? targetTypes : [],
        excludeTypes: Array.isArray(excludeTypes) ? excludeTypes : [],
        mode: mode || 'standard'
      }
      const run = createResearchRun({
        id: `lead-finder-${result.workspace?.id || Date.now()}`,
        workflow: 'lead-finder',
        title: `Lead Finder: ${industry}`,
        status: result.status || result.metadata?.status || 'needs_review',
        part: 'report',
        prompt: result.metadata?.prompt || null,
        searchCalls: result.metadata?.searchCalls || [],
        verificationCalls: result.metadata?.verificationCalls || [],
        enrichmentCalls: result.metadata?.enrichmentCalls || [],
        queryInput,
        workspace: result.workspace,
        results: result.results || [],
        errors: result.metadata?.error ? [result.metadata.error] : [],
        parts: buildLeadFinderParts(result, queryInput)
      })
      const persistence = await persistRun(run)
      payload.runId = run.id
      payload.researchRun = run
      payload.persistence = persistence

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

      const queryInput = {
        sampleCompany: company,
        topN: toPositiveInteger(topN, 10)
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
        sampleCompany: result.sampleCompany,
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

      const result = await investigateOsint(subject, mode)
      const osintRun = result?.researchRun || result
      const persistedRun = createResearchRun({
        id: osintRun.id || `osint-${Date.now()}`,
        workflow: 'osint',
        title: `OSINT: ${subject.companyName || subject.name}`,
        status: osintRun.status || 'needs_review',
        part: 'report',
        prompt: result.metadata?.prompt || null,
        searchCalls: result.metadata?.searchCalls || [],
        verificationCalls: result.metadata?.verificationCalls || [],
        enrichmentCalls: result.metadata?.enrichmentCalls || [],
        queryInput: subject,
        subject: osintRun.subject,
        evidence: osintRun.evidence || [],
        report: osintRun.report || {},
        results: osintRun.report || {},
        parts: buildOsintParts(result)
      })
      const persistence = await persistRun(persistedRun)

      return res.json({
        ...toLegacyOsintReport({ ...result, researchRun: persistedRun }),
        runId: persistedRun.id,
        status: persistedRun.status,
        researchRun: persistedRun,
        persistence
      })
    } catch (error) {
      console.error('Error in osint:', error)
      return sendServiceError(res, error, 'Failed to investigate company')
    }
  })

  router.post('/lead-workspaces/osint-research', async (req, res) => {
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

      const result = await investigateOsint(subject, mode)
      const run = result?.researchRun || result

      const persistedRun = createResearchRun({
        id: run.id || `osint-${Date.now()}`,
        workflow: 'osint',
        title: `OSINT: ${subject.companyName || subject.name}`,
        status: run.status || 'needs_review',
        part: 'report',
        prompt: result.metadata?.prompt || null,
        searchCalls: result.metadata?.searchCalls || [],
        verificationCalls: result.metadata?.verificationCalls || [],
        enrichmentCalls: result.metadata?.enrichmentCalls || [],
        queryInput: subject,
        subject: run.subject,
        evidence: run.evidence || [],
        report: run.report || {},
        results: run.report || {},
        parts: buildOsintParts(result)
      })
      const persistence = await persistRun(persistedRun)

      return res.json({
        success: true,
        research: toLegacyOsintReport({ ...result, researchRun: persistedRun }),
        runId: persistedRun.id,
        status: persistedRun.status,
        researchRun: persistedRun,
        metadata: result?.metadata || {},
        persistence
      })
    } catch (error) {
      console.error('Error in lead-workspace OSINT:', error)
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

  router.get('/lead-workspaces', async (_req, res) => {
    try {
      if (!leadWorkspaceRepository || typeof leadWorkspaceRepository.list !== 'function') {
        return res.json({ success: true, workspaces: [] })
      }

      const workspaces = await leadWorkspaceRepository.list()
      return res.json({ success: true, workspaces: workspaces || [] })
    } catch (error) {
      console.error('Error listing lead workspaces:', error)
      return sendServiceError(res, error, 'Failed to list lead workspaces')
    }
  })

  router.post('/lead-workspaces/discover', async (req, res) => {
    try {
      if (!leadFinderService) {
        return sendMissingAiResponse(res, providerAvailability)
      }

      const { industry, country, keywords, targetTypes, excludeTypes, mode } = req.body || {}
      if (!hasText(industry)) {
        return res.status(400).json({ success: false, code: 'invalid_payload', error: 'industry is required' })
      }

      const result = await leadFinderService.discoverWorkspace({ industry, country, keywords, targetTypes, excludeTypes, mode })
      const workspacePersistence = await persistWorkspace(result.workspace)
      if (result.workspace) {
        result.workspace.persistence = workspacePersistence
      }

      const queryInput = { industry, country: country || '', keywords: Array.isArray(keywords) ? keywords : [], mode: mode || 'standard' }
      await persistRun(createResearchRun({
        id: `lead-finder-${result.workspace?.id || Date.now()}`,
        workflow: 'lead-finder',
        title: `Lead Finder: ${industry}`,
        status: result.status || result.metadata?.status || 'needs_review',
        part: 'report',
        prompt: result.metadata?.prompt || null,
        searchCalls: result.metadata?.searchCalls || [],
        verificationCalls: result.metadata?.verificationCalls || [],
        enrichmentCalls: result.metadata?.enrichmentCalls || [],
        queryInput,
        workspace: result.workspace,
        results: result.results || [],
        parts: buildLeadFinderParts(result, queryInput)
      }))

      return res.json({ success: true, workspace: result.workspace, metadata: result.metadata || {} })
    } catch (error) {
      console.error('Error creating lead workspace:', error)
      return sendServiceError(res, error, 'Failed to create lead workspace')
    }
  })

  router.get('/lead-workspaces/:id', async (req, res) => {
    try {
      const workspace = await leadWorkspaceRepository?.getById?.(req.params.id)
      if (!workspace) {
        return res.status(404).json({ success: false, code: 'not_found', error: 'Workspace not found' })
      }
      return res.json({ success: true, workspace })
    } catch (error) {
      console.error('Error reading lead workspace:', error)
      return sendServiceError(res, error, 'Failed to read lead workspace')
    }
  })

  router.put('/lead-workspaces/:id/company/:companyId', async (req, res) => {
    try {
      const editableFields = new Set([
        'notes',
        'outreachNotes',
        'pipelineStatus',
        'customEmail',
        'customEmailStatus',
        'customContactName',
        'customContactTitle',
        'customLinkedinUrl'
      ])
      const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => editableFields.has(key)))
      const result = await leadWorkspaceRepository?.updateCompany?.(
        req.params.id,
        req.params.companyId,
        (company) => ({ ...company, ...updates })
      )

      if (!result) {
        return res.status(404).json({ success: false, code: 'not_found', error: 'Workspace not found' })
      }
      if (!result.company) {
        return res.status(404).json({ success: false, code: 'not_found', error: 'Company not found' })
      }

      return res.json({ success: true, workspace: result.workspace, company: result.company })
    } catch (error) {
      console.error('Error updating lead workspace company:', error)
      return sendServiceError(res, error, 'Failed to update lead company')
    }
  })

  // GET /api/research-runs
  router.get('/research-runs', async (req, res) => {
    try {
      const {
        limit = 100,
        offset = 0,
        workflow = '',
        status = '',
        query = '',
        from = '',
        to = ''
      } = req.query

      const runs = await researchRunsStorage.list({
        limit: toPositiveInteger(limit, 100),
        offset: toPositiveInteger(offset, 0),
        workflow,
        status,
        query,
        from,
        to
      })

      return res.json({
        success: true,
        runs: runs || [],
        count: runs?.length || 0,
        filters: { workflow, status, query, from, to }
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
