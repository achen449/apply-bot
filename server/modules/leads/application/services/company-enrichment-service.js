import { matchesTargetCountry } from '../../shared/company-result-normalizer.js'

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalize(value) {
  return hasText(value) ? value.trim().toLowerCase() : ''
}

function unique(values = []) {
  return [...new Set(values.filter(hasText).map((value) => value.trim()))]
}

function inferPublicScaleLabel(company = {}) {
  if (hasText(company.companySize)) {
    return { companySize: company.companySize, companySizeSource: company.companySizeSource || '' }
  }

  const signals = (company.scaleSignals || []).join(' ').toLowerCase()
  if (signals.includes('public or listed-company')) {
    return { companySize: 'Large / public company signal', companySizeSource: 'public_scale_signals' }
  }
  if (signals.includes('global footprint') && signals.includes('operating facilities')) {
    return { companySize: 'International multi-site operator', companySizeSource: 'public_scale_signals' }
  }
  if (signals.includes('global footprint')) {
    return { companySize: 'International operations signal', companySizeSource: 'public_scale_signals' }
  }
  if (signals.includes('operating facilities')) {
    return { companySize: 'Operating-facility scale signal', companySizeSource: 'public_scale_signals' }
  }
  return { companySize: '', companySizeSource: '' }
}

function removeContradictoryEmployeeFact(company = {}) {
  const exactCount = Number.parseInt(company.employeeCount, 10) || 0
  const rangeValues = String(company.employeeRange || '').match(/\d+/g) || []
  const upperBound = exactCount || Number.parseInt(rangeValues.at(-1), 10) || 0
  const signals = (company.scaleSignals || []).join(' ').toLowerCase()
  const strongLargeCompanySignal = signals.includes('public or listed-company')
    || (signals.includes('global footprint') && signals.includes('operating facilities'))

  if (!upperBound || upperBound >= 200 || !strongLargeCompanySignal) {
    return company
  }

  return {
    ...company,
    employeeCount: '',
    employeeRange: '',
    companySize: '',
    companySizeSource: ''
  }
}

function hasDeadlineBudget(deadlineAt, minimumRemainingMs = 1000) {
  return !deadlineAt || Date.now() + Math.max(0, Number(minimumRemainingMs) || 0) < deadlineAt
}

function countryMatchesAddress(country, address) {
  return matchesTargetCountry(country, address)
}

