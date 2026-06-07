import * as XLSX from 'xlsx'

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const EMPTY_SHEET_MESSAGE = 'No data'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeFormulaString(value) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

function sanitizeNestedValue(value) {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return sanitizeFormulaString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeNestedValue(item))
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, sanitizeNestedValue(nestedValue)]))
  }

  return sanitizeFormulaString(String(value))
}

function toCellValue(value) {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return sanitizeFormulaString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item === undefined || item === null) {
          return ''
        }

        if (typeof item === 'string') {
          return sanitizeFormulaString(item)
        }

        if (typeof item === 'number' || typeof item === 'boolean') {
          return String(item)
        }

        if (Array.isArray(item) || isPlainObject(item)) {
          return JSON.stringify(sanitizeNestedValue(item))
        }

        return sanitizeFormulaString(String(item))
      })
      .filter((item) => item !== '')
      .join(' | ')
  }

  if (isPlainObject(value)) {
    return sanitizeFormulaString(JSON.stringify(sanitizeNestedValue(value)))
  }

  return sanitizeFormulaString(String(value))
}

function flattenRecord(record, prefix = '') {
  if (!isPlainObject(record)) {
    return prefix ? { [prefix]: toCellValue(record) } : { value: toCellValue(record) }
  }

  return Object.entries(record).reduce((accumulator, [key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key

    if (isPlainObject(value)) {
      return {
        ...accumulator,
        ...flattenRecord(value, nextKey)
      }
    }

    accumulator[nextKey] = toCellValue(value)
    return accumulator
  }, {})
}

function createSheet(rows) {
  if (!rows.length) {
    return XLSX.utils.aoa_to_sheet([[EMPTY_SHEET_MESSAGE]])
  }

  const sanitizedRows = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toCellValue(value)])))
  return XLSX.utils.json_to_sheet(sanitizedRows)
}

function addSheet(workbook, name, rows) {
  XLSX.utils.book_append_sheet(workbook, createSheet(rows), name.slice(0, 31))
}

function buildWorkspaceSummaryRows(workspace) {
  return [{
    workspaceId: workspace.id,
    industry: workspace.industry,
    country: workspace.country || 'Global',
    createdAt: workspace.createdAt,
    keywords: workspace.keywords || [],
    recommendedSegments: workspace.recommendedSegments || [],
    providersUsed: workspace.providersUsed || [],
    companyCount: workspace.summary?.companyCount ?? workspace.companies?.length ?? 0,
    contactCount: workspace.summary?.contactCount ?? workspace.contacts?.length ?? 0,
    draftCount: workspace.summary?.draftCount ?? workspace.drafts?.length ?? 0,
    topProfiles: workspace.summary?.topProfiles || [],
    workflowSource: workspace.lastSyncSource || 'lead-workspace',
    lastSyncedAt: workspace.lastSyncedAt || ''
  }]
}

function buildSearchStrategyRows(workspace) {
  if (!workspace.searchStrategy) {
    return []
  }

  return [{
    workspaceId: workspace.id,
    targetTypes: workspace.searchStrategy.targetTypes || [],
    excludeTypes: workspace.searchStrategy.excludeTypes || [],
    queryTemplates: workspace.searchStrategy.queryTemplates || [],
    queryCount: workspace.searchStrategy.queryCount ?? 0,
    evidenceMode: workspace.searchStrategy.evidenceMode || ''
  }]
}

function buildWorkspaceCompanyRows(workspace) {
  return (workspace.companies || []).map((company) => ({
    workspaceId: workspace.id,
    workspaceIndustry: workspace.industry,
    workspaceCountry: workspace.country,
    workspaceKeywords: workspace.keywords || [],
    ...flattenRecord(company)
  }))
}

function buildWorkspaceContactRows(workspace) {
  return (workspace.contacts || []).map((contact) => ({
    workspaceId: workspace.id,
    workspaceIndustry: workspace.industry,
    workspaceCountry: workspace.country,
    ...flattenRecord(contact)
  }))
}

function buildWorkspaceDraftRows(workspace) {
  return (workspace.drafts || []).map((draft) => ({
    workspaceId: workspace.id,
    workspaceIndustry: workspace.industry,
    workspaceCountry: workspace.country,
    ...flattenRecord(draft)
  }))
}

