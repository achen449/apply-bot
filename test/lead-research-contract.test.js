import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createCompanyEnrichmentService } from '../server/modules/leads/application/services/company-enrichment-service.js'
import { createGoogleMapsSearchService } from '../server/modules/leads/application/services/google-maps-search-service.js'
import { createOsintResearchService } from '../server/modules/leads/application/services/osint-research-service.js'
import { createWebsiteContactEnrichmentService } from '../server/modules/leads/application/services/website-contact-enrichment-service.js'
import { createSimilarCompanyService } from '../server/modules/leads/services/similar-company.js'
import { createAIAgent } from '../server/modules/leads/services/ai-agent.js'
import { createLeadAITools } from '../server/modules/leads/services/ai-tools.js'
import { createLeadFinderService } from '../server/modules/leads/services/lead-finder-service.js'
import { createOsintService } from '../server/modules/leads/services/osint.js'
import { createApiRouter } from '../server/modules/leads/routes/api-routes.js'
import { createLeadSupportRouter } from '../server/modules/leads/routes/lead-support-routes.js'
import {
  canonicalCompanyWebsite,
  dedupeCompanyCandidates,
  deriveCompanyNameFromSearchResult,
  isLikelyBuyerCandidate,
  isLikelyOfficialCompanyResult,
  matchesTargetCountry
} from '../server/modules/leads/shared/company-result-normalizer.js'
import { mergeCompanyFacts } from '../server/modules/leads/shared/company-fact-extractors.js'
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
  assert.equal(matchesTargetCountry('Spain Europe', 'Headquartered in Guangzhou, China'), false)
  assert.equal(matchesTargetCountry('Spain Europe', 'An American lighting company headquartered in Atlanta'), false)
})

test('provider-only similar-company candidates must look like official company pages', () => {
  assert.equal(isLikelyOfficialCompanyResult({
    title: '2026 Updated – Best 20 Solar Street Light Manufacturers in Europe',
    url: 'https://publisher.example/best-solar-street-light-manufacturers-in-europe/',
    snippet: 'A ranked list of manufacturers.'
  }), false)
  assert.equal(isLikelyOfficialCompanyResult({
    title: 'Find Electrical Equipment Manufacturing companies in Spain - Dun & Bradstreet',
    url: 'https://www.dnb.com/business-directory/company-information.electrical_equipment_manufacturing.es.html'
  }), false)
  assert.equal(isLikelyOfficialCompanyResult({
    title: 'SolaX Power: Leading Solar Energy Solutions Company',
    url: 'https://www.solaxpower.com/',
    snippet: 'SolaX Power is a global manufacturer of solar inverters and energy storage systems.'
  }), true)
  assert.equal(deriveCompanyNameFromSearchResult({
    title: 'SolaX Power: Leading Solar Energy Solutions Company',
    url: 'https://www.solaxpower.com/'
  }), 'SolaX Power')
  assert.equal(deriveCompanyNameFromSearchResult({
    title: 'Home | Sigenergy',
    url: 'https://www.sigenergy.com/en'
  }), 'Sigenergy')
  assert.equal(deriveCompanyNameFromSearchResult({
    title: 'Our Story | Helvar Components Oy Ab',
    url: 'https://helvarcomponents.com/our-story'
  }), 'Helvar Components Oy Ab')
  assert.equal(deriveCompanyNameFromSearchResult({
    title: 'For 70 years Panzeri has been producing lighting for every specific need',
    url: 'https://panzeri.it/en'
  }), 'Panzeri')
  assert.equal(canonicalCompanyWebsite('https://helvarcomponents.com/our-story'), 'https://helvarcomponents.com/')
  assert.equal(isLikelyOfficialCompanyResult({
    title: 'Publisher Weekly',
    url: 'https://publisher.example/',
    snippet: 'A roundup of energy storage companies and manufacturers.'
  }), false)
  assert.equal(isLikelyOfficialCompanyResult({
    title: 'Nordeon Group GmbH',
    url: 'https://x.com/nordeongroup',
    snippet: 'Company profile for a lighting manufacturer.'
  }), false)
  assert.equal(isLikelyOfficialCompanyResult({
    title: 'LightingEurope',
    url: 'https://www.lightingeurope.org/',
    snippet: 'The voice of the lighting industry, representing member companies and national associations.'
  }), false)
  assert.equal(isLikelyOfficialCompanyResult({
    title: 'LIGHTS | Switch it on',
    url: 'https://www.lights.de/en/',
    snippet: 'Professional lighting products and projects.'
  }), false)
  assert.equal(isLikelyOfficialCompanyResult({
    title: 'AI Candidate Name',
    originalTitle: 'LIGHTS | Switch it on',
    url: 'https://www.lights.de/en/',
    snippet: 'Professional lighting products and projects.'
  }), false)
  assert.equal(deriveCompanyNameFromSearchResult({
    title: 'Klusdesign.eu LED lighting manufacturer',
    url: 'https://klusdesign.eu/en'
  }), 'Klusdesign')
  assert.equal(deriveCompanyNameFromSearchResult({
    title: 'Aurora Energy Systems',
    url: 'https://aurora.test'
  }), 'Aurora Energy Systems')
  assert.equal(deriveCompanyNameFromSearchResult({
    title: 'ABB | Electrification and Automation',
    url: 'https://new.abb.com/'
  }), 'ABB')
  assert.equal(isLikelyOfficialCompanyResult({
    title: 'ABB | Electrification and Automation',
    url: 'https://new.abb.com/',
    snippet: 'ABB is a global technology company headquartered in Switzerland.'
  }), true)
  assert.equal(deriveCompanyNameFromSearchResult({
    title: 'Siemens | Global Technology Company',
    url: 'https://global.siemens.com.sg/'
  }), 'Siemens')
  assert.equal(deriveCompanyNameFromSearchResult({
    title: 'Acme Industrial',
    url: 'https://portal.acme.co.za/'
  }), 'Acme Industrial')
  assert.equal(isLikelyOfficialCompanyResult({
    title: 'EASE - European Association for Storage of Energy',
    url: 'https://ease-storage.eu/',
    snippet: 'Founded to represent the energy storage industry.'
  }), false)
  assert.equal(isLikelyOfficialCompanyResult({
    title: 'Acme customer story',
    url: 'https://acme-partner.example/customers/acme',
    snippet: 'We are a global company founded in 1990.'
  }), false)
  assert.equal(isLikelyOfficialCompanyResult({
    title: 'Company Listing',
    url: 'https://www.company-listing.org/spain/lighting/',
    snippet: 'A listing of lighting companies in Spain.'
  }), false)
})

