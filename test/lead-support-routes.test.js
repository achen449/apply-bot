import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import * as XLSX from 'xlsx'
import { createGistCustomerDataService } from '../server/modules/leads/application/services/gist-customer-data-service.js'
import { createLeadExportRouter } from '../server/modules/leads/routes/lead-export-routes.js'
import { createLeadSupportRouter } from '../server/modules/leads/routes/lead-support-routes.js'
import { createLeadWorkspaceRepository } from '../server/modules/leads/repositories/lead-workspace-repository.js'

function createJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload
    }
  }
}

function buildWorkspace(overrides = {}) {
  return {
    id: 'workspace-1',
    industry: 'industrial connectors',
    country: 'Germany',
    keywords: ['mc4'],
    createdAt: '2026-06-08T00:00:00.000Z',
    recommendedSegments: ['solar EPC'],
    providersUsed: ['tavily'],
    searchStrategy: {
      targetTypes: ['manufacturer'],
      excludeTypes: ['peer-supplier'],
      queryTemplates: ['industrial connectors Germany'],
      queryCount: 1,
      evidenceMode: 'public-web'
    },
    companies: [
      {
        id: 'company-1',
        name: 'Acme GmbH',
        website: 'https://acme.example',
        country: 'Germany',
        segment: 'solar',
        profile: 'Installer',
        size: '51-200',
        fitScore: 87,
        signals: ['solar EPC'],
        whyFit: 'Buys connector assemblies',
        priority: 'high',
        source: 'tavily',
        sourceUrl: 'https://acme.example/about',
        businessType: 'Installer',
        marketRole: 'buyer',
        businessSummary: 'Public installer profile',
        buyingRelevance: 'Uses PV connectors',
        mainProducts: ['PV systems'],
        targetApplications: ['commercial rooftop'],
        possibleScaleSignal: 'Multi-site operations',
        scaleSignals: ['10+ locations'],
        employeeEstimate: '120',
        foundedYear: '2015',
        headquarters: 'Berlin',
        officialWebsiteLikely: true,
        matchedQueryCount: 1,
        matchedProviders: ['tavily'],
        matchedQueryLabels: ['solar epc'],
        contactEmails: ['sales@acme.example'],
        contactPages: ['https://acme.example/contact'],
        phone: '+49 30 000000',
        address: 'Berlin',
        notes: 'Warm target',
        outreachNotes: 'Needs German intro',
        pipelineStatus: 'new',
        customEmail: 'buyer@acme.example',
        customContactName: 'Anna Buyer',
        customContactTitle: 'Purchasing Manager',
        customLinkedinUrl: 'https://linkedin.example/anna',
        customEmailStatus: 'verified'
      }
    ],
    contacts: [
      {
        id: 'contact-1',
        companyId: 'company-1',
        fullName: 'Anna Buyer',
        title: 'Purchasing Manager',
        department: 'Procurement',
        seniority: 'manager',
        email: 'buyer@acme.example',
        emailStatus: 'verified',
        linkedinUrl: 'https://linkedin.example/anna',
        confidenceScore: 0.91,
        reason: 'Public contact page'
      }
    ],
    drafts: [
      {
        id: 'draft-1',
        workspaceId: 'workspace-1',
        companyId: 'company-1',
        contactId: 'contact-1',
        subject: 'PV connector supply',
        preview: 'Short preview',
        body: 'Full outreach body'
      }
    ],
    summary: {
      companyCount: 1,
      contactCount: 1,
      draftCount: 1,
      topProfiles: ['Installer']
    },
    ...overrides
  }
}

function readWorkbookFromResponseBuffer(arrayBuffer) {
  return XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer' })
}

function getSheetRows(workbook, sheetName) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })
}


test('gist customer data service reports missing env without crashing', () => {
  const service = createGistCustomerDataService({
    gistId: '',
    githubToken: '',
    fileName: 'customers.json',
    fetchImpl: async () => {
      throw new Error('fetch should not run when config is missing')
    }
  })

  assert.deepEqual(service.getConfigurationStatus(), {
    configured: false,
    missingEnvVars: ['GIST_ID', 'GITHUB_GIST_TOKEN'],
    fileName: 'customers.json'
  })
})

