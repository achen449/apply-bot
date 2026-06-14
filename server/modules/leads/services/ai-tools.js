import { createBraveAdapter } from '../providers/brave-adapter.js'
import { createGoogleMapsAdapter } from '../providers/google-maps-adapter.js'
import { createTavilyAdapter } from '../providers/tavily-adapter.js'

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function asPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function compactError(code, message, details = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...details
    }
  }
}

function compactSearchResult(result) {
  return {
    title: result.title || '',
    url: result.url || '',
    snippet: result.snippet || '',
    provider: result.provider || '',
    address: result.address || '',
    phone: result.phone || '',
    metadata: result.metadata || {}
  }
}

function compactCandidate(result) {
  return {
    name: result.title || '',
    address: result.address || result.snippet || '',
    website: result.url || '',
    phone: result.phone || '',
    placeId: result.googlePlaceId || result.metadata?.googlePlaceId || '',
    rating: result.googleRating || result.metadata?.googleRating || 0,
    businessStatus: result.googleBusinessStatus || result.metadata?.googleBusinessStatus || '',
    types: result.googleTypes || result.metadata?.googleTypes || []
  }
}

function normalizeProvider(provider) {
  const value = hasText(provider) ? provider.trim().toLowerCase() : 'tavily'
  return value === 'brave' ? 'brave' : 'tavily'
}

function normalizeQuery(args) {
  return [args.query, args.industry, args.country]
    .filter(hasText)
    .map((value) => value.trim())
    .join(' ')
}

function scoreCompanyMatch(candidate, companyName, address) {
  const candidateName = candidate.name.toLowerCase()
  const candidateAddress = candidate.address.toLowerCase()
  const expectedName = companyName.toLowerCase()
  const expectedAddress = address.toLowerCase()
  let score = 0

  if (expectedName && candidateName.includes(expectedName)) score += 0.5
  if (expectedName && expectedName.includes(candidateName)) score += 0.3
  if (expectedAddress && candidateAddress.includes(expectedAddress)) score += 0.4
  if (candidate.website) score += 0.1
  if (candidate.businessStatus === 'OPERATIONAL') score += 0.1

  return Math.min(Number(score.toFixed(2)), 1)
}

async function withToolTimeout(operation, timeoutMs, label) {
  let timeout
  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => {
      resolve(compactError('tool_timeout', `${label} timed out after ${timeoutMs}ms.`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([operation(), timeoutPromise])
  } finally {
    clearTimeout(timeout)
  }
}

export function createSearchWebTool({ tavilyAdapter, braveAdapter, timeoutMs = 30000 } = {}) {
  const tavily = tavilyAdapter || createTavilyAdapter({})
  const brave = braveAdapter || createBraveAdapter({})

  return {
    name: 'search_web',
    description: 'Search the public web for compact company, market, and sourcing evidence using Tavily or Brave.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Search query to run.' },
        provider: { type: 'string', enum: ['tavily', 'brave'], description: 'Search provider to use.' },
        country: { type: 'string', description: 'Optional country or market context.' },
        industry: { type: 'string', description: 'Optional industry context.' },
        maxResults: { type: 'number', description: 'Maximum compact results to return.' }
      },
      required: ['query']
    },
    async execute(args = {}) {
      const query = normalizeQuery(args)
      if (!hasText(query)) {
        return compactError('invalid_tool_input', 'search_web requires a non-empty query.')
      }

      const provider = normalizeProvider(args.provider)
      const adapter = provider === 'brave' ? brave : tavily
      const maxResults = asPositiveInteger(args.maxResults, 5)

      return withToolTimeout(async () => {
        try {
          const results = await adapter.search({
            query,
            label: 'web-search'
          })

          return {
            ok: true,
            provider,
            query,
            results: (results || []).slice(0, maxResults).map(compactSearchResult)
          }
        } catch (error) {
          return compactError('provider_search_failed', `${provider} search failed.`, {
            provider,
            message: error.message || 'Unknown provider error'
          })
        }
      }, asPositiveInteger(timeoutMs, 30000), `${provider} search`)
    }
  }
}

export function createVerifyCompanyTool({ googleMapsAdapter, timeoutMs = 30000 } = {}) {
  const googleMaps = googleMapsAdapter || createGoogleMapsAdapter({})

  return {
    name: 'verify_company',
    description: 'Verify company identity and address candidates using Google Maps Places evidence.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        company_name: { type: 'string', description: 'Company name to verify.' },
        address: { type: 'string', description: 'Address to verify against the company.' },
        country: { type: 'string', description: 'Optional country or region context.' },
        maxResults: { type: 'number', description: 'Maximum Google Maps candidates to inspect.' }
      },
      required: ['company_name']
    },
    async execute(args = {}) {
      const companyName = hasText(args.company_name) ? args.company_name.trim() : hasText(args.companyName) ? args.companyName.trim() : ''
      const address = hasText(args.address) ? args.address.trim() : ''
      const country = hasText(args.country) ? args.country.trim() : ''

      if (!companyName) {
        return compactError('invalid_tool_input', 'verify_company requires company_name.')
      }

      return withToolTimeout(async () => {
        try {
          const query = [companyName, address, country].filter(hasText).join(' ')
          const results = await googleMaps.searchText(query, {
            requireOperational: false,
            requireWebsite: false,
            maxResults: asPositiveInteger(args.maxResults, 5)
          })
          const candidates = (results || []).slice(0, asPositiveInteger(args.maxResults, 5)).map(compactCandidate)
          const scoredCandidates = candidates.map((candidate) => ({
            ...candidate,
            confidence: scoreCompanyMatch(candidate, companyName, address)
          }))
          const bestCandidate = scoredCandidates[0] || null
          const confidence = bestCandidate?.confidence || 0

          return {
            ok: true,
            verified: confidence >= 0.5,
            address: bestCandidate?.address || '',
            confidence,
            candidates: scoredCandidates
          }
        } catch (error) {
          return {
            ok: true,
            verified: false,
            address: '',
            confidence: 0,
            candidates: [],
            error: {
              code: 'google_maps_verification_failed',
              message: error.message || 'Google Maps verification failed.'
            }
          }
        }
      }, asPositiveInteger(timeoutMs, 30000), 'Google Maps verification')
    }
  }
}

export function createLeadAITools(config = {}) {
  return [
    createSearchWebTool(config),
    createVerifyCompanyTool(config)
  ]
}
