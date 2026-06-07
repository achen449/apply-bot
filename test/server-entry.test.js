import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8')

test('api/server.js exports the shared app without auto-listening on import and server.js mounts export routes', async () => {
  const originalListen = express.application.listen
  const originalArgv1 = process.argv[1]
  let listenCallCount = 0

  express.application.listen = function patchedListen(...args) {
    listenCallCount += 1
    return originalListen.apply(this, args)
  }
  process.argv[1] = new URL(import.meta.url).pathname

  try {
    const serverEntryModule = await import('../api/server.js')
    const serverModule = await import('../server.js')

    assert.equal(listenCallCount, 0)
    assert.equal(typeof serverEntryModule.default, 'function')
    assert.equal(typeof serverEntryModule.default.use, 'function')
    assert.equal(typeof serverModule.startServer, 'function')
    assert.equal(serverEntryModule.default, serverModule.default)
    assert.equal(serverEntryModule.default, serverModule.app)

    assert.match(serverSource, /import\s*\{\s*createLeadExportRouter\s*\}\s*from\s*'\.\/server\/modules\/leads\/routes\/lead-export-routes\.js'/)
    assert.match(serverSource, /app\.use\('\/api',\s*createLeadExportRouter\(\{[\s\S]*leadWorkspaceRepository,[\s\S]*gistCustomerDataService[\s\S]*\}\)\)/)
    assert.match(serverSource, /app\.get\('\/api\/lead-workspaces\/:id'/)
    assert.equal(serverSource.includes("/api/lead-workspaces/:id/export.csv"), false)
    assert.equal(serverSource.includes("/api/lead-workspaces/:id/export.xlsx"), false)
  } finally {
    express.application.listen = originalListen
    process.argv[1] = originalArgv1
  }
})