test('gist customer data service reads and updates the configured gist file while preserving unrelated fields', async () => {
  const requests = []
  const existingDocument = {
    customers: [{ id: 'c1' }],
    leads: [],
    leadWorkspaces: [buildWorkspace()],
    countries: [{ code: 'DE', name: 'Germany' }],
    keywords: ['mc4'],
    searchKeywords: ['battery connector'],
    companies: [{ id: 'company-catalog-1', name: 'Acme GmbH' }],
    websites: [{ id: 'site-1', url: 'https://acme.example' }],
    evidence: [{ id: 'e1', provider: 'tavily' }],
    providerMetadata: { tavily: { queries: 1 } },
    legacyField: { keep: true }
  }

  const service = createGistCustomerDataService({
    gistId: 'gist-123',
    githubToken: 'secret-token',
    fileName: 'customers.json',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options })

      if (!options.method) {
        return createJsonResponse(200, {
          updated_at: '2026-06-07T00:00:00.000Z',
          files: {
            'customers.json': {
              content: JSON.stringify(existingDocument)
            }
          }
        })
      }

      const patchPayload = JSON.parse(options.body)
      return createJsonResponse(200, {
        updated_at: '2026-06-07T00:10:00.000Z',
        files: {
          'customers.json': {
            content: patchPayload.files['customers.json'].content
          }
        }
      })
    }
  })

  const readResult = await service.readCustomerData()
  assert.equal(readResult.exists, true)
  assert.equal(readResult.fileName, 'customers.json')
  assert.equal(readResult.data.legacyField.keep, true)
  assert.equal(readResult.data.leadWorkspaces.length, 1)

  const updated = await service.updateCustomerData({
    leadWorkspaces: [buildWorkspace({ id: 'workspace-2' })],
    providerMetadata: { tavily: { queries: 2 }, brave: { queries: 1 } },
    websites: [{ id: 'site-2', url: 'https://new.example' }]
  })

  assert.equal(updated.exists, true)
  assert.equal(updated.data.legacyField.keep, true)
  assert.equal(updated.data.customers.length, 1)
  assert.equal(updated.data.leadWorkspaces[0].id, 'workspace-2')
  assert.deepEqual(updated.data.websites, [{ id: 'site-2', url: 'https://new.example' }])
  assert.deepEqual(updated.data.providerMetadata, { tavily: { queries: 2 }, brave: { queries: 1 } })
  assert.equal(requests.length, 3)
  assert.equal(requests[1].options.method, undefined)
  assert.equal(requests[2].options.method, 'PATCH')
})

test('gist customer data service rejects malformed payloads and invalid gist schema', async () => {
  const invalidPayloadService = createGistCustomerDataService({
    gistId: 'gist-123',
    githubToken: 'secret-token',
    fileName: 'customers.json',
    fetchImpl: async () => createJsonResponse(200, {
      updated_at: '2026-06-07T00:00:00.000Z',
      files: {
        'customers.json': {
          content: JSON.stringify({ customers: [], leads: [] })
        }
      }
    })
  })

  await assert.rejects(
    () => invalidPayloadService.updateCustomerData({ unexpected: true }),
    (error) => {
      assert.equal(error.code, 'invalid_payload')
      assert.match(error.message, /must include at least one supported document section/)
      return true
    }
  )

  await assert.rejects(
    () => invalidPayloadService.updateCustomerData({ customers: [], unexpected: true }),
    (error) => {
      assert.equal(error.code, 'invalid_payload')
      assert.match(error.message, /Unsupported customer data fields/)
      return true
    }
  )
  const invalidGistService = createGistCustomerDataService({
    gistId: 'gist-123',
    githubToken: 'secret-token',
    fileName: 'customers.json',
    fetchImpl: async () => createJsonResponse(200, {
      updated_at: '2026-06-07T00:00:00.000Z',
      files: {
        'customers.json': {
          content: JSON.stringify({ customers: 'bad-data' })
        }
      }
    })
  })

  await assert.rejects(
    () => invalidGistService.readCustomerData(),
    (error) => {
      assert.equal(error.code, 'invalid_gist_json')
      assert.match(error.message, /customers must be an array of objects/)
      return true
    }
  )
})

