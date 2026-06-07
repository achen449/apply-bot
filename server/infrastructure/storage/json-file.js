import fs from 'fs'
import path from 'path'

export function ensureJsonFile(filePath, fallback) {
  const directory = path.dirname(filePath)
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true })
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf-8')
  }
}

export function readJsonFile(filePath, fallback) {
  ensureJsonFile(filePath, fallback)
  const raw = fs.readFileSync(filePath, 'utf-8')
  if (!raw.trim()) {
    return fallback
  }

  try {
    return JSON.parse(raw)
  } catch (error) {
    console.error(`Failed to parse JSON at ${filePath}:`, error)
    return fallback
  }
}

export function writeJsonFile(filePath, payload) {
  const directory = path.dirname(filePath)
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true })
  }

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}
