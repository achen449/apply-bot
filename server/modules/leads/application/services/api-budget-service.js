function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function buildCacheKey(provider, payload) {
  return `${provider}:${stableStringify(payload).toLowerCase().replace(/\s+/g, ' ').trim()}`
}

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

export function createApiBudgetService({ dailyLimits = {}, cacheTtlHours = 24 } = {}) {
  const memoryCache = new Map()
  const usage = new Map()

  function getLimit(provider) {
    return Number.isFinite(dailyLimits[provider]) ? dailyLimits[provider] : Infinity
  }

  function getUsage(provider, keySlot = 'primary') {
    const key = `${todayKey()}:${provider}:${keySlot}`
    return usage.get(key) || 0
  }

  function incrementUsage(provider, keySlot = 'primary') {
    const key = `${todayKey()}:${provider}:${keySlot}`
    usage.set(key, getUsage(provider, keySlot) + 1)
  }

  function canCall(provider, keySlot = 'primary') {
    return getUsage(provider, keySlot) < getLimit(provider)
  }

  function getCached(provider, payload) {
    const cacheKey = buildCacheKey(provider, payload)
    const cached = memoryCache.get(cacheKey)
    if (!cached) {
      return null
    }
    if (new Date(cached.expiresAt).getTime() < Date.now()) {
      memoryCache.delete(cacheKey)
      return null
    }
    return cached
  }

  function setCached(provider, payload, results) {
    const cacheKey = buildCacheKey(provider, payload)
    const ttlMs = Math.max(1, cacheTtlHours) * 60 * 60 * 1000
    const record = {
      cacheKey,
      provider,
      payload,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      results
    }
    memoryCache.set(cacheKey, record)
    return record
  }

  async function runProviderCall({ provider, payload, keySlot = 'primary', fetcher }) {
    const cached = getCached(provider, payload)
    if (cached) {
      return {
        results: cached.results,
        cacheHit: true,
        skipped: false,
        provider,
        keySlot
      }
    }

    if (!canCall(provider, keySlot)) {
      return {
        results: [],
        cacheHit: false,
        skipped: true,
        provider,
        keySlot,
        reason: 'daily_limit_reached'
      }
    }

    const results = await fetcher()
    incrementUsage(provider, keySlot)
    setCached(provider, payload, results)
    return {
      results,
      cacheHit: false,
      skipped: false,
      provider,
      keySlot
    }
  }

  function getUsageSnapshot() {
    return [...usage.entries()].map(([key, count]) => {
      const [date, provider, keySlot] = key.split(':')
      return { date, provider, keySlot, count, limit: getLimit(provider) }
    })
  }

  return {
    buildCacheKey,
    canCall,
    getCached,
    setCached,
    runProviderCall,
    getUsageSnapshot
  }
}
