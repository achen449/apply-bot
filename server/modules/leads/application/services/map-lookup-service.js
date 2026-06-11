function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function scoreCompanyAddressMatch(place, companyName, address) {
  const name = normalizeText(place.title).toLowerCase()
  const placeAddress = normalizeText(place.address || place.snippet).toLowerCase()
  const expectedName = normalizeText(companyName).toLowerCase()
  const expectedAddress = normalizeText(address).toLowerCase()
  let score = 0

  if (expectedName && name.includes(expectedName)) score += 45
  if (expectedAddress && placeAddress.includes(expectedAddress.slice(0, 24))) score += 35
  if (place.url) score += 10
  if (place.phone) score += 5
  if ((place.googleBusinessStatus || place.metadata?.googleBusinessStatus) === 'OPERATIONAL') score += 5

  return Math.min(100, score)
}

function guessLocationRole(place) {
  const text = `${place.title || ''} ${place.snippet || ''} ${(place.googleTypes || place.metadata?.googleTypes || []).join(' ')}`.toLowerCase()
  if (text.includes('headquarters') || text.includes('corporate office')) return 'hq_or_office'
  if (text.includes('factory') || text.includes('manufactur')) return 'factory'
  if (text.includes('warehouse') || text.includes('logistics')) return 'warehouse'
  if (text.includes('store') || text.includes('retail')) return 'store'
  if (text.includes('office')) return 'office'
  return 'unknown'
}

function classifyAddressType(places) {
  const types = places.flatMap((place) => place.googleTypes || place.metadata?.googleTypes || [])
  const text = types.join(' ').toLowerCase()
  if (text.includes('street_address') && !places.length) return 'unknown'
  if (text.includes('real_estate') || text.includes('lodging')) return 'mixed'
  if (text.includes('establishment') || text.includes('point_of_interest') || text.includes('store')) return 'commercial'
  return places.length ? 'commercial_or_mixed' : 'unknown'
}

function mapPlace(place) {
  return {
    name: place.title || '',
    website: place.url || '',
    formattedAddress: place.address || place.snippet || '',
    phone: place.phone || '',
    rating: place.googleRating || place.metadata?.googleRating || 0,
    businessStatus: place.googleBusinessStatus || place.metadata?.googleBusinessStatus || '',
    placeTypes: place.googleTypes || place.metadata?.googleTypes || [],
    primaryType: place.metadata?.googlePrimaryType || '',
    googlePlaceId: place.googlePlaceId || place.metadata?.googlePlaceId || '',
    geo: place.metadata?.geo || null,
    locationRoleGuess: guessLocationRole(place)
  }
}

export function createMapLookupService({ googleMapsAdapter, apiBudgetService, researchRunService }) {
  async function searchText(query, options = {}) {
    const call = apiBudgetService
      ? await apiBudgetService.runProviderCall({
          provider: 'googleMaps',
          payload: { query, options },
          fetcher: () => googleMapsAdapter.searchText(query, options)
        })
      : { results: await googleMapsAdapter.searchText(query, options), cacheHit: false, skipped: false }
    return call
  }

  async function findCompanyLocations({ companyName, country = '', maxResults = 10 }) {
    const query = [companyName, country].filter(Boolean).join(' ')
    const call = await searchText(query, { maxResults })
    const locations = call.results.map(mapPlace)
    const run = await researchRunService?.saveCompletedRun?.({
      type: 'map_company_locations',
      input: { companyName, country, maxResults },
      providerCalls: [{ provider: 'googleMaps', query, cacheHit: call.cacheHit, skipped: call.skipped }],
      results: locations,
      summary: `Found ${locations.length} location candidates for ${companyName}.`
    })
    return { success: true, mode: 'company_locations', runId: run?.id || null, locations }
  }

  async function lookupAddress({ address, country = '', maxResults = 10 }) {
    const query = [address, country].filter(Boolean).join(' ')
    const call = await searchText(query, { maxResults })
    const places = call.results.map(mapPlace)
    const result = {
      success: true,
      mode: 'address_lookup',
      addressType: classifyAddressType(call.results),
      occupants: places,
      nearbyBusinesses: places
    }
    const run = await researchRunService?.saveCompletedRun?.({
      type: 'map_address_lookup',
      input: { address, country, maxResults },
      providerCalls: [{ provider: 'googleMaps', query, cacheHit: call.cacheHit, skipped: call.skipped }],
      results: places,
      summary: `Found ${places.length} place candidates for address lookup.`
    })
    return { ...result, runId: run?.id || null }
  }

  async function verifyCompanyAddress({ companyName, address, country = '', maxResults = 10 }) {
    const query = [companyName, address, country].filter(Boolean).join(' ')
    const call = await searchText(query, { maxResults })
    const candidates = call.results
      .map((place) => ({ ...mapPlace(place), confidence: scoreCompanyAddressMatch(place, companyName, address) }))
      .sort((left, right) => right.confidence - left.confidence)
    const bestMatch = candidates[0] || null
    const result = {
      success: true,
      mode: 'company_address_verify',
      verified: Boolean(bestMatch && bestMatch.confidence >= 55),
      confidence: bestMatch?.confidence || 0,
      bestMatch,
      candidates
    }
    const run = await researchRunService?.saveCompletedRun?.({
      type: 'map_company_address_verify',
      input: { companyName, address, country, maxResults },
      providerCalls: [{ provider: 'googleMaps', query, cacheHit: call.cacheHit, skipped: call.skipped }],
      results: candidates,
      summary: bestMatch ? `Best match confidence ${bestMatch.confidence}.` : 'No candidate found.'
    })
    return { ...result, runId: run?.id || null }
  }

  return {
    findCompanyLocations,
    lookupAddress,
    verifyCompanyAddress
  }
}
