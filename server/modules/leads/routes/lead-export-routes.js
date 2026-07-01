import express from 'express'
import * as XLSX from 'xlsx'
import { slugify } from '../shared/text-utils.js'

function csvEscape(value = '') {
  const stringValue = String(value ?? '')
  return `"${stringValue.replace(/"/g, '""')}"`
}

function sanitizeExcelCell(value) {
  const stringValue = String(value ?? '')
  return /^[=+\-@]/.test(stringValue) ? `'${stringValue}` : stringValue
}

function sendMissingEnvResponse(res, message, missingEnvVars) {
  return res.status(503).json({
    success: false,
    code: 'missing_env',
    error: message,
    missingEnvVars
  })
}

function sendServiceError(res, error, fallbackMessage) {
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

  if (error?.code === 'invalid_gist_json' || error?.code === 'gist_request_failed') {
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

function buildWorkspaceCsv(workspace) {
  const rows = [
    [
      'Company',
      'Website',
      'Country',
      'Business Type',
      'Segment',
      'Profile',
      'Fit Score',
      'Priority',
      'Main Products',
      'Target Applications',
      'Business Summary',
      'Contact Emails',
      'Custom Contact',
      'Custom Title',
      'Custom Email',
      'Pipeline Status',
      'Notes',
      'Outreach Notes',
      'Source',
      'Source URL'
    ].map(csvEscape).join(',')
  ]

  workspace.companies.forEach((company) => {
    rows.push([
      company.name,
      company.website,
      company.country,
      company.businessType || '',
      company.segment,
      company.profile,
      company.fitScore,
      company.priority,
      (company.mainProducts || []).join(' | '),
      (company.targetApplications || []).join(' | '),
      company.businessSummary || '',
      (company.contactEmails || []).join(' | '),
      company.customContactName || '',
      company.customContactTitle || '',
      company.customEmail || '',
      company.pipelineStatus || '',
      company.notes || '',
      company.outreachNotes || '',
      company.source || '',
      company.sourceUrl || ''
    ].map(csvEscape).join(','))
  })

  return `\uFEFF${rows.join('\n')}`
}

function toAttachmentFileName(value, extension) {
  const normalized = slugify(value) || 'lead-export'
  return `${normalized}.${extension}`
}

function appendJsonSheet(workbook, name, rows) {
  const sanitizedRows = (rows || []).map((row) => {
    const next = {}
    Object.entries(row || {}).forEach(([key, value]) => {
      if (typeof value === 'number' || typeof value === 'boolean') {
        next[key] = value
        return
      }

      next[key] = Array.isArray(value)
        ? sanitizeExcelCell(value.join('; '))
        : sanitizeExcelCell(value)
    })
    return next
  })

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sanitizedRows), name)
}

function buildWorkspaceWorkbook(workspace) {
  const workbook = XLSX.utils.book_new()

  appendJsonSheet(workbook, 'Workspace Summary', [{
    workflowSource: 'lead-workspace',
    workspaceId: workspace.id,
    industry: workspace.industry,
    country: workspace.country || '',
    keywordCount: (workspace.keywords || []).length,
    companyCount: workspace.summary?.companyCount || (workspace.companies || []).length,
    contactCount: workspace.summary?.contactCount || (workspace.contacts || []).length,
    draftCount: workspace.summary?.draftCount || (workspace.drafts || []).length,
    createdAt: workspace.createdAt || ''
  }])

  appendJsonSheet(workbook, 'Search Strategy', [{
    targetTypes: (workspace.searchStrategy?.targetTypes || []).join('; '),
    excludeTypes: (workspace.searchStrategy?.excludeTypes || []).join('; '),
    queryTemplates: (workspace.searchStrategy?.queryTemplates || []).join(' | '),
    queryCount: workspace.searchStrategy?.queryCount || 0,
    evidenceMode: workspace.searchStrategy?.evidenceMode || ''
  }])

  appendJsonSheet(workbook, 'Companies', (workspace.companies || []).map((company) => ({
    name: company.name,
    website: company.website,
    country: company.country,
    businessType: company.businessType || '',
    segment: company.segment,
    profile: company.profile,
    fitScore: company.fitScore,
    priority: company.priority,
    mainProducts: (company.mainProducts || []).join('; '),
    targetApplications: (company.targetApplications || []).join('; '),
    businessSummary: company.businessSummary || '',
    contactEmails: (company.contactEmails || []).join('; '),
    customContactName: company.customContactName || '',
    customContactTitle: company.customContactTitle || '',
    customEmail: company.customEmail || '',
    pipelineStatus: company.pipelineStatus || '',
    notes: company.notes || '',
    outreachNotes: company.outreachNotes || '',
    source: company.source || '',
    sourceUrl: company.sourceUrl || '',
    matchedProviders: (company.matchedProviders || []).join('; ')
  })))

  appendJsonSheet(workbook, 'Contacts', workspace.contacts || [])
  appendJsonSheet(workbook, 'Drafts', workspace.drafts || [])
  return workbook
}

