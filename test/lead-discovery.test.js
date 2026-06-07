import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import express from 'express'
import { createLeadDiscoveryService } from '../server/modules/leads/application/services/lead-discovery-service.js'
import { createOsintParserFacade } from '../server/modules/leads/application/osint/osint-parser-facade.js'
import { createOsintResearchService } from '../server/modules/leads/application/services/osint-research-service.js'
import { createLeadOsintRouter } from '../server/modules/leads/routes/osint-routes.js'

function withFixedNow(now, callback) {
  const originalNow = Date.now
  Date.now = () => now

  return Promise.resolve(callback()).finally(() => {
    Date.now = originalNow
  })
}

function assertRefsResolve(evidenceIds, refs, label) {
  assert.ok(Array.isArray(refs), `${label} should expose evidenceRefs`)
  assert.ok(refs.length > 0, `${label} should include at least one evidence ref`)

  for (const ref of refs) {
    assert.ok(evidenceIds.has(ref), `${label} references missing evidence ${ref}`)
  }
}


test('provider-backed discovery returns analyzed workspace without falling back to seeded profiles', async () => {
  const tavilyCalls = []
  const braveCalls = []
  const googleCalls = []
  const analyzedCandidates = []

  const providerCandidate = {
    title: 'Aurora Industrial Systems GmbH',
    url: 'https://aurora.example.com/about',
    snippet: 'Aurora builds industrial automation lines for solar module plants.',
    rawContent: 'Aurora Industrial Systems GmbH headquartered in Berlin with automation and manufacturing teams.',
    provider: 'tavily',
    queryLabel: 'manufacturer'
  }

  const service = createLeadDiscoveryService({
    tavilySearch: async (query) => {
      tavilyCalls.push(query)
      return [providerCandidate]
    },
    braveSearch: async (query) => {
      braveCalls.push(query)
      return []
    },
    googleMapsSearch: async (query) => {
      googleCalls.push(query)
      return []
    },
    analyzeCompanyWebsite: async (candidate, normalizedKeywords, segmentHints, country) => {
      analyzedCandidates.push({ candidate, normalizedKeywords, segmentHints, country })

      return {
        id: 'analyzed-aurora',
        name: 'Aurora Industrial Systems GmbH',
        website: 'https://aurora.example.com/',
        country: 'Germany',
        segment: 'Factory Automation',
        profile: 'Solar',
        size: 'Enterprise',
        fitScore: 94,
        signals: ['Found via tavily', 'Likely official company website'],
        whyFit: 'Strong automation buyer for solar manufacturing.',
        priority: 'Tier 1',
        source: 'tavily',
        sourceUrl: 'https://aurora.example.com/',
        businessType: 'Industrial Manufacturer',
        marketRole: 'potential-buyer',
        businessSummary: 'Automation integrator for solar factories.',
        buyingRelevance: 'Buys industrial electrical components.',
        mainProducts: ['automation lines'],
        targetApplications: ['Factory Automation'],
        possibleScaleSignal: 'Enterprise',
        scaleSignals: ['global manufacturing'],
        employeeEstimate: '1000+',
        foundedYear: '1998',
        headquarters: 'Berlin, Germany',
        officialWebsiteLikely: true,
        matchedQueryCount: 3,
        matchedProviders: ['tavily', 'brave'],
        matchedQueryLabels: ['manufacturer', 'company'],
        contactEmails: ['hello@aurora.example.com'],
        contactPages: ['https://aurora.example.com/contact'],
        phone: '+49 30 5555',
        address: 'Berlin, Germany',
        notes: '',
        outreachNotes: '',
        pipelineStatus: 'researching',
        customEmail: '',
        customContactName: '',
        customContactTitle: '',
        customLinkedinUrl: '',
        customEmailStatus: 'not-found'
      }
    }
  })

  const workspace = await withFixedNow(1700000000000, () => service.discoverWorkspace({
    industry: 'solar',
    keywords: ['automation'],
    country: 'Germany',
    targetTypes: ['manufacturer'],
    excludeTypes: []
  }))

  assert.equal(workspace.providersUsed.includes('seeded-profile'), false)
  assert.deepEqual(workspace.providersUsed, ['tavily', 'brave'])
  assert.equal(workspace.searchStrategy.evidenceMode, 'multi-query-hit-weighting')
  assert.equal(workspace.companies.length, 1)
  assert.equal(workspace.companies[0].name, 'Aurora Industrial Systems GmbH')
  assert.equal(workspace.contacts.length, 2)
  assert.equal(workspace.drafts.length, 1)
  assert.equal(analyzedCandidates.length, 1)
  assert.equal(analyzedCandidates[0].country, 'Germany')
  assert.ok(analyzedCandidates[0].segmentHints.length > 0)
  assert.ok(tavilyCalls.length > 0)
  assert.ok(braveCalls.length > 0)
  assert.ok(googleCalls.length > 0)
})