test('company fact merging prefers the strongest attributable employee fact across official pages', () => {
  const merged = mergeCompanyFacts([
    { employeeCount: '120', companySize: '50-199', companySizeSource: 'public_employee_count' },
    { employeeCount: '3500', companySize: '1000-9999', companySizeSource: 'public_employee_count' }
  ])
  assert.equal(merged.employeeCount, '3500')
  assert.equal(merged.companySize, '1000-9999')
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

test('website enrichment restores public address and company-size facts from official pages', async () => {
  const service = createWebsiteContactEnrichmentService({
    maxPages: 3,
    resolveHost: resolvePublicTestHost,
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      async text() {
        if (url.endsWith('/about')) {
          return `<script type="application/ld+json">{"@type":"Organization","name":"Solar Example Group","address":{"@type":"PostalAddress","streetAddress":"100 Solar Way","addressLocality":"Madrid","postalCode":"28001","addressCountry":"Spain"}}</script><p>Founded in 2008, our 850 employees support customers worldwide.</p>`
        }
        if (url.endsWith('/contact')) {
          return '<a href="tel:+34%2091%20555%200100">Call us</a><p>Our local contact team has 20 employees.</p>'
        }
        return '<html><body>Official company homepage</body></html>'
      }
    })
  })

  const result = await service.enrich({ website: 'https://solar.example' })
  assert.equal(result.address, '100 Solar Way, Madrid, 28001, Spain')
  assert.equal(result.companyName, 'Solar Example Group')
  assert.equal(result.employeeCount, '850')
  assert.equal(result.companySize, '200-999')
  assert.equal(result.phone, '+34 91 555 0100')
  assert.ok(result.scaleSignals.includes('Global footprint mentioned'))
})

test('website enrichment recognizes workforce wording and localized contact paths without attributing member totals', async () => {
  const visited = []
  const service = createWebsiteContactEnrichmentService({
    maxPages: 6,
    resolveHost: resolvePublicTestHost,
    fetchImpl: async (url) => {
      visited.push(url)
      return {
        ok: true,
        status: 200,
        async text() {
          if (url.endsWith('/en/contact')) {
            return '<address>Example Street 8, 10115 Berlin, Germany</address><a href="tel:+49 30 555 0100">Call</a>'
          }
          if (url.endsWith('/en/about')) {
            return '<p>Our workforce of approximately 3,500 supports customers worldwide.</p>'
          }
          return '<p>We represent member companies employing 80,000 people across Europe.</p>'
        }
      }
    }
  })

  const result = await service.enrich({ website: 'https://lighting.example/en/home' })
  assert.equal(result.employeeCount, '3500')
  assert.equal(result.companySize, '1000-9999')
  assert.equal(result.address, 'Example Street 8, 10115 Berlin, Germany')
  assert.equal(result.phone, '+49 30 555 0100')
  assert.ok(visited.includes('https://lighting.example/en/contact'))
  assert.ok(visited.includes('https://lighting.example/en/about'))
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

  const yearSequenceService = createWebsiteContactEnrichmentService({
    maxPages: 1,
    resolveHost: resolvePublicTestHost,
    fetchImpl: async () => ({ ok: true, status: 200, async text() { return '<p>Milestones: 1989 2004 2011</p>' } })
  })
  const yearSequenceResult = await yearSequenceService.enrich({ website: 'https://years.example' })
  assert.equal(yearSequenceResult.phone, '')

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
        companySize: '200-999',
        companySizeSource: 'public_employee_count',
        employeeCount: '850',
        scaleSignals: ['Global footprint mentioned'],
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
  assert.equal(company.companySize, '200-999')
  assert.equal(company.dataQuality.hasCompanySize, true)
  assert.equal(company.dataQuality.hasScaleSignals, true)
  assert.equal(company.dataQuality.identityStatus, 'map_verified')
  assert.equal(company.dataQuality.needsReview, false)
  assert.ok(result.verificationCalls[0].candidate)
  assert.equal(result.enrichmentCalls[0].emailCount, 1)
})

test('company enrichment trusts a distinctive legal-name variant when Maps returns the same official domain', async () => {
  const service = createCompanyEnrichmentService({
    googleMapsSearchService: {
      async search() {
        return {
          results: [{
            title: 'Zumtobel Lighting GmbH',
            url: 'https://www.zumtobel.com/',
            address: 'Schweizer Str. 30, 6850 Dornbirn, Austria',
            phone: '+43 5572 3900',
            googlePlaceId: 'place-zumtobel',
            googleBusinessStatus: 'OPERATIONAL'
          }]
        }
      }
    }
  })

  const result = await service.enrichCompanies([buildCompanyResult({
    name: 'Zumtobel Group AG',
    website: 'https://www.zumtobel.com/com-en/index.html'
  })], { country: 'Europe', maxResults: 1 })
  assert.equal(result.companies[0].mapVerified, true)
  assert.equal(result.companies[0].address, 'Schweizer Str. 30, 6850 Dornbirn, Austria')
  assert.equal(result.companies[0].phone, '+43 5572 3900')
})

test('company enrichment rejects a non-European Maps branch for a European target and derives scale labels from public signals', async () => {
  const service = createCompanyEnrichmentService({
    googleMapsSearchService: {
      async search() {
        return {
          results: [{
            title: 'ams-OSRAM AG',
            url: 'https://ams-osram.com/',
            address: '7000 Ang Mo Kio Ave 5, Singapore 569877',
            phone: '+65 6551 0000',
            googlePlaceId: 'place-osram-singapore',
            googleBusinessStatus: 'OPERATIONAL'
          }]
        }
      }
    }
  })

  const result = await service.enrichCompanies([buildCompanyResult({
    name: 'ams-OSRAM AG',
    website: 'https://ams-osram.com/',
    employeeCount: '120',
    companySize: '50-199',
    companySizeSource: 'public_employee_count',
    scaleSignals: ['Global footprint mentioned', 'Operating facilities mentioned']
  })], { country: 'Spain Europe', maxResults: 1 })
  assert.equal(result.companies[0].mapVerified, false)
  assert.equal(result.companies[0].address, '')
  assert.equal(result.companies[0].phone, '')
  assert.equal(result.companies[0].companySize, 'International multi-site operator')
  assert.equal(result.companies[0].companySizeSource, 'public_scale_signals')
  assert.equal(result.companies[0].employeeCount, '')
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
  assert.equal(company.dataQuality.identityStatus, 'unverified')
  assert.equal(company.dataQuality.needsReview, true)
  assert.ok(result.verificationCalls[0].candidate)
})

