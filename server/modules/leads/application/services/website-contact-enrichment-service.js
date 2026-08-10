import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { extractCompanyFacts, mergeCompanyFacts } from '../../shared/company-fact-extractors.js'

const DEFAULT_PATHS = [
  '/',
  '/about',
  '/contact',
  '/contact-us',
  '/company',
  '/about-us',
  '/imprint',
  '/legal-notice',
  '/supplier',
  '/vendor',
  '/procurement'
]

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeWebsite(value) {
  if (!hasText(value)) {
    return ''
  }

  const trimmed = value.trim()
  const raw = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
      return ''
    }

    if (parsed.port && !['80', '443'].includes(parsed.port)) {
      return ''
    }

    return parsed.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'instance-data.ec2.internal'
])

function isPrivateIpv4(address) {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10))
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }

  const [first, second, third] = octets
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51)
    || (first === 203 && second === 0)
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase().split('%', 1)[0]
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length)
    if (isIP(mappedIpv4) === 4) {
      return isPrivateIpv4(mappedIpv4)
    }
  }

  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('ff')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('2001:db8:')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
}

function isPublicAddress(address) {
  const family = isIP(address)
  if (family === 4) {
    return !isPrivateIpv4(address)
  }
  if (family === 6) {
    return !isPrivateIpv6(address)
  }
  return false
}

async function isSafePublicWebsiteUrl(value, resolveHost) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return false
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return false
  }

  if (isIP(hostname)) {
    return isPublicAddress(hostname)
  }

  try {
    const records = await resolveHost(hostname, { all: true, verbatim: true })
    const addresses = (Array.isArray(records) ? records : [records])
      .map((record) => typeof record === 'string' ? record : record?.address)
      .filter(Boolean)

    return addresses.length > 0 && addresses.every(isPublicAddress)
  } catch {
    return false
  }
}

function unique(values = []) {
  return [...new Set(values.filter(hasText).map((value) => value.trim()))]
}

