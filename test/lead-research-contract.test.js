import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createCompanyEnrichmentService } from '../server/modules/leads/application/services/company-enrichment-service.js'
import { createWebsiteContactEnrichmentService } from '../server/modules/leads/application/services/website-contact-enrichment-service.js'
import { createSimilarCompanyService } from '../server/modules/leads/services/similar-company.js'
import { createLeadAITools } from '../server/modules/leads/services/ai-tools.js'
import { createLeadFinderService } from '../server/modules/leads/services/lead-finder-service.js'
import { createApiRouter } from '../server/modules/leads/routes/api-routes.js'
import { createLeadSupportRouter } from '../server/modules/leads/routes/lead-support-routes.js'
import { dedupeCompanyCandidates, isLikelyBuyerCandidate, matchesTargetCountry } from '../server/modules/leads/shared/company-result-normalizer.js'
import { calculateResearchRunExpiry, createResearchRun, pruneResearchRuns } from '../server/modules/leads/shared/research-run-contract.js'
import { createApiSecurityMiddleware } from '../server/security.js'
import GistService from '../storage/gist-service.js'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload },
    async text() { return JSON.stringify(payload) }
  }
}

function buildCompanyResult(overrides = {}) {
  return {
    id: 'company-1',
    name: 'Enphase Energy',
    website: 'https://enphase.example',
    country: 'United States',
    fitScore: 88,
    whyFit: 'Solar inverter and energy storage OEM that uses high-current power assemblies.',
    evidence: [],
    ...overrides
  }
}

function buildProviderSearchCall(results, provider = 'tavily', query = 'industrial energy buyers') {
  return {
    name: 'search_web',
    arguments: { provider, query, maxResults: results.length },
    result: {
      ok: true,
      provider,
      query,
      results
    }
  }
}

const resolvePublicTestHost = async () => [{ address: '93.184.216.34', family: 4 }]

test('company normalizer removes article-like results and deduplicates official domains', () => {
  const candidates = dedupeCompanyCandidates([
    { name: 'Complete Guide to MC4 Connectors', website: 'https://blog.example/guide/mc4' },
    { name: 'Enphase Energy', website: 'https://www.enphase.example/company' },
    { name: 'Enphase Energy, Inc.', website: 'https://enphase.example/about' }
  ])

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].website.includes('enphase.example'), true)
  assert.equal(isLikelyBuyerCandidate({ name: 'Solar Connector Factory', website: 'https://factory.example', reason: 'Factory direct supplier' }), false)
  assert.equal(isLikelyBuyerCandidate({ name: 'Original MC4 Connectors', website: 'https://connector.example', reason: 'Quality MC4 connectors for renewable energy.' }), false)
  assert.equal(isLikelyBuyerCandidate({ name: 'Enphase Energy', website: 'https://enphase.example', reason: 'Energy storage OEM procures high-current assemblies' }), true)
  assert.equal(matchesTargetCountry('United States', 'Fremont, CA 94538'), true)
  assert.equal(matchesTargetCountry('United States', 'Sydney, Australia'), false)
  assert.equal(matchesTargetCountry('Germany', ''), true)
})

test('website enrichment returns observed email, phone, source pages, and no-public-email status', async () => {
  const service = createWebsiteContactEnrichmentService({
    maxPages: 3,
    resolveHost: resolvePublicTestHost,
    fetchImpl: async (url) => {
      if (url.endsWith('/contact')) {
        return {
          ok: true,
          status: 200,
          async text() { return '<a href="mailto:procurement@enphase.example">procurement@enphase.example</a><a href="tel:+1 510 555 0100">Call</a>' }
        }
      }
      return {
        ok: true,
        status: 200,
        async text() { return '<html><body>Company information</body></html>' }
      }
    }
  })

  const result = await service.enrich({ website: 'https://enphase.example' })
  assert.equal(result.status, 'completed')
  assert.deepEqual(result.contactEmails, ['procurement@enphase.example'])
  assert.equal(result.emails[0].sourceUrl, 'https://enphase.example/contact')
  assert.equal(result.phone, '+1 510 555 0100')
  assert.ok(result.contactPages.includes('https://enphase.example/contact'))

  const emptyService = createWebsiteContactEnrichmentService({
    maxPages: 1,
    resolveHost: resolvePublicTestHost,
    fetchImpl: async () => ({ ok: true, status: 200, async text() { return '<html>No contact details</html>' } })
  })
  const emptyResult = await emptyService.enrich({ website: 'https://empty.example' })
  assert.equal(emptyResult.status, 'no_public_email')
  assert.deepEqual(emptyResult.contactEmails, [])
})

