import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
// DISABLED: import multer from 'multer'
import net from 'net'
// DISABLED: import { PDFParse } from 'pdf-parse'
import { loadServerEnv } from './server/config/env.js'
import { createLeadWorkspaceRepository } from './server/modules/leads/repositories/lead-workspace-repository.js'
import { createTavilyAdapter } from './server/modules/leads/providers/tavily-adapter.js'
import { createBraveAdapter } from './server/modules/leads/providers/brave-adapter.js'
import { createGoogleMapsAdapter } from './server/modules/leads/providers/google-maps-adapter.js'
import {
  blockedResearchDomains,
  buildIndustryCandidates,
  buildSearchStrategy
} from './server/modules/leads/config/search-strategy.js'
import {
  cleanDomain,
  dedupeStrings,
  normalizeKey,
  stripTrackingParams,
  titleCase,
  toRootCompanyUrl,
  truncateText
} from './server/modules/leads/shared/text-utils.js'
import {
  isLikelyCompanyCandidate,
  looksBlockedResearchDomain,
  titleLooksGeneric
} from './server/modules/leads/domain/entity-resolution/company-candidate-filter.js'
import { mergeProviderCandidates } from './server/modules/leads/domain/entity-resolution/provider-candidate-merger.js'
import { analyzeCompanyWebsite } from './server/modules/leads/application/analyzers/company-website-analyzer.js'
import { buildWorkspaceFromCompanies as buildWorkspaceFromCompaniesModule } from './server/modules/leads/application/workspace/build-workspace-from-companies.js'
import { buildSeededWorkspace } from './server/modules/leads/application/workspace/build-seeded-workspace.js'
import { createWorkspaceSummary as createWorkspaceSummaryModule } from './server/modules/leads/application/workspace/workspace-summary.js'
import { createAddressVerificationService } from './server/modules/leads/application/services/address-verification-service.js'
import { createGoogleMapsSearchService } from './server/modules/leads/application/services/google-maps-search-service.js'
import { createBatchAddressVerificationService } from './server/modules/leads/application/services/batch-address-verification-service.js'
import { createAddressClassificationService } from './server/modules/leads/application/services/address-classification-service.js'
import { createCompanySimilarityService } from './server/modules/leads/application/services/company-similarity-service.js'
import { createLeadDiscoveryService } from './server/modules/leads/application/services/lead-discovery-service.js'
import { createGistCustomerDataService } from './server/modules/leads/application/services/gist-customer-data-service.js'
import { createOsintParserFacade } from './server/modules/leads/application/osint/osint-parser-facade.js'
import { createOsintResearchService } from './server/modules/leads/application/services/osint-research-service.js'
import { createLeadOsintRouter } from './server/modules/leads/routes/osint-routes.js'
import { createLeadSupportRouter } from './server/modules/leads/routes/lead-support-routes.js'
import { createLeadExportRouter } from './server/modules/leads/routes/lead-export-routes.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Enhanced logging for debugging
console.log('[SERVER INIT] Starting server initialization...')
console.log('[SERVER INIT] __dirname:', __dirname)
console.log('[SERVER INIT] Loading environment variables...')

const { TAVILY_API_KEY, BRAVE_API_KEY, GOOGLE_MAPS_API_KEY, GIST_ID, GITHUB_GIST_TOKEN, GIST_CUSTOMER_DATA_FILENAME } = loadServerEnv(__dirname)

