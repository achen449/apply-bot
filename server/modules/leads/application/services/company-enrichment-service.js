function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalize(value) {
  return hasText(value) ? value.trim().toLowerCase() : ''
}

function unique(values = []) {
  return [...new Set(values.filter(hasText).map((value) => value.trim()))]
}

function normalizeCountry(value) {
  const country = normalize(value)
  if (country === 'us' || country === 'usa' || country === 'u.s.' || country === 'u.s.a.') {
    return 'united states'
  }
  return country
}

function countryMatchesAddress(country, address) {
  const normalizedCountry = normalizeCountry(country)
  const normalizedAddress = normalize(address)

  if (!normalizedCountry || !normalizedAddress) {
    return true
  }

  const countryTokens = {
    'united states': ['usa', 'united states', 'u.s.a.', 'united states of america'],
    canada: ['canada'],
    mexico: ['mexico'],
    germany: ['germany', 'deutschland'],
    france: ['france'],
    italy: ['italy', 'italia'],
    spain: ['spain', 'españa'],
    netherlands: ['netherlands', 'the netherlands'],
    australia: ['australia'],
    'united kingdom': ['united kingdom', 'uk', 'england', 'scotland', 'wales']
  }

  const expectedTokens = countryTokens[normalizedCountry]
  const knownOtherCountries = Object.entries(countryTokens)
    .filter(([key]) => key !== normalizedCountry)
    .flatMap(([, tokens]) => tokens)

  if (expectedTokens?.some((token) => normalizedAddress.includes(token))) {
    return true
  }

  if (knownOtherCountries.some((token) => normalizedAddress.includes(token))) {
    return false
  }

  if (normalizedCountry === 'united states') {
    return /,\s*(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\s+\d{5}/i.test(address)
  }

  return true
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
  const genericTokens = new Set(['solar', 'energy', 'power', 'systems', 'system', 'connector', 'connectors', 'technology', 'technologies', 'solutions', 'global', 'industrial', 'electric', 'equipment', 'group'])
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
  const overlap = [...expectedTokens].filter((token) => actualTokens.has(token)).length
  const ratio = overlap / Math.max(expectedTokens.size, actualTokens.size)
  return { exact: false, strong: ratio >= 0.75 && overlap >= 2 }
}

function isTrustedMapMatch(company, candidate, country = '') {
  const companyName = company.name || company.companyName
  const candidateName = candidate.title || candidate.name
  const nameMatch = mapNameMatches(companyName, candidateName)
  if (!nameMatch.strong) {
    return false
  }

  const companyAddress = normalize(company.address)
  const candidateAddress = normalize(candidate.address || candidate.snippet)
  const addressMatches = Boolean(companyAddress && candidateAddress && (candidateAddress.includes(companyAddress) || companyAddress.includes(candidateAddress)))
  const companyHost = websiteHost(company.website)
  const candidateHost = websiteHost(candidate.url || candidate.website)
  const websiteMatches = Boolean(companyHost && candidateHost && companyHost === candidateHost)
  const countryMatches = Boolean(country && candidateAddress && countryMatchesAddress(country, candidateAddress))

  if (addressMatches || websiteMatches) {
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
  }

  if (companyAddress && candidateAddress && (candidateAddress.includes(companyAddress) || companyAddress.includes(candidateAddress))) {
    score += 0.25
  }

  if (companyHost && candidateHost && companyHost === candidateHost) {
    score += 0.25
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
  let timer
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
  })

  try {
    return await Promise.race([operation(), timeoutPromise])
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

export function createCompanyEnrichmentService({
  googleMapsSearchService,
  websiteContactEnrichmentService,
  mapTimeoutMs = 8000
} = {}) {
  return {
    async enrichCompanies(companies = [], { country = '', maxResults = 5, existingVerificationCalls = [] } = {}) {
      const normalizedCompanies = Array.isArray(companies) ? companies : []
      const selectedIds = new Set(normalizedCompanies.slice(0, Math.max(0, Number(maxResults) || 5)).map((company) => company.id || company.name || company.companyName))
      const verificationCalls = []
      const enrichmentCalls = []

      const enrichedSelected = await Promise.all(normalizedCompanies.map(async (company) => {
        const companyName = company.name || company.companyName || ''
        const companyKey = company.id || companyName
        if (!selectedIds.has(companyKey)) {
          return company
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

        if (!mapResult.candidate && googleMapsSearchService && typeof googleMapsSearchService.search === 'function' && hasText(companyName)) {
          const queryLocation = company.address || country

          try {
            const response = await withTimeout(
              () => googleMapsSearchService.search({
                query: companyName,
                location: queryLocation,
                filters: { maxResults: 5, requireOperational: false }
              }),
              Math.max(1000, Number(mapTimeoutMs) || 8000)
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
        } else {
          mapResult.error = 'google_maps_unavailable'
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

        if (websiteContactEnrichmentService && typeof websiteContactEnrichmentService.enrich === 'function' && hasText(next.website)) {
          const contact = await websiteContactEnrichmentService.enrich({ website: next.website })
          next.emails = contact.emails || []
          next.contactEmails = contact.contactEmails || []
          next.contactPages = contact.contactPages || []
          next.contactEmailStatus = contact.status
          next.phone = next.phone || contact.phone || ''
          next.evidence = mergeUniqueEvidence(next.evidence, contact.evidence || [])

          enrichmentCalls.push({
            companyName,
            website: next.website,
            status: contact.status,
            emailCount: (contact.emails || []).length,
            contactPages: contact.contactPages || [],
            calls: contact.calls || []
          })
        }

        next.dataQuality = {
          hasOfficialWebsite: Boolean(next.website),
          hasMapEvidence: Boolean(mapCandidate),
          hasPublicPhone: Boolean(next.phone),
          hasPublicEmail: Boolean(next.contactEmails?.length),
          needsReview: !mapResult.verified || !next.website || (!next.phone && !next.contactEmails?.length)
        }

        return next
      }))

      return {
        companies: enrichedSelected,
        verificationCalls,
        enrichmentCalls
      }
    }
  }
}
