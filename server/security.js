const LOCAL_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3010',
  'http://127.0.0.1:3010'
])

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return ''
  }

  try {
    return new URL(value.trim()).origin
  } catch {
    return ''
  }
}

function configuredOrigins() {
  return new Set(
    String(process.env.APP_ALLOWED_ORIGINS || '')
      .split(',')
      .map(normalizeOrigin)
      .filter(Boolean)
  )
}

function requestOrigin(req) {
  const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  return host ? `${protocol}://${host}` : ''
}

function isAllowedOrigin(req, origin) {
  const normalizedOrigin = normalizeOrigin(origin)
  if (!normalizedOrigin) {
    return false
  }

  if (LOCAL_ORIGINS.has(normalizedOrigin) || configuredOrigins().has(normalizedOrigin)) {
    return true
  }

  return normalizedOrigin === requestOrigin(req)
}

function isPublicApiPath(pathname) {
  return pathname === '/api/ai-config' || pathname === '/api/health'
}

function hasValidAccessToken(req, accessToken) {
  if (!accessToken) {
    return true
  }

  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : ''
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || ''
  const headerToken = typeof req.headers['x-apply-bot-token'] === 'string' ? req.headers['x-apply-bot-token'] : ''
  return bearer === accessToken || headerToken === accessToken
}

/**
 * Keep browser access same-origin by default. An optional APP_ACCESS_TOKEN
 * can be enabled by a deployment without changing the existing local setup.
 */
export function createApiSecurityMiddleware({ accessToken = process.env.APP_ACCESS_TOKEN || '' } = {}) {
  return function apiSecurityMiddleware(req, res, next) {
    const origin = req.headers.origin
    const isApiRequest = req.path === '/api' || req.path.startsWith('/api/')

    if (origin && !isAllowedOrigin(req, origin)) {
      return res.status(403).json({
        success: false,
        code: 'origin_not_allowed',
        error: 'This origin is not allowed to access the API.'
      })
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', normalizeOrigin(origin))
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, Authorization, X-Apply-Bot-Token, X-Requested-With')
      res.setHeader('Access-Control-Max-Age', '600')
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end()
    }

    if (isApiRequest && !isPublicApiPath(req.path) && !hasValidAccessToken(req, accessToken)) {
      return res.status(401).json({
        success: false,
        code: 'access_token_required',
        error: 'An API access token is required for this deployment.'
      })
    }

    return next()
  }
}

export { isAllowedOrigin, normalizeOrigin }