console.log('[SERVER INIT] Environment variables loaded:')
console.log('[SERVER INIT] - TAVILY_API_KEY:', TAVILY_API_KEY ? '鉁?Present' : '鉁?Missing')
console.log('[SERVER INIT] - BRAVE_API_KEY:', BRAVE_API_KEY ? '鉁?Present' : '鉁?Missing')
console.log('[SERVER INIT] - GOOGLE_MAPS_API_KEY:', GOOGLE_MAPS_API_KEY ? '鉁?Present' : '鉁?Missing')
console.log('[SERVER INIT] - GIST_ID:', GIST_ID ? '鉁?Present' : '鉁?Missing')
console.log('[SERVER INIT] - GITHUB_GIST_TOKEN:', GITHUB_GIST_TOKEN ? '鉁?Present' : '鉁?Missing')
console.log('[SERVER INIT] - GIST_CUSTOMER_DATA_FILENAME:', GIST_CUSTOMER_DATA_FILENAME || 'customer-data.json (default)')
const gistCustomerDataService = createGistCustomerDataService({
  gistId: GIST_ID,
  githubToken: GITHUB_GIST_TOKEN,
  fileName: GIST_CUSTOMER_DATA_FILENAME
})
const leadWorkspaceRepository = createLeadWorkspaceRepository(__dirname, { gistCustomerDataService })
const tavilyAdapter = createTavilyAdapter({ apiKey: TAVILY_API_KEY })
const braveAdapter = createBraveAdapter({ apiKey: BRAVE_API_KEY })
const googleMapsAdapter = createGoogleMapsAdapter({ apiKey: GOOGLE_MAPS_API_KEY })
const addressVerificationService = createAddressVerificationService({ googleMapsAdapter })
const googleMapsSearchService = createGoogleMapsSearchService({ googleMapsAdapter })
const batchAddressVerificationService = createBatchAddressVerificationService({ googleMapsAdapter })
const addressClassificationService = createAddressClassificationService({ googleMapsAdapter })
const companySimilarityService = createCompanySimilarityService({ tavilyAdapter })
const leadDiscoveryService = createLeadDiscoveryService({
  tavilySearch: (...args) => tavilyAdapter.search(...args),
  braveSearch: (...args) => braveAdapter.search(...args),
  googleMapsSearch: (...args) => googleMapsAdapter.searchLeadDiscovery(...args)
})
const osintParserFacade = createOsintParserFacade()
const osintResearchService = createOsintResearchService({
  tavilySearch: (...args) => tavilyAdapter.search(...args),
  braveSearch: (...args) => braveAdapter.search(...args),
  googleMapsSearch: (...args) => googleMapsAdapter.searchText(...args),
  parserFacade: osintParserFacade,
  providerAvailability: {
    tavily: Boolean(TAVILY_API_KEY),
    brave: Boolean(BRAVE_API_KEY),
    googleMaps: Boolean(GOOGLE_MAPS_API_KEY)
  }
})
const providerAvailability = {
  tavily: {
    available: Boolean(TAVILY_API_KEY),
    missingEnvVars: TAVILY_API_KEY ? [] : ['TAVILY_API_KEY']
  },
  brave: {
    available: Boolean(BRAVE_API_KEY),
    missingEnvVars: BRAVE_API_KEY ? [] : ['BRAVE_API_KEY']
  },
  googleMaps: {
    available: Boolean(GOOGLE_MAPS_API_KEY),
    missingEnvVars: GOOGLE_MAPS_API_KEY ? [] : ['GOOGLE_MAPS_API_KEY']
  }
}

function sendMissingEnvResponse(res, message, missingEnvVars) {
  return res.status(503).json({
    success: false,
    code: 'missing_env',
    error: message,
    missingEnvVars
  })
}
function sendLeadServiceError(res, error, fallbackMessage) {
  if (error?.code === 'missing_env') {
    return sendMissingEnvResponse(res, error.message, error.missingEnvVars || [])
  }

  if (error?.code === 'invalid_payload') {
    return res.status(400).json({
      success: false,
      code: 'invalid_payload',
      error: error.message || fallbackMessage
    })
  }

  if (error?.code === 'invalid_gist_json' || error?.code === 'gist_request_failed' || error?.code === 'gist_update_failed') {
    return res.status(error.status || 502).json({
      success: false,
      code: error.code,
      error: fallbackMessage
    })
  }

  if (error?.code === 'google_places_request_failed') {
    return res.status(error.status || 502).json({
      success: false,
      code: error.code,
      error: error.message || fallbackMessage
    })
  }

  return res.status(error?.status || 500).json({
    success: false,
    code: error?.code || 'request_failed',
    error: fallbackMessage
  })
}



const app = express()
const DEFAULT_PORT = 3010

function isDirectExecution() {
  if (!process.argv[1]) {
    return false
  }

  return path.resolve(process.argv[1]) === __filename
}

// Check if a port is available
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

// Find an available port starting from the default
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

// Get paths to JSON files (in data directory)
const knowledgeJsonPath = path.join(__dirname, 'data', 'knowledge.json')
const appliedJsonPath = path.join(__dirname, 'data', 'applied.json')
const promptsJsonPath = path.join(__dirname, 'data', 'prompts.json')
const jobFiltersJsonPath = path.join(__dirname, 'data', 'job-filters.json')
const logsJsonPath = path.join(__dirname, 'data', 'logs.json')
const monitoredCompaniesJsonPath = path.join(__dirname, 'data', 'monitored-companies.json')
const resumeTxtPath = path.join(__dirname, 'data', 'resume.txt')
const resumeMetaPath = path.join(__dirname, 'data', 'resume-meta.json')
const dataDir = path.join(__dirname, 'data')