test('lead workspace repository uses gist-backed document when configured', async () => {
  const writes = []
  let document = {
    customers: [],
    leads: [],
    leadWorkspaces: [buildWorkspace()],
    countries: [],
    keywords: [],
    searchKeywords: [],
    companies: [],
    websites: [],
    evidence: [],
    providerMetadata: {}
  }

  const repository = createLeadWorkspaceRepository('C:/tmp', {
    gistCustomerDataService: {
      getConfigurationStatus() {
        return { configured: true }
      },
      async readCustomerData() {
        return { data: document }
      },
      async updateCustomerData(patch) {
        document = {
          ...document,
          ...patch
        }
        writes.push(patch)
        return { data: document }
      }
    }
  })

  const listed = await repository.list()
  assert.equal(listed.length, 1)

  await repository.prependAndTrim(buildWorkspace({ id: 'workspace-2' }), 25)
  assert.equal(document.leadWorkspaces[0].id, 'workspace-2')

  const updateResult = await repository.updateCompany('workspace-2', 'company-1', (company, workspace) => ({
    ...company,
    notes: `${workspace.industry} updated`
  }))

  assert.equal(updateResult.company.notes, 'industrial connectors updated')
  assert.equal(writes.length, 2)
  assert.equal(typeof writes[0].lastSyncedAt, 'string')
})

