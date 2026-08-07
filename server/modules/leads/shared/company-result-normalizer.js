const NON_COMPANY_MARKERS = [
  'wikipedia',
  'top 10',
  'top  Ten',
  'top 20',
  'top companies',
  'complete guide',
  'project guide',
  'buying guide',
  'compatibility guide',
  'how to',
  'what is',
  'list of',
  'supplier directory',
  'company directory',
  'industry directory',
  'article',
  'blog',
  'news',
  'news roundup',
  'comparison',
  'review',
  'explained',
  'alibaba',
  'amazon',
  'reddit',
  'youtube'
]

const NON_COMPANY_PATH_MARKERS = [
  '/blog/',
  '/blogs/',
  '/news/',
  '/article/',
  '/articles/',
  '/guide/',
  '/guides/',
  '/resources/',
  '/directory/',
  '/supplier-directory/',
  '/product/',
  '/products/',
  '/portfolio-item/',
  '/case-study/',
  '/case-studies/',
  '/green-leader/',
  '/wiki/'
]

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalize(value) {
  return hasText(value) ? value.trim().toLowerCase() : ''
}

const COUNTRY_TOKENS = {
  'united states': ['usa', 'united states', 'u.s.a.', 'united states of america'],
  canada: ['canada'],
  mexico: ['mexico'],
  germany: ['germany', 'deutschland'],
  france: ['france'],
  italy: ['italy', 'italia'],
  spain: ['spain', 'españa'],
  netherlands: ['netherlands', 'the netherlands', 'holland'],
  australia: ['australia'],
  india: ['india'],
  japan: ['japan'],
  'south korea': ['south korea', 'republic of korea', 'korea'],
  'united kingdom': ['united kingdom', 'uk', 'england', 'scotland', 'wales']
}

function normalizeCountry(value) {
  const country = normalize(value)
  if (['us', 'usa', 'u.s.', 'u.s.a.'].includes(country)) {
    return 'united states'
  }
  return country
}

export function matchesTargetCountry(country, locationText) {
  const expectedCountry = normalizeCountry(country)
  const observedLocation = normalize(locationText)

  if (!expectedCountry || !observedLocation) {
    return true
  }

  const expectedTokens = COUNTRY_TOKENS[expectedCountry] || [expectedCountry]
  const otherCountryTokens = Object.entries(COUNTRY_TOKENS)
    .filter(([key]) => key !== expectedCountry)
    .flatMap(([, tokens]) => tokens)

  if (expectedTokens.some((token) => observedLocation.includes(token))) {
    return true
  }

  if (otherCountryTokens.some((token) => observedLocation.includes(token))) {
    return false
  }

  if (expectedCountry === 'united states') {
    return /(?:,|\s)(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\s+\d{5}(?:[-\s]\d{4})?/i.test(locationText)
  }

  return true
}

export function likelyCompanyName(value) {
  const name = hasText(value) ? value.trim() : ''
  const normalized = normalize(name)

  if (!name || NON_COMPANY_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()))) {
    return ''
  }

  if (name.length > 140 || /\.(pdf|html?)$/i.test(name)) {
    return ''
  }

  if (name.includes('|')) {
    const segments = name.split('|').map((segment) => segment.trim()).filter(Boolean)
    const lastSegment = segments[segments.length - 1]
    if (segments[0] && NON_COMPANY_MARKERS.some((marker) => normalize(segments[0]).includes(marker.toLowerCase()))) {
      return ''
    }
    if (lastSegment && lastSegment.length >= 2 && lastSegment.length <= 100) {
      return lastSegment
    }
  }

  return name
}

export function likelyOfficialWebsite(value) {
  if (!hasText(value)) {
    return ''
  }

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) {
      return ''
    }
    return url.toString()
  } catch {
    return ''
  }
}

export function isLikelyBuyerCandidate(candidate = {}) {
  const sourceText = normalize([
    candidate.name,
    candidate.companyName,
    candidate.title,
    candidate.segment,
    candidate.businessType,
    candidate.marketRole,
    candidate.reason,
    candidate.whyFit,
    candidate.buyingRelevance,
    candidate.description,
    candidate.snippet
  ].filter(Boolean).join(' '))

  if (!sourceText) {
    return false
  }

  const negativeBuyerMarkers = /(supplier|factory direct|connector manufacturer|component manufacturer|manufacturer of connectors|wholesale catalog|product guide|catalogue|catalog)/i
  const buyerActionMarkers = /(buyer|procure|purchas|sourc|install|integrat|assembl|deploy|operat|project|epc|oem|developer|contractor|system builder|equipment maker)/i
  const productOnlyMarkers = /(mc4|connector|wire harness|cable assembly|battery connector|high[- ]current cable)/i

  if (negativeBuyerMarkers.test(sourceText) && !buyerActionMarkers.test(sourceText)) {
    return false
  }

  // A product-led result without a buyer action is usually a supplier,
  // catalogue, or technical article. Keep it out of the lead shortlist until
  // public evidence identifies a purchasing/use role.
  if (productOnlyMarkers.test(sourceText) && !buyerActionMarkers.test(sourceText)) {
    return false
  }

  return true
}

export function normalizeCompanyCandidate(candidate = {}) {
  const name = likelyCompanyName(candidate.name || candidate.companyName || candidate.title)
  const website = likelyOfficialWebsite(candidate.website || candidate.url)

  if (!name || !website) {
    return null
  }

  const parsedWebsite = new URL(website)
  if (NON_COMPANY_PATH_MARKERS.some((marker) => parsedWebsite.pathname.toLowerCase().includes(marker))) {
    return null
  }

  return {
    ...candidate,
    name,
    website,
    sourceUrl: candidate.sourceUrl || candidate.url || website
  }
}

export function dedupeCompanyCandidates(candidates = []) {
  const byKey = new Map()

  for (const candidate of candidates) {
    const normalized = normalizeCompanyCandidate(candidate)
    if (!normalized) {
      continue
    }

    let key = normalized.website.toLowerCase()
    try {
      key = new URL(normalized.website).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
      // Keep the normalized URL as a safe fallback key.
    }

    if (!byKey.has(key)) {
      byKey.set(key, normalized)
      continue
    }

    const existing = byKey.get(key)
    byKey.set(key, {
      ...existing,
      ...normalized,
      address: existing.address || normalized.address || '',
      phone: existing.phone || normalized.phone || '',
      sourceUrl: existing.sourceUrl || normalized.sourceUrl || normalized.website
    })
  }

  return [...byKey.values()]
}