test('official website evidence is usable even when Google Maps has no trusted match', async () => {
  const service = createCompanyEnrichmentService({
    googleMapsSearchService: { async search() { return { results: [] } } },
    websiteContactEnrichmentService: {
      async enrich() {
        return {
          status: 'no_public_email',
          contactEmails: [],
          emails: [],
          contactPages: [],
          phone: '',
          evidence: []
        }
      }
    }
  })

  const result = await service.enrichCompanies([buildCompanyResult({
    evidence: [{ type: 'public_web', sourceUrl: 'https://enphase.example' }]
  })], { country: 'United States', maxResults: 1 })
  const company = result.companies[0]
  assert.equal(company.mapVerified, false)
  assert.equal(company.dataQuality.identityStatus, 'official_website')
  assert.equal(company.dataQuality.mapStatus, 'not_found')
  assert.equal(company.dataQuality.needsReview, false)
  assert.deepEqual(company.dataQuality.missingFields.sort(), ['address', 'company_size', 'email', 'phone'])
})

test('company enrichment bounds concurrent provider work', async () => {
  let active = 0
  let maxActive = 0
  const service = createCompanyEnrichmentService({
    maxConcurrency: 3,
    googleMapsSearchService: {
      async search() {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 8))
        active -= 1
        return { results: [] }
      }
    }
  })
  const companies = Array.from({ length: 12 }, (_, index) => buildCompanyResult({
    id: `company-${index + 1}`,
    name: `Energy Company ${index + 1}`,
    website: `https://energy-${index + 1}.example`,
    evidence: [{ type: 'public_web', sourceUrl: `https://energy-${index + 1}.example` }]
  }))

  const result = await service.enrichCompanies(companies, { maxResults: companies.length })
  assert.equal(result.companies.length, 12)
  assert.ok(maxActive <= 3)
})

test('company enrichment returns an explicit not-attempted status when the request budget is exhausted', async () => {
  let providerCalls = 0
  const service = createCompanyEnrichmentService({
    googleMapsSearchService: { async search() { providerCalls += 1; return { results: [] } } },
    websiteContactEnrichmentService: { async enrich() { providerCalls += 1; return { status: 'completed' } } }
  })

  const result = await service.enrichCompanies([buildCompanyResult({
    evidence: [{ type: 'public_web', sourceUrl: 'https://enphase.example' }]
  })], {
    maxResults: 1,
    deadlineAt: Date.now() - 1,
    minimumRemainingMs: 1000
  })

  assert.equal(providerCalls, 0)
  assert.equal(result.budgetExhausted, true)
  assert.equal(result.companies[0].dataQuality.enrichmentStatus, 'not_attempted_budget')
})