test('seeded fallback returns deterministic seeded workspace when providers yield no viable companies', async () => {
  const service = createLeadDiscoveryService({
    tavilySearch: async () => [],
    braveSearch: async () => [],
    googleMapsSearch: async () => []
  })

  const workspace = await withFixedNow(1700000000000, () => service.discoverWorkspace({
    industry: 'solar',
    keywords: ['installer'],
    country: 'Germany',
    targetTypes: ['system-integrator'],
    excludeTypes: []
  }))

  assert.deepEqual(workspace.providersUsed, ['seeded-profile'])
  assert.equal(workspace.id, 'workspace-1700000000000')
  assert.equal(workspace.industry, 'Solar')
  assert.equal(workspace.country, 'Germany')
  assert.ok(workspace.companies.length > 0)
  assert.ok(workspace.contacts.length > 0)
  assert.ok(workspace.drafts.length > 0)
  assert.equal(workspace.summary.companyCount, workspace.companies.length)
  assert.equal(workspace.companies[0].source, 'seeded-profile')
  assert.equal(workspace.companies[0].country, 'Germany')
})

test('provider-backed discovery enforces requested targetTypes on analyzed companies', async () => {
  const analyzedRoles = new Map([
    ['https://maker.example.com/about', {
      id: 'company-maker',
      name: 'Maker GmbH',
      website: 'https://maker.example.com/',
      country: 'Germany',
      segment: 'Factory Automation',
      profile: 'Solar',
      size: 'Enterprise',
      fitScore: 94,
      signals: ['Likely official company website'],
      whyFit: 'Manufacturer profile.',
      priority: 'Tier 1',
      source: 'tavily',
      sourceUrl: 'https://maker.example.com/',
      businessType: 'Manufacturer',
      marketRole: 'potential-buyer',
      businessSummary: 'Builds automation lines.',
      buyingRelevance: 'High',
      mainProducts: ['automation lines'],
      targetApplications: ['Factory Automation'],
      possibleScaleSignal: 'Enterprise',
      scaleSignals: ['global manufacturing'],
      employeeEstimate: '1000+',
      foundedYear: '1998',
      headquarters: 'Berlin, Germany',
      officialWebsiteLikely: true,
      matchedQueryCount: 3,
      matchedProviders: ['tavily'],
      matchedQueryLabels: ['manufacturer'],
      contactEmails: ['hello@maker.example.com'],
      contactPages: ['https://maker.example.com/contact'],
      phone: '+49 30 1000',
      address: 'Berlin, Germany',
      notes: '',
      outreachNotes: '',
      pipelineStatus: 'researching',
      customEmail: '',
      customContactName: '',
      customContactTitle: '',
      customLinkedinUrl: '',
      customEmailStatus: 'not-found'
    }],
    ['https://integrator.example.com/about', {
      id: 'company-integrator',
      name: 'Integrator AG',
      website: 'https://integrator.example.com/',
      country: 'Germany',
      segment: 'Factory Automation',
      profile: 'Solar',
      size: 'Upper Mid-Market',
      fitScore: 91,
      signals: ['Likely official company website'],
      whyFit: 'Integrator profile.',
      priority: 'Tier 1',
      source: 'tavily',
      sourceUrl: 'https://integrator.example.com/',
      businessType: 'System Integrator',
      marketRole: 'potential-buyer',
      businessSummary: 'Delivers complete automation systems.',
      buyingRelevance: 'High',
      mainProducts: ['control systems'],
      targetApplications: ['Factory Automation'],
      possibleScaleSignal: 'Upper Mid-Market',
      scaleSignals: ['regional integrator'],
      employeeEstimate: '500+',
      foundedYear: '2004',
      headquarters: 'Munich, Germany',
      officialWebsiteLikely: true,
      matchedQueryCount: 2,
      matchedProviders: ['tavily'],
      matchedQueryLabels: ['system-integrator'],
      contactEmails: ['info@integrator.example.com'],
      contactPages: ['https://integrator.example.com/contact'],
      phone: '+49 89 2000',
      address: 'Munich, Germany',
      notes: '',
      outreachNotes: '',
      pipelineStatus: 'researching',
      customEmail: '',
      customContactName: '',
      customContactTitle: '',
      customLinkedinUrl: '',
      customEmailStatus: 'not-found'
    }]
  ])

  const service = createLeadDiscoveryService({
    tavilySearch: async () => [
      {
        title: 'Maker GmbH',
        url: 'https://maker.example.com/about',
        snippet: 'Manufacturer of solar factory equipment.',
        rawContent: 'Manufacturer of automation lines.',
        provider: 'tavily',
        queryLabel: 'manufacturer'
      },
      {
        title: 'Integrator AG',
        url: 'https://integrator.example.com/about',
        snippet: 'Solar automation integrator.',
        rawContent: 'System integrator for solar plants.',
        provider: 'tavily',
        queryLabel: 'system-integrator'
      }
    ],
    braveSearch: async () => [],
    googleMapsSearch: async () => [],
    analyzeCompanyWebsite: async (candidate) => analyzedRoles.get(candidate.url)
  })

  const workspace = await withFixedNow(1700000000000, () => service.discoverWorkspace({
    industry: 'solar',
    keywords: ['automation'],
    country: 'Germany',
    targetTypes: ['manufacturer'],
    excludeTypes: []
  }))

  assert.equal(workspace.companies.length, 1)
  assert.equal(workspace.companies[0].name, 'Maker GmbH')
  assert.equal(workspace.companies[0].businessType, 'Manufacturer')
  assert.deepEqual(workspace.searchStrategy.targetTypes, ['manufacturer'])
})

