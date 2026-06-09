import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'
import net from 'net'
import { PDFParse } from 'pdf-parse'
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
const { TAVILY_API_KEY, BRAVE_API_KEY, GOOGLE_MAPS_API_KEY, GIST_ID, GITHUB_GIST_TOKEN, GIST_CUSTOMER_DATA_FILENAME } = loadServerEnv(__dirname)
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

// Get list of resume files
app.get('/api/resumes', (req, res) => {
  try {
    const files = fs.readdirSync(dataDir)
    const resumeFiles = files
      .filter(file => file.toLowerCase().endsWith('.pdf'))
      .map(file => {
        const filePath = path.join(dataDir, file)
        const stats = fs.statSync(filePath)
        return {
          name: file,
          type: 'application/pdf',
          size: stats.size,
          uploadedAt: stats.mtime.toISOString()
        }
      })
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    
    res.json(resumeFiles)
  } catch (error) {
    console.error('Error reading resume files:', error)
    res.status(500).json({ error: 'Failed to read resume files' })
  }
})

// Upload resume file
app.post('/api/resumes/upload', (req, res) => {
  console.log('Upload request received')
  upload.single('resume')(req, res, (err) => {
    if (err) {
      console.error('Upload error:', err)
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' })
        }
        return res.status(400).json({ error: err.message || 'Upload error' })
      }
      return res.status(400).json({ error: err.message || 'Upload failed' })
    }
    
    try {
      if (!req.file) {
        console.log('No file in request')
        return res.status(400).json({ error: 'No file uploaded. Please select a PDF file.' })
      }
      
      console.log('File uploaded successfully:', req.file.filename)
      res.json({
        success: true,
        file: {
          name: req.file.filename,
          size: req.file.size,
          uploadedAt: new Date().toISOString()
        }
      })
    } catch (error) {
      console.error('Error processing upload:', error)
      res.status(500).json({ error: error.message || 'Failed to upload resume' })
    }
  })
})

// Delete resume file
app.delete('/api/resumes/:filename', (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename)
    // Security: prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' })
    }

    const filePath = path.join(dataDir, filename)

    // Only allow deleting PDF files
    if (!filename.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only PDF files can be deleted' })
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' })
    }

    fs.unlinkSync(filePath)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting resume:', error)
    res.status(500).json({ error: 'Failed to delete resume' })
  }
})

// Parse resume and save to resume.txt
app.post('/api/resumes/parse/:filename', async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename)
    // Security: prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' })
    }

    const filePath = path.join(dataDir, filename)

    // Only allow parsing PDF files
    if (!filename.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only PDF files can be parsed' })
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' })
    }

    console.log('Parsing resume:', filename)

    // Read PDF file buffer
    const dataBuffer = fs.readFileSync(filePath)

    // Parse the PDF using pdf-parse v2
    const parser = new PDFParse({ data: dataBuffer })
    const result = await parser.getText()
    const text = result.text
    console.log('Extracted text length:', text.length)

    // Clean up the parser
    await parser.destroy()

    // Save raw text to resume.txt
    fs.writeFileSync(resumeTxtPath, text, 'utf-8')
    console.log('Resume text saved to resume.txt')

    // Save metadata to resume-meta.json
    const meta = {
      sourceFile: filename,
      parsedAt: new Date().toISOString(),
      textLength: text.length
    }
    fs.writeFileSync(resumeMetaPath, JSON.stringify(meta, null, 2), 'utf-8')
    console.log('Resume metadata saved to resume-meta.json')

    res.json({
      success: true,
      sourceFile: filename,
      textLength: text.length
    })
  } catch (error) {
    console.error('Error parsing resume:', error)
    res.status(500).json({ error: error.message || 'Failed to parse resume' })
  }
})

