function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function readResponseText(response) {
  return response.text().catch(() => '')
}

function buildMissingEnvError() {
  const error = new Error('Gist customer data storage is not configured.')
  error.code = 'missing_env'
  error.missingEnvVars = ['GIST_ID', 'GITHUB_GIST_TOKEN']
  error.status = 503
  return error
}

const SUPPORTED_FIELDS = [
  'customers',
  'leads',
  'leadWorkspaces',
  'countries',
  'keywords',
  'searchKeywords',
  'companies',
  'websites',
  'evidence',
  'providerMetadata',
  'lastSyncedAt',
  'lastSyncSource'
]

function createDefaultDocument() {
  return {
    customers: [],
    leads: [],
    leadWorkspaces: [],
    countries: [],
    keywords: [],
    searchKeywords: [],
    companies: [],
    websites: [],
    evidence: [],
    providerMetadata: {}
  }
}

function validateDocumentShape(document) {
  const normalized = {
    ...createDefaultDocument(),
    ...(document || {})
  }

  const arrayFields = [
    'customers',
    'leads',
    'leadWorkspaces',
    'countries',
    'keywords',
    'searchKeywords',
    'companies',
    'websites',
    'evidence'
  ]

  for (const field of arrayFields) {
    if (!Array.isArray(normalized[field])) {
      const error = new Error(`${field} must be an array of objects or values.`)
      error.code = 'invalid_gist_json'
      error.status = 502
      throw error
    }
  }

  if (!normalized.providerMetadata || typeof normalized.providerMetadata !== 'object' || Array.isArray(normalized.providerMetadata)) {
    const error = new Error('providerMetadata must be an object.')
    error.code = 'invalid_gist_json'
    error.status = 502
    throw error
  }

  return normalized
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    const error = new Error('Customer data payload must be an object.')
    error.code = 'invalid_payload'
    error.status = 400
    throw error
  }

  const keys = Object.keys(patch)
  if (!keys.length) {
    const error = new Error('Customer data payload must include at least one supported document section.')
    error.code = 'invalid_payload'
    error.status = 400
    throw error
  }

  const unsupported = keys.filter((key) => !SUPPORTED_FIELDS.includes(key))
  if (unsupported.length === keys.length) {
    const error = new Error('Customer data payload must include at least one supported document section.')
    error.code = 'invalid_payload'
    error.status = 400
    throw error
  }

  if (unsupported.length) {
    const error = new Error(`Unsupported customer data fields: ${unsupported.join(', ')}`)
    error.code = 'invalid_payload'
    error.status = 400
    throw error
  }
}

async function parseGistResponse(response, fileName) {
  const payload = await response.json().catch(() => null)
  const file = payload?.files?.[fileName] || payload?.files?.[Object.keys(payload?.files || {})[0]]

  if (!file?.content) {
    const error = new Error(`The configured Gist file ${fileName} does not exist or has no content.`)
    error.code = 'gist_request_failed'
    error.status = 502
    throw error
  }

  let document
  try {
    document = JSON.parse(file.content)
  } catch {
    const error = new Error('The configured Gist file does not contain valid JSON.')
    error.code = 'invalid_gist_json'
    error.status = 502
    throw error
  }

  return {
    updatedAt: payload?.updated_at || null,
    data: validateDocumentShape(document)
  }
}

export function createGistCustomerDataService({
  gistId,
  githubToken,
  fileName = 'customer-data.json',
  fetchImpl = globalThis.fetch
} = {}) {
  const hasConfig = hasText(gistId) && hasText(githubToken)

  function getConfigurationStatus() {
    return {
      configured: hasConfig,
      missingEnvVars: hasConfig ? [] : ['GIST_ID', 'GITHUB_GIST_TOKEN'],
      fileName
    }
  }

  async function requestGist(method, body) {
    if (!hasConfig) {
      throw buildMissingEnvError()
    }

    const response = await fetchImpl(`https://api.github.com/gists/${gistId}`, {
      ...(method && method !== 'GET' ? { method } : {}),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })

    if (!response.ok) {
      const responseText = await readResponseText(response)
      const error = new Error(`GitHub Gist request failed with status ${response.status}${responseText ? `: ${responseText}` : ''}`)
      error.code = 'gist_request_failed'
      error.status = 502
      throw error
    }

    return response
  }

  async function readCustomerData() {
    try {
      const response = await requestGist('GET')
      const parsed = await parseGistResponse(response, fileName)

      return {
        success: true,
        storage: 'gist',
        gistId,
        fileName,
        exists: true,
        updatedAt: parsed.updatedAt,
        data: parsed.data
      }
  } catch (error) {
    if (error.code) {
      throw error
    }

    const wrapped = new Error('Failed to read customer data')
    wrapped.code = 'gist_request_failed'
    wrapped.status = 502
    throw wrapped
  }
  }

  async function updateCustomerData(patch) {
    validatePatch(patch)
    let currentData
    try {
      currentData = (await readCustomerData()).data
    } catch (error) {
      if (error.code === 'invalid_gist_json') {
        const wrapped = new Error('The configured Gist file does not contain valid JSON.')
        wrapped.code = 'invalid_gist_json'
        wrapped.status = 502
        throw wrapped
      }
      throw error
    }

    const nextData = validateDocumentShape({
      ...currentData,
      ...patch
    })

    try {
      const response = await requestGist('PATCH', {
        files: {
          [fileName]: {
            content: JSON.stringify(nextData, null, 2)
          }
        }
      })
      const parsed = await parseGistResponse(response, fileName)

      return {
        success: true,
        storage: 'gist',
        gistId,
        fileName,
        exists: true,
        updatedAt: parsed.updatedAt,
        data: parsed.data
      }
    } catch (error) {
      if (error.code === 'invalid_gist_json' || error.code === 'invalid_payload' || error.code === 'missing_env') {
        throw error
      }

      const wrapped = new Error('Failed to update customer data')
      wrapped.code = 'gist_request_failed'
      wrapped.status = 502
      throw wrapped
    }
  }

  return {
    getConfigurationStatus,
    readCustomerData,
    updateCustomerData
  }
}
