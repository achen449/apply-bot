import { mapGoogleMapsPlaceMatch } from '../mappers/google-maps-dto-mapper.js'

export function createAddressVerificationService({ googleMapsAdapter }) {
  return {
    async verifyCompanyAddress({ companyName, address }) {
      const query = [companyName, address].filter(Boolean).join(' ')
      const results = await googleMapsAdapter.searchText(query, { maxResults: 1 })

      if (!results.length) {
        return {
          verified: false,
          match: null,
          message: 'No Google Maps listing found for this company and address'
        }
      }

      return {
        verified: true,
        match: mapGoogleMapsPlaceMatch(results[0])
      }
    }
  }
}
