export function createConfigurationError(message, missingEnvVars = []) {
  const error = new Error(message)
  error.code = 'missing_env'
  error.status = 503
  error.missingEnvVars = missingEnvVars
  return error
}

const DEFAULT_FILE_NAME = 'customer-data.json'
const KNOWN_DOCUMENT_KEYS = new Set([
  'customers',
  'leads',
  'leadWorkspaces',
  'countries',
  'keywords',
  'searchKeywords',
  'companies',
  'websites',
  'evidence',
  'researchRuns',
  'searchCache',
  'apiUsage',
  'providerMetadata',
  'lastSyncedAt',
  'lastSyncSource'
])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createInvalidPayloadError(message) {
  const error = new Error(message)
  error.code = 'invalid_payload'
  error.status = 400
  return error
}

function createInvalidGistDocumentError(message) {
  const error = new Error(message)
  error.code = 'invalid_gist_json'
  error.status = 502
  return error
}

function buildDefaultCustomerData() {
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
    researchRuns: [],
    searchCache: [],
    apiUsage: [],
    providerMetadata: {}
  }
}

function getConfiguredFile(gist, preferredFileName) {
  const files = gist?.files || {}

  if (preferredFileName && files[preferredFileName]) {
    return {
      fileName: preferredFileName,
      file: files[preferredFileName]
    }
  }

  if (preferredFileName) {
    return {
      fileName: preferredFileName,
      file: null
    }
  }

  const [firstFileName] = Object.keys(files)
  return {
    fileName: firstFileName || DEFAULT_FILE_NAME,
    file: firstFileName ? files[firstFileName] : null
  }
}

function assertString(value, fieldPath, errorFactory) {
  if (typeof value !== 'string') {
    throw errorFactory(`${fieldPath} must be a string.`)
  }
}

function assertNumber(value, fieldPath, errorFactory) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw errorFactory(`${fieldPath} must be a finite number.`)
  }
}

function assertOptionalString(value, fieldPath, errorFactory) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw errorFactory(`${fieldPath} must be a string when provided.`)
  }
}

function assertStringArray(value, fieldPath, errorFactory) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw errorFactory(`${fieldPath} must be an array of strings.`)
  }
}

function assertObjectArray(value, fieldPath, errorFactory) {
  if (!Array.isArray(value) || value.some((item) => !isPlainObject(item))) {
    throw errorFactory(`${fieldPath} must be an array of objects.`)
  }
}

function validateLeadCompany(company, fieldPath, errorFactory) {
  if (!isPlainObject(company)) {
    throw errorFactory(`${fieldPath} must be an object.`)
  }

  assertString(company.id, `${fieldPath}.id`, errorFactory)
  assertString(company.name, `${fieldPath}.name`, errorFactory)
  assertString(company.website, `${fieldPath}.website`, errorFactory)
  assertString(company.country, `${fieldPath}.country`, errorFactory)
  assertString(company.segment, `${fieldPath}.segment`, errorFactory)
  assertString(company.profile, `${fieldPath}.profile`, errorFactory)
  assertString(company.size, `${fieldPath}.size`, errorFactory)
  assertNumber(company.fitScore, `${fieldPath}.fitScore`, errorFactory)
  assertStringArray(company.signals, `${fieldPath}.signals`, errorFactory)
  assertString(company.whyFit, `${fieldPath}.whyFit`, errorFactory)
  assertString(company.priority, `${fieldPath}.priority`, errorFactory)

  const optionalStringFields = [
    'source',
    'sourceUrl',
    'businessType',
    'marketRole',
    'businessSummary',
    'buyingRelevance',
    'possibleScaleSignal',
    'employeeEstimate',
    'foundedYear',
    'headquarters',
    'phone',
    'address',
    'notes',
    'outreachNotes',
    'pipelineStatus',
    'customEmail',
    'customContactName',
    'customContactTitle',
    'customLinkedinUrl',
    'customEmailStatus'
  ]

  optionalStringFields.forEach((fieldName) => {
    assertOptionalString(company[fieldName], `${fieldPath}.${fieldName}`, errorFactory)
  })

  const optionalStringArrayFields = [
    'mainProducts',
    'targetApplications',
    'scaleSignals',
    'matchedProviders',
    'matchedQueryLabels',
    'contactEmails',
    'contactPages'
  ]

  optionalStringArrayFields.forEach((fieldName) => {
    if (company[fieldName] !== undefined) {
      assertStringArray(company[fieldName], `${fieldPath}.${fieldName}`, errorFactory)
    }
  })

  if (company.officialWebsiteLikely !== undefined && typeof company.officialWebsiteLikely !== 'boolean') {
    throw errorFactory(`${fieldPath}.officialWebsiteLikely must be a boolean when provided.`)
  }

  if (company.matchedQueryCount !== undefined) {
    assertNumber(company.matchedQueryCount, `${fieldPath}.matchedQueryCount`, errorFactory)
  }
}

