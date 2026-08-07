import express from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadServerEnv } from './config/env.js'
import { createLeadWorkspaceRepository } from './modules/leads/repositories/lead-workspace-repository.js'
import { dedupeStrings } from './modules/leads/shared/text-utils.js'
import { createAIAgent } from './modules/leads/services/ai-agent.js'
import { createLeadAITools } from './modules/leads/services/ai-tools.js'
import { createLeadFinderService } from './modules/leads/services/lead-finder-service.js'
import { createSimilarCompanyService } from './modules/leads/services/similar-company.js'
import { createOsintService } from './modules/leads/services/osint.js'
import { createTavilyAdapter } from './modules/leads/providers/tavily-adapter.js'
import { createBraveAdapter } from './modules/leads/providers/brave-adapter.js'
import { createGoogleMapsAdapter } from './modules/leads/providers/google-maps-adapter.js'
import { createGoogleMapsSearchService } from './modules/leads/application/services/google-maps-search-service.js'
import { createAddressClassificationService } from './modules/leads/application/services/address-classification-service.js'
import { createLeadDiscoveryService } from './modules/leads/application/services/lead-discovery-service.js'
import { createOsintResearchService } from './modules/leads/application/services/osint-research-service.js'
import { createResearchRunsStorage } from './modules/leads/storage/research-runs-storage.js'
import { createUsageStatsStorage } from './modules/leads/storage/usage-stats-storage.js'
import { createLeadSupportRouter } from './modules/leads/routes/lead-support-routes.js'
import { createLeadExportRouter } from './modules/leads/routes/lead-export-routes.js'
import { createApiRouter as createLeadApiRouter } from './modules/leads/routes/api-routes.js'
import GistService from '../storage/gist-service.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const isServerlessRuntime = Boolean(process.env.VERCEL || process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME)
const writableRoot = isServerlessRuntime ? path.join(os.tmpdir(), 'apply-bot') : projectRoot

// Keep the configured environment values unchanged, but enforce a bounded
// synchronous budget for Vercel's current 60-second runtime limit.
const serverlessLeadFinderPolicy = isServerlessRuntime
  ? {
      requestBudgetMs: 45000,
      aiTimeoutMs: 10000,
      maxTokens: 4000,
      maxIterationsCap: 2,
      maxToolCalls: 4,
      toolTimeoutMs: 4000
    }
  : {}

const {
  TAVILY_API_KEY,
  TAVILY_API_KEY_BACKUP,
  BRAVE_API_KEY,
  BRAVE_API_KEY_BACKUP,
  GOOGLE_MAPS_API_KEY,
  GIST_ID,
  GITHUB_GIST_TOKEN,
  GIST_CUSTOMER_DATA_FILENAME,
  AI_API_HOST,
  AI_API_KEY,
  AI_MODEL,
  AI_REASONING_EFFORT,
  AI_TIMEOUT_MS,
  AI_MAX_TOKENS
} = loadServerEnv(projectRoot)

const gistService = new GistService(
  GIST_ID,
  GITHUB_GIST_TOKEN,
  GIST_CUSTOMER_DATA_FILENAME
)

const aiAgent = (AI_API_HOST && AI_API_KEY && AI_MODEL)
  ? createAIAgent({
      apiHost: AI_API_HOST,
      apiKey: AI_API_KEY,
      model: AI_MODEL,
      reasoningEffort: AI_REASONING_EFFORT,
      timeoutMs: AI_TIMEOUT_MS,
      maxTokens: AI_MAX_TOKENS
    })
  : null

const tavilyAdapter = createTavilyAdapter({
  apiKey: TAVILY_API_KEY,
  apiKeys: [TAVILY_API_KEY_BACKUP]
})

const braveAdapter = createBraveAdapter({
  apiKey: BRAVE_API_KEY,
  apiKeys: [BRAVE_API_KEY_BACKUP]
})

const googleMapsAdapter = createGoogleMapsAdapter({
  apiKey: GOOGLE_MAPS_API_KEY
})

const googleMapsSearchService = createGoogleMapsSearchService({
  googleMapsAdapter
})

const aiTools = aiAgent ? createLeadAITools({
  tavilyAdapter,
  braveAdapter,
  googleMapsAdapter,
  timeoutMs: isServerlessRuntime ? 4000 : 8000
}) : []

const leadFinderService = aiAgent ? createLeadFinderService({
  aiAgent,
  tools: aiTools,
  promptStorage: gistService,
  ...serverlessLeadFinderPolicy
}) : null

