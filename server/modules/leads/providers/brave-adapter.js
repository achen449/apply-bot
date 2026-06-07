import { fetchJson } from '../../../infrastructure/http/fetch-json.js'
import { buildProviderSearchResult, getQueryText } from './provider-result-normalizer.js'

export function createBraveAdapter({ apiKey }) {
  async function fetchWithToken(url) {
    return fetchJson(url, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey
      }
    })
  }

  return {
    async search(queryConfig) {
      const query = getQueryText(queryConfig)
      if (!apiKey || !query) {
        return []
      }

      try {
        const data = await fetchWithToken(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`)

        const webResults = (data.web?.results || []).map((result) => buildProviderSearchResult('brave', queryConfig, {
          title: result.title || '',
          url: result.url || '',
          snippet: result.description || '',
          rawContent: result.extra_snippets?.join(' ') || result.description || '',
          metadata: {
            age: result.age || '',
            language: result.language || ''
          }
        }))

        const locationIds = (data.locations?.results || [])
          .map((result) => result.id)
          .filter(Boolean)
          .slice(0, 6)

        if (!locationIds.length) {
          return webResults
        }

        const idsQuery = locationIds.map((id) => `ids=${encodeURIComponent(id)}`).join('&')
        const [poisData, descriptionsData] = await Promise.all([
          fetchWithToken(`https://api.search.brave.com/res/v1/local/pois?${idsQuery}`).catch(() => ({ results: [] })),
          fetchWithToken(`https://api.search.brave.com/res/v1/local/descriptions?${idsQuery}`).catch(() => ({ results: [] }))
        ])

        const descriptionById = new Map((descriptionsData.results || []).map((result) => [result.id, result.description || '']))
        const localResults = (poisData.results || []).map((result) => {
          const websiteResult = (result.results || []).find((item) => item.url)
          const website = websiteResult?.url || result.url || ''
          const address = result.postal_address?.displayAddress || ''
          const phone = result.contact?.telephone || ''
          const description = descriptionById.get(result.id) || ''

          return buildProviderSearchResult('brave', queryConfig, {
            title: result.title || websiteResult?.title || '',
            url: website,
            snippet: address || websiteResult?.description || description,
            rawContent: [
              result.title || '',
              address,
              phone,
              description,
              ...(result.categories || []),
              ...(result.results || []).map((item) => item.description || '')
            ].filter(Boolean).join(' '),
            metadata: {
              braveLocationId: result.id || '',
              categories: result.categories || [],
              placeSourceUrl: result.url || website
            },
            extra: {
              address,
              phone,
              localDescription: description,
              placeSourceUrl: result.url || website,
              isLocalPoi: true
            }
          })
        }).filter((result) => result.url && result.title)

        return [...webResults, ...localResults]
      } catch (error) {
        console.error('Brave search failed:', error.message)
        return []
      }
    }
  }
}