test('provider-backed discovery excludes analyzed companies that match excluded request types', async () => {
  const service = createLeadDiscoveryService({
    tavilySearch: async () => [{
      title: 'Channel Partner BV',
      url: 'https://channel.example.com/about',
      snippet: 'Regional stockist and distribution partner.',
      rawContent: 'Distributor of industrial connectors.',
      provider: 'tavily',
      queryLabel: 'distributor'
    }],
    braveSearch: async () => [],
    googleMapsSearch: async () => [],
    analyzeCompanyWebsite: async () => ({
      id: 'company-channel',
      name: 'Channel Partner BV',
      website: 'https://channel.example.com/',
      country: 'Germany',
      segment: 'Factory Automation',
      profile: 'Solar',
      size: 'Mid-Market',
      fitScore: 88,
      signals: ['Likely official company website'],
      whyFit: 'Channel sales organization.',
      priority: 'Tier 1',
      source: 'tavily',
      sourceUrl: 'https://channel.example.com/',
      businessType: 'Distributor',
      marketRole: 'channel-partner',
      businessSummary: 'Regional stockist and distributor.',
      buyingRelevance: 'Medium',
      mainProducts: ['connector distribution'],
      targetApplications: ['Factory Automation'],
      possibleScaleSignal: 'Mid-Market',
      scaleSignals: ['regional stock'],
      employeeEstimate: '200+',
      foundedYear: '2010',
      headquarters: 'Hamburg, Germany',
      officialWebsiteLikely: true,
      matchedQueryCount: 2,
      matchedProviders: ['tavily'],
      matchedQueryLabels: ['distributor'],
      contactEmails: ['sales@channel.example.com'],
      contactPages: ['https://channel.example.com/contact'],
      phone: '+49 40 3000',
      address: 'Hamburg, Germany',
      notes: '',
      outreachNotes: '',
      pipelineStatus: 'researching',
      customEmail: '',
      customContactName: '',
      customContactTitle: '',
      customLinkedinUrl: '',
      customEmailStatus: 'not-found'
    })
  })

  const workspace = await withFixedNow(1700000000000, () => service.discoverWorkspace({
    industry: 'solar',
    keywords: ['automation'],
    country: 'Germany',
    targetTypes: ['distributor'],
    excludeTypes: ['distributor']
  }))

  assert.deepEqual(workspace.providersUsed, ['seeded-profile'])
  assert.equal(workspace.companies[0].source, 'seeded-profile')
})