test('website enrichment ignores noisy markup, invalid phones, and external redirects', async () => {
  let fetchCount = 0
  const service = createWebsiteContactEnrichmentService({
    maxPages: 1,
    resolveHost: resolvePublicTestHost,
    fetchImpl: async (url) => {
      fetchCount += 1
      if (url.includes('redirected.example')) {
        return {
          ok: true,
          status: 200,
          url: 'https://other-company.example/contact',
          async text() {
            return '<a href="mailto:real@other-company.example">real@other-company.example</a><a href="tel:+1 510 555 0100">+1 510 555 0100</a>'
          }
        }
      }

      return {
        ok: true,
        status: 200,
        url,
        async text() {
          return '<script>const email = "fake@script.example"; const phone = "92631766"</script><meta content="92631766"><a href="mailto:real@noise.example">Contact us</a><span>+1 510 555 0100</span>'
        }
      }
    }
  })

  const result = await service.enrich({ website: 'https://noise.example' })
  assert.deepEqual(result.contactEmails, ['real@noise.example'])
  assert.equal(result.phone, '+1 510 555 0100')

  const cachedResult = await service.enrich({ website: 'https://noise.example' })
  assert.equal(cachedResult.cached, true)
  assert.equal(fetchCount, 1)

  const redirectedResult = await service.enrich({ website: 'https://redirected.example' })
  assert.equal(redirectedResult.status, 'unavailable')
  assert.deepEqual(redirectedResult.contactEmails, [])
  assert.equal(redirectedResult.phone, '')
  assert.equal(redirectedResult.calls[0].error, 'external_redirect')
})

test('website enrichment blocks private hosts before making a request', async () => {
  let fetchCount = 0
  const service = createWebsiteContactEnrichmentService({
    fetchImpl: async () => {
      fetchCount += 1
      return { ok: true, status: 200, async text() { return 'should not be fetched' } }
    }
  })

  const result = await service.enrich({ website: 'http://127.0.0.1' })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.error, 'unsafe_or_unresolvable_website')
  assert.equal(fetchCount, 0)
  assert.equal(result.calls[0].error, 'unsafe_or_unresolvable_website')
})

test('website enrichment blocks metadata, private IPv6, private DNS, and redirects before fetching internal targets', async () => {
  let fetchCount = 0
  const service = createWebsiteContactEnrichmentService({
    resolveHost: async () => [{ address: 'fd00::10', family: 6 }],
    fetchImpl: async () => {
      fetchCount += 1
      return { ok: true, status: 200, async text() { return 'must not be fetched' } }
    }
  })

  for (const website of ['http://169.254.169.254', 'http://[::1]', 'https://metadata.example']) {
    const result = await service.enrich({ website })
    assert.equal(result.status, 'unavailable')
    assert.equal(result.error, 'unsafe_or_unresolvable_website')
  }
  assert.equal(fetchCount, 0)

  const redirectService = createWebsiteContactEnrichmentService({
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    maxPages: 1,
    fetchImpl: async () => ({
      ok: false,
      status: 302,
      headers: { get(name) { return name.toLowerCase() === 'location' ? 'http://127.0.0.1/admin' : null } },
      async text() { return '' }
    })
  })
  const redirectResult = await redirectService.enrich({ website: 'https://public.example' })
  assert.equal(redirectResult.status, 'unavailable')
  assert.equal(redirectResult.calls[0].error, 'external_redirect')
})

test('company enrichment merges Google Maps fields and official website contacts', async () => {
  const websiteContactEnrichmentService = {
    async enrich() {
      return {
        status: 'completed',
        contactEmails: ['sales@enphase.example'],
        emails: [{ value: 'sales@enphase.example', sourceUrl: 'https://enphase.example/contact' }],
        contactPages: ['https://enphase.example/contact'],
        evidence: [{ type: 'public_email', sourceUrl: 'https://enphase.example/contact', value: 'sales@enphase.example' }]
      }
    }
  }
  const service = createCompanyEnrichmentService({
    websiteContactEnrichmentService,
    googleMapsSearchService: {
      async search() {
        return {
          results: [{
            title: 'Enphase Energy',
            url: 'https://enphase.example',
            address: '47281 Bayside Pkwy, Fremont, CA 94538, United States',
            phone: '+1 510 555 0100',
            googlePlaceId: 'place-enphase-1',
            googleBusinessStatus: 'OPERATIONAL',
            metadata: { googlePlaceId: 'place-enphase-1', googleBusinessStatus: 'OPERATIONAL' }
          }]
        }
      }
    }
  })

  const result = await service.enrichCompanies([buildCompanyResult()], { country: 'United States', maxResults: 1 })
  const company = result.companies[0]
  assert.equal(company.mapVerified, true)
  assert.equal(company.map.placeId, 'place-enphase-1')
  assert.equal(company.phone, '+1 510 555 0100')
  assert.deepEqual(company.contactEmails, ['sales@enphase.example'])
  assert.equal(company.contactEmailStatus, 'completed')
  assert.ok(result.verificationCalls[0].candidate)
  assert.equal(result.enrichmentCalls[0].emailCount, 1)
})

