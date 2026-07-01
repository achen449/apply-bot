function classifyFromTypes(types = []) {
  const normalized = (types || []).map((type) => String(type).toLowerCase())
  const businessSignals = ['establishment', 'point_of_interest', 'store', 'industrial_equipment_supplier', 'premise']
  const residentialSignals = ['subpremise', 'residential', 'apartment_complex']

  const businessHits = normalized.filter((type) => businessSignals.includes(type)).length
  const residentialHits = normalized.filter((type) => residentialSignals.includes(type)).length

  if (businessHits > residentialHits && businessHits > 0) {
    return {
      classification: 'COMMERCIAL',
      confidence: Math.min(0.65 + businessHits * 0.08, 0.95),
      reason: 'Google Maps place types indicate a business or commercial establishment.'
    }
  }

  if (residentialHits > businessHits && residentialHits > 0) {
    return {
      classification: 'RESIDENTIAL',
      confidence: Math.min(0.6 + residentialHits * 0.08, 0.9),
      reason: 'Google Maps place types lean residential and lack strong business signals.'
    }
  }

  return {
    classification: 'MIXED_OR_UNKNOWN',
    confidence: 0.5,
    reason: 'Available map evidence is mixed or too weak to classify confidently.'
  }
}

function normalizePlaceDetails(candidate = {}) {
  return {
    name: candidate.title || candidate.name || '',
    address: candidate.address || candidate.snippet || '',
    phone: candidate.phone || '',
    website: candidate.url || candidate.website || '',
    types: candidate.googleTypes || candidate.types || [],
    businessStatus: candidate.googleBusinessStatus || candidate.businessStatus || 'UNKNOWN',
    rating: candidate.googleRating || candidate.rating || 0
  }
}

export function createAddressClassificationService({ googleMapsSearchService }) {
  if (!googleMapsSearchService || typeof googleMapsSearchService.search !== 'function') {
    throw new Error('createAddressClassificationService requires googleMapsSearchService.search.')
  }

  return {
    async batchClassify(addresses = []) {
      const results = await Promise.all(
        addresses.map(async (item) => {
          const response = await googleMapsSearchService.search({
            query: item.name,
            location: item.address,
            filters: {
              requireOperational: false,
              maxResults: 3,
              includeEmails: false
            }
          })

          const best = response.results?.[0] || null
          const classification = classifyFromTypes(best?.googleTypes || best?.types || [])

          return {
            input: item,
            result: {
              ...classification,
              placeDetails: best ? normalizePlaceDetails(best) : null
            }
          }
        })
      )

      return { results }
    }
  }
}