function createWorkspaceSummary(companies, contacts, drafts) {
  return {
    companyCount: companies.length,
    contactCount: contacts.length,
    draftCount: drafts.length,
    topProfiles: dedupeStrings(companies.map((company) => company.profile)).slice(0, 4)
  }
}

const searchWithGoogleMapsNew = (...args) => googleMapsAdapter.searchText(...args)

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

leadWorkspaceRepository.init()

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, dataDir)
  },
  filename: (req, file, cb) => {
    // Keep original filename, but ensure it's a PDF
    const ext = path.extname(file.originalname)
    const name = path.basename(file.originalname, ext)
    cb(null, `${name}${ext}`)
  }
})

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
      cb(null, true)
    } else {
      cb(new Error('Only PDF files are allowed'))
    }
  }
})

app.use(cors())
app.use(express.json())

// Read knowledge.json
app.get('/api/unknown', (req, res) => {
  try {
    if (!fs.existsSync(knowledgeJsonPath)) {
      return res.json([])
    }
    const data = fs.readFileSync(knowledgeJsonPath, 'utf-8')
    const json = data.trim() ? JSON.parse(data) : []
    res.json(Array.isArray(json) ? json : [])
  } catch (error) {
    console.error('Error reading knowledge.json:', error)
    res.status(500).json({ error: 'Failed to read knowledge.json' })
  }
})

// Update knowledge.json
app.post('/api/unknown', (req, res) => {
  try {
    const questions = req.body
    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: 'Invalid data format' })
    }
    fs.writeFileSync(knowledgeJsonPath, JSON.stringify(questions, null, 2), 'utf-8')
    res.json({ success: true })
  } catch (error) {
    console.error('Error writing knowledge.json:', error)
    res.status(500).json({ error: 'Failed to write knowledge.json' })
  }
})

// Update single question
app.put('/api/unknown/:index', (req, res) => {
  try {
    const index = parseInt(req.params.index)
    const updatedQuestion = req.body
    
    if (!fs.existsSync(knowledgeJsonPath)) {
      return res.status(404).json({ error: 'knowledge.json not found' })
    }
    
    const data = fs.readFileSync(knowledgeJsonPath, 'utf-8')
    const questions = data.trim() ? JSON.parse(data) : []
    
    if (!Array.isArray(questions) || index < 0 || index >= questions.length) {
      return res.status(400).json({ error: 'Invalid index' })
    }
    
    questions[index] = updatedQuestion
    fs.writeFileSync(knowledgeJsonPath, JSON.stringify(questions, null, 2), 'utf-8')
    res.json({ success: true, question: updatedQuestion })
  } catch (error) {
    console.error('Error updating question:', error)
    res.status(500).json({ error: 'Failed to update question' })
  }
})

// Read applied.json
app.get('/api/applied', (req, res) => {
  try {
    if (!fs.existsSync(appliedJsonPath)) {
      return res.json([])
    }
    const data = fs.readFileSync(appliedJsonPath, 'utf-8')
    const json = data.trim() ? JSON.parse(data) : []
    res.json(Array.isArray(json) ? json : [])
  } catch (error) {
    console.error('Error reading applied.json:', error)
    res.status(500).json({ error: 'Failed to read applied.json' })
  }
})

// Update applied.json
app.post('/api/applied', (req, res) => {
  try {
    const applications = req.body
    if (!Array.isArray(applications)) {
      return res.status(400).json({ error: 'Invalid data format' })
    }
    fs.writeFileSync(appliedJsonPath, JSON.stringify(applications, null, 2), 'utf-8')
    res.json({ success: true })
  } catch (error) {
    console.error('Error writing applied.json:', error)
    res.status(500).json({ error: 'Failed to write applied.json' })
  }
})


/* DISABLED FOR VERCEL - All resume/PDF routes removed (old job application feature)
   Originally from line 342 to ~line 470
   Removed routes:
   - GET /api/resumes
   - POST /api/resumes/upload
   - DELETE /api/resumes/:filename
   - POST /api/resumes/parse/:filename
   - extractTextFromPDF() function
*/


export { app }
export default app

if (isDirectExecution()) {
  startServer()
}
