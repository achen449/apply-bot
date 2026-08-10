function buildQuery(query, location) {
  return [query, location].filter((value) => typeof value === 'string' && value.trim()).join(' in ')
}

function normalizeGeo(value) {
  if (!value) {
    return null
  }

  if (typeof value.lat === 'number' && typeof value.lng === 'number') {
    return { latitude: value.lat, longitude: value.lng }
  }

  if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    return { latitude: value.latitude, longitude: value.longitude }
  }

  return null
}

const GOOGLE_MAPS_MAX_RESULTS = 20

export function createGoogleMapsSearchService({ googleMapsAdapter }) {
  if (!googleMapsAdapter || typeof googleMapsAdapter.searchText !== 'function') {
    throw new Error('createGoogleMapsSearchService requires googleMapsAdapter.searchText.')
  }

  return {
    async search({ query, location = '', filters = {} } = {}) {
      const normalizedQuery = buildQuery(query, location)
      const parsedRequestedCount = Number.parseInt(filters.maxResults, 10)
      const requestedCount = Number.isFinite(parsedRequestedCount) && parsedRequestedCount > 0
        ? parsedRequestedCount
        : GOOGLE_MAPS_MAX_RESULTS
      const appliedMaxResults = Math.min(requestedCount, GOOGLE_MAPS_MAX_RESULTS)
      const results = await googleMapsAdapter.searchText(normalizedQuery, {
        ...filters,
        maxResults: appliedMaxResults
      })
      const filtered = (results || []).filter((result) => {
        if (filters.requirePhone && !result.phone) {
          return false
        }

        return true
      })

      return {
        query: normalizedQuery,
        count: filtered.length,
        resultPolicy: {
          requestedCount,
          appliedMaxResults,
          maxAllowed: GOOGLE_MAPS_MAX_RESULTS,
          requestTruncated: requestedCount > GOOGLE_MAPS_MAX_RESULTS
        },
        results: filtered.map((result) => ({
          ...result,
          location: normalizeGeo(result.location),
          geo: normalizeGeo(result.geo || result.metadata?.geo),
          metadata: {
            ...(result.metadata || {}),
            geo: normalizeGeo(result.metadata?.geo)
          }
        }))
      }
    }
  }
}
