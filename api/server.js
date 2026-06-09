import app from '../server.js'

// Vercel serverless function handler
// Wraps Express app to conform to Vercel's (req, res) => {} signature
const handler = (req, res) => {
  return app(req, res)
}

export default handler
