import path from 'path'
import { readJsonFile, writeJsonFile } from '../../../infrastructure/storage/json-file.js'
import { createGoogleMapsAdapter } from '../providers/google-maps-adapter.js'

const CACHE_DIR = path.resolve(process.cwd(), 'storage', 'cache')
const CACHE_FILE = path.join(CACHE_DIR, 'company-verification-cache.json')
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

/**
 * Get cache key for company verification
 * @param {string} companyName - Company name to verify
 * @returns {string} Cache key
 */
function getCacheKey(companyName) {
  return `map:${companyName.toLowerCase().trim()}`
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
 * Get cached verification result
 * @param {string} cacheKey - Cache key
 * @returns {object|null} Cached result or null if expired/missing
 */
function getCachedResult(cacheKey) {
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

  return entry.result
}

/**
 * Save verification result to cache
 * @param {string} cacheKey - Cache key
 * @param {object} result - Verification result to cache
 */
function setCachedResult(cacheKey, result) {
  const cache = loadCache()
  cache[cacheKey] = {
    timestamp: Date.now(),
    result
  }
  saveCache(cache)
}

/**
 * Verify a company exists using Google Maps API
 * @param {object} options - Verification options
 * @param {string} options.companyName - Company name to verify
 * @param {string} options.apiKey - Google Maps API key
 * @returns {Promise<object>} Verification result
 */
export async function verifyCompany({ companyName, apiKey }) {
  try {
    // Validate inputs
    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      return {
        ok: false,
        verified: false,
        reason: 'Company name is required and must be a non-empty string'
      }
    }

    if (!apiKey) {
      return {
        ok: false,
        verified: false,
        reason: 'Google Maps API key is required'
      }
    }

    // Check cache first
    const cacheKey = getCacheKey(companyName)
    const cachedResult = getCachedResult(cacheKey)

    if (cachedResult) {
      return {
        ...cachedResult,
        cached: true
      }
    }

    // Create Google Maps adapter
    const googleMapsAdapter = createGoogleMapsAdapter({ apiKey })

    // Search for the company
    const results = await googleMapsAdapter.searchText(companyName, {
      maxResults: 1
    })

    // Check if we found any results
    if (!results || results.length === 0) {
      const failureResult = {
        ok: false,
        verified: false,
        reason: 'No results found for this company name'
      }
      setCachedResult(cacheKey, failureResult)
      return {
        ...failureResult,
        cached: false
      }
    }

    // Extract information from first result
    const firstResult = results[0]
    const successResult = {
      ok: true,
      verified: true,
      address: firstResult.extra?.address || firstResult.snippet || '',
      placeId: firstResult.extra?.googlePlaceId || firstResult.metadata?.googlePlaceId || '',
      name: firstResult.title || '',
      phone: firstResult.extra?.phone || '',
      website: firstResult.url || '',
      rating: firstResult.metadata?.googleRating || 0,
      businessStatus: firstResult.extra?.googleBusinessStatus || 'UNKNOWN'
    }

    // Save to cache
    setCachedResult(cacheKey, successResult)

    return {
      ...successResult,
      cached: false
    }
  } catch (error) {
    const errorResult = {
      ok: false,
      verified: false,
      reason: error.message || 'Company verification failed',
      errorCode: error.code || 'VERIFICATION_ERROR'
    }

    // Don't cache errors
    return errorResult
  }
}
