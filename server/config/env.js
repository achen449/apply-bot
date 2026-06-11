import fs from 'fs'

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)

  lines.forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) {
      return
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    const normalizedValue = rawValue.replace(/^['\"]|['\"]$/g, '')

    if (key && !process.env[key]) {
      process.env[key] = normalizedValue
    }
  })
}

export function loadServerEnv(rootDir) {
  loadEnvFile(`${rootDir}/.env.local`)
  loadEnvFile(`${rootDir}/.env`)

  return {
    TAVILY_API_KEY: process.env.TAVILY_API_KEY || '',
    TAVILY_API_KEY_BACKUP: process.env.TAVILY_API_KEY_BACKUP || '',
    BRAVE_API_KEY: process.env.BRAVE_API_KEY || '',
    BRAVE_API_KEY_BACKUP: process.env.BRAVE_API_KEY_BACKUP || '',
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || '',
    GIST_ID: process.env.GIST_ID || '',
    GITHUB_GIST_TOKEN: process.env.GITHUB_GIST_TOKEN || '',
    GIST_CUSTOMER_DATA_FILENAME: process.env.GIST_CUSTOMER_DATA_FILENAME || '',
    AI_API_HOST: process.env.AI_API_HOST || '',
    AI_API_KEY: process.env.AI_API_KEY || '',
    AI_MODEL: process.env.AI_MODEL || '',
    AI_PROVIDER: process.env.AI_PROVIDER || 'openai-compatible',
    AI_TIMEOUT_MS: Number.parseInt(process.env.AI_TIMEOUT_MS || '60000', 10),
    AI_MAX_TOKENS: Number.parseInt(process.env.AI_MAX_TOKENS || '4000', 10),
    API_CACHE_TTL_HOURS: Number.parseInt(process.env.API_CACHE_TTL_HOURS || '24', 10),
    API_DAILY_TAVILY_LIMIT: Number.parseInt(process.env.API_DAILY_TAVILY_LIMIT || '80', 10),
    API_DAILY_BRAVE_LIMIT: Number.parseInt(process.env.API_DAILY_BRAVE_LIMIT || '80', 10),
    API_DAILY_GOOGLE_MAPS_LIMIT: Number.parseInt(process.env.API_DAILY_GOOGLE_MAPS_LIMIT || '200', 10),
    API_DAILY_AI_LIMIT: Number.parseInt(process.env.API_DAILY_AI_LIMIT || '100', 10)
  }
}
