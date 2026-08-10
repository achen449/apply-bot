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
  'company listing',
  'business listing',
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
  '/companies.',
  '/companies/',
  '/supplier-directory/',
  '/product/',
  '/products/',
  '/portfolio-item/',
  '/case-study/',
  '/case-studies/',
  '/customer/',
  '/customers/',
  '/partner/',
  '/partners/',
  '/customer-story/',
  '/customer-stories/',
  '/success-story/',
  '/success-stories/',
  '/green-leader/',
  '/wiki/'
]

const RESEARCH_DIRECTORY_HOST_MARKERS = [
  'dnb.com',
  'company-listing.org',
  'europages.',
  'thomasnet.com',
  'power-technology.com',
  'electricalsinformed.com',
  'e-electricity.com'
]

const NON_OFFICIAL_PROFILE_HOSTS = [
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com'
]

const LISTING_TITLE_PATTERN = /(?:\b(?:top|best)\s+\d+|\bupdated\b.*\bbest\b|manufacturers?\s+(?:and\s+suppliers?\s+)?in\b|companies?\s+in\b|supplier directory|company directory|company listing|business listings?|buyers? guide|\blist of\b|\bdirectory\b|\bfind\b.*\bcompanies\b)/i
const NON_OPERATING_ENTITY_PATTERN = /\b(?:industry association|trade association|federation|industry council|supplier directory|manufacturer directory|company directory|information resource|resource portal|community portal|online library|product library)\b/i
const NON_OPERATING_NAME_PATTERN = /\b(?:associations?|federation|industry council|trade body|industry body)\b/i
const SLOGAN_TITLE_PATTERN = /^(?:introducing\b|discover\b|welcome\b|switch it on\b|the information resource\b|home[-\s]+[a-z])/i
const NON_OPERATING_ORGANIZATION_SIGNAL_PATTERN = /\b(?:membership|member companies|member organisations?|member organizations?|representing (?:the|our|more than|over)|voice of the .{0,50} industry|trade body|industry body|advocacy|policy makers?|non-profit|not-for-profit)\b/i
const SEO_TITLE_DESCRIPTOR_PATTERN = /\b(?:led |solar |industrial |commercial )?(?:lighting |energy |electrical )?(?:manufacturer|supplier|company|solutions?|systems?|products?)\b/i

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
  china: ['china', 'people\'s republic of china', 'prc', 'guangzhou', 'shenzhen', 'shanghai', 'beijing'],
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

  const europeTarget = /\b(?:europe|european union|eu)\b/.test(expectedCountry)
  if (europeTarget) {
    const europeanTokens = [
      'europe', 'european union', 'austria', 'austrian', 'belgium', 'belgian', 'bulgaria', 'bulgarian',
      'croatia', 'croatian', 'cyprus', 'cypriot', 'czech', 'denmark', 'danish', 'estonia', 'estonian',
      'finland', 'finnish', 'france', 'french', 'germany', 'german', 'greece', 'greek', 'hungary', 'hungarian',
      'ireland', 'irish', 'italy', 'italian', 'latvia', 'latvian', 'lithuania', 'lithuanian', 'luxembourg',
      'malta', 'maltese', 'netherlands', 'dutch', 'norway', 'norwegian', 'poland', 'polish', 'portugal',
      'portuguese', 'romania', 'romanian', 'slovakia', 'slovak', 'slovenia', 'slovenian', 'spain', 'spanish',
      'sweden', 'swedish', 'switzerland', 'swiss', 'united kingdom', 'british', 'england', 'scotland', 'wales'
    ]
    const nonEuropeanTokens = [
      'china', 'chinese', 'guangzhou', 'shenzhen', 'shanghai', 'beijing', 'united states', 'usa', 'u.s.',
      'american', 'canada', 'canadian', 'mexico', 'mexican', 'australia', 'australian', 'india', 'indian',
      'japan', 'japanese', 'south korea', 'korean', 'singapore', 'singaporean', 'malaysia', 'malaysian',
      'vietnam', 'vietnamese', 'brazil', 'brazilian'
    ]
    if (europeanTokens.some((token) => observedLocation.includes(token))) {
      return true
    }
    if (nonEuropeanTokens.some((token) => observedLocation.includes(token))) {
      return false
    }
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

function websiteHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function domainBrand(value) {
  const host = websiteHost(value)
  const parts = host.split('.').filter(Boolean)
  const countryCodeSecondLevel = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])
  const usesCountryCodeSecondLevel = parts.at(-1)?.length === 2 && countryCodeSecondLevel.has(parts.at(-2))
  const registrableIndex = usesCountryCodeSecondLevel ? parts.length - 3 : parts.length - 2
  const label = parts[Math.max(0, registrableIndex)] || ''
  if (!label || /^(www|shop|store|blog|news|support|help)$/i.test(label)) {
    return ''
  }

  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function normalizeComparable(value) {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, '')
}

function isGenericSearchTitle(value) {
  const normalized = normalize(value).replace(/[^a-z0-9]+/g, ' ').trim()
  return !normalized
    || /^(?:home|homepage|company|official site|welcome|our story|about us|who we are|company profile|contact us|history)$/.test(normalized)
    || LISTING_TITLE_PATTERN.test(normalized)
}