function validateLeadContact(contact, fieldPath, errorFactory) {
  if (!isPlainObject(contact)) {
    throw errorFactory(`${fieldPath} must be an object.`)
  }

  ;['id', 'companyId', 'fullName', 'title', 'department', 'seniority', 'email', 'emailStatus', 'linkedinUrl', 'reason'].forEach((fieldName) => {
    assertString(contact[fieldName], `${fieldPath}.${fieldName}`, errorFactory)
  })
  assertNumber(contact.confidenceScore, `${fieldPath}.confidenceScore`, errorFactory)
}

function validateLeadDraft(draft, fieldPath, errorFactory) {
  if (!isPlainObject(draft)) {
    throw errorFactory(`${fieldPath} must be an object.`)
  }

  ;['id', 'workspaceId', 'companyId', 'contactId', 'subject', 'preview', 'body'].forEach((fieldName) => {
    assertString(draft[fieldName], `${fieldPath}.${fieldName}`, errorFactory)
  })
}

function validateLeadWorkspaceSummary(summary, fieldPath, errorFactory) {
  if (!isPlainObject(summary)) {
    throw errorFactory(`${fieldPath} must be an object.`)
  }

  ;['companyCount', 'contactCount', 'draftCount'].forEach((fieldName) => {
    assertNumber(summary[fieldName], `${fieldPath}.${fieldName}`, errorFactory)
  })
  assertStringArray(summary.topProfiles, `${fieldPath}.topProfiles`, errorFactory)
}

function validateLeadSearchStrategy(strategy, fieldPath, errorFactory) {
  if (!isPlainObject(strategy)) {
    throw errorFactory(`${fieldPath} must be an object.`)
  }

  assertStringArray(strategy.targetTypes, `${fieldPath}.targetTypes`, errorFactory)
  assertStringArray(strategy.excludeTypes, `${fieldPath}.excludeTypes`, errorFactory)
  assertStringArray(strategy.queryTemplates, `${fieldPath}.queryTemplates`, errorFactory)
  assertNumber(strategy.queryCount, `${fieldPath}.queryCount`, errorFactory)
  assertOptionalString(strategy.evidenceMode, `${fieldPath}.evidenceMode`, errorFactory)
}

function validateLeadWorkspace(workspace, fieldPath, errorFactory) {
  if (!isPlainObject(workspace)) {
    throw errorFactory(`${fieldPath} must be an object.`)
  }

  assertString(workspace.id, `${fieldPath}.id`, errorFactory)
  assertString(workspace.industry, `${fieldPath}.industry`, errorFactory)
  assertString(workspace.country, `${fieldPath}.country`, errorFactory)
  assertStringArray(workspace.keywords, `${fieldPath}.keywords`, errorFactory)
  assertString(workspace.createdAt, `${fieldPath}.createdAt`, errorFactory)
  assertStringArray(workspace.recommendedSegments, `${fieldPath}.recommendedSegments`, errorFactory)

  if (workspace.providersUsed !== undefined) {
    assertStringArray(workspace.providersUsed, `${fieldPath}.providersUsed`, errorFactory)
  }

  if (workspace.searchStrategy !== undefined) {
    validateLeadSearchStrategy(workspace.searchStrategy, `${fieldPath}.searchStrategy`, errorFactory)
  }

  if (!Array.isArray(workspace.companies)) {
    throw errorFactory(`${fieldPath}.companies must be an array.`)
  }
  workspace.companies.forEach((company, index) => {
    validateLeadCompany(company, `${fieldPath}.companies[${index}]`, errorFactory)
  })

  if (!Array.isArray(workspace.contacts)) {
    throw errorFactory(`${fieldPath}.contacts must be an array.`)
  }
  workspace.contacts.forEach((contact, index) => {
    validateLeadContact(contact, `${fieldPath}.contacts[${index}]`, errorFactory)
  })

  if (!Array.isArray(workspace.drafts)) {
    throw errorFactory(`${fieldPath}.drafts must be an array.`)
  }
  workspace.drafts.forEach((draft, index) => {
    validateLeadDraft(draft, `${fieldPath}.drafts[${index}]`, errorFactory)
  })

  validateLeadWorkspaceSummary(workspace.summary, `${fieldPath}.summary`, errorFactory)
}

function validateKnownSections(document, errorFactory) {
  const arrayOfObjectsSections = ['customers', 'leads', 'countries', 'companies', 'websites', 'evidence', 'researchRuns', 'searchCache', 'apiUsage']
  arrayOfObjectsSections.forEach((fieldName) => {
    if (document[fieldName] !== undefined) {
      assertObjectArray(document[fieldName], fieldName, errorFactory)
    }
  })

  if (document.keywords !== undefined) {
    assertStringArray(document.keywords, 'keywords', errorFactory)
  }

  if (document.searchKeywords !== undefined) {
    assertStringArray(document.searchKeywords, 'searchKeywords', errorFactory)
  }

  if (document.leadWorkspaces !== undefined) {
    if (!Array.isArray(document.leadWorkspaces)) {
      throw errorFactory('leadWorkspaces must be an array.')
    }

    document.leadWorkspaces.forEach((workspace, index) => {
      validateLeadWorkspace(workspace, `leadWorkspaces[${index}]`, errorFactory)
    })
  }

  if (document.providerMetadata !== undefined && !isPlainObject(document.providerMetadata)) {
    throw errorFactory('providerMetadata must be an object.')
  }

  assertOptionalString(document.lastSyncedAt, 'lastSyncedAt', errorFactory)
  assertOptionalString(document.lastSyncSource, 'lastSyncSource', errorFactory)
}

