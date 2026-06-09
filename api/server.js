import app from '../server.js'

// Vercel serverless function handler with comprehensive logging
export default async function handler(req, res) {
  const startTime = Date.now()
  const requestId = Math.random().toString(36).substring(7)
  
  try {
    // Log incoming request
    console.log(`[${requestId}] START ${req.method} ${req.url}`)
    console.log(`[${requestId}] Headers:`, JSON.stringify(req.headers, null, 2))
    
    // Set CORS headers for all responses
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    )

    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
      console.log(`[${requestId}] OPTIONS preflight - returning 200`)
      res.status(200).end()
      return
    }

    console.log(`[${requestId}] Passing to Express app...`)
    
    // Pass request to Express app
    const result = await app(req, res)
    
    const duration = Date.now() - startTime
    console.log(`[${requestId}] SUCCESS in ${duration}ms`)
    
    return result
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[${requestId}] ERROR after ${duration}ms:`, error)
    console.error(`[${requestId}] Error stack:`, error.stack)
    console.error(`[${requestId}] Error details:`, {
      name: error.name,
      message: error.message,
      code: error.code
    })
    
    // Return proper error response
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: error.message,
        requestId: requestId,
        timestamp: new Date().toISOString()
      })
    }
  }
}