test('company enrichment does not promote an untrusted map candidate into contact fields', async () => {
  const service = createCompanyEnrichmentService({
    googleMapsSearchService: {
      async search() {
        return {
          results: [{
            title: 'Energy Solutions',
            url: 'https://other.example',
            address: '1 Main St, Austin, TX 78701, United States',
            phone: '+1 512 555 0100',
            googlePlaceId: 'place-untrusted'
          }]
        }
      }
    }
  })

  const result = await service.enrichCompanies([buildCompanyResult({ website: '' })], { country: 'United States', maxResults: 1 })
  const company = result.companies[0]
  assert.equal(company.mapVerified, false)
  assert.equal(company.address, '')
  assert.equal(company.phone, '')
  assert.equal(company.website, '')
  assert.ok(result.verificationCalls[0].candidate)
})

test('verify_company tool reports provider failures as failed tool calls', async () => {
  const [searchTool, verifyTool] = createLeadAITools({
    googleMapsAdapter: {
      async searchText() {
        throw new Error('places unavailable')
      }
    },
    timeoutMs: 100
  })

  assert.equal(searchTool.name, 'search_web')
  const result = await verifyTool.execute({ company_name: 'Enphase Energy' })
  assert.equal(result.ok, false)
  assert.equal(result.verified, false)
  assert.equal(result.error.code, 'google_maps_verification_failed')
})

test('search_web forwards the requested candidate count to the provider adapter', async () => {
  let receivedConfig
  const [searchTool] = createLeadAITools({
    tavilyAdapter: {
      async search(config) {
        receivedConfig = config
        return Array.from({ length: 15 }, (_, index) => ({
          title: `Energy Buyer ${index + 1}`,
          url: `https://buyer-${index + 1}.example`,
          snippet: 'Energy storage OEM buyer that procures industrial assemblies.',
          provider: 'tavily'
        }))
      }
    },
    braveAdapter: { async search() { return [] } }
  })

  const result = await searchTool.execute({
    query: 'energy storage buyers',
    provider: 'tavily',
    maxResults: 15
  })

  assert.equal(receivedConfig.maxResults, 15)
  assert.equal(result.results.length, 15)
})

test('search_web falls back to an available provider when the requested provider is not configured', async () => {
  const [searchTool] = createLeadAITools({
    tavilyAdapter: { available: false, async search() { throw new Error('Tavily should not be called') } },
    braveAdapter: {
      available: true,
      async search() {
        return [{ title: 'Brave Buyer', url: 'https://brave-buyer.example', snippet: 'Buyer evidence', provider: 'brave' }]
      }
    }
  })

  const result = await searchTool.execute({ query: 'energy buyers', provider: 'tavily', maxResults: 1 })
  assert.equal(result.ok, true)
  assert.equal(result.provider, 'brave')
  assert.equal(result.results[0].title, 'Brave Buyer')
})

test('Lead Finder excludes provider companies whose observed location conflicts with the requested country', async () => {
  const service = createLeadFinderService({
    aiAgent: {
      async executeTask() {
        return {
          parsedJson: { companies: [] },
          finalText: '',
          toolCalls: [{
            name: 'search_web',
            arguments: { provider: 'brave', query: 'energy storage OEM United States' },
            result: {
              ok: true,
              provider: 'brave',
              results: [
                {
                  title: 'Wrong Country Energy',
                  url: 'https://wrong.example',
                  snippet: 'Energy storage integrator in Sydney, Australia.'
                },
                {
                  title: 'US Energy Systems',
                  url: 'https://us-energy.example',
                  snippet: 'Energy storage OEM in Fremont, CA 94538, United States.'
                }
              ]
            }
          }],
          status: 'completed',
          partial: false
        }
      }
    }
  })

  const result = await service.discoverWorkspace({
    industry: 'industrial connectors',
    country: 'United States',
    keywords: ['battery connector'],
    mode: 'economy'
  })

  assert.deepEqual(result.workspace.companies.map((company) => company.name), ['US Energy Systems'])
})

test('Lead Finder keeps candidate-pool and display limits explicit instead of defaulting shortlist to five', async () => {
  const service = createLeadFinderService({
    aiAgent: {
      async executeTask() {
        return {
          parsedJson: { companies: [] },
          finalText: '',
          toolCalls: [{
            name: 'search_web',
            arguments: { provider: 'brave', query: 'industrial energy buyers' },
            result: {
              ok: true,
              provider: 'brave',
              results: Array.from({ length: 25 }, (_, index) => ({
                title: `Industrial Buyer ${index + 1}`,
                url: `https://industrial-buyer-${index + 1}.example`,
                snippet: 'Industrial energy storage OEM buyer in Fremont, United States that procures equipment.'
              }))
            }
          }],
          status: 'completed',
          partial: false
        }
      }
    }
  })

  const result = await service.discoverWorkspace({
    industry: 'industrial connectors',
    country: 'United States',
    mode: 'standard'
  })

  assert.equal(result.metadata.resultPolicy.requestedCount, 10)
  assert.equal(result.metadata.resultPolicy.candidatePoolTarget, 20)
  assert.equal(result.workspace.companies.length, 20)
  assert.equal(result.candidatePool.length, 20)
  assert.equal(result.shortlist.length, 5)
})