test('provider-backed discovery rejects non-official low-score analyzed companies before workspace assembly', async () => {
  let analyzeCalls = 0

  const service = createLeadDiscoveryService({
    tavilySearch: async () => [{
      title: 'Weak Prospect Ltd',
      url: 'https://weak.example.com/about',
      snippet: 'Possible company mention on an about page.',
      rawContent: 'Weak Prospect Ltd is based in Berlin and founded in 2020, but the page still lacks strong product evidence.',
      provider: 'tavily',
      queryLabel: 'company'
    }],
    braveSearch: async () => [],
    googleMapsSearch: async () => [],
    analyzeCompanyWebsite: async () => {
      analyzeCalls += 1

      return {
        id: 'company-weak',
        name: 'Weak Prospect Ltd',
        website: 'https://weak.example.com/',
        country: 'Germany',
        segment: 'Factory Automation',
        profile: 'Solar',
        size: 'Niche / Unknown',
        fitScore: 85,
        signals: ['Possible aggregator or non-official page'],
        whyFit: 'Weak signal only.',
        priority: 'Tier 3',
        source: 'tavily',
        sourceUrl: 'https://weak.example.com/about',
        businessType: 'Manufacturer',
        marketRole: 'potential-buyer',
        businessSummary: 'Insufficient evidence.',
        buyingRelevance: 'Low',
        mainProducts: ['automation lines'],
        targetApplications: ['Factory Automation'],
        possibleScaleSignal: 'Unknown',
        scaleSignals: [],
        employeeEstimate: '',
        foundedYear: '',
        headquarters: '',
        officialWebsiteLikely: false,
        matchedQueryCount: 1,
        matchedProviders: ['tavily'],
        matchedQueryLabels: ['company'],
        contactEmails: [],
        contactPages: ['https://weak.example.com/contact'],
        phone: '',
        address: '',
        notes: '',
        outreachNotes: '',
        pipelineStatus: 'researching',
        customEmail: '',
        customContactName: '',
        customContactTitle: '',
        customLinkedinUrl: '',
        customEmailStatus: 'not-found'
      }
    }
  })

  const workspace = await withFixedNow(1700000000000, () => service.discoverWorkspace({
    industry: 'solar',
    keywords: ['automation'],
    country: 'Germany',
    targetTypes: ['manufacturer'],
    excludeTypes: []
  }))

  assert.equal(analyzeCalls, 1)
  assert.deepEqual(workspace.providersUsed, ['seeded-profile'])
  assert.equal(workspace.companies[0].source, 'seeded-profile')
})

