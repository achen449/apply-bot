import express from 'express'
import cors from 'cors'
import path from 'path'
import net from 'net'
import { fileURLToPath } from 'url'
import apiRoutes from './server/api-routes.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const DEFAULT_PORT = 3010

// CORS configuration
app.use(cors())

// JSON parser
app.use(express.json())

// API routes
app.use('/api', apiRoutes)

// Static files
app.use(express.static(path.join(__dirname, 'dist')))

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// Port availability check
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port)
  })
}

// Find available port
async function findAvailablePort(startPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i
    if (await isPortAvailable(port)) {
      return port
    }
    console.log(`Port ${port} is in use, trying ${port + 1}...`)
  }
  throw new Error(`No available port found between ${startPort} and ${startPort + maxAttempts - 1}`)
}

// Check if this file is being executed directly
function isDirectExecution() {
  if (!process.argv[1]) {
    return false
  }
  return path.resolve(process.argv[1]) === __filename
}

// Start server
export async function startServer() {
  try {
    const port = await findAvailablePort(DEFAULT_PORT)
    return app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error.message)
    process.exit(1)
  }
}

export { app }
export default app

if (isDirectExecution()) {
  startServer()
}
