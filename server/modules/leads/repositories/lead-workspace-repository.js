import path from 'path'
import { ensureJsonFile, readJsonFile, writeJsonFile } from '../../../infrastructure/storage/json-file.js'

function ensureWorkspaceArray(value) {
  return Array.isArray(value) ? value : []
}

function createLocalLeadWorkspaceRepository(rootDir) {
  const filePath = path.join(rootDir, 'data', 'lead-workspaces.json')

  function readAll() {
    return ensureWorkspaceArray(readJsonFile(filePath, []))
  }

  return {
    init() {
      ensureJsonFile(filePath, [])
    },
    async list() {
      return readAll()
    },
    async getById(id) {
      return readAll().find((workspace) => workspace.id === id) || null
    },
    async prependAndTrim(workspace, limit = 25) {
      const workspaces = readAll()
      workspaces.unshift(workspace)
      writeJsonFile(filePath, workspaces.slice(0, limit))
      return workspace
    },
    async updateCompany(workspaceId, companyId, updater) {
      const workspaces = readAll()
      const workspace = workspaces.find((item) => item.id === workspaceId)
      if (!workspace) {
        return null
      }

      const companyIndex = workspace.companies.findIndex((item) => item.id === companyId)
      if (companyIndex === -1) {
        return { workspace, company: null }
      }

      workspace.companies[companyIndex] = updater(workspace.companies[companyIndex], workspace)
      writeJsonFile(filePath, workspaces)
      return { workspace, company: workspace.companies[companyIndex] }
    }
  }
}

function createGistLeadWorkspaceRepository(gistCustomerDataService) {
  async function readDocument() {
    const result = await gistCustomerDataService.readCustomerData()
    return result.data
  }

  async function writeDocument(patch) {
    const result = await gistCustomerDataService.updateCustomerData(patch)
    return result.data
  }

  async function mutateDocument(mutator, fallbackPatch) {
    if (typeof gistCustomerDataService.mutateCustomerData === 'function') {
      const result = await gistCustomerDataService.mutateCustomerData(mutator)
      return result.data
    }
    return writeDocument(fallbackPatch)
  }

  return {
    init() {},
    async list() {
      const document = await readDocument()
      return ensureWorkspaceArray(document.leadWorkspaces)
    },
    async getById(id) {
      const workspaces = await this.list()
      return workspaces.find((workspace) => workspace.id === id) || null
    },
    async prependAndTrim(workspace, limit = 25) {
      const workspaces = await this.list()
      const nextWorkspaces = [workspace, ...workspaces.filter((item) => item.id !== workspace.id)].slice(0, limit)
      await mutateDocument((current) => ({
        ...current,
        leadWorkspaces: [workspace, ...ensureWorkspaceArray(current.leadWorkspaces).filter((item) => item.id !== workspace.id)].slice(0, limit),
        lastSyncedAt: new Date().toISOString(),
        lastSyncSource: 'lead-workspace-repository'
      }), {
        leadWorkspaces: nextWorkspaces,
        lastSyncedAt: new Date().toISOString(),
        lastSyncSource: 'lead-workspace-repository'
      })
      return workspace
    },
    async updateCompany(workspaceId, companyId, updater) {
      const workspaces = await this.list()
      const workspaceIndex = workspaces.findIndex((item) => item.id === workspaceId)
      if (workspaceIndex === -1) {
        return null
      }

      const workspace = workspaces[workspaceIndex]
      const companyIndex = workspace.companies.findIndex((item) => item.id === companyId)
      if (companyIndex === -1) {
        return { workspace, company: null }
      }

      const nextWorkspace = {
        ...workspace,
        companies: workspace.companies.map((company, index) => {
          if (index !== companyIndex) {
            return company
          }

          return updater(company, workspace)
        })
      }

      const nextWorkspaces = workspaces.map((item, index) => index === workspaceIndex ? nextWorkspace : item)
      await mutateDocument((current) => {
        const latestWorkspaces = ensureWorkspaceArray(current.leadWorkspaces)
        const latestIndex = latestWorkspaces.findIndex((item) => item.id === workspaceId)
        if (latestIndex === -1) return current
        const latestWorkspace = latestWorkspaces[latestIndex]
        const latestCompanyIndex = ensureWorkspaceArray(latestWorkspace.companies).findIndex((item) => item.id === companyId)
        if (latestCompanyIndex === -1) return current
        const updatedLatestWorkspace = {
          ...latestWorkspace,
          companies: latestWorkspace.companies.map((company, index) => index === latestCompanyIndex ? updater(company, latestWorkspace) : company)
        }
        return {
          ...current,
          leadWorkspaces: latestWorkspaces.map((item, index) => index === latestIndex ? updatedLatestWorkspace : item),
          lastSyncedAt: new Date().toISOString(),
          lastSyncSource: 'lead-workspace-repository'
        }
      }, {
        leadWorkspaces: nextWorkspaces,
        lastSyncedAt: new Date().toISOString(),
        lastSyncSource: 'lead-workspace-repository'
      })

      return {
        workspace: nextWorkspace,
        company: nextWorkspace.companies[companyIndex]
      }
    }
  }
}

export function createLeadWorkspaceRepository(rootDir, options = {}) {
  const { gistCustomerDataService } = options

  if (gistCustomerDataService?.getConfigurationStatus?.().configured) {
    return createGistLeadWorkspaceRepository(gistCustomerDataService)
  }

  return createLocalLeadWorkspaceRepository(rootDir)
}