test('research run contract sets a 60-day expiry and prunes only expired runs', () => {
  const createdAt = '2026-08-07T00:00:00.000Z'
  const run = createResearchRun({
    id: 'run-1',
    workflow: 'lead-finder',
    title: 'Lead Finder: Enphase',
    status: 'completed',
    createdAt,
    parts: [{ part: 'discovery', status: 'completed', title: 'Buyer discovery' }]
  })
  assert.equal(run.expiresAt, calculateResearchRunExpiry(createdAt))
  assert.equal(run.parts[0].part, 'discovery')

  const active = createResearchRun({ id: 'active', workflow: 'osint', createdAt: '2026-08-01T00:00:00.000Z' })
  const expired = { ...run, id: 'expired', expiresAt: '2026-08-06T00:00:00.000Z' }
  assert.deepEqual(pruneResearchRuns([active, expired], new Date('2026-08-07T00:00:00.000Z')).map((item) => item.id), ['active'])
})

test('GistService removes expired research runs and assigns expiry to legacy records', async () => {
  const service = new GistService('gist-test', 'token-test', 'customer-data.json')
  const updates = []
  service.octokit.gists = {
    async get() {
      return {
        data: {
          files: {
            'customer-data.json': {
              content: JSON.stringify({
                customers: [{ id: 'keep-customer' }],
                researchRuns: [
                  { id: 'expired', createdAt: '2026-05-01T00:00:00.000Z', expiresAt: '2026-06-01T00:00:00.000Z' },
                  { id: 'legacy', createdAt: '2026-08-01T00:00:00.000Z' }
                ]
              })
            }
          }
        }
      }
    },
    async update(args) {
      updates.push(JSON.parse(args.files['customer-data.json'].content))
      return { data: { files: args.files } }
    }
  }

  const result = await service.readCustomerData()
  assert.deepEqual(result.data.customers, [{ id: 'keep-customer' }])
  assert.equal(result.data.researchRuns.length, 1)
  assert.equal(result.data.researchRuns[0].id, 'legacy')
  assert.equal(result.data.researchRuns[0].workflow, 'legacy')
  assert.equal(result.data.researchRuns[0].parts[0].part, 'legacy')
  assert.ok(result.data.researchRuns[0].expiresAt)
  assert.equal(updates.length, 1)
})

test('GistService serializes concurrent research-run writes without losing records', async () => {
  const service = new GistService('gist-test', 'token-test', 'customer-data.json')
  let document = { customers: [{ id: 'keep-customer' }], researchRuns: [] }
  let version = 0

  service.octokit.gists = {
    async get() {
      return {
        data: { files: { 'customer-data.json': { content: JSON.stringify(document) } } },
        headers: { etag: `v${version}` }
      }
    },
    async update(args) {
      document = JSON.parse(args.files['customer-data.json'].content)
      version += 1
      return {
        data: { files: args.files },
        headers: { etag: `v${version}` }
      }
    }
  }

  await Promise.all([
    service.saveResearchRun(createResearchRun({ id: 'run-a', workflow: 'lead-finder', title: 'Lead Finder A' })),
    service.saveResearchRun(createResearchRun({ id: 'run-b', workflow: 'osint', title: 'OSINT B' }))
  ])

  assert.deepEqual(document.customers, [{ id: 'keep-customer' }])
  assert.deepEqual(document.researchRuns.map((run) => run.id).sort(), ['run-a', 'run-b'])
})

test('GistService retries a research-run write after an ETag conflict', async () => {
  const service = new GistService('gist-test', 'token-test', 'customer-data.json')
  let updateCalls = 0
  let document = { researchRuns: [] }

  service.octokit.gists = {
    async get() {
      return {
        data: { files: { 'customer-data.json': { content: JSON.stringify(document) } } },
        headers: { etag: `v${updateCalls}` }
      }
    },
    async update(args) {
      updateCalls += 1
      if (updateCalls === 1) {
        const error = new Error('etag conflict')
        error.status = 412
        throw error
      }
      document = JSON.parse(args.files['customer-data.json'].content)
      return { data: { files: args.files }, headers: { etag: `v${updateCalls}` } }
    }
  }

  await service.saveResearchRun(createResearchRun({ id: 'run-retry', workflow: 'osint', title: 'OSINT retry' }))
  assert.equal(updateCalls, 2)
  assert.equal(document.researchRuns[0].id, 'run-retry')
})

