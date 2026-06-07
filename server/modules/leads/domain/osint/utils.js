let idCounter = 0

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function ensureNonEmptyString(value, fieldName) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${fieldName} must be a non-empty string`)
  }

  return normalizeWhitespace(value)
}

export function ensureArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`)
  }

  return value
}

export function ensureEnum(value, allowedValues, fieldName) {
  if (!allowedValues.includes(value)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(', ')}`)
  }

  return value
}

export function optionalString(value) {
  return isNonEmptyString(value) ? normalizeWhitespace(value) : ''
}

export function optionalNullableString(value) {
  return isNonEmptyString(value) ? normalizeWhitespace(value) : null
}

export function dedupeStrings(values) {
  return [...new Set((values || []).filter(isNonEmptyString).map((value) => normalizeWhitespace(value)))]
}

export function normalizeUrl(value) {
  if (!isNonEmptyString(value)) {
    return ''
  }

  return normalizeWhitespace(value)
}

export function createTimestamp(value = new Date().toISOString()) {
  return ensureNonEmptyString(value, 'timestamp')
}

export function createId(prefix) {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36).padStart(3, '0')}`
}

export function assertEvidenceRefs(evidenceRefs, fieldName = 'evidenceRefs') {
  ensureArray(evidenceRefs, fieldName)

  const refs = dedupeStrings(evidenceRefs)
  if (!refs.length) {
    throw new Error(`${fieldName} must include at least one evidence reference`)
  }

  return refs
}

export function compactObject(objectValue) {
  return Object.fromEntries(
    Object.entries(objectValue).filter(([, value]) => value !== undefined)
  )
}

export function toArray(value) {
  return Array.isArray(value) ? value : []
}

export function normalizeConfidence(value) {
  if (value == null || value === '') {
    return null
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    throw new Error('confidence must be between 0 and 1')
  }

  return numeric
}

export function normalizeScore(value, fieldName = 'score') {
  if (value == null || value === '') {
    return null
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    throw new Error(`${fieldName} must be between 0 and 100`)
  }

  return numeric
}

export function ensureObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`)
  }

  return value
}

export function normalizeTextList(values) {
  return dedupeStrings(toArray(values))
}