function flattenProviderMetadata(providerMetadata = {}) {
  return Object.entries(providerMetadata || {}).map(([provider, metadata]) => {
    const row = { provider }
    Object.entries(metadata || {}).forEach(([key, value]) => {
      row[`metadata.${key}`] = value
    })
    return row
  })
}

function buildCustomerDataWorkbook(document = {}) {
  const workbook = XLSX.utils.book_new()
  const workspaces = document.leadWorkspaces || []

  appendJsonSheet(workbook, 'Document Summary', [{
    workflowSource: document.lastSyncSource || '',
    lastSyncedAt: document.lastSyncedAt || '',
    workspaceCount: workspaces.length,
    customerCount: (document.customers || []).length,
    leadCount: (document.leads || []).length,
    providerCount: Object.keys(document.providerMetadata || {}).length
  }])

  appendJsonSheet(workbook, 'Customers', document.customers || [])
  appendJsonSheet(workbook, 'Leads', document.leads || [])
  appendJsonSheet(workbook, 'Lead Workspaces', workspaces.map((workspace) => ({
    id: workspace.id,
    industry: workspace.industry,
    country: workspace.country || '',
    targetTypes: (workspace.searchStrategy?.targetTypes || []).join('; '),
    excludeTypes: (workspace.searchStrategy?.excludeTypes || []).join('; '),
    queryTemplates: (workspace.searchStrategy?.queryTemplates || []).join(' | '),
    queryCount: workspace.searchStrategy?.queryCount || 0,
    companyCount: workspace.summary?.companyCount || (workspace.companies || []).length,
    contactCount: workspace.summary?.contactCount || (workspace.contacts || []).length,
    draftCount: workspace.summary?.draftCount || (workspace.drafts || []).length
  })))
  appendJsonSheet(workbook, 'Workspace Companies', workspaces.flatMap((workspace) => (workspace.companies || []).map((company) => ({
    workspaceId: workspace.id,
    name: company.name,
    website: company.website,
    notes: company.notes || '',
    matchedProviders: (company.matchedProviders || []).join('; '),
    phone: company.phone || '',
    address: company.address || ''
  }))))
  appendJsonSheet(workbook, 'Workspace Contacts', workspaces.flatMap((workspace) => (workspace.contacts || []).map((contact) => ({
    workspaceId: workspace.id,
    ...contact
  }))))
  appendJsonSheet(workbook, 'Workspace Drafts', workspaces.flatMap((workspace) => (workspace.drafts || []).map((draft) => ({
    workspaceId: workspace.id,
    ...draft
  }))))
  appendJsonSheet(workbook, 'Countries', document.countries || [])
  appendJsonSheet(workbook, 'Keywords', (document.keywords || []).map((keyword) => ({ keyword })))
  appendJsonSheet(workbook, 'Search Keywords', (document.searchKeywords || []).map((searchKeyword) => ({ searchKeyword })))
  appendJsonSheet(workbook, 'Company Catalog', document.companies || [])
  appendJsonSheet(workbook, 'Websites', document.websites || [])
  appendJsonSheet(workbook, 'Evidence', document.evidence || [])
  appendJsonSheet(workbook, 'Provider Metadata', flattenProviderMetadata(document.providerMetadata))
  return workbook
}

function sendWorkbook(res, workbook, fileName) {
  const workbookBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename=${fileName}`)
  return res.send(workbookBuffer)
}

export function createLeadExportRouter({
  leadWorkspaceRepository,
  gistCustomerDataService
}) {
  const router = express.Router()

  router.get('/lead-workspaces/:id/export.csv', async (req, res) => {
    try {
      const workspace = await leadWorkspaceRepository.getById(req.params.id)

      if (!workspace) {
        return res.status(404).json({ error: 'Workspace not found' })
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename=${toAttachmentFileName(`${workspace.industry}-${workspace.country || 'global'}`, 'csv')}`)
      return res.send(buildWorkspaceCsv(workspace))
    } catch (error) {
      console.error('Error exporting workspace CSV:', error)
      return res.status(500).json({ error: 'Failed to export workspace' })
    }
  })

  router.get('/lead-workspaces/:id/export.xlsx', async (req, res) => {
    try {
      const workspace = await leadWorkspaceRepository.getById(req.params.id)

      if (!workspace) {
        return res.status(404).json({ error: 'Workspace not found' })
      }

      return sendWorkbook(
        res,
        buildWorkspaceWorkbook(workspace),
        toAttachmentFileName(`${workspace.industry}-${workspace.country || 'global'}`, 'xlsx')
      )
    } catch (error) {
      console.error('Error exporting workspace XLSX:', error)
      return sendServiceError(res, error, 'Failed to export workspace')
    }
  })

  router.get('/customer-data/export.xlsx', async (req, res) => {
    try {
      const result = await gistCustomerDataService.readCustomerData()
      return sendWorkbook(res, buildCustomerDataWorkbook(result.data), 'customer-data-export.xlsx')
    } catch (error) {
      console.error('Error exporting customer-data workbook:', error)
      return sendServiceError(res, error, 'Failed to export customer data')
    }
  })

  return router
}