test('Lead Finder API saves a workspace and a Research Run with identifiable parts', async () => {
  let savedWorkspace
  let savedRun
  const app = express()
  app.use(express.json())
  app.use('/api', createApiRouter({
    leadFinderService: {
      async discoverWorkspace() {
        return {
          status: 'completed',
          workspace: {
            id: 'workspace-enphase',
            industry: 'industrial connectors',
            country: 'United States',
            companies: [buildCompanyResult()],
            summary: { companyCount: 1 }
          },
          results: [buildCompanyResult()],
          companies: [{ name: 'Enphase Energy', score: 88 }],
          toolCalls: [],
          metadata: {
            status: 'completed',
            prompt: { key: 'lead-finder', rendered: 'buyer-side query prompt' },
            searchCalls: [{ provider: 'brave', query: 'energy storage OEM procurement', ok: true, resultCount: 3 }],
            verificationCalls: [{ companyName: 'Enphase Energy', verified: true, confidence: 0.9, ok: true }],
            enrichmentCalls: [{ companyName: 'Enphase Energy', status: 'no_public_email', emailCount: 0 }]
          }
        }
      }
    },
    leadWorkspaceRepository: {
      async prependAndTrim(workspace) { savedWorkspace = workspace },
      async list() { return savedWorkspace ? [savedWorkspace] : [] },
      async getById() { return savedWorkspace },
      async updateCompany() { return null }
    },
    researchRunsStorage: { async save(run) { savedRun = run }, async list() { return savedRun ? [savedRun] : [] } },
    providerAvailability: {},
    aiConfiguration: {}
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/lead-finder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry: 'industrial connectors', country: 'United States', mode: 'standard' })
    })
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.workspace.persistence.saved, true)
    assert.equal(payload.runId, savedRun.id)
    assert.equal(savedRun.workflow, 'lead-finder')
    assert.equal(savedRun.expiresAt != null, true)
    assert.deepEqual(savedRun.parts.map((part) => part.part), ['discovery', 'entity-normalization', 'map-verification', 'contact-enrichment', 'report'])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('Research Runs API forwards filters and returns identifiable run records', async () => {
  let receivedFilters
  const app = express()
  app.use(express.json())
  app.use('/api', createApiRouter({
    researchRunsStorage: {
      async list(filters) {
        receivedFilters = filters
        return [{
          id: 'run-enphase',
          workflow: 'lead-finder',
          part: 'report',
          status: 'partial',
          title: 'Lead Finder: Enphase',
          createdAt: '2026-08-07T00:00:00.000Z',
          expiresAt: '2026-10-06T00:00:00.000Z',
          parts: [{ part: 'discovery', status: 'completed', title: 'Buyer discovery' }]
        }]
      }
    },
    providerAvailability: {},
    aiConfiguration: {}
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/research-runs?workflow=lead-finder&status=partial&query=Enphase&from=2026-08-01&to=2026-08-31&limit=2&offset=1`)
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.runs[0].workflow, 'lead-finder')
    assert.equal(payload.runs[0].parts[0].part, 'discovery')
    assert.deepEqual(receivedFilters, {
      limit: 2,
      offset: 1,
      workflow: 'lead-finder',
      status: 'partial',
      query: 'Enphase',
      from: '2026-08-01',
      to: '2026-08-31'
    })
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('OSINT legacy and lead-workspace routes both save a labeled Research Run', async () => {
  const savedRuns = []
  const app = express()
  app.use(express.json())
  app.use('/api', createApiRouter({
    osintService: {
      async investigateCompany(payload) {
        return {
          researchRun: {
            id: `osint-${payload.companyName}`,
            status: 'partial',
            subject: { companyName: payload.companyName, website: payload.website || '' },
            evidence: [{ evidenceId: 'ev-1', title: payload.companyName, sourceUrl: 'https://enphase.com' }],
            providerAvailability: [{ provider: 'brave', available: true, resultCount: 1 }],
            report: { overview: { canonicalName: payload.companyName, officialWebsite: 'https://enphase.com' }, publicContacts: [] }
          },
          metadata: { prompt: { key: 'osint', rendered: 'osint prompt' } }
        }
      }
    },
    researchRunsStorage: { async save(run) { savedRuns.push(run) } },
    providerAvailability: { ai: { available: true, missingEnvVars: [] } },
    aiConfiguration: {}
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    for (const endpoint of ['/api/osint', '/api/lead-workspaces/osint-research']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: 'Enphase Energy', website: 'https://enphase.com' })
      })
      const payload = await response.json()
      assert.equal(response.status, 200)
      assert.equal(payload.runId != null, true)
      assert.equal(payload.researchRun.workflow, 'osint')
      assert.ok(payload.researchRun.parts.some((part) => part.part === 'report'))
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }

  assert.equal(savedRuns.length, 2)
  assert.ok(savedRuns.every((run) => run.workflow === 'osint' && run.expiresAt))
})

test('API security keeps disallowed origins out and protects non-public API routes when a token is configured', async () => {
  const app = express()
  app.use(createApiSecurityMiddleware({ accessToken: 'test-access-token' }))
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.get('/api/private', (_req, res) => res.json({ ok: true }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    const disallowed = await fetch(`${baseUrl}/api/private`, { headers: { Origin: 'https://evil.example' } })
    assert.equal(disallowed.status, 403)

    const missingToken = await fetch(`${baseUrl}/api/private`, { headers: { Origin: baseUrl } })
    assert.equal(missingToken.status, 401)

    const allowed = await fetch(`${baseUrl}/api/private`, {
      headers: { Origin: baseUrl, Authorization: 'Bearer test-access-token' }
    })
    assert.equal(allowed.status, 200)

    const health = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://evil.example' } })
    assert.equal(health.status, 403)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('lead workspace updates cannot overwrite evidence, map, or provider fields from the client', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', createApiRouter({
    leadWorkspaceRepository: {
      async updateCompany(_workspaceId, _companyId, updater) {
        const company = updater({
          id: 'company-1',
          name: 'Enphase Energy',
          phone: '+1 510 555 0100',
          mapVerified: true,
          evidence: [{ sourceUrl: 'https://enphase.com' }]
        })
        return { workspace: { id: 'workspace-1', companies: [company] }, company }
      }
    }
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/lead-workspaces/workspace-1/company/company-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: 'Call procurement next week',
        phone: '+1 000 000 0000',
        mapVerified: false,
        evidence: [],
        score: 0
      })
    })
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.company.notes, 'Call procurement next week')
    assert.equal(payload.company.phone, '+1 510 555 0100')
    assert.equal(payload.company.mapVerified, true)
    assert.deepEqual(payload.company.evidence, [{ sourceUrl: 'https://enphase.com' }])
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('Google Maps search can enrich public email and preserves source page', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', createLeadSupportRouter({
    googleMapsSearchService: {
      async search() {
        return { query: 'Enphase Energy in United States', count: 1, results: [{ title: 'Enphase Energy', url: 'https://enphase.example', address: 'Fremont, United States', phone: '+1 510 555 0100' }] }
      }
    },
    websiteContactEnrichmentService: {
      async enrich() {
        return { status: 'completed', contactEmails: ['sales@enphase.example'], emails: [{ value: 'sales@enphase.example', sourceUrl: 'https://enphase.example/contact' }], contactPages: ['https://enphase.example/contact'], evidence: [] }
      }
    },
    providerAvailability: { googleMaps: { available: true, missingEnvVars: [] } },
    addressClassificationService: {},
    companySimilarityService: {},
    gistCustomerDataService: {}
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/google-maps/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Enphase Energy', location: 'United States', filters: { includeEmails: true } })
    })
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.deepEqual(payload.results[0].emails, ['sales@enphase.example'])
    assert.deepEqual(payload.results[0].contactPages, ['https://enphase.example/contact'])
    assert.equal(payload.enrichment.publicEmailCount, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('Google Maps email enrichment processes every returned result instead of a hidden ten-item cap', async () => {
  let enrichmentCount = 0
  const app = express()
  app.use(express.json())
  app.use('/api', createLeadSupportRouter({
    googleMapsSearchService: {
      async search() {
        return {
          query: 'energy buyers',
          count: 12,
          results: Array.from({ length: 12 }, (_, index) => ({
            title: `Energy Buyer ${index + 1}`,
            url: `https://buyer-${index + 1}.example`,
            address: 'Fremont, United States'
          }))
        }
      }
    },
    websiteContactEnrichmentService: {
      async enrich({ website }) {
        enrichmentCount += 1
        return {
          status: 'no_public_email',
          contactEmails: [],
          emails: [],
          contactPages: [`${website}/contact`],
          evidence: []
        }
      }
    },
    providerAvailability: { googleMaps: { available: true, missingEnvVars: [] } },
    researchRunsStorage: { async save() {} }
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/google-maps/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'energy buyers', filters: { maxResults: 20, includeEmails: true } })
    })
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.results.length, 12)
    assert.equal(payload.enrichment.attempted, 12)
    assert.equal(enrichmentCount, 12)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('Google Maps batch verification reports oversized input instead of silently dropping companies', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', createLeadSupportRouter({
    googleMapsSearchService: {},
    providerAvailability: { googleMaps: { available: true, missingEnvVars: [] } }
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/lead-workspaces/batch-verify-csv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companies: Array.from({ length: 51 }, (_, index) => ({ name: `Company ${index + 1}` })) })
    })
    const payload = await response.json()
    assert.equal(response.status, 400)
    assert.equal(payload.code, 'batch_limit_exceeded')
    assert.equal(payload.requestedCount, 51)
    assert.equal(payload.maxAllowed, 50)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('main similar-company route preserves needs_review status in the saved run', async () => {
  let savedRun
  const app = express()
  app.use(express.json())
  app.use('/api', createApiRouter({
    similarCompanyService: {
      async findSimilarCompanies() {
        return {
          status: 'needs_review',
          partial: false,
          results: [],
          metadata: {
            status: 'needs_review',
            searchCalls: [{ provider: 'tavily', query: 'Enphase competitors', ok: false, error: 'provider_search_failed' }],
            verificationCalls: [],
            enrichmentCalls: []
          },
          error: { code: 'no_grounded_company_evidence', message: 'No grounded evidence.' }
        }
      }
    },
    researchRunsStorage: { async save(run) { savedRun = run } },
    providerAvailability: {
      tavily: { available: true, missingEnvVars: [] },
      ai: { available: true, missingEnvVars: [] }
    }
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/similar-company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: { name: 'Enphase Energy' }, topN: 5 })
    })
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.status, 'needs_review')
    assert.equal(savedRun.status, 'needs_review')
    assert.equal(savedRun.parts[3].status, 'needs_review')
    assert.equal(savedRun.errors[0].code, 'no_grounded_company_evidence')
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('legacy and current similar-company routes share the requested-count contract', async () => {
  const receivedCounts = []
  const similarCompanyService = {
    async findSimilarCompanies(payload) {
      receivedCounts.push(payload.maxResults)
      return {
        status: 'completed',
        partial: false,
        sampleCompany: payload,
        results: [],
        companies: [],
        metadata: {
          status: 'completed',
          resultPolicy: {
            requestedCount: payload.maxResults,
            candidatePoolTarget: payload.maxResults * 2,
            displayedCount: 0
          },
          searchCalls: [],
          verificationCalls: [],
          enrichmentCalls: []
        }
      }
    }
  }
  const app = express()
  app.use(express.json())
  const providerAvailability = {
    tavily: { available: false, missingEnvVars: ['TAVILY_API_KEY'] },
    brave: { available: true, missingEnvVars: [] },
    ai: { available: true, missingEnvVars: [] }
  }
  const routeConfig = {
    similarCompanyService,
    companySimilarityService: similarCompanyService,
    researchRunsStorage: { async save() {} },
    providerAvailability
  }
  app.use('/api', createApiRouter(routeConfig))
  app.use('/api', createLeadSupportRouter(routeConfig))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    for (const endpoint of ['/api/similar-company', '/api/companies/find-similar']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: { name: 'Enphase Energy' }, topN: 15 })
      })
      const payload = await response.json()
      assert.equal(response.status, 200)
      assert.equal(payload.metadata.resultPolicy.requestedCount, 15)
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }

  assert.deepEqual(receivedCounts, [15, 15])
})

