function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function unique(values = []) {
  return [...new Set(values.filter(hasText).map((value) => value.trim()))]
}

function decodeHtmlEntities(value = '') {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function visibleText(html = '') {
  return decodeHtmlEntities(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function employeeBand(value) {
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value >= 10000) return '10000+'
  if (value >= 1000) return '1000-9999'
  if (value >= 200) return '200-999'
  if (value >= 50) return '50-199'
  return '1-49'
}

function employeeFactIsAttributable(text, match) {
  if (!match || !Number.isInteger(match.index)) return false
  const context = text.slice(Math.max(0, match.index - 140), Math.min(text.length, match.index + match[0].length + 140))
  if (/\b(?:represent(?:s|ing)|members?|member companies|member organisations?|member organizations?|parent company|partner network)\b/i.test(context)) {
    return false
  }
  return /\b(?:our|we|company|group|business|organisation|organization|workforce|team|employs?|employing)\b/i.test(context)
}

function extractEmployeeFacts(text = '') {
  const normalized = String(text).replace(/,/g, '')
  if (/\b(?:represent(?:s|ing)|members?|member companies|member organisations?|member organizations?).{0,140}(?:employees?|staff|people)\b/i.test(normalized)) {
    return { employeeCount: '', employeeRange: '', companySize: '', companySizeSource: '' }
  }
  const rangeMatch = normalized.match(/\b(\d{1,6})\s*(?:-|–|—|to)\s*(\d{1,6})\s+(?:employees?|staff|people)\b/i)
  if (rangeMatch && employeeFactIsAttributable(normalized, rangeMatch)) {
    const lower = Number(rangeMatch[1])
    const upper = Number(rangeMatch[2])
    return {
      employeeCount: '',
      employeeRange: `${lower}-${upper}`,
      companySize: employeeBand(upper),
      companySizeSource: 'public_employee_range'
    }
  }

  const exactMatch = normalized.match(/\b(?:over|more than|approximately|around|about)?\s*(\d{1,6})\+?\s+(?:employees?|staff|people)\b/i)
    || normalized.match(/\b(?:employs?|employing|workforce of|team of|staff of|employee count(?: of|:)?|number of employees(?: is|:)?|with)\s*(?:over|more than|approximately|around|about)?\s*(\d{1,6})\+?\b/i)
    || normalized.match(/\b(?:employees?|staff|workforce)\s*(?:of|:|is|totals?)?\s*(?:over|more than|approximately|around|about)?\s*(\d{1,6})\+?\b/i)
  if (!exactMatch || !employeeFactIsAttributable(normalized, exactMatch)) {
    return { employeeCount: '', employeeRange: '', companySize: '', companySizeSource: '' }
  }

  const count = Number(exactMatch[1])
  return {
    employeeCount: String(count),
    employeeRange: '',
    companySize: employeeBand(count),
    companySizeSource: 'public_employee_count'
  }
}

function extractScaleSignals(text = '') {
  const normalized = String(text).toLowerCase()
  const signals = []

  if (/fortune|public company|listed company|nasdaq|nyse|stock exchange/.test(normalized)) {
    signals.push('Public or listed-company signal')
  }
  if (/global|worldwide|international|multinational|across \d+ countries/.test(normalized)) {
    signals.push('Global footprint mentioned')
  }
  if (/factory|manufacturing plant|production site|manufacturing sites|facilities|warehouse|r&d center/.test(normalized)) {
    signals.push('Operating facilities mentioned')
  }
  if (/founded in|established in|since 19\d{2}|since 20\d{2}/.test(normalized)) {
    signals.push('Company history/founding signal')
  }

  return unique(signals).slice(0, 4)
}

function extractHeadquarters(text = '') {
  const normalized = String(text).replace(/\s+/g, ' ')
  const match = normalized.match(/(?:headquartered in|headquarters (?:are )?in|based in)\s+([^.;]{3,100})/i)
  const candidate = match ? match[1].trim().replace(/\s+/g, ' ').slice(0, 100) : ''
  if (!candidate || /\b(?:manufactur|provid|offer|support|serv|specializ|has|with|company|business|streams?|brands?|comprised)\b/i.test(candidate)) {
    return ''
  }
  return candidate
}

function extractCompanyName(html = '') {
  const jsonLdBlocks = [...String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const block of jsonLdBlocks) {
    if (!/@type["']?\s*:\s*["'](?:Organization|Corporation|LocalBusiness)/i.test(block[1])) continue
    const name = block[1].match(/["']name["']\s*:\s*["']([^"']{2,100})/i)?.[1]
    if (name) return decodeHtmlEntities(name).trim()
  }

  const metaName = String(html).match(/<meta\b[^>]*(?:property|name)=["'](?:og:site_name|application-name)["'][^>]*content=["']([^"']{2,100})["']/i)?.[1]
    || String(html).match(/<meta\b[^>]*content=["']([^"']{2,100})["'][^>]*(?:property|name)=["'](?:og:site_name|application-name)["']/i)?.[1]
  return metaName ? decodeHtmlEntities(metaName).trim() : ''
}

function extractJsonLdAddress(html = '') {
  const blocks = [...String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const block of blocks) {
    const value = block[1]
    if (!/PostalAddress/i.test(value)) continue

    const parts = [
      value.match(/["']streetAddress["']\s*:\s*["']([^"']+)/i)?.[1],
      value.match(/["']addressLocality["']\s*:\s*["']([^"']+)/i)?.[1],
      value.match(/["']addressRegion["']\s*:\s*["']([^"']+)/i)?.[1],
      value.match(/["']postalCode["']\s*:\s*["']([^"']+)/i)?.[1],
      value.match(/["']addressCountry["']\s*:\s*["']([^"']+)/i)?.[1]
    ].filter(Boolean)

    if (parts.length >= 2) {
      return decodeHtmlEntities(parts.join(', ')).replace(/\\u0026/g, '&')
    }
  }
  return ''
}

function extractAddressElement(html = '') {
  const match = String(html).match(/<address\b[^>]*>([\s\S]*?)<\/address>/i)
  const value = match ? visibleText(match[1]) : ''
  return value.length >= 8 && value.length <= 180 ? value : ''
}

export function extractCompanyFacts(value = '', title = '') {
  const html = String(value || '')
  const text = `${title} ${visibleText(html) || html}`.replace(/\s+/g, ' ').trim()
  const employees = extractEmployeeFacts(text)
  const scaleSignals = extractScaleSignals(text)
  const headquarters = extractHeadquarters(text)
  const address = extractJsonLdAddress(html) || extractAddressElement(html)

  return {
    ...employees,
    companyName: extractCompanyName(html),
    scaleSignals,
    headquarters,
    address
  }
}

export function mergeCompanyFacts(facts = []) {
  const values = Array.isArray(facts) ? facts : []
  const employeeFact = values
    .filter((item) => hasText(item?.companySize) && hasText(item?.companySizeSource)
      && (hasText(item?.employeeCount) || hasText(item?.employeeRange)))
    .sort((a, b) => {
      const upperBound = (item) => {
        if (hasText(item?.employeeCount)) return Number.parseInt(item.employeeCount, 10) || 0
        const rangeValues = String(item?.employeeRange || '').match(/\d+/g) || []
        return Number.parseInt(rangeValues.at(-1), 10) || 0
      }
      return upperBound(b) - upperBound(a)
    })[0] || null
  return {
    companyName: values.find((item) => hasText(item?.companyName))?.companyName || '',
    employeeCount: employeeFact?.employeeCount || '',
    employeeRange: employeeFact?.employeeRange || '',
    companySize: employeeFact?.companySize || '',
    companySizeSource: employeeFact?.companySizeSource || '',
    scaleSignals: unique(values.flatMap((item) => item?.scaleSignals || [])).slice(0, 6),
    headquarters: values.find((item) => hasText(item?.headquarters))?.headquarters || '',
    address: values.find((item) => hasText(item?.address))?.address || ''
  }
}