const similarCompanyService = aiAgent ? createSimilarCompanyService({
  aiAgent,
  tools: aiTools,
  promptStorage: gistService
}) : null

const osintService = aiAgent ? createOsintService({
  aiAgent,
  tools: aiTools,
  promptStorage: gistService,
  gistStorage: gistService
}) : null

const addressClassificationService = createAddressClassificationService({
  googleMapsSearchService
})

const researchRunsStorage = createResearchRunsStorage({ gistService })
const usageStatsStorage = createUsageStatsStorage({ gistService })

const promptStorage = {
  async read(type) {
    return gistService.getPrompt(type)
  },
  async write(type, content) {
    return gistService.savePrompt(type, content)
  },
  async delete(type) {
    return gistService.deletePrompt(type)
  }
}

const researchRunsStorageAdapter = {
  async list({ limit = 100, offset = 0 } = {}) {
    const result = await gistService.readCustomerData()
    const runs = Array.isArray(result.data?.researchRuns) ? result.data.researchRuns : []
    return runs.slice(offset, offset + limit)
  },
  async save(run) {
    await gistService.saveResearchRun(run)
  }
}

const usageStatsStorageAdapter = {
  async get(period = 'day') {
    const result = await gistService.readCustomerData()
    const runs = Array.isArray(result.data?.researchRuns) ? result.data.researchRuns : []
    const byWorkflow = {}
    const providers = {}

    for (const run of runs) {
      const workflow = run.workflow || 'unknown'
      byWorkflow[workflow] = (byWorkflow[workflow] || 0) + 1
      for (const call of run.searchCalls || []) {
        const provider = call.provider || 'unknown'
        providers[provider] = (providers[provider] || 0) + 1
      }
      for (const call of run.verificationCalls || []) {
        const provider = call.provider || 'unknown'
        providers[provider] = (providers[provider] || 0) + 1
      }
    }

    return { period, totalRuns: runs.length, byWorkflow, providers }
  }
}

const leadWorkspaceRepository = createLeadWorkspaceRepository(writableRoot, {
  gistCustomerDataService: gistService
})

const leadFeatureUnavailable = {
  success: false,
  code: 'lead_feature_unavailable',
  error: 'This lead workflow is temporarily unavailable while the AI refactor is rebuilt.'
}

const providerAvailability = {
  tavily: {
    available: Boolean(TAVILY_API_KEY || TAVILY_API_KEY_BACKUP),
    missingEnvVars: TAVILY_API_KEY || TAVILY_API_KEY_BACKUP ? [] : ['TAVILY_API_KEY']
  },
  brave: {
    available: Boolean(BRAVE_API_KEY || BRAVE_API_KEY_BACKUP),
    missingEnvVars: BRAVE_API_KEY || BRAVE_API_KEY_BACKUP ? [] : ['BRAVE_API_KEY']
  },
  googleMaps: {
    available: Boolean(GOOGLE_MAPS_API_KEY),
    missingEnvVars: GOOGLE_MAPS_API_KEY ? [] : ['GOOGLE_MAPS_API_KEY']
  },
  ai: {
    available: Boolean(AI_API_HOST && AI_API_KEY && AI_MODEL),
    missingEnvVars: [
      AI_API_HOST ? '' : 'AI_API_HOST',
      AI_API_KEY ? '' : 'AI_API_KEY',
      AI_MODEL ? '' : 'AI_MODEL'
    ].filter(Boolean)
  }
}

const aiConfiguration = {
  configured: providerAvailability.ai.available,
  host: (() => {
    try {
      return AI_API_HOST ? new URL(AI_API_HOST).hostname : ''
    } catch {
      return ''
    }
  })(),
  model: AI_MODEL,
  reasoningEffort: AI_REASONING_EFFORT || 'default',
  timeoutMs: AI_TIMEOUT_MS,
  maxTokens: AI_MAX_TOKENS
}

const evidenceOsintService = createOsintResearchService({
  googleMapsSearch: googleMapsSearchService.search,
  braveSearch: braveAdapter.search,
  tavilySearch: tavilyAdapter.search,
  providerAvailability: {
    googleMaps: providerAvailability.googleMaps.available,
    brave: providerAvailability.brave.available,
    tavily: providerAvailability.tavily.available,
    googleMapsReason: providerAvailability.googleMaps.missingEnvVars.join(', '),
    braveReason: providerAvailability.brave.missingEnvVars.join(', '),
    tavilyReason: providerAvailability.tavily.missingEnvVars.join(', ')
  }
})

function sendMissingEnvResponse(res, message, missingEnvVars) {
  return res.status(503).json({
    success: false,
    code: 'missing_env',
    error: message,
    missingEnvVars
  })
}