test('similar company preserves provider evidence when the AI final response times out', async () => {
  const timeoutError = new Error('AI final response timed out')
  timeoutError.code = 'ai_request_timeout'
  timeoutError.iterations = 3
  timeoutError.toolCalls = [
    {
      id: 'search-1',
      name: 'search_web',
      arguments: { provider: 'tavily', query: 'Enphase competitors solar storage' },
      result: {
        ok: true,
        provider: 'tavily',
        results: [{
          title: 'APsystems USA',
          url: 'https://usa.apsystems.com',
          snippet: 'APsystems provides microinverters, energy storage, and rapid shutdown products.'
        }]
      }
    },
    {
      id: 'verify-1',
      name: 'verify_company',
      arguments: { company_name: 'APsystems USA', address: '' },
      result: { ok: false, verified: false, error: { code: 'google_maps_request_failed' } }
    }
  ]

  const service = createSimilarCompanyService({
    requestBudgetMs: 240000,
    aiTimeoutMs: 120000,
    maxTokens: 3000,
    aiAgent: {
      async executeTask() {
        throw timeoutError
      }
    },
    companyEnrichmentService: {
      async enrichCompanies(companies) {
        return {
          companies,
          verificationCalls: [],
          enrichmentCalls: []
        }
      }
    }
  })

  const result = await service.findSimilarCompanies({
    name: 'Enphase Energy',
    website: 'https://enphase.com',
    industry: 'solar energy and storage',
    maxResults: 5
  })

  assert.equal(result.status, 'partial')
  assert.equal(result.partial, true)
  assert.equal(result.error.code, 'ai_request_timeout')
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0].company.title, 'APsystems USA')
  assert.equal(result.metadata.searchCalls[0].provider, 'tavily')
  assert.equal(result.metadata.verificationCalls[0].ok, false)
})