function websiteHost(value) {
  if (!hasText(value)) {
    return ''
  }

  try {
    return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function normalizedCompanyName(value) {
  return normalize(value)
    .replace(/\b(incorporated|inc|corporation|corp|limited|ltd|llc|gmbh|ag|bv|plc|company|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isGenericCompanyName(value) {
  const tokens = normalizedCompanyName(value).split(' ').filter(Boolean)
  const genericTokens = new Set([
    'solar', 'energy', 'power', 'systems', 'system', 'connector', 'connectors', 'technology', 'technologies',
    'solutions', 'solution', 'global', 'industrial', 'electric', 'electrical', 'equipment', 'group', 'company',
    'manufacturer', 'manufacturers', 'lighting', 'light', 'lights', 'led', 'street', 'commercial', 'outdoor',
    'renewable', 'installation', 'contractor', 'professional', 'home', 'storage', 'battery', 'supplier'
  ])
  return tokens.length === 0 || tokens.length === 1 || tokens.every((token) => genericTokens.has(token))
}

function mapNameMatches(companyName, candidateName) {
  const expected = normalizedCompanyName(companyName)
  const actual = normalizedCompanyName(candidateName)
  if (!expected || !actual) {
    return { exact: false, strong: false }
  }

  if (expected === actual) {
    return { exact: true, strong: true }
  }

  const expectedTokens = new Set(expected.split(' ').filter(Boolean))
  const actualTokens = new Set(actual.split(' ').filter(Boolean))
  const overlappingTokens = [...expectedTokens].filter((token) => actualTokens.has(token))
  const overlap = overlappingTokens.length
  const ratio = overlap / Math.max(expectedTokens.size, actualTokens.size)
  const genericTokens = new Set(['energy', 'power', 'solar', 'lighting', 'light', 'systems', 'solutions', 'technology', 'technologies', 'international', 'global', 'group'])
  const distinctive = overlappingTokens.some((token) => token.length >= 5 && !genericTokens.has(token))
  return { exact: false, strong: ratio >= 0.75 && overlap >= 2, distinctive }
}

function isTrustedMapMatch(company, candidate, country = '') {
  const companyName = company.name || company.companyName
  const candidateName = candidate.title || candidate.name
  const nameMatch = mapNameMatches(companyName, candidateName)
  if (!nameMatch.strong && !nameMatch.distinctive) {
    return false
  }

  const companyAddress = normalize(company.address)
  const candidateAddress = normalize(candidate.address || candidate.snippet)
  const addressMatches = Boolean(companyAddress && candidateAddress && (candidateAddress.includes(companyAddress) || companyAddress.includes(candidateAddress)))
  const companyHost = websiteHost(company.website)
  const candidateHost = websiteHost(candidate.url || candidate.website)
  const websiteMatches = Boolean(companyHost && candidateHost && companyHost === candidateHost)
  const countryMatches = Boolean(country && candidateAddress && countryMatchesAddress(country, candidateAddress))

  if (websiteMatches && (nameMatch.strong || nameMatch.distinctive || nameMatch.exact)) {
    return true
  }

  if (addressMatches && (nameMatch.strong || nameMatch.exact)) {
    return true
  }

  return Boolean(nameMatch.exact && !isGenericCompanyName(companyName) && (countryMatches || (!companyAddress && !companyHost)))
}

function mapSourceUrl(placeId) {
  return placeId
    ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`
    : ''
}

function scoreMapCandidate(company, candidate, country = '') {
  const companyName = normalize(company.name || company.companyName)
  const candidateName = normalize(candidate.title || candidate.name)
  const companyAddress = normalize(company.address)
  const candidateAddress = normalize(candidate.address || candidate.snippet)
  const companyHost = websiteHost(company.website)
  const candidateHost = websiteHost(candidate.url || candidate.website)
  const nameMatch = mapNameMatches(companyName, candidateName)
  let score = 0

  if (nameMatch.exact) {
    score += 0.55
  } else if (nameMatch.strong) {
    score += 0.4
  } else if (nameMatch.distinctive) {
    score += 0.15
  }

  if (companyAddress && candidateAddress && (candidateAddress.includes(companyAddress) || companyAddress.includes(candidateAddress))) {
    score += 0.25
  }

  if (companyHost && candidateHost && companyHost === candidateHost) {
    score += 0.5
  }

  if (country && candidateAddress && countryMatchesAddress(country, candidateAddress)) {
    score += 0.1
  }

  if ((candidate.googleBusinessStatus || candidate.metadata?.googleBusinessStatus) === 'OPERATIONAL') {
    score += 0.05
  }

  return Math.min(Number(score.toFixed(2)), 1)
}

async function withTimeout(operation, timeoutMs) {
  const controller = new AbortController()
  let timer
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ timedOut: true })
    }, timeoutMs)
  })

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise])
  } finally {
    clearTimeout(timer)
  }
}

function mergeUniqueEvidence(existing = [], additions = []) {
  const next = [...existing, ...additions]
  const seen = new Set()

  return next.filter((item) => {
    const key = JSON.stringify({
      type: item.type || item.sourceType || '',
      sourceUrl: item.sourceUrl || '',
      value: item.value || item.snippet || ''
    })
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

async function mapWithConcurrency(items = [], limit = 5, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(Number(limit) || 5, items.length || 1))

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  }))

  return results
}

export function createCompanyEnrichmentService({
  googleMapsSearchService,
  websiteContactEnrichmentService,
  mapTimeoutMs = 8000,
  maxConcurrency = 5
} = {}) {
  return {
    async enrichCompanies(companies = [], {
      country = '',
      maxResults = 5,
      existingVerificationCalls = [],
      deadlineAt = 0,
      minimumRemainingMs = 1000
    } = {}) {
      const normalizedCompanies = Array.isArray(companies) ? companies : []
      const selectedIds = new Set(normalizedCompanies.slice(0, Math.max(0, Number(maxResults) || 5)).map((company) => company.id || company.name || company.companyName))
      const verificationCalls = []
      const enrichmentCalls = []
      let budgetExhausted = false

      const enrichedSelected = await mapWithConcurrency(normalizedCompanies, maxConcurrency, async (company) => {
        const companyName = company.name || company.companyName || ''
        const companyKey = company.id || companyName
        if (!selectedIds.has(companyKey)) {
          return {
            ...company,
            dataQuality: {
              ...(company.dataQuality || {}),
              enrichmentStatus: 'not_attempted_policy'
            }
          }
        }

        if (!hasDeadlineBudget(deadlineAt, minimumRemainingMs)) {
          budgetExhausted = true
          return {
            ...company,
            dataQuality: {
              ...(company.dataQuality || {}),
              enrichmentStatus: 'not_attempted_budget',
              needsReview: !company.identityGrounded && !company.mapVerified
            }
          }
        }

        let mapResult = {
          ok: false,
          verified: false,
          confidence: 0,
          candidate: null,
          candidates: [],
          error: null
        }

        const previousVerification = (Array.isArray(existingVerificationCalls) ? existingVerificationCalls : [])
          .find((call) => {
            const previousName = normalize(call.companyName)
            const currentName = normalize(companyName)
            return previousName && currentName && (
              previousName === currentName
              || previousName.includes(currentName)
              || currentName.includes(previousName)
            )
          })

        if (previousVerification && (previousVerification.candidate || previousVerification.candidates?.length)) {
          const previousCandidate = previousVerification.candidate || previousVerification.candidates[0]
          mapResult = {
            ok: previousVerification.ok !== false,
            verified: Boolean(previousVerification.verified),
            confidence: Number(previousVerification.confidence || previousCandidate?.confidence || 0),
            candidate: previousCandidate,
            candidates: previousVerification.candidates || [previousCandidate],
            error: previousVerification.error?.message || previousVerification.error || null
          }
        }

        const canAttemptMap = hasDeadlineBudget(deadlineAt, minimumRemainingMs)
        if (!mapResult.candidate
          && canAttemptMap
          && googleMapsSearchService
          && typeof googleMapsSearchService.search === 'function'
          && hasText(companyName)) {
          const queryLocation = company.address || country

          try {
            const remainingMapBudgetMs = deadlineAt > 0
              ? Math.max(1, deadlineAt - Date.now() - 100)
              : Number.POSITIVE_INFINITY
            const effectiveMapTimeoutMs = Math.max(1, Math.min(
              Math.max(1000, Number(mapTimeoutMs) || 8000),
              remainingMapBudgetMs
            ))
            const response = await withTimeout(
              (signal) => googleMapsSearchService.search({
                query: companyName,
                location: queryLocation,
                filters: { maxResults: 5, requireOperational: false, signal }
              }),
              effectiveMapTimeoutMs
            )

            if (response?.timedOut) {
              mapResult.error = 'map_lookup_timeout'
            } else {
              const candidates = (response?.results || [])
                .filter((candidate) => countryMatchesAddress(country, candidate.address || candidate.snippet))
                .map((candidate) => ({
                  ...candidate,
                  confidence: scoreMapCandidate(company, candidate, country)
                }))
                .sort((left, right) => right.confidence - left.confidence)

              mapResult = {
                ok: true,
                verified: Boolean(candidates[0] && candidates[0].confidence >= 0.6 && isTrustedMapMatch(company, candidates[0], country)),
                confidence: candidates[0]?.confidence || 0,
                candidate: candidates[0] || null,
                candidates,
                error: null
              }
            }
          } catch (error) {
            mapResult.error = error?.message || 'map_lookup_failed'
          }
          if (!hasDeadlineBudget(deadlineAt, 0)) {
            budgetExhausted = true
          }
        } else if (!mapResult.candidate) {
          if (!canAttemptMap) {
            budgetExhausted = true
            mapResult.error = 'not_attempted_budget'
          } else {
            mapResult.error = 'google_maps_unavailable'
          }
        }

        const mapCandidate = mapResult.candidate
        const trustedMapCandidate = mapResult.verified ? mapCandidate : null
        const placeId = mapCandidate?.googlePlaceId || mapCandidate?.placeId || mapCandidate?.metadata?.googlePlaceId || ''
        const mapEvidence = mapCandidate
          ? [{
              type: 'google_maps',
              sourceUrl: mapSourceUrl(placeId),
              title: mapCandidate.title || mapCandidate.name || companyName,
              snippet: mapCandidate.address || mapCandidate.snippet || '',
              confidence: mapResult.confidence,
              observedAt: new Date().toISOString()
            }]
          : []

        verificationCalls.push({
          companyName,
          address: company.address || '',
          ok: mapResult.ok,
          verified: mapResult.verified,
          confidence: mapResult.confidence,
          candidate: mapCandidate
            ? {
                name: mapCandidate.title || mapCandidate.name || '',
                address: mapCandidate.address || mapCandidate.snippet || '',
                phone: mapCandidate.phone || '',
                website: mapCandidate.url || mapCandidate.website || '',
                placeId,
                sourceUrl: mapSourceUrl(placeId)
              }
            : null,
          error: mapResult.error
        })

        const next = {
          ...company,
          name: companyName,
          companyName: company.companyName || companyName,
          address: company.address || trustedMapCandidate?.address || trustedMapCandidate?.snippet || '',
          phone: company.phone || trustedMapCandidate?.phone || '',
          website: company.website || trustedMapCandidate?.url || trustedMapCandidate?.website || '',
          mapVerified: mapResult.verified,
          map: {
            verified: mapResult.verified,
            placeId,
            confidence: mapResult.confidence,
            sourceUrl: mapSourceUrl(placeId),
            businessStatus: mapCandidate?.googleBusinessStatus || mapCandidate?.metadata?.googleBusinessStatus || 'UNKNOWN'
          },
          matchedProviders: unique([...(company.matchedProviders || []), ...(mapCandidate ? ['google-maps'] : [])]),
          evidence: mergeUniqueEvidence(company.evidence || [], mapEvidence)
        }

        if (websiteContactEnrichmentService
          && typeof websiteContactEnrichmentService.enrich === 'function'
          && hasText(next.website)
          && hasDeadlineBudget(deadlineAt, minimumRemainingMs)) {
          let contact
          try {
            contact = await websiteContactEnrichmentService.enrich({ website: next.website })
          } catch (error) {
            contact = {
              status: 'enrichment_failed',
              contactEmails: [],
              emails: [],
              contactPages: [],
              phone: '',
              evidence: [],
              error: error?.message || 'website_enrichment_failed'
            }
          }
          if (!hasDeadlineBudget(deadlineAt, 0)) {
            budgetExhausted = true
          }
          next.emails = contact.emails || []
          next.contactEmails = contact.contactEmails || []
          next.contactPages = contact.contactPages || []
          next.contactEmailStatus = contact.status
          if (contact.companyName && (isGenericCompanyName(companyName) || companyName.length > 80)) {
            next.name = contact.companyName
            next.companyName = contact.companyName
          }
          next.phone = next.phone || contact.phone || ''
          next.address = next.address || contact.address || ''
          next.headquarters = company.headquarters || contact.headquarters || ''
          next.employeeCount = company.employeeCount || contact.employeeCount || ''
          next.employeeRange = company.employeeRange || contact.employeeRange || ''
          next.companySize = company.companySize || contact.companySize || ''
          next.companySizeSource = company.companySizeSource || contact.companySizeSource || ''
          next.scaleSignals = unique([...(company.scaleSignals || []), ...(contact.scaleSignals || [])])
          next.evidence = mergeUniqueEvidence(next.evidence, contact.evidence || [])

          enrichmentCalls.push({
            companyName,
            website: next.website,
            status: contact.status,
            emailCount: (contact.emails || []).length,
            contactPages: contact.contactPages || [],
            calls: contact.calls || [],
            error: contact.error || null
          })
        } else if (websiteContactEnrichmentService && hasText(next.website) && !hasDeadlineBudget(deadlineAt, minimumRemainingMs)) {
          budgetExhausted = true
          next.contactEmailStatus = 'not_attempted_budget'
          enrichmentCalls.push({
            companyName,
            website: next.website,
            status: 'not_attempted_budget',
            emailCount: 0,
            contactPages: [],
            calls: [],
            error: null
          })
        }

        Object.assign(next, removeContradictoryEmployeeFact(next))
        const publicScale = inferPublicScaleLabel(next)
        next.companySize = publicScale.companySize
        next.companySizeSource = publicScale.companySizeSource

        const hasOfficialWebsite = Boolean(next.website)
        const hasPublicIdentityEvidence = hasOfficialWebsite && (next.evidence || []).some((item) => [
          'public_web',
          'official_website',
          'public_address',
          'public_phone',
          'public_email'
        ].includes(item.type || item.sourceType))
        const identityStatus = mapResult.verified
          ? 'map_verified'
          : hasPublicIdentityEvidence
            ? 'official_website'
            : 'unverified'
        const mapStatus = mapResult.verified
          ? 'verified'
          : mapCandidate
            ? 'candidate_found'
            : mapResult.ok
              ? 'not_found'
              : 'unavailable'

        next.dataQuality = {
          hasOfficialWebsite,
          hasMapEvidence: Boolean(mapCandidate),
          hasPublicPhone: Boolean(next.phone),
          hasPublicEmail: Boolean(next.contactEmails?.length),
          hasCompanySize: Boolean(next.companySize),
          hasScaleSignals: Boolean(next.scaleSignals?.length),
          enrichmentStatus: next.contactEmailStatus === 'not_attempted_budget' ? 'partial_budget' : 'completed',
          identityStatus,
          mapStatus,
          contactStatus: next.phone || next.contactEmails?.length
            ? 'available'
            : ['unavailable', 'enrichment_failed'].includes(next.contactEmailStatus)
              ? 'unavailable'
              : 'not_found',
          missingFields: [
            !next.address ? 'address' : '',
            !next.phone ? 'phone' : '',
            !next.contactEmails?.length ? 'email' : '',
            !next.companySize ? 'company_size' : ''
          ].filter(Boolean),
          needsReview: identityStatus === 'unverified'
        }

        return next
      })

      return {
        companies: enrichedSelected,
        verificationCalls,
        enrichmentCalls,
        budgetExhausted
      }
    }
  }
}
