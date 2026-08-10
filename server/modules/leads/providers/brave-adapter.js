import { fetchJson } from '../../../infrastructure/http/fetch-json.js'
import { buildProviderSearchResult, getQueryText } from './provider-result-normalizer.js'

export function createBraveAdapter({ apiKey, apiKeys = [] }) {
  const keys = [...new Set([apiKey, ...apiKeys].filter(Boolean))]

  async function fetchWithToken(url, token, options = {}) {
    return fetchJson(url, {
      signal: options.signal,
      timeoutMs: Number.parseInt(options.timeoutMs, 10) || 12000,
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': token
      }
    })
  }

  return {
    available: keys.length > 0,
    async search(queryConfig) {
      const query = getQueryText(queryConfig)
      const maxResults = Math.min(Math.max(Number.parseInt(queryConfig?.maxResults, 10) || 8, 1), 20)
      if (!keys.length || !query) {
        return []
      }

      const failures = []
      for (const key of keys) {
        try {
          const requestOptions = { signal: queryConfig?.signal, timeoutMs: queryConfig?.timeoutMs }
          const data = await fetchWithToken(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`, key, requestOptions)

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
          const [poisOutcome, descriptionsOutcome] = await Promise.allSettled([
            fetchWithToken(`https://api.search.brave.com/res/v1/local/pois?${idsQuery}`, key, requestOptions),
            fetchWithToken(`https://api.search.brave.com/res/v1/local/descriptions?${idsQuery}`, key, requestOptions)
          ])
          const poisData = poisOutcome.status === 'fulfilled' ? poisOutcome.value : { results: [] }
          const descriptionsData = descriptionsOutcome.status === 'fulfilled' ? descriptionsOutcome.value : { results: [] }
          const providerWarnings = [
            poisOutcome.status === 'rejected' ? 'local_pois_failed' : '',
            descriptionsOutcome.status === 'rejected' ? 'local_descriptions_failed' : ''
          ].filter(Boolean)

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
                placeSourceUrl: result.url || website,
                providerWarnings
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

          return [...webResults.map((result) => ({
            ...result,
            metadata: { ...(result.metadata || {}), providerWarnings }
          })), ...localResults].slice(0, maxResults)
        } catch (error) {
          failures.push(error)
        }
      }

      const error = new Error(`Brave search failed for all configured keys: ${failures.at(-1)?.message || 'unknown provider error'}`)
      error.code = 'brave_search_failed'
      error.failures = failures.length
      throw error
    }
  }
}