test('similar company builds a larger candidate pool and displays every qualified result', async () => {
  const buyerResults = Array.from({ length: 21 }, (_, index) => ({
    title: `Energy Buyer ${index + 1}`,
    url: `https://energy-buyer-${index + 1}.example`,
    snippet: 'Energy storage OEM buyer that procures and integrates industrial assemblies.',
    provider: 'tavily'
  }))
  const filteredResults = Array.from({ length: 9 }, (_, index) => ({
    title: `Connector Product Guide ${index + 1}`,
    url: `https://guide-${index + 1}.example/article`,
    snippet: 'Product guide and catalogue for industrial connectors.',
    provider: 'tavily'
  }))
  const allResults = [...buyerResults, ...filteredResults]
  const toolCalls = Array.from({ length: 4 }, (_, index) => buildProviderSearchCall(
    allResults.slice(index * 8, index * 8 + 8),
    index % 2 === 0 ? 'tavily' : 'brave',
    `energy storage buyers query ${index + 1}`
  ))
  let executeArgs

  const service = createSimilarCompanyService({
    requestBudgetMs: 240000,
    aiTimeoutMs: 120000,
    maxTokens: 3000,
    aiAgent: {
      async executeTask(args) {
        executeArgs = args
        return {
          finalText: JSON.stringify({ companies: [] }),
          parsedJson: { companies: [] },
          toolCalls,
          iterations: 4,
          status: 'completed',
          partial: false
        }
      }
    }
  })

  const result = await service.findSimilarCompanies({
    name: 'Enphase Energy',
    website: 'https://enphase.com',
    industry: 'solar energy and storage',
    maxResults: 15
  })

  assert.match(executeArgs.systemPrompt, /候选池目标：30/)
  assert.equal(executeArgs.deadlineMs, 240000)
  assert.equal(executeArgs.timeoutMs, 120000)
  assert.equal(JSON.parse(executeArgs.userInput).candidatePoolTarget, 30)
  assert.equal(result.metadata.resultPolicy.requestedCount, 15)
  assert.equal(result.metadata.resultPolicy.candidatePoolTarget, 30)
  assert.equal(result.metadata.resultPolicy.displayedCount, 21)
  assert.equal(result.results.length, 21)
  assert.equal(result.results.some((item) => item.company.title.includes('Product Guide')), false)
})

