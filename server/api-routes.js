import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadServerEnv } from './config/env.js'
import { createLeadWorkspaceRepository } from './modules/leads/repositories/lead-workspace-repository.js'
import { dedupeStrings } from './modules/leads/shared/text-utils.js'
import GistService from '../storage/gist-service.js'

const gistService = new GistService(
  process.env.GIST_ID,
  process.env.GITHUB_GIST_TOKEN
)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const {
  TAVILY_API_KEY,
  BRAVE_API_KEY,
  GOOGLE_MAPS_API_KEY,
  AI_API_HOST,
  AI_API_KEY,
  AI_MODEL
} = loadServerEnv(projectRoot)

const leadWorkspaceRepository = createLeadWorkspaceRepository(projectRoot)

const leadFeatureUnavailable = {
  success: false,
  code: 'lead_feature_unavailable',
  error: 'This lead workflow is temporarily unavailable while the AI refactor is rebuilt.'
}

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

const dataDir = path.join(projectRoot, 'data')
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

// Lead Workspaces API
router.get('/lead-workspaces', async (req, res) => {
  try {
    const workspaces = await leadWorkspaceRepository.list()
    res.json({ workspaces })
  } catch (error) {
    console.error('Error reading lead workspaces:', error)
    res.status(500).json({ error: 'Failed to read lead workspaces' })
  }
})

router.post('/lead-workspaces/discover', async (req, res) => {
  try {
    const { industry } = req.body

    if (!industry || typeof industry !== 'string') {
      return res.status(400).json({ error: 'Industry is required' })
    }

    return sendLeadFeatureUnavailable(res, 'lead-workspace-discovery')
  } catch (error) {
    console.error('Error creating lead workspace:', error)
    return sendLeadServiceError(res, error, 'Failed to create lead workspace')
  }
})

router.get('/lead-workspaces/:id', async (req, res) => {
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

router.put('/lead-workspaces/:id/company/:companyId', async (req, res) => {
  try {
    const updateResult = await leadWorkspaceRepository.updateCompany(req.params.id, req.params.companyId, (company, workspace) => {
      const nextCompany = {
        ...company,
        ...req.body
      }

      const nextCompanies = workspace.companies.map((item) => item.id === company.id ? nextCompany : item)
      workspace.summary = createWorkspaceSummary(nextCompanies, workspace.contacts || [], workspace.drafts || [])

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

// Google Maps API
router.post('/lead-workspaces/verify-google-maps', async (req, res) => {
  try {
    const { companyName, address } = req.body

    if (!providerAvailability.googleMaps.available) {
      return sendMissingEnvResponse(
        res,
        'GOOGLE_MAPS_API_KEY is required for Google Maps verification.',
        providerAvailability.googleMaps.missingEnvVars
      )
    }

    if (!companyName && !address) {
      return res.status(400).json({ error: 'companyName or address is required' })
    }

    return sendLeadFeatureUnavailable(res, 'google-maps-verification')
  } catch (error) {
    console.error('Error verifying with Google Maps:', error)
    return sendLeadServiceError(res, error, 'Failed to verify with Google Maps')
  }
})

router.post('/google-maps/company-locations', async (req, res) => {
  try {
    const { companyName, country = '', maxResults = 10 } = req.body || {}
    if (!providerAvailability.googleMaps.available) {
      return sendMissingEnvResponse(res, 'GOOGLE_MAPS_API_KEY is required for company location lookup.', providerAvailability.googleMaps.missingEnvVars)
    }
    if (!companyName) {
      return res.status(400).json({ error: 'companyName is required' })
    }
    return sendLeadFeatureUnavailable(res, 'google-maps-company-locations')
  } catch (error) {
    console.error('Error finding company locations:', error)
    return sendLeadServiceError(res, error, 'Failed to find company locations')
  }
})

router.post('/google-maps/address-lookup', async (req, res) => {
  try {
    const { address, country = '', maxResults = 10 } = req.body || {}
    if (!providerAvailability.googleMaps.available) {
      return sendMissingEnvResponse(res, 'GOOGLE_MAPS_API_KEY is required for address lookup.', providerAvailability.googleMaps.missingEnvVars)
    }
    if (!address) {
      return res.status(400).json({ error: 'address is required' })
    }
    return sendLeadFeatureUnavailable(res, 'google-maps-address-lookup')
  } catch (error) {
    console.error('Error looking up address:', error)
    return sendLeadServiceError(res, error, 'Failed to look up address')
  }
})

router.post('/google-maps/verify-company-address', async (req, res) => {
  try {
    const { companyName, address, country = '', maxResults = 10 } = req.body || {}
    if (!providerAvailability.googleMaps.available) {
      return sendMissingEnvResponse(res, 'GOOGLE_MAPS_API_KEY is required for company address verification.', providerAvailability.googleMaps.missingEnvVars)
    }
    if (!companyName || !address) {
      return res.status(400).json({ error: 'companyName and address are required' })
    }
    return sendLeadFeatureUnavailable(res, 'google-maps-company-address-verification')
  } catch (error) {
    console.error('Error verifying company address:', error)
    return sendLeadServiceError(res, error, 'Failed to verify company address')
  }
})

router.post('/google-maps/search', async (req, res) => {
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

    return sendLeadFeatureUnavailable(res, 'google-maps-search')
  } catch (error) {
    console.error('Error searching Google Maps:', error)
    return sendLeadServiceError(res, error, 'Failed to search Google Maps')
  }
})

router.post('/lead-workspaces/batch-verify-csv', async (req, res) => {
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

    return sendLeadFeatureUnavailable(res, 'batch-google-maps-verification')
  } catch (error) {
    console.error('Error batch verifying with Google Maps:', error)
    return sendLeadServiceError(res, error, 'Failed to batch verify with Google Maps')
  }
})

// AI Config Status
router.get('/ai/config-status', (req, res) => {
  res.json({
    success: true,
    configured: providerAvailability.ai.available,
    missingEnvVars: providerAvailability.ai.missingEnvVars,
    model: AI_MODEL || '',
    provider: 'openai-compatible'
  })
})

// Disabled features (return 501)
router.post('/lead-workspaces/osint-research', (req, res) => {
  return sendLeadFeatureUnavailable(res, 'osint-research')
})

router.post('/addresses/batch-classify', (req, res) => {
  return sendLeadFeatureUnavailable(res, 'address-classification')
})

router.post('/companies/find-similar', (req, res) => {
  return sendLeadFeatureUnavailable(res, 'similar-company-search')
})

router.get('/customer-data', (req, res) => {
  return sendLeadFeatureUnavailable(res, 'customer-data-gist-sync')
})

router.put('/customer-data', (req, res) => {
  return sendLeadFeatureUnavailable(res, 'customer-data-gist-sync')
})

router.get('/lead-workspaces/:id/export.csv', (req, res) => {
  return sendLeadFeatureUnavailable(res, 'lead-workspace-export')
})

router.get('/lead-workspaces/:id/export.xlsx', (req, res) => {
  return sendLeadFeatureUnavailable(res, 'lead-workspace-export')
})

router.get('/customer-data/export.xlsx', (req, res) => {
  return sendLeadFeatureUnavailable(res, 'customer-data-export')
})

router.get('/research-runs', (req, res) => {
  return sendLeadFeatureUnavailable(res, 'research-runs')
})

router.get('/provider-usage', (req, res) => {
  return sendLeadFeatureUnavailable(res, 'provider-usage')
})

export default router
