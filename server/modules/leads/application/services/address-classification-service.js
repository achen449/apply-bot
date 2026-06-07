export function createAddressClassificationService({ googleMapsAdapter }) {
  function classifyByPlaceTypes(types = []) {
    const commercialKeywords = ['store', 'establishment', 'point_of_interest', 'office', 'factory', 'warehouse', 'restaurant', 'shopping_mall', 'bank', 'hospital']
    const residentialKeywords = ['street_address', 'premise', 'subpremise', 'residential', 'apartment', 'housing']
    const commercialScore = types.filter(type => commercialKeywords.includes(type)).length
    const residentialScore = types.filter(type => residentialKeywords.includes(type)).length

    if (commercialScore > 0 && residentialScore > 0) {
      return {
        classification: 'MIXED_USE',
        confidence: 0.6,
        reason: 'Google Maps place types include both commercial and residential signals'
      }
    }

    if (commercialScore > residentialScore) {
      return {
        classification: 'COMMERCIAL',
        confidence: Math.min(0.95, 0.6 + commercialScore * 0.15),
        reason: 'Google Maps place types indicate a commercial location'
      }
    }

    if (residentialScore > commercialScore) {
      return {
        classification: 'RESIDENTIAL',
        confidence: Math.min(0.9, 0.5 + residentialScore * 0.15),
        reason: 'Google Maps place types indicate a residential location'
      }
    }

    return {
      classification: 'UNKNOWN',
      confidence: 0.3,
      reason: 'Google Maps place types do not provide enough classification signals'
    }
  }

  async function classifyAddress(companyName, address) {
    if (!companyName || !address) {
      return {
        classification: 'UNKNOWN',
        confidence: 0,
        placeDetails: null,
        reason: 'Missing company name or address'
      }
    }

    try {
      const query = `${companyName} ${address}`
      const searchResults = await googleMapsAdapter.searchText(query, { maxResults: 1 })

      if (!searchResults.length) {
        return {
          classification: 'NOT_FOUND',
          confidence: 0,
          placeDetails: null,
          reason: 'No Google Maps listing found'
        }
      }

      const place = searchResults[0]
      const types = place.metadata?.googleTypes || []
      const classification = classifyByPlaceTypes(types)

      return {
        classification: classification.classification,
        confidence: classification.confidence,
        placeDetails: {
          name: place.title || '',
          address: place.extra?.address || place.snippet || '',
          phone: place.extra?.phone || '',
          website: place.url || '',
          types,
          businessStatus: place.metadata?.googleBusinessStatus || '',
          rating: place.metadata?.googleRating || 0
        },
        reason: classification.reason
      }
    } catch (error) {
      return {
        classification: 'UNKNOWN',
        confidence: 0,
        placeDetails: null,
        reason: error.message || 'Address classification failed'
      }
    }
  }

  async function batchClassify(addresses = []) {
    const results = []

    for (const item of addresses) {
      results.push({
        input: item,
        result: await classifyAddress(item?.name, item?.address)
      })
    }

    return { results }
  }

  return {
    classifyAddress,
    classifyByPlaceTypes,
    batchClassify
  }
}