// Get current parsed resume metadata
app.get('/api/resume', (req, res) => {
  try {
    if (!fs.existsSync(resumeMetaPath)) {
      return res.json({
        exists: false,
        sourceFile: null,
        parsedAt: null,
        textLength: 0
      })
    }

    const metaData = fs.readFileSync(resumeMetaPath, 'utf-8')
    const meta = metaData.trim() ? JSON.parse(metaData) : null

    if (!meta) {
      return res.json({
        exists: false,
        sourceFile: null,
        parsedAt: null,
        textLength: 0
      })
    }

    res.json({
      exists: true,
      sourceFile: meta.sourceFile,
      parsedAt: meta.parsedAt,
      textLength: meta.textLength
    })
  } catch (error) {
    console.error('Error reading resume metadata:', error)
    res.status(500).json({ error: 'Failed to read resume metadata' })
  }
})

// Prompts API
// Get all prompts
app.get('/api/prompts', (req, res) => {
  try {
    if (!fs.existsSync(promptsJsonPath)) {
      return res.json({ prompts: [] })
    }
    const data = fs.readFileSync(promptsJsonPath, 'utf-8')
    const json = data.trim() ? JSON.parse(data) : { prompts: [] }

    // Load content from .md files if file field exists
    const promptsWithContent = json.prompts.map(prompt => {
      if (prompt.file) {
        const filePath = path.join(dataDir, prompt.file)
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8')
          return { ...prompt, content }
        }
      }
      return prompt
    })

    res.json({ prompts: promptsWithContent })
  } catch (error) {
    console.error('Error reading prompts.json:', error)
    res.status(500).json({ error: 'Failed to read prompts.json' })
  }
})