export function canonicalCompanyWebsite(value) {
  const website = likelyOfficialWebsite(value)
  if (!website) return ''

  const url = new URL(website)
  const segments = url.pathname.split('/').filter(Boolean)
  const identityIndex = segments.findIndex((segment) => /^(?:about|about-us|our-story|who-we-are|company|company-profile|contact|contact-us|imprint|legal|legal-notice)$/i.test(segment))
  if (identityIndex === 0) {
    url.pathname = '/'
  } else if (identityIndex === 1 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0])) {
    url.pathname = `/${segments[0]}/`
  }
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function deriveCompanyNameFromSearchResult(candidate = {}) {
  const rawTitle = hasText(candidate.title || candidate.name) ? String(candidate.title || candidate.name).trim() : ''
  const website = candidate.website || candidate.url || ''
  const brand = domainBrand(website)
  const titleSegments = rawTitle
    .replace(/[®™©]/g, '')
    .split(/\s+[|–—-]\s+|\s*:\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const firstSegment = titleSegments[0] || ''
  const brandKey = normalizeComparable(brand)
  const alignedSegment = brandKey
    ? titleSegments.find((segment) => {
        const key = normalizeComparable(segment)
        return key && (key.includes(brandKey) || brandKey.includes(key))
      })
    : ''

  if (brand
    && alignedSegment
    && alignedSegment.length > brand.length + 15
    && /\b(?:for \d+ years|has been|have been|since \d{4}|we are|our company|producing|manufacturing|providing)\b/i.test(alignedSegment)) {
    return brand
  }

  if (alignedSegment
    && !isGenericSearchTitle(alignedSegment)
    && alignedSegment.length <= 80
    && !(brand
      && alignedSegment.length > brand.length + 12
      && SEO_TITLE_DESCRIPTOR_PATTERN.test(alignedSegment)
      && /\b[a-z0-9-]+\.(?:com|net|org|eu|de|fr|it|es|co|io)\b/i.test(alignedSegment))) {
    return alignedSegment
  }
  if (!brand && firstSegment && !isGenericSearchTitle(firstSegment) && firstSegment.length <= 80) {
    return firstSegment
  }

  return brand || likelyCompanyName(rawTitle)
}

export function isLikelyOfficialCompanyResult(candidate = {}) {
  const website = likelyOfficialWebsite(candidate.website || candidate.url)
  const displayedTitle = hasText(candidate.title || candidate.name) ? String(candidate.title || candidate.name).trim() : ''
  const rawTitle = hasText(candidate.originalTitle) ? String(candidate.originalTitle).trim() : displayedTitle
  if (!website || !rawTitle) {
    return false
  }

  let parsed
  try {
    parsed = new URL(website)
  } catch {
    return false
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase()
  const path = parsed.pathname.toLowerCase()
  const sourceText = [rawTitle, displayedTitle, candidate.snippet, candidate.rawContent].filter(Boolean).join(' ')
  if (RESEARCH_DIRECTORY_HOST_MARKERS.some((marker) => host.includes(marker))) {
    return false
  }
  if (NON_OFFICIAL_PROFILE_HOSTS.some((marker) => host === marker || host.endsWith(`.${marker}`))) {
    return false
  }
  if (LISTING_TITLE_PATTERN.test(rawTitle)) {
    return false
  }
  const titleSegments = rawTitle.split(/\s+[|–—-]\s+|\s*:\s*/).map((segment) => segment.trim()).filter(Boolean)
  if (NON_OPERATING_ENTITY_PATTERN.test(sourceText)
    || NON_OPERATING_NAME_PATTERN.test(`${rawTitle} ${displayedTitle}`)
    || titleSegments.some((segment) => SLOGAN_TITLE_PATTERN.test(segment))
    || (NON_OPERATING_ORGANIZATION_SIGNAL_PATTERN.test(sourceText)
      && /(?:\.org|\.ngo)$/i.test(host))) {
    return false
  }
  if (NON_COMPANY_PATH_MARKERS.some((marker) => path.includes(marker))) {
    return false
  }
  if (/^\/(?:product|products|customer|customers|partner|partners|case-study|case-studies|success-story|success-stories)(?:\/|$)/i.test(path)) {
    return false
  }
  if (/(?:^|\.)(?:library|directory|catalog)(?:\.|$)/i.test(host) || /^\/(?:manufacturer|suppliers?|companies)\/?$/i.test(path)) {
    return false
  }
  if (/\.(?:pdf|docx?|xlsx?)(?:$|\?)/i.test(path)) {
    return false
  }
  if (/\b(?:magazine|weekly|news|media|directory|marketplace|portal|journal|association|roundup|buyers? guide)\b/i.test(sourceText)
    && !/\b(?:we are (?:a|an)|our company|headquarter|founded|employees?|manufacturing (?:plant|site))\b/i.test(sourceText)) {
    return false
  }

  const pathDepth = path.split('/').filter(Boolean).length
  const brandKey = normalizeComparable(domainBrand(website))
  const titleKey = normalizeComparable(rawTitle)
  const domainTitleAligned = Boolean(brandKey && titleKey && (titleKey.includes(brandKey) || brandKey.includes(titleKey)))
  const identitySignals = [
    /\b(?:about us|our company|who we are|we are (?:a|an)|headquarter|founded|established|employees?|workforce|manufacturing (?:plant|site)|global offices?)\b/i.test(sourceText),
    /\b(?:inc|corp|corporation|ltd|limited|llc|gmbh|ag|plc|group)\b/i.test(rawTitle)
  ].filter(Boolean).length
  const rootOrIdentityPath = pathDepth === 0 || /^\/(?:en|es|de|fr|it|company|company-profile|about|about-us|our-story|who-we-are|contact|contact-us|imprint|legal|legal-notice)\/?$/i.test(path)

  if (candidate.isLocalPoi) {
    return rootOrIdentityPath && (domainTitleAligned || identitySignals >= 1)
  }

  return pathDepth <= 2 && (identitySignals >= 1 || (rootOrIdentityPath && domainTitleAligned))
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
  const website = canonicalCompanyWebsite(candidate.website || candidate.url)

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
