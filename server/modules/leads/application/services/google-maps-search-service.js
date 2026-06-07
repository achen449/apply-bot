import { scrapeWebsiteEmails } from '../analyzers/website-email-analyzer.js'

export function createGoogleMapsSearchService({ googleMapsAdapter }) {
  return {
    async search({ query, location = '', filters = {} }) {
      const searchQuery = location ? `${query} in ${location}` : query
      const {
        minRating = 0,
        requireWebsite = false,
        requirePhone = false,
        requireOperational = false,
        maxResults = 20,
        includeEmails = false
      } = filters

      const places = await googleMapsAdapter.searchText(searchQuery, {
        minRating,
        requireWebsite,
        requireOperational,
        maxResults
      })

      let results = requirePhone ? places.filter((place) => place.phone) : places

      if (includeEmails) {
        results = await Promise.all(results.map(async (place) => ({
          ...place,
          emails: await scrapeWebsiteEmails(place.url)
        })))
      }

      return {
        query: searchQuery,
        count: results.length,
        results
      }
    }
  }
}
