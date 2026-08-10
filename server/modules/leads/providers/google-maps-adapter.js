import { buildProviderSearchResult, getQueryText } from './provider-result-normalizer.js'

export function createGoogleMapsAdapter({ apiKey }) {
  async function searchText(query, options = {}) {
    if (!apiKey || !query) {
      return []
    }

    const {
      minRating = 0,
      requireWebsite = false,
      requireOperational = false,
      maxResults = 20
    } = options

    const maxResultCount = Math.min(Math.max(Number.parseInt(maxResults, 10) || 20, 1), 20)

    try {
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        signal: options.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.businessStatus,places.primaryType,places.types,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber'
        },
        body: JSON.stringify({
          textQuery: query,
          maxResultCount
        })
      })

      if (!response.ok) {
        const responseText = await response.text().catch(() => '')
        const error = new Error(`Google Places API returned ${response.status}${responseText ? `: ${responseText.slice(0, 240)}` : ''}`)
        error.code = 'google_places_request_failed'
        error.status = response.status === 401 || response.status === 403 ? 502 : response.status
        throw error
      }

      const data = await response.json()
      const places = data.places || []
      const results = []

      for (const place of places) {
        const rating = place.rating || 0
        const businessStatus = place.businessStatus || 'UNKNOWN'
        const website = place.websiteUri || ''

        if (minRating > 0 && rating < minRating) continue
        if (requireWebsite && !website) continue
        if (requireOperational && businessStatus !== 'OPERATIONAL') continue

        results.push(buildProviderSearchResult('google-maps', query, {
          title: place.displayName?.text || '',
          url: website,
          snippet: place.formattedAddress || '',
          rawContent: `${place.displayName?.text || ''} ${place.formattedAddress || ''} ${(place.types || []).join(' ')}`.trim(),
          metadata: {
            googlePlaceId: place.id || '',
            googleRating: rating,
            googleReviewCount: place.userRatingCount || 0,
            googleBusinessStatus: businessStatus,
            googleTypes: place.types || [],
            googlePrimaryType: place.primaryType || '',
            geo: place.location || null
          },
          extra: {
            address: place.formattedAddress || '',
            phone: place.nationalPhoneNumber || place.internationalPhoneNumber || '',
            googlePlaceId: place.id || '',
            googleRating: rating,
            googleBusinessStatus: businessStatus,
            googleTypes: place.types || [],
            geo: place.location || null
          }
        }))
      }

      return results
    } catch (error) {
      console.error('Google Maps search failed:', error.message)
      throw error
    }
  }

  return {
    searchText,
    async searchLeadDiscovery(queryConfig) {
      const query = getQueryText(queryConfig)
      return searchText(query, {
        minRating: 3.5,
        requireWebsite: true,
        requireOperational: true,
        maxResults: 20
      })
    }
  }
}