function validateCustomerDataDocument(document, { source, allowUnknownKeys }) {
  const errorFactory = source === 'gist'
    ? createInvalidGistDocumentError
    : createInvalidPayloadError

  if (!isPlainObject(document)) {
    throw errorFactory('Customer data must be a JSON object.')
  }

  const keys = Object.keys(document)
  const recognizedKeys = keys.filter((key) => KNOWN_DOCUMENT_KEYS.has(key))
  const unknownKeys = keys.filter((key) => !KNOWN_DOCUMENT_KEYS.has(key))

  if (source === 'payload' && recognizedKeys.length === 0) {
    throw errorFactory('Customer data payload must include at least one supported document section.')
  }

  if (!allowUnknownKeys && unknownKeys.length > 0) {
    throw errorFactory(`Unsupported customer data fields: ${unknownKeys.join(', ')}.`)
  }

  validateKnownSections(document, errorFactory)

  return document
}

function normalizeCustomerDataDocument(document) {
  return {
    ...buildDefaultCustomerData(),
    ...document
  }
}

export function createGistCustomerDataService({
  gistId,
  githubToken,
  fileName = '',
  fetchImpl = fetch
}) {
  function getConfigurationStatus() {
    const missingEnvVars = []

    if (!gistId) {
      missingEnvVars.push('GIST_ID')
    }
    if (!githubToken) {
      missingEnvVars.push('GITHUB_GIST_TOKEN')
    }

    return {
      configured: missingEnvVars.length === 0,
      missingEnvVars,
      fileName: fileName || DEFAULT_FILE_NAME
    }
  }

  function assertConfigured() {
    const config = getConfigurationStatus()
    if (!config.configured) {
      throw createConfigurationError(
        'Gist customer data storage is not configured.',
        config.missingEnvVars
      )
    }
  }

  async function fetchGist() {
    assertConfigured()

    const response = await fetchImpl(`https://api.github.com/gists/${gistId}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })

    if (!response.ok) {
      const error = new Error(`GitHub Gist request failed with status ${response.status}`)
      error.code = 'gist_request_failed'
      error.status = response.status === 401 || response.status === 403 ? 502 : response.status
      throw error
    }

    return response.json()
  }

  function parseCustomerData(rawContent) {
    if (!rawContent || !String(rawContent).trim()) {
      return buildDefaultCustomerData()
    }

    let parsed
    try {
      parsed = JSON.parse(rawContent)
    } catch {
      throw createInvalidGistDocumentError('The configured Gist file does not contain valid JSON.')
    }

    validateCustomerDataDocument(parsed, { source: 'gist', allowUnknownKeys: true })
    return normalizeCustomerDataDocument(parsed)
  }

  function buildResponseFromGist(gist) {
    const { fileName: resolvedFileName, file } = getConfiguredFile(gist, fileName)
    const content = file?.content || ''

    return {
      storage: 'gist',
      gistId,
      fileName: resolvedFileName,
      exists: Boolean(file),
      updatedAt: gist?.updated_at || null,
      data: parseCustomerData(content)
    }
  }

  async function readCustomerData() {
    const gist = await fetchGist()
    return buildResponseFromGist(gist)
  }

  async function updateCustomerData(nextData) {
    assertConfigured()

    validateCustomerDataDocument(nextData, { source: 'payload', allowUnknownKeys: false })

    const gist = await fetchGist()
    const currentState = buildResponseFromGist(gist)
    const mergedData = normalizeCustomerDataDocument({
      ...currentState.data,
      ...nextData
    })

    let serializedContent = ''
    try {
      serializedContent = JSON.stringify(mergedData, null, 2)
    } catch {
      throw createInvalidPayloadError('Customer data must be valid JSON-serializable data.')
    }

    const response = await fetchImpl(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        files: {
          [currentState.fileName || fileName || DEFAULT_FILE_NAME]: {
            content: serializedContent
          }
        }
      })
    })

    if (!response.ok) {
      const error = new Error(`GitHub Gist update failed with status ${response.status}`)
      error.code = 'gist_update_failed'
      error.status = response.status === 401 || response.status === 403 ? 502 : response.status
      throw error
    }

    const nextGist = await response.json()
    return buildResponseFromGist(nextGist)
  }

  return {
    getConfigurationStatus,
    readCustomerData,
    updateCustomerData
  }
}
