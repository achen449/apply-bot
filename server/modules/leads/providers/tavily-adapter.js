import { fetchJson } from '../../../infrastructure/http/fetch-json.js'
import { buildProviderSearchResult, getQueryText } from './provider-result-normalizer.js'

export function createTavilyAdapter({ apiKey }) {
  return {
    async search(queryConfig) {
      const query = getQueryText(queryConfig)
      if (!apiKey || !query) {
        return []
      }

      try {
        const data = await fetchJson('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: 'advanced',
            max_results: 8,
            include_raw_content: true,
            topic: 'general'
          })
        })

        return (data.results || []).map((result) => buildProviderSearchResult('tavily', queryConfig, {
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
        return []
      }
    }
  }
}
