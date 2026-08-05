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

export function createGoogleMapsSearchService({ googleMapsAdapter }) {
  if (!googleMapsAdapter || typeof googleMapsAdapter.searchText !== 'function') {
    throw new Error('createGoogleMapsSearchService requires googleMapsAdapter.searchText.')
  }

  return {
    async search({ query, location = '', filters = {} } = {}) {
      const normalizedQuery = buildQuery(query, location)
      const results = await googleMapsAdapter.searchText(normalizedQuery, filters)
      const filtered = (results || []).filter((result) => {
        if (filters.requirePhone && !result.phone) {
          return false
        }

        return true
      })

      return {
        query: normalizedQuery,
        count: filtered.length,
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