function decodeHtmlEntities(value = '') {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&commat;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function visibleText(html = '') {
  return decodeHtmlEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeEmail(value = '') {
  const normalized = decodeHtmlEntities(value)
    .replace(/^mailto:/i, '')
    .split(/[?#]/, 1)[0]
    .trim()
    .replace(/^[<\("'\s]+|[),.;:'">\s]+$/g, '')
    .toLowerCase()

  if (!normalized || normalized.includes('/') || normalized.includes('\\') || normalized.includes('://')) {
    return ''
  }

  const match = normalized.match(/^[a-z0-9.!#$%&'*+=?^_`{|}~-]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/i)
  if (!match || normalized.includes('example.com')) {
    return ''
  }

  const labels = match[1].split('.')
  const topLevelDomain = labels[labels.length - 1]
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(topLevelDomain)) {
    return ''
  }

  return normalized
}

function classifyEmail(value) {
  const localPart = value.split('@')[0].toLowerCase()

  if (/(procurement|purchasing|sourcing|supplier|vendor)/.test(localPart)) {
    return 'procurement'
  }

  if (/(sales|business|commercial)/.test(localPart)) {
    return 'sales'
  }

  if (/(info|contact|hello|office|support)/.test(localPart)) {
    return 'generic'
  }

  if (/(noreply|no-reply|donotreply|do-not-reply)/.test(localPart)) {
    return 'unknown'
  }

  return 'unknown'
}

function extractEmails(html = '') {
  const decoded = decodeHtmlEntities(html.replace(/&#64;|\[at\]/gi, '@').replace(/&#46;|\[dot\]/gi, '.'))
  const markup = decoded
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
  const mailtoValues = [...markup.matchAll(/href\s*=\s*["']\s*mailto:([^"']+)/gi)]
    .map((match) => match[1])
  const visible = visibleText(decoded)
  const matches = [
    ...mailtoValues,
    ...(visible.match(/[a-z0-9.!#$%&'*+=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi) || [])
  ]

  return unique(matches.map(normalizeEmail).filter(Boolean))
}

function normalizePhone(value = '') {
  let decodedValue = value
  try {
    decodedValue = decodeURIComponent(value)
  } catch {
    // Preserve the original value when it is not valid percent-encoded text.
  }
  const normalized = decodeHtmlEntities(decodedValue)
    .replace(/^(?:tel:|callto:)/i, '')
    .split(/[?#;]/, 1)[0]
    .replace(/\s*(?:ext\.?|x)\s*\d+.*$/i, '')
    .trim()
    .replace(/[),.;]+$/, '')

  if (!normalized || /[a-z/\\:<>{}]/i.test(normalized)) {
    return ''
  }

  const digits = normalized.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15 || /^0+$/.test(digits)) {
    return ''
  }

  // International numbers written with 00 must still contain a plausible
  // national number; this rejects values such as 00220 0 20 20 from broken
  // phone widgets while preserving ordinary local formats.
  if (/^00/.test(digits) && digits.length < 11) {
    return ''
  }

  const yearLikeTokens = normalized.match(/\b(?:19|20)\d{2}\b/g) || []
  if (yearLikeTokens.length >= 2 && yearLikeTokens.join('').length === digits.length) {
    return ''
  }

  return normalized
}

function extractPhone(html = '') {
  const decoded = decodeHtmlEntities(html)
  const telValues = [...decoded.matchAll(/href\s*=\s*["']\s*(?:tel:|callto:)([^"']+)/gi)]
    .map((match) => normalizePhone(match[1]))
    .filter(Boolean)

  if (telValues[0]) {
    return telValues[0]
  }

  const text = visibleText(decoded)
  const candidates = text.match(/(?:\+\d[\d\s().-]{6,}\d|\(\d{2,4}\)[\d\s.-]{5,}\d|\b\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4}\b)/g) || []
  return candidates.map(normalizePhone).find(Boolean) || ''
}

function buildUrls(website, maxPages) {
  const base = new URL(website)
  const baseDirectory = base.pathname.endsWith('/')
    ? base.pathname.replace(/\/$/, '')
    : base.pathname.replace(/\/[^/]*$/, '')
  const localizedPaths = baseDirectory && baseDirectory !== '/'
    ? ['/contact', '/contact-us', '/company', '/about', '/about-us', '/imprint'].map((path) => `${baseDirectory}${path}`)
    : []
  const paths = [base.pathname, ...localizedPaths, ...DEFAULT_PATHS]
  const urls = []

  for (const pathname of paths) {
    const url = new URL(base.origin)
    url.pathname = pathname || '/'
    const normalized = url.toString().replace(/\/$/, '')

    if (!urls.includes(normalized)) {
      urls.push(normalized)
    }

    if (urls.length >= maxPages) {
      break
    }
  }

  return urls
}

function normalizedHostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function isSameWebsite(requestedUrl, finalUrl) {
  let requested
  let final
  try {
    requested = new URL(requestedUrl)
    final = new URL(finalUrl)
  } catch {
    return false
  }

  const requestedHost = normalizedHostname(requestedUrl)
  const finalHost = normalizedHostname(finalUrl)
  const requestedPort = requested.port || (requested.protocol === 'https:' ? '443' : '80')
  const finalPort = final.port || (final.protocol === 'https:' ? '443' : '80')
  return Boolean(
    requestedHost
      && finalHost
      && requestedHost === finalHost
      && ['http:', 'https:'].includes(final.protocol)
      && requestedPort === finalPort
  )
}

async function readResponseText(response, maxBytes) {
  const contentLength = Number.parseInt(response.headers?.get?.('content-length') || response.headers?.['content-length'] || '', 10)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { text: '', error: 'response_too_large' }
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const chunks = []
    let size = 0

    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        size += next.value?.byteLength || 0
        if (size > maxBytes) {
          await reader.cancel()
          return { text: '', error: 'response_too_large' }
        }
        chunks.push(decoder.decode(next.value, { stream: true }))
      }
      chunks.push(decoder.decode())
      return { text: chunks.join(''), error: null }
    } finally {
      reader.releaseLock?.()
    }
  }

  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { text: '', error: 'response_too_large' }
  }
  return { text, error: null }
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs, isAllowedUrl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let currentUrl = url

  try {
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      if (typeof isAllowedUrl === 'function' && !(await isAllowedUrl(currentUrl))) {
        return {
          ok: false,
          status: 0,
          text: '',
          finalUrl: currentUrl,
          error: 'unsafe_or_unresolvable_website'
        }
      }

      const response = await fetchImpl(currentUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'ApplyBotResearch/1.0 (+public-contact-enrichment)'
        },
        redirect: 'manual',
        signal: controller.signal
      })

      const location = response.headers?.get?.('location') || response.headers?.location
      if (response.status >= 300 && response.status < 400 && location) {
        const nextUrl = new URL(location, currentUrl).toString()
        if (!isSameWebsite(currentUrl, nextUrl)) {
          return {
            ok: false,
            status: response.status,
            text: '',
            finalUrl: nextUrl,
            error: 'external_redirect'
          }
        }
        currentUrl = nextUrl
        continue
      }

      if (!response.ok) {
        return { ok: false, status: response.status, text: '', finalUrl: currentUrl }
      }

      const body = await readResponseText(response, 400000)
      if (body.error) {
        return { ok: false, status: response.status, text: '', finalUrl: currentUrl, error: body.error }
      }
      return {
        ok: true,
        status: response.status,
        text: body.text,
        finalUrl: response.url || currentUrl
      }
    }

    return { ok: false, status: 0, text: '', finalUrl: currentUrl, error: 'redirect_limit_exceeded' }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: '',
      finalUrl: currentUrl,
      error: error?.name === 'AbortError' ? 'timeout' : error?.message || 'request_failed'
    }
  } finally {
    clearTimeout(timer)
  }
}

export function createWebsiteContactEnrichmentService({
  fetchImpl = globalThis.fetch,
  resolveHost = lookup,
  timeoutMs = 5000,
  maxPages = 4,
  cacheTtlMs = 60 * 60 * 1000
} = {}) {
  const cache = new Map()
  const hostSafetyCache = new Map()

  async function isAllowedUrl(url) {
    const hostname = new URL(url).hostname.toLowerCase()
    if (!hostSafetyCache.has(hostname)) {
      hostSafetyCache.set(hostname, isSafePublicWebsiteUrl(url, resolveHost))
    }
    return hostSafetyCache.get(hostname)
  }

  return {
    async enrich({ website } = {}) {
      const normalizedWebsite = normalizeWebsite(website)

      if (!normalizedWebsite) {
        return {
          status: 'not_configured',
          website: '',
          emails: [],
          contactEmails: [],
          contactPages: [],
          phone: '',
          companyName: '',
          address: '',
          headquarters: '',
          employeeCount: '',
          employeeRange: '',
          companySize: '',
          companySizeSource: '',
          scaleSignals: [],
          evidence: [],
          calls: []
        }
      }

      if (!(await isAllowedUrl(normalizedWebsite))) {
        return {
          status: 'unavailable',
          website: normalizedWebsite,
          emails: [],
          contactEmails: [],
          contactPages: [],
          phone: '',
          companyName: '',
          address: '',
          headquarters: '',
          employeeCount: '',
          employeeRange: '',
          companySize: '',
          companySizeSource: '',
          scaleSignals: [],
          evidence: [],
          error: 'unsafe_or_unresolvable_website',
          calls: [{
            url: normalizedWebsite,
            ok: false,
            status: 0,
            finalUrl: normalizedWebsite,
            error: 'unsafe_or_unresolvable_website',
            emailCount: 0
          }]
        }
      }

      const cached = cache.get(normalizedWebsite)
      if (cached && cached.expiresAt > Date.now()) {
        return JSON.parse(JSON.stringify({ ...cached.result, cached: true }))
      }

      const urls = buildUrls(normalizedWebsite, Math.max(1, Math.min(Number(maxPages) || 4, 6)))
      const responses = await Promise.all(urls.map(async (url) => ({
        url,
        response: await fetchWithTimeout(fetchImpl, url, Math.max(500, Number(timeoutMs) || 5000), isAllowedUrl)
      })))

      const emails = []
      const contactPages = []
      const evidence = []
      const companyFacts = []
      const calls = responses.map(({ url, response }) => ({
        url,
        ok: Boolean(response.ok && isSameWebsite(url, response.finalUrl || url)),
        status: response.status,
        finalUrl: response.finalUrl || url,
        error: response.error || (response.ok && !isSameWebsite(url, response.finalUrl || url) ? 'external_redirect' : null),
        emailCount: response.ok && isSameWebsite(url, response.finalUrl || url) ? extractEmails(response.text).length : 0
      }))

      for (const { url, response } of responses) {
        if (!response.ok || !isSameWebsite(url, response.finalUrl || url)) {
          continue
        }

        const pageEmails = extractEmails(response.text)
        const phone = extractPhone(response.text)
        const facts = extractCompanyFacts(response.text)
        companyFacts.push(facts)

        if (pageEmails.length > 0 || phone) {
          contactPages.push(url)
        }

        for (const email of pageEmails) {
          emails.push({
            value: email,
            type: classifyEmail(email),
            sourceUrl: url,
            observedAt: new Date().toISOString()
          })
          evidence.push({
            type: 'public_email',
            sourceUrl: url,
            value: email,
            observedAt: new Date().toISOString()
          })
        }

        if (phone) {
          evidence.push({
            type: 'public_phone',
            sourceUrl: url,
            value: phone,
            observedAt: new Date().toISOString()
          })
        }

        if (facts.address) {
          evidence.push({
            type: 'public_address',
            sourceUrl: url,
            value: facts.address,
            observedAt: new Date().toISOString()
          })
        }
        if (facts.companySize) {
          evidence.push({
            type: 'public_company_size',
            sourceUrl: url,
            value: facts.companySize,
            employeeCount: facts.employeeCount,
            employeeRange: facts.employeeRange,
            observedAt: new Date().toISOString()
          })
        }
      }

      const uniqueEmails = []
      const emailKeys = new Set()
      for (const email of emails) {
        if (emailKeys.has(email.value)) {
          continue
        }
        emailKeys.add(email.value)
        uniqueEmails.push(email)
      }

      const phone = evidence.find((item) => item.type === 'public_phone')?.value || ''
      const facts = mergeCompanyFacts(companyFacts)
      const successfulPages = responses.filter(({ url, response }) => response.ok && isSameWebsite(url, response.finalUrl || url)).length
      const result = {
        status: uniqueEmails.length > 0 ? 'completed' : successfulPages > 0 ? 'no_public_email' : 'unavailable',
        website: normalizedWebsite,
        emails: uniqueEmails,
        contactEmails: uniqueEmails.map((email) => email.value),
        contactPages: unique(contactPages),
        phone,
        ...facts,
        evidence,
        calls
      }

      const ttl = Math.max(0, Number(cacheTtlMs) || 0)
      if (ttl > 0) {
        cache.set(normalizedWebsite, { expiresAt: Date.now() + ttl, result })
      }

      return result
    }
  }
}