function sendLeadFeatureUnavailable(res, feature) {
  return res.status(501).json({
    ...leadFeatureUnavailable,
    feature
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

function createWorkspaceSummary(companies, contacts, drafts) {
  return {
    companyCount: companies.length,
    contactCount: contacts.length,
    draftCount: drafts.length,
    topProfiles: dedupeStrings(companies.map((company) => company.profile)).slice(0, 4)
  }
}

const dataDir = path.join(writableRoot, 'data')
const knowledgeJsonPath = path.join(dataDir, 'knowledge.json')
const appliedJsonPath = path.join(dataDir, 'applied.json')
const promptsJsonPath = path.join(dataDir, 'prompts.json')
const jobFiltersJsonPath = path.join(dataDir, 'job-filters.json')
const logsJsonPath = path.join(dataDir, 'logs.json')
const monitoredCompaniesJsonPath = path.join(dataDir, 'monitored-companies.json')
const resumeTxtPath = path.join(dataDir, 'resume.txt')
const resumeMetaPath = path.join(dataDir, 'resume-meta.json')

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

leadWorkspaceRepository.init()

const router = express.Router()

// Read knowledge.json
router.get('/unknown', (req, res) => {
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
router.post('/unknown', (req, res) => {
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
router.put('/unknown/:index', (req, res) => {
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
router.get('/applied', (req, res) => {
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
router.post('/applied', (req, res) => {
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
router.get('/resumes', (req, res) => {
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
router.post('/resumes/upload', (req, res) => {
  res.status(410).json({
    success: false,
    code: 'resume_upload_disabled',
    error: 'Resume PDF upload is disabled in the serverless lead-generation deployment.'
  })
})

// Delete resume file
router.delete('/resumes/:filename', (req, res) => {
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
router.post('/resumes/parse/:filename', async (req, res) => {
  res.status(410).json({
    success: false,
    code: 'resume_pdf_parse_disabled',
    error: 'Resume PDF parsing is disabled in the serverless lead-generation deployment.'
  })
})

// Get current parsed resume metadata
router.get('/resume', (req, res) => {
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
router.get('/prompts/:type', async (req, res) => {
  try {
    const { type } = req.params
    const prompt = await gistService.getPrompt(type)
    res.json({ prompt })
  } catch (error) {
    console.error('Error reading prompt:', error)
    res.status(500).json({ error: 'Failed to read prompt' })
  }
})

router.put('/prompts/:type', async (req, res) => {
  try {
    const { type } = req.params
    const { content } = req.body
    await gistService.savePrompt(type, content)
    res.json({ success: true })
  } catch (error) {
    console.error('Error updating prompt:', error)
    res.status(500).json({ error: 'Failed to update prompt' })
  }
})

router.delete('/prompts/:type', async (req, res) => {
  try {
    const { type } = req.params
    await gistService.deletePrompt(type)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting prompt:', error)
    res.status(500).json({ error: 'Failed to delete prompt' })
  }
})

// Job Filters API
router.get('/job-filters', (req, res) => {
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

router.post('/job-filters', (req, res) => {
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
router.get('/logs', (req, res) => {
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

router.post('/logs', (req, res) => {
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

    logsData.sessions.unshift(session)

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

router.post('/logs/:sessionId/entries', (req, res) => {
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

router.delete('/logs/:sessionId', (req, res) => {
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
router.get('/monitored-companies', (req, res) => {
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

router.post('/monitored-companies', (req, res) => {
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

// Lead workflows are handled by mounted modular routers below.

const leadApiRouter = createLeadApiRouter({
  leadFinderService,
  similarCompanyService,
  osintService,
  fallbackOsintService: evidenceOsintService,
  promptStorage,
  researchRunsStorage: researchRunsStorageAdapter,
  usageStatsStorage: usageStatsStorageAdapter,
  providerAvailability,
  aiConfiguration,
  persistTimeoutMs: isServerlessRuntime ? 5000 : 0
})

const leadSupportRouter = createLeadSupportRouter({
  addressClassificationService,
  companySimilarityService: similarCompanyService,
  googleMapsSearchService,
  researchRunsStorage: researchRunsStorageAdapter,
  gistCustomerDataService: gistService,
  providerAvailability
})

const leadExportRouter = createLeadExportRouter({
  leadWorkspaceRepository,
  gistCustomerDataService: gistService
})

router.use('/', leadApiRouter)
router.use('/', leadSupportRouter)
router.use('/', leadExportRouter)

export default router