// Create new prompt
app.post('/api/prompts', (req, res) => {
  try {
    const { name, content, isDefault } = req.body

    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' })
    }

    let promptsData = { prompts: [] }
    if (fs.existsSync(promptsJsonPath)) {
      const data = fs.readFileSync(promptsJsonPath, 'utf-8')
      promptsData = data.trim() ? JSON.parse(data) : { prompts: [] }
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      promptsData.prompts = promptsData.prompts.map(p => ({ ...p, isDefault: false }))
    }

    const promptId = `prompt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const fileName = `prompts/${promptId}.md`
    const filePath = path.join(dataDir, fileName)

    // Save content to .md file
    fs.writeFileSync(filePath, content, 'utf-8')

    const newPrompt = {
      id: promptId,
      name,
      file: fileName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDefault: isDefault || false
    }

    promptsData.prompts.push(newPrompt)
    fs.writeFileSync(promptsJsonPath, JSON.stringify(promptsData, null, 2), 'utf-8')

    // Return prompt with content for client
    res.json({ success: true, prompt: { ...newPrompt, content } })
  } catch (error) {
    console.error('Error creating prompt:', error)
    res.status(500).json({ error: 'Failed to create prompt' })
  }
})

// Update prompt
app.put('/api/prompts/:id', (req, res) => {
  try {
    const { id } = req.params
    const { name, content, isDefault } = req.body

    if (!fs.existsSync(promptsJsonPath)) {
      return res.status(404).json({ error: 'prompts.json not found' })
    }

    const data = fs.readFileSync(promptsJsonPath, 'utf-8')
    const promptsData = data.trim() ? JSON.parse(data) : { prompts: [] }

    const index = promptsData.prompts.findIndex(p => p.id === id)
    if (index === -1) {
      return res.status(404).json({ error: 'Prompt not found' })
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      promptsData.prompts = promptsData.prompts.map(p =>
        p.id === id ? p : { ...p, isDefault: false }
      )
    }

    const prompt = promptsData.prompts[index]

    // Update content in .md file if content is provided
    if (content !== undefined && prompt.file) {
      const filePath = path.join(dataDir, prompt.file)
      fs.writeFileSync(filePath, content, 'utf-8')
    }

    // Update metadata in prompts.json
    promptsData.prompts[index] = {
      ...prompt,
      name: name !== undefined ? name : prompt.name,
      isDefault: isDefault !== undefined ? isDefault : prompt.isDefault,
      updatedAt: new Date().toISOString()
    }

    fs.writeFileSync(promptsJsonPath, JSON.stringify(promptsData, null, 2), 'utf-8')

    // Return updated prompt with content
    const updatedPrompt = { ...promptsData.prompts[index] }
    if (updatedPrompt.file) {
      const filePath = path.join(dataDir, updatedPrompt.file)
      if (fs.existsSync(filePath)) {
        updatedPrompt.content = fs.readFileSync(filePath, 'utf-8')
      }
    }

    res.json({ success: true, prompt: updatedPrompt })
  } catch (error) {
    console.error('Error updating prompt:', error)
    res.status(500).json({ error: 'Failed to update prompt' })
  }
})

// Delete prompt
app.delete('/api/prompts/:id', (req, res) => {
  try {
    const { id } = req.params

    if (!fs.existsSync(promptsJsonPath)) {
      return res.status(404).json({ error: 'prompts.json not found' })
    }

    const data = fs.readFileSync(promptsJsonPath, 'utf-8')
    const promptsData = data.trim() ? JSON.parse(data) : { prompts: [] }

    const index = promptsData.prompts.findIndex(p => p.id === id)
    if (index === -1) {
      return res.status(404).json({ error: 'Prompt not found' })
    }

    const prompt = promptsData.prompts[index]

    // Delete the .md file if it exists
    if (prompt.file) {
      const filePath = path.join(dataDir, prompt.file)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    }

    promptsData.prompts.splice(index, 1)
    fs.writeFileSync(promptsJsonPath, JSON.stringify(promptsData, null, 2), 'utf-8')
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting prompt:', error)
    res.status(500).json({ error: 'Failed to delete prompt' })
  }
})

// Job Filters API
// Get all job filters
app.get('/api/job-filters', (req, res) => {
  try {
    if (!fs.existsSync(jobFiltersJsonPath)) {
      return res.json({ filters: [] })
    }
    const data = fs.readFileSync(jobFiltersJsonPath, 'utf-8')
    const json = data.trim() ? JSON.parse(data) : { filters: [] }
    res.json(json)
  } catch (error) {
    console.error('Error reading job-filters.json:', error)
    res.status(500).json({ error: 'Failed to read job-filters.json' })
  }
})

// Update job filters
app.post('/api/job-filters', (req, res) => {
  try {
    const { filters } = req.body

    if (!Array.isArray(filters)) {
      return res.status(400).json({ error: 'Invalid data format' })
    }

    fs.writeFileSync(jobFiltersJsonPath, JSON.stringify({ filters }, null, 2), 'utf-8')
    res.json({ success: true })
  } catch (error) {
    console.error('Error writing job-filters.json:', error)
    res.status(500).json({ error: 'Failed to write job-filters.json' })
  }
})

// Logs API
// Get all logs
app.get('/api/logs', (req, res) => {
  try {
    if (!fs.existsSync(logsJsonPath)) {
      return res.json({ sessions: [] })
    }
    const data = fs.readFileSync(logsJsonPath, 'utf-8')
    const json = data.trim() ? JSON.parse(data) : { sessions: [] }
    res.json(json)
  } catch (error) {
    console.error('Error reading logs.json:', error)
    res.status(500).json({ error: 'Failed to read logs.json' })
  }
})

// Create new log session
app.post('/api/logs', (req, res) => {
  try {
    const { session } = req.body

    if (!session || !session.id) {
      return res.status(400).json({ error: 'Invalid session data' })
    }

    let logsData = { sessions: [] }
    if (fs.existsSync(logsJsonPath)) {
      const data = fs.readFileSync(logsJsonPath, 'utf-8')
      logsData = data.trim() ? JSON.parse(data) : { sessions: [] }
    }

    // Add new session at the beginning
    logsData.sessions.unshift(session)

    // Keep only last 50 sessions
    if (logsData.sessions.length > 50) {
      logsData.sessions = logsData.sessions.slice(0, 50)
    }

    fs.writeFileSync(logsJsonPath, JSON.stringify(logsData, null, 2), 'utf-8')
    res.json({ success: true, session })
  } catch (error) {
    console.error('Error creating log session:', error)
    res.status(500).json({ error: 'Failed to create log session' })
  }
})

// Append log entry to existing session
app.post('/api/logs/:sessionId/entries', (req, res) => {
  try {
    const { sessionId } = req.params
    const { entry } = req.body

    if (!entry) {
      return res.status(400).json({ error: 'Invalid entry data' })
    }

    if (!fs.existsSync(logsJsonPath)) {
      return res.status(404).json({ error: 'No logs found' })
    }

    const data = fs.readFileSync(logsJsonPath, 'utf-8')
    const logsData = data.trim() ? JSON.parse(data) : { sessions: [] }

    const session = logsData.sessions.find(s => s.id === sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    if (!session.entries) {
      session.entries = []
    }
    session.entries.push(entry)
    session.updatedAt = new Date().toISOString()

    fs.writeFileSync(logsJsonPath, JSON.stringify(logsData, null, 2), 'utf-8')
    res.json({ success: true })
  } catch (error) {
    console.error('Error appending log entry:', error)
    res.status(500).json({ error: 'Failed to append log entry' })
  }
})

// Delete log session
app.delete('/api/logs/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params

    if (!fs.existsSync(logsJsonPath)) {
      return res.status(404).json({ error: 'No logs found' })
    }

    const data = fs.readFileSync(logsJsonPath, 'utf-8')
    const logsData = data.trim() ? JSON.parse(data) : { sessions: [] }

    const index = logsData.sessions.findIndex(s => s.id === sessionId)
    if (index === -1) {
      return res.status(404).json({ error: 'Session not found' })
    }

    logsData.sessions.splice(index, 1)
    fs.writeFileSync(logsJsonPath, JSON.stringify(logsData, null, 2), 'utf-8')
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting log session:', error)
    res.status(500).json({ error: 'Failed to delete log session' })
  }
})

// Monitored Companies API
// Get all monitored companies
app.get('/api/monitored-companies', (req, res) => {
  try {
    if (!fs.existsSync(monitoredCompaniesJsonPath)) {
      return res.json({ companies: [] })
    }
    const data = fs.readFileSync(monitoredCompaniesJsonPath, 'utf-8')
    const json = data.trim() ? JSON.parse(data) : { companies: [] }
    res.json(json)
  } catch (error) {
    console.error('Error reading monitored-companies.json:', error)
    res.status(500).json({ error: 'Failed to read monitored-companies.json' })
  }
})

// Update monitored companies
app.post('/api/monitored-companies', (req, res) => {
  try {
    const { companies } = req.body

    if (!Array.isArray(companies)) {
      return res.status(400).json({ error: 'Invalid data format' })
    }

    fs.writeFileSync(monitoredCompaniesJsonPath, JSON.stringify({ companies }, null, 2), 'utf-8')
    res.json({ success: true })
  } catch (error) {
    console.error('Error writing monitored-companies.json:', error)
    res.status(500).json({ error: 'Failed to write monitored-companies.json' })
  }
})

app.get('/api/lead-workspaces', async (req, res) => {
  try {
    const workspaces = await leadWorkspaceRepository.list()
    res.json({ workspaces })
  } catch (error) {
    console.error('Error reading lead workspaces:', error)
    res.status(500).json({ error: 'Failed to read lead workspaces' })
  }
})

app.post('/api/lead-workspaces/discover', async (req, res) => {
  try {
    const { industry, keywords = [], country = '', targetTypes = [], excludeTypes = [] } = req.body

    if (!industry || typeof industry !== 'string') {
      return res.status(400).json({ error: 'Industry is required' })
    }

    const workspace = await leadDiscoveryService.discoverWorkspace({ industry, keywords, country, targetTypes, excludeTypes })
    const warnings = []

    try {
      await leadWorkspaceRepository.prependAndTrim(workspace, 25)
    } catch (storageError) {
      console.error('Error saving lead workspace:', storageError)
      warnings.push({
        code: storageError?.code || 'workspace_storage_failed',
        message: 'Workspace was created, but storage sync failed. Check Gist settings before saving.'
      })
    }

    res.json({ workspace, warnings })
  } catch (error) {
    console.error('Error creating lead workspace:', error)
    return sendLeadServiceError(res, error, 'Failed to create lead workspace')
  }
})

app.use('/api/lead-workspaces', createLeadOsintRouter({ osintResearchService }))
app.use('/api', createLeadSupportRouter({
  addressClassificationService,
  companySimilarityService,
  gistCustomerDataService,
  providerAvailability
}))
app.use('/api', createLeadExportRouter({
  leadWorkspaceRepository,
  gistCustomerDataService
}))

app.put('/api/lead-workspaces/:id/company/:companyId', async (req, res) => {
  try {
    const updateResult = await leadWorkspaceRepository.updateCompany(req.params.id, req.params.companyId, (company, workspace) => {
      const nextCompany = {
        ...company,
        ...req.body
      }

      const nextCompanies = workspace.companies.map((item) => item.id === company.id ? nextCompany : item)
      workspace.summary = createWorkspaceSummaryModule(nextCompanies, workspace.contacts || [], workspace.drafts || [])

      return nextCompany
    })

    if (!updateResult) {
      return res.status(404).json({ error: 'Workspace not found' })
    }

    if (!updateResult.company) {
      return res.status(404).json({ error: 'Company not found' })
    }

    res.json({ company: updateResult.company })
  } catch (error) {
    console.error('Error updating company:', error)
    res.status(500).json({ error: 'Failed to update company' })
  }
})


app.get('/api/lead-workspaces/:id', async (req, res) => {
  try {
    const workspace = await leadWorkspaceRepository.getById(req.params.id)

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' })
    }

    res.json({ workspace })
  } catch (error) {
    console.error('Error reading lead workspace:', error)
    res.status(500).json({ error: 'Failed to read lead workspace' })
  }
})

// Google Maps verification endpoint
app.post('/api/lead-workspaces/verify-google-maps', async (req, res) => {
  try {
    const { companyName, address } = req.body

    if (!providerAvailability.googleMaps.available) {
      return sendMissingEnvResponse(
        res,
        'GOOGLE_MAPS_API_KEY is required for Google Maps verification.',
        providerAvailability.googleMaps.missingEnvVars
      )
    }

    if (!companyName) {
      return res.status(400).json({ error: 'companyName is required' })
    }

    const result = await addressVerificationService.verifyCompanyAddress({ companyName, address })
    res.json(result)
  } catch (error) {
    console.error('Error verifying with Google Maps:', error)
    return sendLeadServiceError(res, error, 'Failed to verify with Google Maps')
  }
})

// Google Maps Search endpoint (active lead generation)
app.post('/api/google-maps/search', async (req, res) => {
  try {
    const { query, location, filters = {} } = req.body

    if (!providerAvailability.googleMaps.available) {
      return sendMissingEnvResponse(
        res,
        'GOOGLE_MAPS_API_KEY is required for Google Maps search.',
        providerAvailability.googleMaps.missingEnvVars
      )
    }

    if (!query) {
      return res.status(400).json({ error: 'query is required' })
    }

    const result = await googleMapsSearchService.search({ query, location, filters })
    res.json(result)
  } catch (error) {
    console.error('Error searching Google Maps:', error)
    return sendLeadServiceError(res, error, 'Failed to search Google Maps')
  }
})

// Batch CSV/Excel verification endpoint
app.post('/api/lead-workspaces/batch-verify-csv', async (req, res) => {
  try {
    const { companies } = req.body

    if (!providerAvailability.googleMaps.available) {
      return sendMissingEnvResponse(
        res,
        'GOOGLE_MAPS_API_KEY is required for batch Google Maps verification.',
        providerAvailability.googleMaps.missingEnvVars
      )
    }

    if (!Array.isArray(companies) || companies.length === 0) {
      return res.status(400).json({ error: 'companies array is required and must not be empty' })
    }

    const result = await batchAddressVerificationService.verifyCompanies(companies)
    res.json(result)
  } catch (error) {
    console.error('Error batch verifying with Google Maps:', error)
    return sendLeadServiceError(res, error, 'Failed to batch verify with Google Maps')
  }
})

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

