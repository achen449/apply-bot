import { fetchJson } from '../../../infrastructure/http/fetch-json.js'
import { buildProviderSearchResult, getQueryText } from './provider-result-normalizer.js'

export function createTavilyAdapter({ apiKey, apiKeys = [] }) {
  const keys = [...new Set([apiKey, ...apiKeys].filter(Boolean))]

  return {
    available: keys.length > 0,
    async search(queryConfig) {
      const query = getQueryText(queryConfig)
      const maxResults = Math.min(Math.max(Number.parseInt(queryConfig?.maxResults, 10) || 8, 1), 20)
      if (!keys.length || !query) {
        return []
      }

      for (const key of keys) {
        try {
        const data = await fetchJson('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            api_key: key,
            query,
            search_depth: 'advanced',
            max_results: maxResults,
            include_raw_content: true,
            topic: 'general'
          })
        })

        return (data.results || []).slice(0, maxResults).map((result) => buildProviderSearchResult('tavily', queryConfig, {
          title: result.title || '',
          url: result.url || '',
          snippet: result.content || '',
          rawContent: result.raw_content || result.content || '',
          metadata: {
            score: result.score,
            publishedDate: result.published_date || ''
          }
        }))
        } catch (error) {
          console.error('Tavily search failed:', error.message)
        }
      }

      return []
    }
  }
}
