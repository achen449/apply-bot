import app from '../server.js'

// Vercel serverless function handler. Keep logs request-safe: never print the
// complete headers object because it may contain cookies, bearer tokens,
// Vercel OIDC tokens, or proxy signatures.
export default async function handler(req, res) {
  const startTime = Date.now()
  const requestId = Math.random().toString(36).substring(7)
  
  try {
    const requestPath = typeof req.url === 'string' ? req.url.split('?', 1)[0] : ''
    console.log(`[${requestId}] START ${req.method} ${requestPath}`)
    
    // Pass request to Express app
    const result = await app(req, res)
    
    const duration = Date.now() - startTime
    console.log(`[${requestId}] COMPLETE ${req.method} ${requestPath} in ${duration}ms`)
    
    return result
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[${requestId}] ERROR after ${duration}ms`, {
      name: error?.name || 'Error',
      code: error?.code || 'unknown_error'
    })
    
    // Return proper error response
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        code: error?.code || 'internal_error',
        requestId: requestId,
        timestamp: new Date().toISOString()
      })
    }
  }
}