test('osint research returns structured evidence-backed fallback output without guessed contact data', async () => {
  const service = createOsintResearchService({
    googleMapsSearch: async () => [{
      title: 'Aurora Industrial Systems GmbH',
      url: 'https://aurora.example.com',
      snippet: 'Berlin, Germany',
      address: 'Berlin, Germany',
      phone: '+49 30 5555',
      metadata: {
        placeId: 'place-1',
        formatted_address: 'Berlin, Germany'
      }
    }],
    braveSearch: async () => [{
      title: 'Aurora Industrial Systems GmbH',
      url: 'https://aurora.example.com/about',
      snippet: 'Aurora builds automation systems for solar factories.',
      rawContent: 'Aurora Industrial Systems GmbH provides automation systems for solar factories.'
    }],
    tavilySearch: async () => [{
      title: 'Aurora company overview',
      url: 'https://aurora.example.com/company',
      snippet: 'Company overview and products',
      rawContent: 'Aurora company overview and products.'
    }],
    parserFacade: createOsintParserFacade(),
    providerAvailability: {
      googleMaps: true,
      brave: true,
      tavily: true
    }
  })

  const result = await service.research({
    companyName: 'Aurora Industrial Systems GmbH',
    website: 'aurora.example.com',
    country: 'Germany',
    address: 'Berlin, Germany',
    clues: ['automation systems', 'solar factories']
  })

  assert.equal(result.status, 'partial')
  assert.equal(result.parser.used, false)
  assert.equal(result.providerAvailability.every((item) => item.available), true)
  assert.ok(result.providerResults.length >= 3)
  assert.ok(result.evidence.length >= 3)
  assert.ok(result.findings.length >= 3)
  assert.ok(result.publicContacts.some((contact) => contact.value === '+49 30 5555'))
  assert.equal(result.publicContacts.some((contact) => String(contact.value).includes('guess')), false)
  assert.equal(result.report.overview.officialWebsite, 'https://aurora.example.com')
  assert.ok(result.report.evidenceRefs.length > 0)
  assert.ok(result.researchCase.evidenceRefs.length > 0)
})

