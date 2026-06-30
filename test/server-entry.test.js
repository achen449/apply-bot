import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8')

test('api/server.js exports a Vercel handler without auto-listening on import', async () => {
  const originalListen = express.application.listen
  const originalArgv1 = process.argv[1]
  const originalVercel = process.env.VERCEL
  const originalGistId = process.env.GIST_ID
  const originalGistToken = process.env.GITHUB_GIST_TOKEN
  let listenCallCount = 0

  express.application.listen = function patchedListen(...args) {
    listenCallCount += 1
    return originalListen.apply(this, args)
  }
  process.argv[1] = new URL(import.meta.url).pathname
  process.env.VERCEL = '1'
  process.env.GIST_ID = 'test-gist'
  process.env.GITHUB_GIST_TOKEN = 'test-token'

  try {
    const serverEntryModule = await import('../api/server.js')
    const serverModule = await import('../server.js')

    assert.equal(listenCallCount, 0)
    assert.equal(typeof serverEntryModule.default, 'function')
    assert.equal(typeof serverModule.startServer, 'function')
    assert.equal(typeof serverModule.app.use, 'function')

    assert.match(serverSource, /import\s+apiRoutes\s+from\s+'\.\/server\/api-routes\.js'/)
    assert.match(serverSource, /app\.use\('\/api',\s*apiRoutes\)/)
    assert.equal(serverSource.includes("/api/lead-workspaces/:id/export.csv"), false)
    assert.equal(serverSource.includes("/api/lead-workspaces/:id/export.xlsx"), false)
  } finally {
    express.application.listen = originalListen
    process.argv[1] = originalArgv1
    if (originalVercel === undefined) {
      delete process.env.VERCEL
    } else {
      process.env.VERCEL = originalVercel
    }
    if (originalGistId === undefined) {
      delete process.env.GIST_ID
    } else {
      process.env.GIST_ID = originalGistId
    }
    if (originalGistToken === undefined) {
      delete process.env.GITHUB_GIST_TOKEN
    } else {
      process.env.GITHUB_GIST_TOKEN = originalGistToken
    }
  }
})