function buildLeadWorkspaceRows(workspaces) {
  return (workspaces || []).map((workspace) => ({
    workspaceId: workspace.id,
    industry: workspace.industry,
    country: workspace.country,
    createdAt: workspace.createdAt,
    keywords: workspace.keywords || [],
    recommendedSegments: workspace.recommendedSegments || [],
    providersUsed: workspace.providersUsed || [],
    targetTypes: workspace.searchStrategy?.targetTypes || [],
    excludeTypes: workspace.searchStrategy?.excludeTypes || [],
    queryTemplates: workspace.searchStrategy?.queryTemplates || [],
    queryCount: workspace.searchStrategy?.queryCount ?? 0,
    evidenceMode: workspace.searchStrategy?.evidenceMode || '',
    companyCount: workspace.summary?.companyCount ?? workspace.companies?.length ?? 0,
    contactCount: workspace.summary?.contactCount ?? workspace.contacts?.length ?? 0,
    draftCount: workspace.summary?.draftCount ?? workspace.drafts?.length ?? 0,
    topProfiles: workspace.summary?.topProfiles || []
  }))
}

function buildWorkspaceAggregateRows(workspaces, selector) {
  return (workspaces || []).flatMap((workspace) => selector(workspace))
}

function buildKeyValueRows(values, valueHeader) {
  return (values || []).map((value, index) => ({
    row: index + 1,
    [valueHeader]: value
  }))
}

function buildProviderMetadataRows(providerMetadata) {
  return Object.entries(providerMetadata || {}).map(([provider, metadata]) => ({
    provider,
    ...flattenRecord(metadata, 'metadata')
  }))
}

function writeWorkbook(workbook) {
  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    compression: true
  })
}

export function createLeadWorkbookExportService() {
  function buildWorkspaceWorkbook(workspace) {
    const workbook = XLSX.utils.book_new()
    addSheet(workbook, 'Workspace Summary', buildWorkspaceSummaryRows(workspace))
    addSheet(workbook, 'Search Strategy', buildSearchStrategyRows(workspace))
    addSheet(workbook, 'Companies', buildWorkspaceCompanyRows(workspace))
    addSheet(workbook, 'Contacts', buildWorkspaceContactRows(workspace))
    addSheet(workbook, 'Drafts', buildWorkspaceDraftRows(workspace))
    return writeWorkbook(workbook)
  }

  function buildCustomerDataWorkbook(document) {
    const workspaces = Array.isArray(document?.leadWorkspaces) ? document.leadWorkspaces : []
    const workbook = XLSX.utils.book_new()

    addSheet(workbook, 'Document Summary', [{
      customerCount: Array.isArray(document?.customers) ? document.customers.length : 0,
      leadCount: Array.isArray(document?.leads) ? document.leads.length : 0,
      workspaceCount: workspaces.length,
      countryCount: Array.isArray(document?.countries) ? document.countries.length : 0,
      keywordCount: Array.isArray(document?.keywords) ? document.keywords.length : 0,
      searchKeywordCount: Array.isArray(document?.searchKeywords) ? document.searchKeywords.length : 0,
      companyCatalogCount: Array.isArray(document?.companies) ? document.companies.length : 0,
      websiteCount: Array.isArray(document?.websites) ? document.websites.length : 0,
      evidenceCount: Array.isArray(document?.evidence) ? document.evidence.length : 0,
      providerCount: document?.providerMetadata ? Object.keys(document.providerMetadata).length : 0,
      workflowSource: document?.lastSyncSource || '',
      lastSyncedAt: document?.lastSyncedAt || ''
    }])
    addSheet(workbook, 'Customers', (document?.customers || []).map((item) => flattenRecord(item)))
    addSheet(workbook, 'Leads', (document?.leads || []).map((item) => flattenRecord(item)))
    addSheet(workbook, 'Lead Workspaces', buildLeadWorkspaceRows(workspaces))
    addSheet(workbook, 'Workspace Companies', buildWorkspaceAggregateRows(workspaces, buildWorkspaceCompanyRows))
    addSheet(workbook, 'Workspace Contacts', buildWorkspaceAggregateRows(workspaces, buildWorkspaceContactRows))
    addSheet(workbook, 'Workspace Drafts', buildWorkspaceAggregateRows(workspaces, buildWorkspaceDraftRows))
    addSheet(workbook, 'Countries', (document?.countries || []).map((item) => flattenRecord(item)))
    addSheet(workbook, 'Keywords', buildKeyValueRows(document?.keywords || [], 'keyword'))
    addSheet(workbook, 'Search Keywords', buildKeyValueRows(document?.searchKeywords || [], 'searchKeyword'))
    addSheet(workbook, 'Company Catalog', (document?.companies || []).map((item) => flattenRecord(item)))
    addSheet(workbook, 'Websites', (document?.websites || []).map((item) => flattenRecord(item)))
    addSheet(workbook, 'Evidence', (document?.evidence || []).map((item) => flattenRecord(item)))
    addSheet(workbook, 'Provider Metadata', buildProviderMetadataRows(document?.providerMetadata || {}))

    return writeWorkbook(workbook)
  }

  return {
    buildWorkspaceWorkbook,
    buildCustomerDataWorkbook,
    mimeType: XLSX_MIME_TYPE
  }
}
