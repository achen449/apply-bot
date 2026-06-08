import app from '../server.js'

// Vercel's Node.js runtime can serve an Express app directly.
// This module is the explicit serverless boundary for `/api/*` rewrites
// and intentionally avoids starting a listener.
export const handler = app

export default handler
