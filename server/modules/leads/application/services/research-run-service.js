import fs from 'fs'
import path from 'path'

function createId(type) {
  return `run-${type || 'research'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readLocalDocument(filePath) {
  if (!fs.existsSync(filePath)) {
    return { researchRuns: [], searchCache: [], apiUsage: [] }
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  return content.trim() ? JSON.parse(content) : { researchRuns: [], searchCache: [], apiUsage: [] }
}

function writeLocalDocument(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(document, null, 2), 'utf-8')
}

export function createResearchRunService({ rootDir, gistCustomerDataService }) {
  const localFilePath = path.join(rootDir, 'data', 'research-runs.json')

  async function readDocument() {
    const config = gistCustomerDataService?.getConfigurationStatus?.()
    if (config?.configured) {
      const result = await gistCustomerDataService.readCustomerData()
      return result.data
    }
    return readLocalDocument(localFilePath)
  }

  async function writeSections(sections) {
    const config = gistCustomerDataService?.getConfigurationStatus?.()
    if (config?.configured) {
      return gistCustomerDataService.updateCustomerData(sections)
    }
    const current = readLocalDocument(localFilePath)
    const next = { ...current, ...sections }
    writeLocalDocument(localFilePath, next)
    return { storage: 'local', data: next }
  }

  async function list({ type, limit = 50 } = {}) {
    const document = await readDocument()
    const runs = Array.isArray(document.researchRuns) ? document.researchRuns : []
    return runs
      .filter((run) => !type || run.type === type)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, limit)
  }

  async function createRun({ type, input, status = 'running', providerCalls = [], results = [], evidence = [], summary = '', errors = [] }) {
    const document = await readDocument()
    const runs = Array.isArray(document.researchRuns) ? document.researchRuns : []
    const now = new Date().toISOString()
    const run = {
      id: createId(type),
      type,
      input: input || {},
      status,
      createdAt: now,
      updatedAt: now,
      providerCalls,
      results,
      evidence,
      summary,
      errors
    }
    await writeSections({ researchRuns: [run, ...runs].slice(0, 200) })
    return run
  }

  async function completeRun(id, patch = {}) {
    const document = await readDocument()
    const runs = Array.isArray(document.researchRuns) ? document.researchRuns : []
    const nextRuns = runs.map((run) => run.id === id
      ? {
          ...run,
          ...patch,
          status: patch.status || 'completed',
          updatedAt: new Date().toISOString()
        }
      : run)
    await writeSections({ researchRuns: nextRuns })
    return nextRuns.find((run) => run.id === id) || null
  }

  async function saveCompletedRun({ type, input, providerCalls = [], results = [], evidence = [], summary = '', errors = [] }) {
    return createRun({
      type,
      input,
      status: errors.length ? 'completed_with_warnings' : 'completed',
      providerCalls,
      results,
      evidence,
      summary,
      errors
    })
  }

  return {
    list,
    createRun,
    completeRun,
    saveCompletedRun
  }
}