test('company enrichment aborts a Maps request when its timeout expires', async () => {
  let aborted = false
  const service = createCompanyEnrichmentService({
    mapTimeoutMs: 20,
    googleMapsSearchService: {
      async search({ filters }) {
        return new Promise((resolve) => {
          filters.signal.addEventListener('abort', () => {
            aborted = true
            resolve({ results: [] })
          }, { once: true })
        })
      }
    }
  })

  const result = await service.enrichCompanies([buildCompanyResult()], { maxResults: 1 })
  assert.equal(aborted, true)
  assert.equal(result.verificationCalls[0].error, 'map_lookup_timeout')
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

test('search_web does not duplicate industry or country terms already present in the query', async () => {
  let receivedQuery = ''
  const [searchTool] = createLeadAITools({
    tavilyAdapter: {
      async search(config) {
        receivedQuery = config.query
        return []
      }
    },
    braveAdapter: { available: false, async search() { return [] } }
  })

  await searchTool.execute({
    query: 'solar inverter companies Germany official website',
    industry: 'solar inverter',
    country: 'Germany',
    provider: 'tavily'
  })

  assert.equal((receivedQuery.match(/solar inverter/gi) || []).length, 1)
  assert.equal((receivedQuery.match(/Germany/gi) || []).length, 1)
})

test('AI agent supports a lower per-task reasoning effort for fast candidate generation', async () => {
  const originalFetch = globalThis.fetch
  let requestBody
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return jsonResponse({ choices: [{ message: { content: '{"companies":[]}' }, finish_reason: 'stop' }] })
  }

  try {
    const agent = createAIAgent({
      apiHost: 'https://ai.example/v1',
      apiKey: 'test-key',
      model: 'test-model',
      reasoningEffort: 'max'
    })
    await agent.executeTask({ userInput: 'Generate candidates', reasoningEffort: 'low', maxIterations: 1 })
    assert.equal(requestBody.reasoning_effort, 'low')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('AI agent attaches collected tool evidence to a later HTTP failure', async () => {
  const originalFetch = globalThis.fetch
  let requestCount = 0
  globalThis.fetch = async () => {
    requestCount += 1
    if (requestCount === 1) {
      return jsonResponse({
        choices: [{
          message: {
            content: '',
            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_web', arguments: '{"query":"Acme"}' } }]
          },
          finish_reason: 'tool_calls'
        }]
      })
    }
    return jsonResponse({ error: 'upstream failed' }, 500)
  }

  try {
    const agent = createAIAgent({ apiHost: 'https://ai.example/v1', apiKey: 'test-key', model: 'test-model' })
    await assert.rejects(
      () => agent.executeTask({
        userInput: 'Research Acme',
        tools: [{ name: 'search_web', description: 'Search', parameters: {}, async execute() { return { ok: true, results: [{ title: 'Acme' }] } } }],
        maxIterations: 3
      }),
      (error) => error.code === 'ai_request_failed' && error.toolCalls?.length === 1
    )
  } finally {
    globalThis.fetch = originalFetch
  }
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

test('search_web retries the alternate provider when the configured provider returns no results', async () => {
  let braveCalls = 0
  const [searchTool] = createLeadAITools({
    tavilyAdapter: { available: true, async search() { return [] } },
    braveAdapter: {
      available: true,
      async search() {
        braveCalls += 1
        return [{ title: 'Runtime Fallback Buyer', url: 'https://runtime-fallback.example', snippet: 'Industrial OEM buyer', provider: 'brave' }]
      }
    },
    timeoutMs: 100
  })

  const result = await searchTool.execute({ query: 'industrial OEM buyers', provider: 'tavily', maxResults: 5 })
  assert.equal(result.ok, true)
  assert.equal(result.provider, 'brave')
  assert.equal(result.fallbackFrom, 'tavily')
  assert.equal(result.results.length, 1)
  assert.equal(braveCalls, 1)
  assert.deepEqual(result.attempts.map((attempt) => attempt.provider), ['tavily', 'brave'])
})

test('search_web gives fallback providers the actual remaining shared deadline and aborts timed-out requests', async () => {
  let aborted = false
  const delayedFallbackTool = createLeadAITools({
    tavilyAdapter: {
      available: true,
      async search() {
        await new Promise((resolve) => setTimeout(resolve, 70))
        return []
      }
    },
    braveAdapter: {
      available: true,
      async search() {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return [{ title: 'Remaining Budget Buyer', url: 'https://remaining-budget.example', snippet: 'Industrial OEM buyer' }]
      }
    },
    timeoutMs: 120
  })[0]
  const fallbackResult = await delayedFallbackTool.execute({ query: 'industrial OEM buyers', provider: 'tavily' })
  assert.equal(fallbackResult.ok, true)
  assert.equal(fallbackResult.provider, 'brave')

  const abortingTool = createLeadAITools({
    tavilyAdapter: {
      available: true,
      async search({ signal }) {
        return new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true
            resolve([])
          }, { once: true })
        })
      }
    },
    braveAdapter: { available: false, async search() { return [] } },
    timeoutMs: 30
  })[0]
  const timeoutResult = await abortingTool.execute({ query: 'slow search', provider: 'tavily' })
  assert.equal(timeoutResult.ok, false)
  assert.equal(aborted, true)
})

test('verify_company ranks the strongest Maps match first', async () => {
  const verifyTool = createLeadAITools({
    tavilyAdapter: { available: false },
    braveAdapter: { available: false },
    googleMapsAdapter: {
      async searchText() {
        return [
          { title: 'Unrelated Lighting Shop', url: '', address: 'Unknown' },
          { title: 'Acme Lighting', url: 'https://acme.example', address: 'Madrid, Spain', googleBusinessStatus: 'OPERATIONAL' }
        ]
      }
    }
  })[1]
  const result = await verifyTool.execute({ company_name: 'Acme Lighting', country: 'Spain' })
  assert.equal(result.verified, true)
  assert.equal(result.candidates[0].name, 'Acme Lighting')
})

test('search_web reports an incomplete provider failure instead of a successful empty result', async () => {
  const [searchTool] = createLeadAITools({
    tavilyAdapter: { available: true, async search() { return [] } },
    braveAdapter: { available: true, async search() { throw new Error('Brave unavailable') } },
    timeoutMs: 100
  })

  const result = await searchTool.execute({ query: 'industrial OEM buyers', provider: 'tavily', maxResults: 5 })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'provider_search_incomplete')
  assert.deepEqual(result.error.attempts.map((attempt) => [attempt.provider, attempt.ok]), [
    ['tavily', true],
    ['brave', false]
  ])
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

test('Lead Finder partial recovery uses the mode verification target and loads stored prompts', async () => {
  let renderedPrompt = ''
  const timeoutError = new Error('Lead Finder AI timed out')
  timeoutError.code = 'ai_request_timeout'
  timeoutError.toolCalls = [{
    name: 'search_web',
    arguments: { provider: 'brave', query: 'industrial energy buyers' },
    result: {
      ok: true,
      provider: 'brave',
      results: Array.from({ length: 20 }, (_, index) => ({
        title: `Deep Buyer ${index + 1}`,
        url: `https://deep-buyer-${index + 1}.example`,
        snippet: 'Industrial OEM buyer in the United States that procures equipment.'
      }))
    }
  }]
  const service = createLeadFinderService({
    requestBudgetMs: 240000,
    promptStorage: {
      async getPrompt(key) {
        assert.equal(key, 'lead-finder')
        return 'CUSTOM LEAD PROMPT: {{industry}} / {{country}}'
      }
    },
    aiAgent: {
      async executeTask(args) {
        renderedPrompt = args.systemPrompt
        throw timeoutError
      }
    }
  })

  const result = await service.discoverWorkspace({
    industry: 'industrial connectors',
    country: 'United States',
    mode: 'deep'
  })

  assert.equal(renderedPrompt, 'CUSTOM LEAD PROMPT: industrial connectors / United States')
  assert.equal(result.candidatePool.length, 20)
  assert.equal(result.shortlist.length, 10)
})

test('Lead Finder enriches every displayed company instead of only the verification prefix', async () => {
  let enrichmentMaxResults = 0
  let enrichmentDeadlineAt = 0
  const providerResults = Array.from({ length: 12 }, (_, index) => ({
    title: `Industrial Buyer ${index + 1}`,
    url: `https://industrial-buyer-${index + 1}.example/`,
    snippet: 'Industrial equipment OEM company in the United States that procures assemblies.'
  }))
  const service = createLeadFinderService({
    requestBudgetMs: 240000,
    aiAgent: {
      async executeTask() {
        return {
          parsedJson: { companies: [] },
          finalText: '{"companies":[]}',
          toolCalls: [buildProviderSearchCall(providerResults, 'brave', 'industrial OEM buyers United States')],
          status: 'completed',
          partial: false
        }
      }
    },
    companyEnrichmentService: {
      async enrichCompanies(companies, options) {
        enrichmentMaxResults = options.maxResults
        enrichmentDeadlineAt = options.deadlineAt
        return {
          companies: companies.map((company) => ({
            ...company,
            dataQuality: { identityStatus: 'official_website', enrichmentStatus: 'completed', needsReview: false }
          })),
          verificationCalls: [],
          enrichmentCalls: [],
          budgetExhausted: false
        }
      }
    }
  })

  const result = await service.discoverWorkspace({ industry: 'industrial connectors', country: 'United States', mode: 'standard' })
  assert.equal(result.workspace.companies.length, 12)
  assert.equal(enrichmentMaxResults, 12)
  assert.equal(enrichmentDeadlineAt > Date.now(), true)
  assert.equal(result.workspace.companies.every((company) => company.dataQuality.enrichmentStatus === 'completed'), true)
})

test('Lead Finder reports partial when enrichment exhausts the shared request budget', async () => {
  const service = createLeadFinderService({
    requestBudgetMs: 240000,
    aiAgent: {
      async executeTask() {
        return {
          parsedJson: { companies: [] },
          toolCalls: [buildProviderSearchCall([{
            title: 'Industrial Buyer',
            url: 'https://industrial-buyer.example/',
            snippet: 'Industrial equipment OEM company in the United States that procures assemblies.'
          }], 'brave', 'industrial buyer United States')],
          status: 'completed',
          partial: false
        }
      }
    },
    companyEnrichmentService: {
      async enrichCompanies(companies) {
        return { companies, verificationCalls: [], enrichmentCalls: [], budgetExhausted: true }
      }
    }
  })
  const result = await service.discoverWorkspace({ industry: 'industrial connectors', country: 'United States', mode: 'economy' })
  assert.equal(result.status, 'partial')
  assert.equal(result.workspace.status, 'partial')
  assert.equal(result.metadata.enrichmentBudgetExhausted, true)
  assert.equal(result.metadata.error.code, 'request_budget_exhausted')
})

test('Lead Finder rejects directories and articles even when their snippets contain buyer wording', async () => {
  const service = createLeadFinderService({
    aiAgent: {
      async executeTask() {
        return {
          parsedJson: { companies: [] },
          finalText: '{"companies":[]}',
          toolCalls: [buildProviderSearchCall([{
            title: 'Top 20 Industrial Buyers in Germany',
            url: 'https://directory.example/companies/industrial-buyers',
            snippet: 'A directory of OEM buyers that procure industrial equipment.'
          }], 'brave', 'industrial buyers Germany')],
          status: 'completed',
          partial: false
        }
      }
    }
  })

  const result = await service.discoverWorkspace({ industry: 'industrial connectors', country: 'Germany', mode: 'economy' })
  assert.equal(result.workspace.companies.length, 0)
  assert.equal(result.status, 'needs_review')
})

test('OSINT service loads the stored prompt when no explicit override is provided', async () => {
  let renderedPrompt = ''
  const service = createOsintService({
    persistResearchRun: false,
    promptStorage: {
      async getPrompt(key) {
        assert.equal(key, 'osint')
        return 'CUSTOM OSINT PROMPT: {{companyName}} / {{country}}'
      }
    },
    aiAgent: {
      async executeTask(args) {
        renderedPrompt = args.systemPrompt
        return {
          parsedJson: { evidence: [], report: {} },
          finalText: '{"evidence":[],"report":{}}',
          toolCalls: [],
          iterations: 1,
          status: 'completed',
          partial: false
        }
      }
    }
  })

  const result = await service.investigateCompany({ companyName: 'Signify', country: 'Netherlands', mode: 'economy' })
  assert.equal(renderedPrompt, 'CUSTOM OSINT PROMPT: Signify / Netherlands')
  assert.equal(result.researchRun.status, 'needs_review')
})

test('fallback OSINT service seeds recovered evidence and avoids repeating a successful provider call', async () => {
  let braveCalls = 0
  const service = createOsintResearchService({
    braveSearch: async () => {
      braveCalls += 1
      return []
    },
    providerAvailability: { googleMaps: false, brave: true, tavily: false }
  })
  const initialToolCalls = [buildProviderSearchCall([{
    title: 'Enphase Energy',
    url: 'https://enphase.com/',
    snippet: 'Official solar and energy storage company.'
  }], 'brave', 'Enphase Energy official website')]

  const result = await service.research({
    companyName: 'Enphase Energy',
    website: 'https://enphase.com',
    initialToolCalls,
    initialError: { code: 'ai_request_timeout', message: 'AI final report timed out' }
  })

  assert.equal(braveCalls, 0)
  assert.equal(result.status, 'partial')
  assert.equal(result.evidence.some((item) => item.sourceUrl === 'https://enphase.com/'), true)
  assert.equal(result.unresolvedQuestions.some((item) => item.includes('AI analysis ended early')), true)
})

test('fallback OSINT keeps an unverified recovered Maps candidate out of verified entity evidence', async () => {
  const service = createOsintResearchService({ providerAvailability: { googleMaps: true, brave: false, tavily: false } })
  const result = await service.research({
    companyName: 'Acme Lighting',
    initialToolCalls: [{
      name: 'verify_company',
      arguments: { company_name: 'Acme Lighting' },
      result: {
        ok: true,
        verified: false,
        confidence: 0.2,
        candidates: [{ name: 'Acme Lighting', address: 'Unknown branch', website: '' }]
      }
    }]
  })
  assert.equal(result.verification.mapsMatchStatus, 'unverified')
  assert.equal(result.verification.entityStatus, 'unverified')
  assert.equal(result.evidence.some((item) => item.trustTier === 'map-candidate'), true)
})

test('fallback OSINT trusts only the winning recovered Maps candidate', async () => {
  const service = createOsintResearchService({ providerAvailability: { googleMaps: true, brave: false, tavily: false } })
  const result = await service.research({
    companyName: 'Acme Lighting',
    initialToolCalls: [{
      name: 'verify_company',
      arguments: { company_name: 'Acme Lighting' },
      result: {
        ok: true,
        verified: true,
        confidence: 0.8,
        candidates: [
          { name: 'Acme Lighting', address: 'Madrid, Spain', website: 'https://acme.example', placeId: 'winner' },
          { name: 'Acme Lighting Outlet', address: 'Barcelona, Spain', website: 'https://outlet.example', placeId: 'secondary' }
        ]
      }
    }]
  })
  const mapEvidence = result.evidence.filter((item) => item.provider === 'google-maps')
  assert.equal(mapEvidence.filter((item) => item.trustTier === 'official-map').length, 1)
  assert.equal(mapEvidence.find((item) => item.placeId === 'secondary').trustTier, 'map-candidate')
})

test('OSINT direct Maps research ranks the exact subject first and only uses the winning phone', async () => {
  const service = createOsintResearchService({
    googleMapsSearch: async () => ({
      results: [
        { title: 'Acme Lighting Outlet', url: 'https://outlet.example', address: 'Barcelona, Spain', phone: '+34 111 111 111', placeId: 'outlet' },
        { title: 'Acme Lighting', url: 'https://acme.example', address: 'Madrid, Spain', phone: '+34 222 222 222', placeId: 'company' }
      ]
    }),
    providerAvailability: { googleMaps: true, brave: false, tavily: false }
  })
  const result = await service.research({ companyName: 'Acme Lighting', website: 'https://acme.example', country: 'Spain' })
  const mapEvidence = result.evidence.filter((item) => item.provider === 'google-maps')
  assert.equal(mapEvidence.find((item) => item.placeId === 'company').trustTier, 'official-map')
  assert.equal(mapEvidence.find((item) => item.placeId === 'outlet').trustTier, 'map-candidate')
  assert.deepEqual(result.publicContacts.map((item) => item.value), ['+34 222 222 222'])
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

test('OSINT timeout fallback receives already-collected tool evidence instead of starting over', async () => {
  let fallbackPayload
  const timeoutError = new Error('AI final report timed out')
  timeoutError.code = 'ai_request_timeout'
  timeoutError.toolCalls = [buildProviderSearchCall([{
    title: 'Enphase Energy',
    url: 'https://enphase.com/',
    snippet: 'Official solar and energy storage company.'
  }], 'brave', 'Enphase Energy official website')]

  const app = express()
  app.use(express.json())
  app.use('/api', createApiRouter({
    osintService: { async investigateCompany() { throw timeoutError } },
    fallbackOsintService: {
      async research(payload) {
        fallbackPayload = payload
        return {
          status: 'partial',
          subject: { companyName: payload.companyName, website: payload.website || '' },
          evidence: payload.initialToolCalls[0].result.results.map((item, index) => ({
            evidenceId: `recovered-${index + 1}`,
            provider: 'brave',
            sourceUrl: item.url,
            title: item.title,
            snippet: item.snippet
          })),
          providerAvailability: [{ provider: 'brave', available: true, resultCount: 1 }],
          providerResults: [],
          verification: { researchStatus: 'partial' },
          report: { overview: { canonicalName: payload.companyName }, publicContacts: [] },
          findings: [],
          publicContacts: [],
          riskFlags: [],
          unresolvedQuestions: [],
          researchCase: { evidenceRefs: ['recovered-1'] }
        }
      }
    },
    researchRunsStorage: { async save() {} },
    providerAvailability: { ai: { available: true, missingEnvVars: [] } },
    aiConfiguration: {}
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/osint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: 'Enphase Energy', website: 'https://enphase.com' })
    })
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(fallbackPayload.initialToolCalls.length, 1)
    assert.equal(fallbackPayload.initialError.code, 'ai_request_timeout')
    assert.equal(payload.researchRun.evidence.some((item) => item.sourceUrl === 'https://enphase.com/'), true)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
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

test('Google Maps exposes its provider result cap instead of silently truncating the request', async () => {
  let receivedMaxResults = 0
  const service = createGoogleMapsSearchService({
    googleMapsAdapter: {
      async searchText(_query, filters) {
        receivedMaxResults = filters.maxResults
        return []
      }
    }
  })

  const result = await service.search({ query: 'energy buyers', filters: { maxResults: 50 } })
  assert.equal(receivedMaxResults, 20)
  assert.deepEqual(result.resultPolicy, {
    requestedCount: 50,
    appliedMaxResults: 20,
    maxAllowed: 20,
    requestTruncated: true
  })
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

test('similar company generates more than thirty candidates, verifies them programmatically, and displays every qualified result', async () => {
  const aiCandidates = Array.from({ length: 36 }, (_, index) => ({
    companyName: `Energy Buyer ${index + 1}`,
    similarityScore: 90 - (index % 20),
    businessSimilarity: 34,
    marketSimilarity: 27,
    scaleSimilarity: 24,
    reason: 'Energy storage OEM buyer that procures and integrates industrial assemblies.'
  }))
  let executeArgs
  let searchCallCount = 0
  const searchTool = {
    name: 'search_web',
    availableProviders: ['tavily', 'brave'],
    async execute(args) {
      searchCallCount += 1
      const match = args.query.match(/^Energy Buyer (\d+)\b/)
      if (!match) {
        return { ok: true, provider: args.provider, query: args.query, results: [] }
      }
      const number = Number(match[1])
      const result = number <= 21
        ? {
            title: `Energy Buyer ${number} | Official Company`,
            url: `https://energy-buyer-${number}.example/`,
            snippet: 'Official energy storage OEM and system integrator company.',
            provider: args.provider
          }
        : {
            title: `Top Energy Buyer ${number} Companies`,
            url: `https://directory-${number}.example/companies/energy`,
            snippet: 'A ranked company directory.',
            provider: args.provider
          }
      return { ok: true, provider: args.provider, query: args.query, results: [result] }
    }
  }

  const service = createSimilarCompanyService({
    tools: [searchTool],
    requestBudgetMs: 240000,
    aiTimeoutMs: 120000,
    maxTokens: 3000,
    aiAgent: {
      async executeTask(args) {
        executeArgs = args
        return {
          finalText: JSON.stringify({ companies: aiCandidates }),
          parsedJson: { companies: aiCandidates },
          toolCalls: [],
          iterations: 1,
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

  assert.match(executeArgs.systemPrompt, /Candidate pool target: 36/)
  assert.equal(executeArgs.deadlineMs <= 240000 && executeArgs.deadlineMs > 239000, true)
  assert.equal(executeArgs.timeoutMs, 120000)
  assert.equal(executeArgs.reasoningEffort, 'low')
  assert.equal(executeArgs.maxIterations, 1)
  assert.deepEqual(executeArgs.tools, [])
  assert.equal(JSON.parse(executeArgs.userInput).candidatePoolTarget, 36)
  assert.equal(result.metadata.resultPolicy.requestedCount, 15)
  assert.equal(result.metadata.resultPolicy.candidatePoolTarget, 36)
  assert.equal(result.metadata.resultPolicy.displayLimit, 30)
  assert.equal(result.metadata.resultPolicy.displayedCount, 21)
  assert.equal(result.metadata.candidateGeneration.generatedCount, 36)
  assert.equal(result.metadata.candidateGeneration.verificationSearchCount, 36)
  assert.equal(searchCallCount, 51)
  assert.equal(result.results.length, 21)
  assert.equal(result.results.some((item) => item.company.title.includes('Top Energy')), false)
  assert.equal(result.metadata.searchCalls.every((call) => !/[\u4e00-\u9fff]/.test(call.query)), true)
})

test('similar company supplements a completed AI run and enriches every displayed company', async () => {
  let fallbackCallCount = 0
  let candidateVerificationCount = 0
  let enrichmentMaxResults = 0
  const searchTool = {
    name: 'search_web',
    availableProviders: ['brave'],
    async execute(args) {
      const isCandidateVerification = args.query.startsWith('Primary Energy Company ')
      if (isCandidateVerification) {
        candidateVerificationCount += 1
        assert.equal(args.maxResults, 8)
        return {
          ok: true,
          provider: 'brave',
          query: args.query,
          results: [{
            title: 'Primary Energy Company',
            url: 'https://primary-energy.example/',
            snippet: 'Official energy storage OEM that procures industrial assemblies.',
            provider: 'brave'
          }]
        }
      }
      fallbackCallCount += 1
      assert.equal(args.maxResults, 20)
      return {
        ok: true,
        provider: 'brave',
        query: args.query,
        results: [{
          title: `Fallback Energy ${fallbackCallCount}`,
          url: `https://fallback-energy-${fallbackCallCount}.example/`,
          snippet: 'Official energy storage OEM and system integrator that procures industrial assemblies.',
          provider: 'brave'
        }]
      }
    }
  }
  const service = createSimilarCompanyService({
    tools: [searchTool],
    aiAgent: {
      async executeTask() {
        return {
          finalText: JSON.stringify({ companies: [{
            companyName: 'Primary Energy Company',
            similarityScore: 85,
            reason: 'Official energy storage OEM that procures industrial assemblies.'
          }] }),
          parsedJson: { companies: [{
            companyName: 'Primary Energy Company',
            similarityScore: 85,
            reason: 'Official energy storage OEM that procures industrial assemblies.'
          }] },
          toolCalls: [],
          iterations: 1,
          status: 'completed',
          partial: false
        }
      }
    },
    companyEnrichmentService: {
      async enrichCompanies(companies, options) {
        enrichmentMaxResults = options.maxResults
        return {
          companies: companies.map((company) => ({
            ...company,
            companySize: '50-199',
            dataQuality: { identityStatus: 'official_website', mapStatus: 'not_found', needsReview: false }
          })),
          verificationCalls: companies.map((company) => ({ companyName: company.name, ok: true, verified: false })),
          enrichmentCalls: companies.map((company) => ({ companyName: company.name, status: 'no_public_email' }))
        }
      }
    }
  })

  const result = await service.findSimilarCompanies({
    name: 'Enphase Energy',
    website: 'https://enphase.com',
    industry: 'solar energy and storage',
    maxResults: 2
  })

  assert.equal(candidateVerificationCount, 1)
  assert.equal(fallbackCallCount, 4)
  assert.equal(result.results.length, 5)
  assert.equal(enrichmentMaxResults, 5)
  assert.equal(result.metadata.resultPolicy.enrichedCount, 5)
  assert.equal(result.results.every((item) => item.companySize === '50-199'), true)
  assert.equal(result.results.every((item) => item.dataQuality.needsReview === false), true)
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

test('similar company excludes a real but unrelated company when public evidence contradicts the target industry', async () => {
  const searchTool = {
    name: 'search_web',
    availableProviders: ['brave'],
    async execute(args) {
      if (args.query.startsWith('Real Pet Foods ')) {
        return {
          ok: true,
          provider: 'brave',
          query: args.query,
          results: [{
            title: 'Real Pet Foods',
            url: 'https://real-pet-foods.example/',
            snippet: 'Pet food company producing nutrition products for dogs and cats.'
          }]
        }
      }
      return { ok: true, provider: 'brave', query: args.query, results: [] }
    }
  }
  const service = createSimilarCompanyService({
    tools: [searchTool],
    aiAgent: {
      async executeTask() {
        return {
          parsedJson: { companies: [{
            companyName: 'Real Pet Foods',
            similarityScore: 95,
            reason: 'Claimed by AI to be a solar equipment buyer.'
          }] },
          finalText: '',
          toolCalls: [],
          status: 'completed',
          partial: false
        }
      }
    }
  })

  const result = await service.findSimilarCompanies({
    name: 'Solar Sample',
    industry: 'solar inverter and battery storage',
    country: 'Spain',
    maxResults: 5
  })
  assert.equal(result.results.length, 0)
  assert.equal(result.status, 'needs_review')
})

test('similar company removes directory pages and non-European entities while canonicalizing official identity pages', async () => {
  const searchTool = {
    name: 'search_web',
    availableProviders: ['brave'],
    async execute(args) {
      if (args.query.startsWith('Helvar Components Oy Ab ')) {
        return {
          ok: true,
          provider: 'brave',
          query: args.query,
          results: [{
            title: 'Our Story | Helvar Components Oy Ab',
            url: 'https://helvarcomponents.com/our-story',
            snippet: 'Our Finnish company manufactures professional lighting components in Finland.'
          }]
        }
      }
      if (args.query.startsWith('Company Listing ')) {
        return {
          ok: true,
          provider: 'brave',
          query: args.query,
          results: [{
            title: 'Company Listing',
            url: 'https://www.company-listing.org/spain/lighting/',
            snippet: 'A listing of lighting companies in Spain.'
          }]
        }
      }
      if (args.query.startsWith('Acuity Brands ')) {
        return {
          ok: true,
          provider: 'brave',
          query: args.query,
          results: [{
            title: 'Acuity Brands, Inc.',
            url: 'https://www.acuitybrands.com/',
            snippet: 'Our professional lighting company serves customers across Europe.'
          }]
        }
      }
      return { ok: true, provider: 'brave', query: args.query, results: [] }
    }
  }
  const service = createSimilarCompanyService({
    tools: [searchTool],
    aiAgent: {
      async executeTask() {
        return {
          parsedJson: {
            companies: [
              { companyName: 'Helvar Components Oy Ab', similarityScore: 92, reason: 'European lighting components manufacturer.' },
              { companyName: 'Company Listing', similarityScore: 90, reason: 'Lighting companies in Spain.' },
              { companyName: 'Acuity Brands', similarityScore: 88, reason: 'Professional lighting company.' }
            ]
          },
          toolCalls: [],
          status: 'completed'
        }
      }
    },
    companyEnrichmentService: {
      async enrichCompanies(companies) {
        return {
          companies: companies.map((company) => company.companyName === 'Acuity Brands, Inc.'
            ? { ...company, address: 'Atlanta, GA, United States' }
            : company),
          verificationCalls: [],
          enrichmentCalls: [],
          budgetExhausted: false
        }
      }
    }
  })

  const result = await service.findSimilarCompanies({
    name: 'Signify',
    industry: 'professional lighting and connected lighting systems',
    description: 'Find operating lighting manufacturers and technology companies with similar public profiles in Spain and Europe.',
    maxResults: 3
  })

  assert.deepEqual(result.results.map((item) => item.company.title), ['Helvar Components Oy Ab'])
  assert.equal(result.results[0].profile.website, 'https://helvarcomponents.com/')
  assert.equal(result.metadata.resultPolicy.geographyRejectedCount, 1)
})

test('similar company retries another provider when the first provider returns only a filtered third-party page', async () => {
  const calls = []
  const searchTool = {
    name: 'search_web',
    availableProviders: ['brave', 'tavily'],
    async execute(args) {
      calls.push(args.provider)
      if (args.provider === 'brave') {
        return {
          ok: true,
          provider: 'brave',
          results: [{
            title: 'Acme Lighting customer story',
            url: 'https://partner.example/customers/acme-lighting',
            snippet: 'We are a lighting technology company founded in 1990.'
          }]
        }
      }
      return {
        ok: true,
        provider: 'tavily',
        results: [{
          title: 'Acme Lighting GmbH',
          url: 'https://acme-lighting.example/',
          snippet: 'Official professional lighting manufacturer and connected lighting company.'
        }]
      }
    }
  }
  const service = createSimilarCompanyService({
    tools: [searchTool],
    aiAgent: {
      async executeTask() {
        return { parsedJson: { companies: [{ companyName: 'Acme Lighting GmbH', similarityScore: 90, reason: 'Professional lighting manufacturer.' }] }, toolCalls: [], status: 'completed' }
      }
    }
  })

  const result = await service.findSimilarCompanies({ name: 'Signify', industry: 'professional lighting', maxResults: 1 })
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0].profile.website, 'https://acme-lighting.example/')
  assert.deepEqual(calls.slice(0, 2), ['brave', 'tavily'])
})

test('similar company does not expose unverified AI size or headquarters as observed facts', async () => {
  const searchTool = {
    name: 'search_web',
    availableProviders: ['brave'],
    async execute(args) {
      if (args.query.startsWith('Verified Solar Systems ')) {
        return {
          ok: true,
          provider: 'brave',
          query: args.query,
          results: [{
            title: 'Verified Solar Systems',
            url: 'https://verified-solar.example/',
            snippet: 'Solar inverter and battery storage OEM company.'
          }]
        }
      }
      return { ok: true, provider: 'brave', query: args.query, results: [] }
    }
  }
  const service = createSimilarCompanyService({
    tools: [searchTool],
    aiAgent: {
      async executeTask() {
        return {
          parsedJson: { companies: [{
            companyName: 'Verified Solar Systems',
            similarityScore: 90,
            companySize: '10000+',
            headquarters: 'Invented City',
            products: ['Invented product'],
            reason: 'Solar inverter and battery storage OEM.'
          }] },
          finalText: '',
          toolCalls: [],
          status: 'completed',
          partial: false
        }
      }
    }
  })

  const result = await service.findSimilarCompanies({ name: 'Solar Sample', industry: 'solar inverter and battery storage', maxResults: 1 })
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0].companySize, '')
  assert.equal(result.results[0].headquarters, '')
  assert.deepEqual(result.results[0].products, [])
})

test('similar company exposes result truncation and returns partial when enrichment hits the request budget', async () => {
  const searchTool = {
    name: 'search_web',
    availableProviders: ['brave'],
    async execute(args) {
      if (args.query.startsWith('Budget Solar ')) {
        return {
          ok: true,
          provider: 'brave',
          query: args.query,
          results: [{
            title: 'Budget Solar',
            url: 'https://budget-solar.example/',
            snippet: 'Solar inverter and battery storage OEM company.'
          }]
        }
      }
      return { ok: true, provider: 'brave', query: args.query, results: [] }
    }
  }
  const service = createSimilarCompanyService({
    tools: [searchTool],
    aiAgent: {
      async executeTask() {
        return {
          parsedJson: { companies: [{ companyName: 'Budget Solar', similarityScore: 90, reason: 'Solar inverter and storage OEM.' }] },
          finalText: '',
          toolCalls: [],
          status: 'completed',
          partial: false
        }
      }
    },
    companyEnrichmentService: {
      async enrichCompanies(companies) {
        return { companies, verificationCalls: [], enrichmentCalls: [], budgetExhausted: true }
      }
    }
  })

  const result = await service.findSimilarCompanies({ name: 'Solar Sample', industry: 'solar inverter and battery storage', maxResults: 50 })
  assert.equal(result.metadata.resultPolicy.requestedInputCount, 50)
  assert.equal(result.metadata.resultPolicy.maxAllowedResults, 30)
  assert.equal(result.metadata.resultPolicy.requestTruncated, true)
  assert.equal(result.status, 'partial')
  assert.equal(result.error.code, 'request_budget_exhausted')
})

test('similar company loads a stored candidate prompt and appends the verification-stage contract', async () => {
  let renderedPrompt = ''
  const service = createSimilarCompanyService({
    promptStorage: {
      async getPrompt(key) {
        assert.equal(key, 'similar-company')
        return 'CUSTOM SIMILAR PROMPT: {{companyName}} / {{candidatePoolTarget}}'
      }
    },
    aiAgent: {
      async executeTask(args) {
        renderedPrompt = args.systemPrompt
        return {
          parsedJson: { companies: [] },
          finalText: '{"companies":[]}',
          toolCalls: [],
          iterations: 1,
          status: 'completed',
          partial: false
        }
      }
    }
  })

  await service.findSimilarCompanies({ name: 'Signify', maxResults: 15 })
  assert.match(renderedPrompt, /^CUSTOM SIMILAR PROMPT: Signify \/ 36/)
  assert.match(renderedPrompt, /Search and identity verification will be performed programmatically/)
})

test('similar company does not use a name-only Maps match as proof of market relevance', async () => {
  const service = createSimilarCompanyService({
    aiAgent: {
      async executeTask() {
        return {
          parsedJson: {
            companies: [
              { companyName: 'Verified Solar One', website: 'https://untrusted-one.example', similarityScore: 90, reason: 'Solar OEM buyer' },
              { companyName: 'Verified Solar Two', website: 'https://untrusted-two.example', similarityScore: 85, reason: 'Energy storage integrator' },
              { companyName: 'Unverified Solar Three', website: 'https://untrusted-three.example', similarityScore: 80, reason: 'Industrial lighting buyer' }
            ]
          },
          toolCalls: [],
          status: 'completed',
          partial: false
        }
      }
    },
    companyEnrichmentService: {
      async enrichCompanies(companies) {
        return {
          companies: companies.map((company) => {
            const verified = company.name.startsWith('Verified')
            return {
              ...company,
              website: verified ? `https://${company.name.toLowerCase().replace(/\s+/g, '-')}.example` : '',
              mapVerified: verified,
              dataQuality: {
                identityStatus: verified ? 'map_verified' : 'unverified',
                mapStatus: verified ? 'verified' : 'not_found',
                needsReview: !verified
              }
            }
          }),
          verificationCalls: [],
          enrichmentCalls: []
        }
      }
    }
  })

  const result = await service.findSimilarCompanies({ name: 'Signify', maxResults: 3 })
  assert.equal(result.results.length, 0)
  assert.equal(result.status, 'needs_review')
  assert.equal(result.metadata.grounding.provisionalAiCount, 3)
  assert.equal(result.metadata.grounding.verifiedProvisionalCount, 0)
  assert.equal(result.metadata.resultPolicy.provisionalVerifiedCount, 0)
})

test('similar company does not report completed when no qualified result exists', async () => {
  const service = createSimilarCompanyService({
    aiAgent: {
      async executeTask() {
        return {
          finalText: JSON.stringify({ companies: [] }),
          parsedJson: { companies: [] },
          toolCalls: [],
          status: 'completed',
          partial: false
        }
      }
    }
  })

  const result = await service.findSimilarCompanies({ name: 'Enphase Energy', maxResults: 5 })
  assert.equal(result.status, 'needs_review')
  assert.equal(result.results.length, 0)
  assert.equal(result.error.code, 'no_qualified_results')
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
