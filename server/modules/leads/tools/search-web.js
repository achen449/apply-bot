import path from 'path'
import { readJsonFile, writeJsonFile } from '../../../infrastructure/storage/json-file.js'
import { createTavilyAdapter } from '../providers/tavily-adapter.js'
import { createBraveAdapter } from '../providers/brave-adapter.js'

const CACHE_DIR = path.resolve(process.cwd(), 'storage', 'cache')
const CACHE_FILE = path.join(CACHE_DIR, 'search-cache.json')
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24 hours

/**
 * Get cache key for search query
 * @param {string} provider - Search provider (tavily or brave)
 * @param {string|object} query - Search query
 * @returns {string} Cache key
 */
function getCacheKey(provider, query) {
  const queryText = typeof query === 'string' ? query : query.query || JSON.stringify(query)
  return `search:${provider}:${queryText.toLowerCase().trim()}`
}

/**
 * Load cache from disk
 * @returns {object} Cache object
 */
function loadCache() {
  return readJsonFile(CACHE_FILE, {})
}

/**
 * Save cache to disk
 * @param {object} cache - Cache object to save
 */
function saveCache(cache) {
  writeJsonFile(CACHE_FILE, cache)
}

/**
 * Get cached search results
 * @param {string} cacheKey - Cache key
 * @returns {array|null} Cached results or null if expired/missing
 */
function getCachedResults(cacheKey) {
  const cache = loadCache()
  const entry = cache[cacheKey]

  if (!entry) {
    return null
  }

  const now = Date.now()
  if (now - entry.timestamp > CACHE_TTL_MS) {
    // Cache expired
    return null
  }

  return entry.results
}

/**
 * Save search results to cache
 * @param {string} cacheKey - Cache key
 * @param {array} results - Search results to cache
 */
function setCachedResults(cacheKey, results) {
  const cache = loadCache()
  cache[cacheKey] = {
    timestamp: Date.now(),
    results
  }
  saveCache(cache)
}

/**
 * Search the web using Tavily or Brave adapter with caching
 * @param {object} options - Search options
 * @param {string} options.provider - Search provider ('tavily' or 'brave')
 * @param {string|object} options.query - Search query
 * @param {string|array} options.apiKey - API key(s) for the provider
 * @returns {Promise<object>} Search result object with ok/error/data
 */
export async function searchWeb({ provider = 'tavily', query, apiKey }) {
  try {
    // Validate inputs
    if (!query) {
      return {
        ok: false,
        error: {
          code: 'INVALID_QUERY',
          message: 'Query is required'
        }
      }
    }

    if (!apiKey) {
      return {
        ok: false,
        error: {
          code: 'MISSING_API_KEY',
          message: `API key is required for ${provider}`
        }
      }
    }

    // Check cache first
    const cacheKey = getCacheKey(provider, query)
    const cachedResults = getCachedResults(cacheKey)

    if (cachedResults) {
      return {
        ok: true,
        data: cachedResults,
        cached: true
      }
    }

    // Create adapter based on provider
    let adapter
    const apiKeys = Array.isArray(apiKey) ? apiKey : [apiKey]

    if (provider === 'tavily') {
      adapter = createTavilyAdapter({ apiKeys })
    } else if (provider === 'brave') {
      adapter = createBraveAdapter({ apiKeys })
    } else {
      return {
        ok: false,
        error: {
          code: 'INVALID_PROVIDER',
          message: `Unknown provider: ${provider}. Use 'tavily' or 'brave'`
        }
      }
    }

    // Perform search
    const results = await adapter.search(query)

    // Save to cache if successful
    if (results && results.length > 0) {
      setCachedResults(cacheKey, results)
    }

    return {
      ok: true,
      data: results,
      cached: false
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'SEARCH_FAILED',
        message: error.message || 'Search failed',
        details: error.stack
      }
    }
  }
}
