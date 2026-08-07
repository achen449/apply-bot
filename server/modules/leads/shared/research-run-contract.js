export const RESEARCH_RUN_TTL_DAYS = 60

const VALID_STATUSES = new Set(['completed', 'partial', 'needs_review', 'failed'])

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function asStatus(value, fallback = 'needs_review') {
  return VALID_STATUSES.has(value) ? value : fallback
}

export function calculateResearchRunExpiry(createdAt, now = new Date()) {
  const created = new Date(createdAt || now)
  const base = Number.isNaN(created.getTime()) ? now : created
  const expiresAt = new Date(base.getTime() + RESEARCH_RUN_TTL_DAYS * 24 * 60 * 60 * 1000)
  return expiresAt.toISOString()
}

export function isResearchRunExpired(run = {}, now = new Date()) {
  if (!hasText(run.expiresAt)) {
    return false
  }

  const expiresAt = new Date(run.expiresAt)
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()
}

export function pruneResearchRuns(runs = [], now = new Date()) {
  return (Array.isArray(runs) ? runs : []).filter((run) => !isResearchRunExpired(run, now))
}

function inferLegacyWorkflow(run = {}) {
  const text = `${run.title || ''} ${run.id || ''}`.toLowerCase()
  if (run.sampleCompany || text.includes('similar-company')) {
    return 'similar-company'
  }
  if (run.workspace || run.queryInput?.industry || text.includes('lead-finder')) {
    return 'lead-finder'
  }
  if (run.subject || run.report || text.includes('osint') || text.startsWith('research-')) {
    return 'osint'
  }
  return 'legacy'
}

export function normalizeStoredResearchRun(run = {}) {
  const id = run.id || `legacy-run-${Date.now()}`
  const workflow = run.workflow || inferLegacyWorkflow(run)
  const status = VALID_STATUSES.has(run.status) ? run.status : 'needs_review'
  const hasParts = Array.isArray(run.parts) && run.parts.length > 0

  return {
    ...run,
    id,
    workflow,
    part: run.part || (hasParts ? run.parts[0].part || 'report' : 'legacy'),
    status,
    parts: hasParts
      ? run.parts
      : [{
          id: `${id}-legacy-part`,
          workflow,
          part: 'legacy',
          status: 'needs_review',
          title: 'Legacy run — part metadata unavailable',
          errors: ['This run was created before workflow part tracking was enabled.']
        }],
    createdAt: run.createdAt || run.timestamp || new Date().toISOString(),
    expiresAt: run.expiresAt || calculateResearchRunExpiry(run.createdAt || run.timestamp)
  }
}

export function normalizeResearchRunPart(part = {}, fallbackId = 'part') {
  return {
    id: part.id || fallbackId,
    workflow: part.workflow || '',
    part: part.part || 'report',
    status: asStatus(part.status),
    title: part.title || part.part || 'Research part',
    startedAt: part.startedAt || null,
    completedAt: part.completedAt || null,
    ...part,
    status: asStatus(part.status),
    part: part.part || 'report'
  }
}

export function createResearchRun({
  id,
  workflow,
  title,
  status = 'needs_review',
  part = 'report',
  createdAt = new Date().toISOString(),
  parts = [],
  ...details
} = {}) {
  const normalizedParts = (Array.isArray(parts) ? parts : []).map((item, index) => normalizeResearchRunPart(item, `${id || 'run'}-part-${index + 1}`))
  const normalizedStatus = asStatus(status)

  return {
    id: id || `run-${Date.now()}`,
    workflow: workflow || 'unknown',
    title: title || workflow || 'Research run',
    part,
    status: normalizedStatus,
    createdAt,
    expiresAt: details.expiresAt || calculateResearchRunExpiry(createdAt),
    parts: normalizedParts,
    ...details,
    status: normalizedStatus,
    part,
    expiresAt: details.expiresAt || calculateResearchRunExpiry(createdAt),
    parts: normalizedParts
  }
}

export function getPartStatus({ attempted = 0, succeeded = 0, failed = 0, empty = false } = {}) {
  if (failed > 0 && succeeded > 0) {
    return 'partial'
  }
  if (failed > 0) {
    return 'failed'
  }
  if (empty || (attempted > 0 && succeeded === 0)) {
    return 'needs_review'
  }
  return 'completed'
}
