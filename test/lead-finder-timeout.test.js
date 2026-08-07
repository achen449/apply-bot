import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createAIAgent } from '../server/modules/leads/services/ai-agent.js'
import { createLeadFinderService } from '../server/modules/leads/services/lead-finder-service.js'
import { createApiRouter } from '../server/modules/leads/routes/api-routes.js'

test('AI agent applies a task deadline and preserves partial execution context', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })

  try {
    const agent = createAIAgent({
      apiHost: 'https://ai.example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
      timeoutMs: 120000,
      maxTokens: 12000
    })

    await assert.rejects(
      () => agent.executeTask({
        userInput: 'find buyers',
        deadlineMs: 650,
        timeoutMs: 1000,
        maxTokens: 4000
      }),
      (error) => {
        assert.equal(error.code, 'ai_request_timeout')
        assert.ok(Array.isArray(error.toolCalls))
        assert.equal(error.iterations, 1)
        return true
      }
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('serverless lead finder returns partial evidence when the AI budget is exhausted', async () => {
  let receivedOptions
  const aiAgent = {
    async executeTask(options) {
      receivedOptions = options
      const error = new Error('AI task deadline reached during AI request.')
      error.code = 'ai_request_timeout'
      error.iterations = 1
      error.toolCalls = [{
        id: 'search-1',
        name: 'search_web',
        arguments: { query: 'industrial connector buyers Germany', provider: 'tavily' },
        result: {
          ok: true,
          provider: 'tavily',
          results: [{
            title: 'Aurora Energy Systems',
            url: 'https://aurora.example.test',
            snippet: 'Energy systems integrator and industrial buyer.',
            provider: 'tavily'
          }]
        }
      }]
      throw error
    }
  }

  const service = createLeadFinderService({
    aiAgent,
    requestBudgetMs: 240000,
    aiTimeoutMs: 120000,
    maxTokens: 12000,
    maxIterationsCap: 5,
    maxToolCalls: 6,
    toolTimeoutMs: 8000
  })

  const result = await service.discoverWorkspace({
    industry: 'industrial connectors',
    country: 'Germany',
    keywords: ['mc4'],
    mode: 'economy'
  })

  assert.equal(receivedOptions.deadlineMs, 240000)
  assert.equal(receivedOptions.timeoutMs, 120000)
  assert.equal(receivedOptions.maxTokens, 12000)
  assert.equal(receivedOptions.maxIterations, 5)
  assert.equal(receivedOptions.maxToolCalls, 6)
  assert.equal(result.status, 'needs_review')
  assert.equal(result.partial, true)
  assert.equal(result.metadata.status, 'needs_review')
  assert.equal(result.companies[0].name, 'Aurora Energy Systems')
  assert.equal(result.toolCalls[0].function.name, 'search_web')
})

test('lead-finder response is not blocked by a slow research-run persistence call', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', createApiRouter({
    leadFinderService: {
      async discoverWorkspace() {
        return {
          status: 'needs_review',
          partial: true,
          workspace: { id: 'workspace-timeout-test' },
          results: [],
          companies: [],
          toolCalls: [],
          candidatePool: [],
          shortlist: [],
          metadata: { status: 'needs_review', partial: true }
        }
      }
    },
    researchRunsStorage: {
      async save() {
        await new Promise(() => {})
      }
    },
    persistTimeoutMs: 20,
    providerAvailability: {},
    aiConfiguration: {}
  }))

  const server = await new Promise((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer))
  })

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/lead-finder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry: 'industrial connectors', mode: 'economy' })
    })
    const payload = await response.json()

    assert.equal(response.status, 200)
    assert.equal(payload.status, 'needs_review')
    assert.equal(payload.partial, true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