test('similar company rejects AI-only candidates when provider evidence is empty', async () => {
  const service = createSimilarCompanyService({
    aiAgent: {
      async executeTask() {
        return {
          finalText: JSON.stringify({ companies: [{ companyName: 'Invented Solar', website: 'https://invented.example', similarityScore: 92, reason: 'AI-only claim' }] }),
          parsedJson: { companies: [{ companyName: 'Invented Solar', website: 'https://invented.example', similarityScore: 92, reason: 'AI-only claim' }] },
          toolCalls: [{
            name: 'search_web',
            arguments: { provider: 'tavily', query: 'Enphase competitors' },
            result: { ok: false, error: { code: 'provider_search_failed' } }
          }],
          iterations: 2
        }
      }
    }
  })

  const result = await service.findSimilarCompanies({
    name: 'Enphase Energy',
    website: 'https://enphase.com',
    maxResults: 5
  })

  assert.equal(result.status, 'needs_review')
  assert.equal(result.results.length, 0)
  assert.equal(result.error.code, 'no_grounded_company_evidence')
  assert.equal(result.metadata.grounding.groundedCount, 0)
})

test('similar company route persists identifiable partial research parts', async () => {
  let savedRun
  const app = express()
  app.use(express.json())
  app.use('/api', createLeadSupportRouter({
    companySimilarityService: {
      async findSimilarCompanies() {
        return {
          status: 'partial',
          partial: true,
          sampleCompany: { name: 'Enphase Energy', website: 'https://enphase.com' },
          results: [{ company: { title: 'APsystems USA', url: 'https://usa.apsystems.com' }, similarity: 0.6 }],
          companies: [{ name: 'APsystems USA', website: 'https://usa.apsystems.com' }],
          metadata: {
            prompt: { key: 'similar-company', rendered: 'similar prompt' },
            searchCalls: [{ provider: 'tavily', query: 'solar storage competitors', ok: true, resultCount: 1 }],
            verificationCalls: [{ companyName: 'APsystems USA', ok: false, verified: false, error: 'google_maps_request_failed' }],
            enrichmentCalls: [{ companyName: 'APsystems USA', status: 'no_public_email', emailCount: 0 }]
          },
          error: { code: 'ai_request_timeout', message: 'AI final response timed out' }
        }
      }
    },
    researchRunsStorage: {
      async save(run) { savedRun = run }
    },
    providerAvailability: {
      tavily: { available: true, missingEnvVars: [] },
      ai: { available: true, missingEnvVars: [] }
    }
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/companies/find-similar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: { name: 'Enphase Energy', website: 'https://enphase.com' }, topN: 5 })
    })
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.partial, true)
    assert.equal(payload.status, 'partial')
    assert.equal(payload.runId, savedRun.id)
    assert.equal(savedRun.expiresAt != null, true)
    assert.deepEqual(savedRun.parts.map((part) => part.part), ['discovery', 'map-verification', 'contact-enrichment', 'report'])
    assert.equal(savedRun.parts[3].status, 'partial')
    assert.equal(savedRun.errors[0].code, 'ai_request_timeout')
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
