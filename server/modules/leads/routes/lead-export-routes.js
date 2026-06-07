import express from 'express'
import path from 'path'
import { slugify } from '../shared/text-utils.js'
import { createLeadWorkbookExportService } from '../application/services/lead-workbook-export-service.js'

function csvEscape(value = '') {
  const stringValue = String(value ?? '')
  return `"${stringValue.replace(/"/g, '""')}"`
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

  if (error?.code === 'invalid_gist_json') {
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

function toCustomerExportBaseName(fileName = '') {
  const parsed = path.parse(fileName)
  return parsed.name ? `${parsed.name}-export` : 'customer-data-export'
}

export function createLeadExportRouter({
  leadWorkspaceRepository,
  gistCustomerDataService
}) {
  const router = express.Router()
  const workbookExportService = createLeadWorkbookExportService()

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

      const workbook = workbookExportService.buildWorkspaceWorkbook(workspace)
      res.setHeader('Content-Type', workbookExportService.mimeType)
      res.setHeader('Content-Disposition', `attachment; filename=${toAttachmentFileName(`${workspace.industry}-${workspace.country || 'global'}`, 'xlsx')}`)
      return res.send(workbook)
    } catch (error) {
      console.error('Error exporting workspace XLSX:', error)
      return res.status(500).json({ error: 'Failed to export workspace workbook' })
    }
  })

  router.get('/customer-data/export.xlsx', async (req, res) => {
    try {
      const result = await gistCustomerDataService.readCustomerData()
      const workbook = workbookExportService.buildCustomerDataWorkbook(result.data)
      res.setHeader('Content-Type', workbookExportService.mimeType)
      res.setHeader('Content-Disposition', `attachment; filename=${toAttachmentFileName(toCustomerExportBaseName(result.fileName), 'xlsx')}`)
      return res.send(workbook)
    } catch (error) {
      console.error('Error exporting customer data XLSX:', error)
      return sendServiceError(res, error, 'Failed to export customer data workbook')
    }
  })

  return router
}
