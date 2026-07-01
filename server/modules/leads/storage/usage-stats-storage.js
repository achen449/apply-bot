export function createUsageStatsStorage({ gistService } = {}) {
  return {
    async get(period = 'day') {
      if (!gistService?.readCustomerData) {
        return {
          period,
          totalRuns: 0,
          byWorkflow: {},
          providers: {}
        }
      }

      const result = await gistService.readCustomerData()
      const runs = Array.isArray(result.data?.researchRuns) ? result.data.researchRuns : []

      const byWorkflow = {}
      const providers = {}
      for (const run of runs) {
        const workflow = run.workflow || 'unknown'
        byWorkflow[workflow] = (byWorkflow[workflow] || 0) + 1
        for (const provider of run.searchCalls || []) {
          const providerName = provider.provider || 'unknown'
          providers[providerName] = (providers[providerName] || 0) + 1
        }
        for (const provider of run.verificationCalls || []) {
          const providerName = provider.provider || 'unknown'
          providers[providerName] = (providers[providerName] || 0) + 1
        }
      }

      return {
        period,
        totalRuns: runs.length,
        byWorkflow,
        providers
      }
    }
  }
}