test('lead support router returns clear missing-env responses and gist-backed data shape', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', createLeadSupportRouter({
    addressClassificationService: {
      async batchClassify(addresses) {
        return {
          results: addresses.map((item) => ({
            input: item,
            result: { classification: 'COMMERCIAL', confidence: 0.91 }
          }))
        }
      }
    },
    companySimilarityService: {
      async findSimilarCompanies(company, topN) {
        return [{ company: { title: `${company.name} peer` }, similarity: 0.72, topN }]
      }
    },
    gistCustomerDataService: {
      getConfigurationStatus() {
        return { configured: true, missingEnvVars: [], fileName: 'customers.json' }
      },
      async readCustomerData() {
        return {
          storage: 'gist',
          gistId: 'gist-123',
          fileName: 'customers.json',
          exists: true,
          updatedAt: '2026-06-07T00:00:00.000Z',
          data: {
            customers: [{ id: 'c1' }],
            leads: [],
            leadWorkspaces: [buildWorkspace()],
            countries: [],
            keywords: ['mc4'],
            searchKeywords: ['battery connector'],
            companies: [],
            websites: [],
            evidence: [],
            providerMetadata: { tavily: { queries: 1 } }
          }
        }
      },
      async updateCustomerData(data) {
        return {
          storage: 'gist',
          gistId: 'gist-123',
          fileName: 'customers.json',
          exists: true,
          updatedAt: '2026-06-07T00:05:00.000Z',
          data
        }
      }
    },
    providerAvailability: {
      googleMaps: { available: false, missingEnvVars: ['GOOGLE_MAPS_API_KEY'] },
      tavily: { available: false, missingEnvVars: ['TAVILY_API_KEY'] }
    }
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })

  try {
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`

    const missingMaps = await fetch(`${baseUrl}/api/addresses/batch-classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses: [{ name: 'Acme', address: 'Berlin' }] })
    })
    assert.equal(missingMaps.status, 503)
    assert.deepEqual(await missingMaps.json(), {
      success: false,
      code: 'missing_env',
      error: 'GOOGLE_MAPS_API_KEY is required for address classification.',
      missingEnvVars: ['GOOGLE_MAPS_API_KEY']
    })

    const missingTavily = await fetch(`${baseUrl}/api/companies/find-similar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: { name: 'Acme' } })
    })
    assert.equal(missingTavily.status, 503)

    const customerData = await fetch(`${baseUrl}/api/customer-data`)
    assert.equal(customerData.status, 200)
    const customerPayload = await customerData.json()
    assert.equal(customerPayload.storage, 'gist')
    assert.equal(customerPayload.fileName, 'customers.json')
    assert.equal(customerPayload.data.leadWorkspaces.length, 1)
    assert.deepEqual(customerPayload.data.providerMetadata, { tavily: { queries: 1 } })

    const invalidBody = await fetch(`${baseUrl}/api/customer-data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: true })
    })
    assert.equal(invalidBody.status, 400)
    assert.deepEqual(await invalidBody.json(), {
      success: false,
      code: 'invalid_customer_data_payload',
      error: 'Request body must be a JSON object with a data field.'
    })

    const updated = await fetch(`${baseUrl}/api/customer-data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          customers: [],
          leads: [{ id: 'l1' }],
          leadWorkspaces: [buildWorkspace({ id: 'workspace-2' })],
          countries: [],
          keywords: ['mc4'],
          searchKeywords: ['battery connector'],
          companies: [],
          websites: [],
          evidence: [],
          providerMetadata: { tavily: { queries: 2 } }
        }
      })
    })
    assert.equal(updated.status, 200)
    const updatedPayload = await updated.json()
    assert.equal(updatedPayload.data.leadWorkspaces[0].id, 'workspace-2')
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
})


test('lead support router returns safe missing_env responses and sanitizes gist request failures', async () => {
  const missingEnvApp = express()
  missingEnvApp.use(express.json())
  missingEnvApp.use('/api', createLeadSupportRouter({
    addressClassificationService: {
      async batchClassify() {
        return { results: [] }
      }
    },
    companySimilarityService: {
      async findSimilarCompanies() {
        return []
      }
    },
    gistCustomerDataService: createGistCustomerDataService({
      gistId: '',
      githubToken: '',
      fileName: 'customers.json',
      fetchImpl: async () => {
        throw new Error('fetch should not run when gist config is missing')
      }
    }),
    providerAvailability: {
      googleMaps: { available: true, missingEnvVars: [] },
      tavily: { available: true, missingEnvVars: [] }
    }
  }))

  const missingEnvServer = await new Promise((resolve) => {
    const instance = missingEnvApp.listen(0, () => resolve(instance))
  })

  try {
    const address = missingEnvServer.address()
    const baseUrl = `http://127.0.0.1:${address.port}`

    const readResponse = await fetch(`${baseUrl}/api/customer-data`)
    const readText = await readResponse.text()
    assert.equal(readResponse.status, 503)
    assert.deepEqual(JSON.parse(readText), {
      success: false,
      code: 'missing_env',
      error: 'Gist customer data storage is not configured.',
      missingEnvVars: ['GIST_ID', 'GITHUB_GIST_TOKEN']
    })

    const updateResponse = await fetch(`${baseUrl}/api/customer-data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          customers: [],
          leads: [],
          leadWorkspaces: [buildWorkspace()],
          countries: [],
          keywords: ['mc4'],
          searchKeywords: ['battery connector'],
          companies: [],
          websites: [],
          evidence: [],
          providerMetadata: {}
        }
      })
    })
    const updateText = await updateResponse.text()
    assert.equal(updateResponse.status, 503)
    assert.deepEqual(JSON.parse(updateText), {
      success: false,
      code: 'missing_env',
      error: 'Gist customer data storage is not configured.',
      missingEnvVars: ['GIST_ID', 'GITHUB_GIST_TOKEN']
    })
  } finally {
    await new Promise((resolve, reject) => {
      missingEnvServer.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  const secretToken = 'super-secret-token'
  const gistFailureApp = express()
  gistFailureApp.use(express.json())
  gistFailureApp.use('/api', createLeadSupportRouter({
    addressClassificationService: {
      async batchClassify() {
        return { results: [] }
      }
    },
    companySimilarityService: {
      async findSimilarCompanies() {
        return []
      }
    },
    gistCustomerDataService: createGistCustomerDataService({
      gistId: 'gist-123',
      githubToken: secretToken,
      fileName: 'customers.json',
      fetchImpl: async () => createJsonResponse(403, { message: 'forbidden' })
    }),
    providerAvailability: {
      googleMaps: { available: true, missingEnvVars: [] },
      tavily: { available: true, missingEnvVars: [] }
    }
  }))

  const gistFailureServer = await new Promise((resolve) => {
    const instance = gistFailureApp.listen(0, () => resolve(instance))
  })

  try {
    const address = gistFailureServer.address()
    const baseUrl = `http://127.0.0.1:${address.port}`

    const updateResponse = await fetch(`${baseUrl}/api/customer-data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          customers: [],
          leads: [],
          leadWorkspaces: [buildWorkspace()],
          countries: [],
          keywords: ['mc4'],
          searchKeywords: ['battery connector'],
          companies: [],
          websites: [],
          evidence: [],
          providerMetadata: { tavily: { queries: 1 } }
        }
      })
    })
    const updateText = await updateResponse.text()
    assert.equal(updateResponse.status, 502)
    assert.deepEqual(JSON.parse(updateText), {
      success: false,
      code: 'gist_request_failed',
      error: 'Failed to update customer data'
    })
    assert.equal(updateText.includes(secretToken), false)
  } finally {
    await new Promise((resolve, reject) => {
      gistFailureServer.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
})

test('lead support router sanitizes invalid gist JSON errors', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', createLeadSupportRouter({
    addressClassificationService: {
      async batchClassify() {
        return { results: [] }
      }
    },
    companySimilarityService: {
      async findSimilarCompanies() {
        return []
      }
    },
    gistCustomerDataService: {
      getConfigurationStatus() {
        return { configured: true, missingEnvVars: [], fileName: 'customers.json' }
      },
      async readCustomerData() {
        const error = new Error('The configured Gist file does not contain valid JSON.')
        error.code = 'invalid_gist_json'
        error.status = 502
        throw error
      },
      async updateCustomerData() {
        const error = new Error('Customer data payload must include at least one supported document section.')
        error.code = 'invalid_payload'
        error.status = 400
        throw error
      }
    },
    providerAvailability: {
      googleMaps: { available: true, missingEnvVars: [] },
      tavily: { available: true, missingEnvVars: [] }
    }
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })

  try {
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`

    const readResponse = await fetch(`${baseUrl}/api/customer-data`)
    assert.equal(readResponse.status, 502)
    assert.deepEqual(await readResponse.json(), {
      success: false,
      code: 'invalid_gist_json',
      error: 'The configured Gist file does not contain valid JSON.'
    })

    const updateResponse = await fetch(`${baseUrl}/api/customer-data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { foo: 'bar' } })
    })
    assert.equal(updateResponse.status, 400)
    assert.deepEqual(await updateResponse.json(), {
      success: false,
      code: 'invalid_payload',
      error: 'Customer data payload must include at least one supported document section.'
    })
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
})

test('lead export router returns workspace CSV and XLSX downloads with safe workbook cells', async () => {
  const workspace = buildWorkspace({
    companies: [
      {
        ...buildWorkspace().companies[0],
        name: '=Acme GmbH',
        notes: '@warm intro',
        outreachNotes: '-follow up after expo',
        customContactName: '+Anna Buyer'
      }
    ]
  })

  const app = express()
  app.use('/api', createLeadExportRouter({
    leadWorkspaceRepository: {
      async getById(id) {
        return id === workspace.id ? workspace : null
      }
    },
    gistCustomerDataService: {
      async readCustomerData() {
        throw new Error('not used in workspace export test')
      }
    }
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })

  try {
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`

    const csvResponse = await fetch(`${baseUrl}/api/lead-workspaces/${workspace.id}/export.csv`)
    assert.equal(csvResponse.status, 200)
    assert.match(csvResponse.headers.get('content-type') || '', /text\/csv/)
    assert.match(csvResponse.headers.get('content-disposition') || '', /industrial-connectors-germany\.csv/)
    const csvText = await csvResponse.text()
    assert.match(csvText, /"Company","Website"/)
    assert.match(csvText, /"Source URL"/)
    assert.match(csvText, /=Acme GmbH/)

    const xlsxResponse = await fetch(`${baseUrl}/api/lead-workspaces/${workspace.id}/export.xlsx`)
    assert.equal(xlsxResponse.status, 200)
    assert.equal(xlsxResponse.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.match(xlsxResponse.headers.get('content-disposition') || '', /industrial-connectors-germany\.xlsx/)

    const workbook = readWorkbookFromResponseBuffer(await xlsxResponse.arrayBuffer())
    assert.deepEqual(workbook.SheetNames, ['Workspace Summary', 'Search Strategy', 'Companies', 'Contacts', 'Drafts'])

    const summaryRows = getSheetRows(workbook, 'Workspace Summary')
    assert.equal(summaryRows[0].industry, 'industrial connectors')
    assert.equal(summaryRows[0].workflowSource, 'lead-workspace')

    const companyRows = getSheetRows(workbook, 'Companies')
    assert.equal(companyRows[0].name, "'=Acme GmbH")
    assert.equal(companyRows[0].notes, "'@warm intro")
    assert.equal(companyRows[0].outreachNotes, "'-follow up after expo")
    assert.equal(companyRows[0].customContactName, "'+Anna Buyer")
    assert.equal(companyRows[0].contactEmails, 'sales@acme.example')

    const contactRows = getSheetRows(workbook, 'Contacts')
    assert.equal(contactRows[0].fullName, 'Anna Buyer')

    const draftRows = getSheetRows(workbook, 'Drafts')
    assert.equal(draftRows[0].subject, 'PV connector supply')
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
})

test('lead export router returns full customer-data XLSX workbook with complete sections', async () => {
  const document = {
    customers: [{ id: 'customer-1', name: 'Customer One', owner: '=secretary' }],
    leads: [{ id: 'lead-1', status: 'qualified', notes: '+priority' }],
    leadWorkspaces: [buildWorkspace()],
    countries: [{ code: 'DE', name: 'Germany' }],
    keywords: ['mc4'],
    searchKeywords: ['battery connector'],
    companies: [{ id: 'catalog-1', name: 'Catalog Co', website: 'https://catalog.example' }],
    websites: [{ id: 'site-1', url: 'https://acme.example', source: 'public-web' }],
    evidence: [{ id: 'evidence-1', provider: 'tavily', snippet: '@public proof' }],
    providerMetadata: {
      tavily: { queries: 3, lastQuery: '=industrial connectors germany' },
      brave: { queries: 1 }
    },
    lastSyncedAt: '2026-06-08T01:00:00.000Z',
    lastSyncSource: 'lead-finder'
  }

  const app = express()
  app.use('/api', createLeadExportRouter({
    leadWorkspaceRepository: {
      async getById() {
        return null
      }
    },
    gistCustomerDataService: {
      async readCustomerData() {
        return {
          storage: 'gist',
          gistId: 'gist-123',
          fileName: 'customer-data.json',
          exists: true,
          updatedAt: '2026-06-08T01:05:00.000Z',
          data: document
        }
      },
      getConfigurationStatus() {
        return { configured: true, missingEnvVars: [], fileName: 'customer-data.json' }
      }
    }
  }))

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })

  try {
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`
    const response = await fetch(`${baseUrl}/api/customer-data/export.xlsx`)

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.match(response.headers.get('content-disposition') || '', /customer-data-export\.xlsx/)

    const workbook = readWorkbookFromResponseBuffer(await response.arrayBuffer())
    assert.deepEqual(workbook.SheetNames, [
      'Document Summary',
      'Customers',
      'Leads',
      'Lead Workspaces',
      'Workspace Companies',
      'Workspace Contacts',
      'Workspace Drafts',
      'Countries',
      'Keywords',
      'Search Keywords',
      'Company Catalog',
      'Websites',
      'Evidence',
      'Provider Metadata'
    ])

    const summaryRows = getSheetRows(workbook, 'Document Summary')
    assert.equal(summaryRows[0].workflowSource, 'lead-finder')
    assert.equal(summaryRows[0].workspaceCount, 1)
    assert.equal(summaryRows[0].providerCount, 2)

    const customerRows = getSheetRows(workbook, 'Customers')
    assert.equal(customerRows[0].name, 'Customer One')
    assert.equal(customerRows[0].owner, "'=secretary")

    const leadRows = getSheetRows(workbook, 'Leads')
    assert.equal(leadRows[0].notes, "'+priority")

    const workspaceRows = getSheetRows(workbook, 'Lead Workspaces')
    assert.equal(workspaceRows[0].industry, 'industrial connectors')
    assert.equal(workspaceRows[0].targetTypes, 'manufacturer')

    const workspaceCompanyRows = getSheetRows(workbook, 'Workspace Companies')
    assert.equal(workspaceCompanyRows[0].name, 'Acme GmbH')
    assert.equal(workspaceCompanyRows[0].notes, 'Warm target')
    assert.equal(workspaceCompanyRows[0].matchedProviders, 'tavily')

    const countriesRows = getSheetRows(workbook, 'Countries')
    assert.equal(countriesRows[0].code, 'DE')

    const keywordRows = getSheetRows(workbook, 'Keywords')
    assert.equal(keywordRows[0].keyword, 'mc4')

    const searchKeywordRows = getSheetRows(workbook, 'Search Keywords')
    assert.equal(searchKeywordRows[0].searchKeyword, 'battery connector')

    const evidenceRows = getSheetRows(workbook, 'Evidence')
    assert.equal(evidenceRows[0].snippet, "'@public proof")

    const providerRows = getSheetRows(workbook, 'Provider Metadata')
    assert.equal(providerRows[0].provider, 'tavily')
    assert.equal(providerRows[0]['metadata.lastQuery'], "'=industrial connectors germany")
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
})