test('osint route validates input and returns stable response shape', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/lead-workspaces', createLeadOsintRouter({
    osintResearchService: {
      async research(body) {
        return {
          status: 'needs_review',
          mode: body.mode || 'company_due_diligence',
          subject: {
            companyName: body.companyName,
            subjectRef: 'subject:acme'
          },
          compliance: {
            publicSourcesOnly: true,
            noGuessedEmails: true,
            noGuessedPhones: true,
            noInferredPrivateContactData: true,
            unknownStaysNullOrEmpty: true,
            everyMaterialClaimRequiresEvidence: true
          },
          providerAvailability: [],
          providerResults: [],
          evidence: [],
          verification: {
            entityStatus: 'unverified',
            officialWebsiteStatus: 'unverified',
            addressStatus: 'unverified',
            publicContactStatus: 'unverified'
          },
          parser: {
            available: false,
            used: false,
            reason: 'parser_not_configured',
            error: null,
            contract: null
          },
          report: null,
          findings: [],
          publicContacts: [],
          riskFlags: [],
          unresolvedQuestions: ['Need more evidence.'],
          researchCase: {
            researchCaseId: 'rc_1',
            caseType: 'company_due_diligence',
            subjectRefs: ['subject:acme'],
            findings: [],
            evidenceRefs: []
          }
        }
      }
    }
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })

  try {
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`

    const badResponse = await fetch(`${baseUrl}/api/lead-workspaces/osint-research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    })
    assert.equal(badResponse.status, 400)

    const goodResponse = await fetch(`${baseUrl}/api/lead-workspaces/osint-research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ companyName: 'Acme Robotics' })
    })

    assert.equal(goodResponse.status, 200)
    const payload = await goodResponse.json()
    assert.equal(payload.research.subject.companyName, 'Acme Robotics')
    assert.equal(payload.research.status, 'needs_review')
    assert.ok(Array.isArray(payload.research.unresolvedQuestions))
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
})

test('osint research preserves evidence provenance across reports findings contacts and case outputs', async () => {
  const service = createOsintResearchService({
    googleMapsSearch: async () => [{
      title: 'Aurora Industrial Systems GmbH',
      url: 'https://aurora.example.com',
      snippet: 'Berlin, Germany',
      address: 'Berlin, Germany',
      phone: '+49 30 5555',
      metadata: {
        placeId: 'place-1',
        formatted_address: 'Berlin, Germany'
      }
    }],
    braveSearch: async () => [{
      title: 'Aurora Industrial Systems GmbH',
      url: 'https://aurora.example.com/about',
      snippet: 'Aurora builds automation systems for solar factories.',
      rawContent: 'Aurora Industrial Systems GmbH provides automation systems for solar factories.'
    }],
    tavilySearch: async () => [{
      title: 'Aurora company overview',
      url: 'https://aurora.example.com/company',
      snippet: 'Company overview and products',
      rawContent: 'Aurora company overview and products.'
    }],
    parserFacade: createOsintParserFacade(),
    providerAvailability: {
      googleMaps: true,
      brave: true,
      tavily: true
    }
  })

  const result = await service.research({
    companyName: 'Aurora Industrial Systems GmbH',
    website: 'aurora.example.com',
    country: 'Germany',
    address: 'Berlin, Germany',
    clues: ['automation systems', 'solar factories']
  })

  const evidenceIds = new Set(result.evidence.map((record) => record.evidenceId))

  assert.ok(evidenceIds.size >= 3)
  assertRefsResolve(evidenceIds, result.report.evidenceRefs, 'report')
  assertRefsResolve(evidenceIds, result.researchCase.evidenceRefs, 'researchCase')

  for (const finding of result.findings) {
    assertRefsResolve(evidenceIds, finding.evidenceRefs, `finding:${finding.findingType}`)
  }

  for (const contact of result.publicContacts) {
    assertRefsResolve(evidenceIds, contact.evidenceRefs, `contact:${contact.value}`)
  }
})

test('osint research marks unavailable providers as skipped and avoids fabricating public contacts', async () => {
  const service = createOsintResearchService({
    parserFacade: createOsintParserFacade(),
    providerAvailability: {
      googleMaps: false,
      googleMapsReason: 'missing_api_key',
      brave: false,
      braveReason: 'missing_api_key',
      tavily: false,
      tavilyReason: 'missing_api_key'
    }
  })

  const result = await service.research({
    companyName: 'No Key Systems GmbH',
    website: 'no-key.example.com',
    country: 'Germany'
  })

  assert.equal(result.status, 'needs_review')
  assert.deepEqual(
    result.providerAvailability.map((entry) => ({
      provider: entry.provider,
      available: entry.available,
      skipped: entry.skipped,
      reason: entry.reason,
      queriesAttempted: entry.queriesAttempted,
      resultCount: entry.resultCount
    })),
    [
      {
        provider: 'google-maps',
        available: false,
        skipped: true,
        reason: 'missing_api_key',
        queriesAttempted: 0,
        resultCount: 0
      },
      {
        provider: 'brave',
        available: false,
        skipped: true,
        reason: 'missing_api_key',
        queriesAttempted: 0,
        resultCount: 0
      },
      {
        provider: 'tavily',
        available: false,
        skipped: true,
        reason: 'missing_api_key',
        queriesAttempted: 0,
        resultCount: 0
      }
    ]
  )
  assert.equal(result.publicContacts.length, 0)
  assert.equal(result.report.publicContacts.length, 0)
  assert.equal(result.report.findings.some((finding) => finding.findingType === 'public_contact'), false)
  assert.equal(result.evidence.length, 1)
  assert.equal(result.evidence[0].provider, 'system')
  assert.match(result.unresolvedQuestions.join(' '), /google-maps was skipped: missing_api_key/i)
  assert.match(result.unresolvedQuestions.join(' '), /brave was skipped: missing_api_key/i)
  assert.match(result.unresolvedQuestions.join(' '), /tavily was skipped: missing_api_key/i)
})

test('osint research falls back safely when parser output includes guessed public contact data', async () => {
  const parserFacade = createOsintParserFacade({
    parseCollectedEvidence: async () => ({
      mode: 'company_due_diligence',
      status: 'completed',
      summary: {
        entityName: 'Aurora Industrial Systems GmbH',
        officialWebsiteStatus: 'partially_verified',
        publicContactStatus: 'discovered',
        confidence: 0.91
      },
      report: {
        schemaVersion: 'osint-report-v1',
        subjectRef: 'subject:aurora-industrial-systems-gmbh',
        overview: {
          canonicalName: 'Aurora Industrial Systems GmbH',
          officialWebsite: 'https://aurora.example.com',
          evidenceRefs: ['ev-parser-1']
        },
        products: [],
        targetApplications: [],
        publicContacts: [],
        findings: [],
        riskFlags: [],
        unresolvedQuestions: [],
        evidenceRefs: ['ev-parser-1']
      },
      findings: [{
        findingType: 'official_website',
        label: 'Official website observed',
        value: 'https://aurora.example.com',
        confidence: 0.9,
        verificationStatus: 'partially_verified',
        subjectRef: 'subject:aurora-industrial-systems-gmbh',
        evidenceRefs: ['ev-parser-1']
      }],
      publicContacts: [{
        contactType: 'public_email',
        value: 'guessed@aurora.example.com [guess]',
        ownerScope: 'company_level',
        verificationStatus: 'observed',
        evidenceRefs: ['ev-parser-1']
      }],
      riskFlags: [],
      unresolvedQuestions: [],
      evidenceRefs: ['ev-parser-1']
    })
  })

  const service = createOsintResearchService({
    braveSearch: async () => [{
      title: 'Aurora Industrial Systems GmbH',
      url: 'https://aurora.example.com/about',
      snippet: 'Aurora builds automation systems for solar factories.',
      rawContent: 'Aurora Industrial Systems GmbH provides automation systems for solar factories.'
    }],
    parserFacade,
    providerAvailability: {
      googleMaps: false,
      brave: true,
      tavily: false
    }
  })

  const result = await service.research({
    companyName: 'Aurora Industrial Systems GmbH',
    website: 'aurora.example.com',
    country: 'Germany',
    clues: ['automation systems']
  })

  assert.equal(result.parser.available, true)
  assert.equal(result.parser.used, false)
  assert.equal(result.parser.reason, 'parser_failed')
  assert.match(result.parser.error, /guessed|inferred/i)
  assert.equal(result.publicContacts.some((contact) => String(contact.value).includes('guess')), false)
  assert.equal(result.report.publicContacts.some((contact) => String(contact.value).includes('guess')), false)
  assert.equal(result.status, 'partial')
})

test('osint research falls back safely when parser execution throws', async () => {
  const parserFacade = createOsintParserFacade({
    parseCollectedEvidence: async () => {
      throw new Error('parser offline')
    }
  })

  const service = createOsintResearchService({
    googleMapsSearch: async () => [{
      title: 'Aurora Industrial Systems GmbH',
      url: 'https://aurora.example.com',
      snippet: 'Berlin, Germany',
      address: 'Berlin, Germany',
      metadata: {
        placeId: 'place-1',
        formatted_address: 'Berlin, Germany'
      }
    }],
    parserFacade,
    providerAvailability: {
      googleMaps: true,
      brave: false,
      tavily: false
    }
  })

  const result = await service.research({
    companyName: 'Aurora Industrial Systems GmbH',
    website: 'aurora.example.com',
    country: 'Germany',
    address: 'Berlin, Germany'
  })

  assert.equal(result.parser.available, true)
  assert.equal(result.parser.used, false)
  assert.equal(result.parser.reason, 'parser_failed')
  assert.equal(result.parser.error, 'parser offline')
  assert.equal(result.status, 'partial')
  assert.ok(result.report)
  assert.ok(result.findings.length > 0)
})

test('server mounts the OSINT router under lead workspaces exactly once and before parameterized lead routes', async () => {
  const serverSource = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8')
  const mountLine = "app.use('/api/lead-workspaces', createLeadOsintRouter({ osintResearchService }))"
  const mountMatches = serverSource
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line === mountLine)
  const discoverIndex = serverSource.indexOf("app.post('/api/lead-workspaces/discover'")
  const mountIndex = serverSource.indexOf(mountLine)
  const putCompanyIndex = serverSource.indexOf("app.put('/api/lead-workspaces/:id/company/:companyId'")
  const getWorkspaceIndex = serverSource.indexOf("app.get('/api/lead-workspaces/:id'")

  assert.equal(mountMatches.length, 1)
  assert.notEqual(discoverIndex, -1)
  assert.notEqual(mountIndex, -1)
  assert.notEqual(putCompanyIndex, -1)
  assert.notEqual(getWorkspaceIndex, -1)
  assert.ok(mountIndex > discoverIndex)
  assert.ok(mountIndex < putCompanyIndex)
  assert.ok(mountIndex < getWorkspaceIndex)
})
