function normalizeRuns(runs) {
  return Array.isArray(runs) ? runs : []
}

function matchesQuery(run, query = '') {
  if (!query) {
    return true
  }

  const haystack = JSON.stringify({
    title: run.title,
    workflow: run.workflow,
    part: run.part,
    queryInput: run.queryInput,
    prompt: run.prompt
  }).toLowerCase()

  return haystack.includes(query.toLowerCase())
}

export function createResearchRunsStorage({ gistService } = {}) {
  return {
    async list({ limit = 100, offset = 0, workflow = '', status = '', query = '', from = '', to = '' } = {}) {
      if (gistService?.readCustomerData) {
        const result = await gistService.readCustomerData()
        const runs = normalizeRuns(result.data?.researchRuns)
          .filter((run) => !workflow || run.workflow === workflow)
          .filter((run) => !status || run.status === status)
          .filter((run) => matchesQuery(run, query))
          .filter((run) => !from || new Date(run.createdAt || 0) >= new Date(from))
          .filter((run) => !to || new Date(run.createdAt || 0) <= new Date(to))

        return runs.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit))
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
