function normalizeRuns(runs) {
  return Array.isArray(runs) ? runs : []
}

export function createResearchRunsStorage({ gistService } = {}) {
  return {
    async list({ limit = 100, offset = 0 } = {}) {
      if (gistService?.readCustomerData) {
        const result = await gistService.readCustomerData()
        const runs = normalizeRuns(result.data?.researchRuns)
        return runs.slice(offset, offset + limit)
      }

      return []
    },
    async save(run) {
      if (gistService?.saveResearchRun) {
        await gistService.saveResearchRun(run)
      }
    }
  }
}
