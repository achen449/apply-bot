import { mapGoogleMapsPlaceMatch } from '../mappers/google-maps-dto-mapper.js'

export function createBatchAddressVerificationService({ googleMapsAdapter }) {
  return {
    async verifyCompanies(companies = []) {
      const results = []

      for (const company of companies) {
        if (!company.name) {
          results.push({
            input: company,
            verified: false,
            match: null,
            error: 'Missing company name'
          })
          continue
        }

        try {
          const query = [company.name, company.address].filter(Boolean).join(' ')
          const searchResults = await googleMapsAdapter.searchText(query, { maxResults: 1 })

          if (!searchResults.length) {
            results.push({
              input: company,
              verified: false,
              match: null,
              message: 'No Google Maps listing found'
            })
            continue
          }

          results.push({
            input: company,
            verified: true,
            match: mapGoogleMapsPlaceMatch(searchResults[0])
          })
        } catch (error) {
          results.push({
            input: company,
            verified: false,
            match: null,
            error: error.message || 'Verification failed'
          })
        }
      }

      return { results }
    }
  }
}
