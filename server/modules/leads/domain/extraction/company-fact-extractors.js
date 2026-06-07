import { cleanDomain, dedupeStrings, titleCase, truncateText } from '../../shared/text-utils.js'
import { titleLooksGeneric } from '../entity-resolution/company-candidate-filter.js'

export function extractEmails(text = '') {
  return dedupeStrings(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
}

export function extractPhones(text = '') {
  return dedupeStrings(text.match(/\+?\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}/g) || [])
}

export function extractCompanyNameFromDomain(url = '') {
  const domain = cleanDomain(url).replace(/^www\./, '')
  if (!domain) {
    return ''
  }

  const base = domain.split('.')[0]
  if (!base || /^(shop|store|blog|news|media|support|help)$/.test(base)) {
    return ''
  }

  return titleCase(base.replace(/[-_]+/g, ' '))
}

export function computeScaleSignal(rawContent = '', title = '') {
  const content = `${title} ${rawContent}`.toLowerCase()

  if (/global|multinational|fortune|public company|listed company/.test(content)) {
    return 'Large enterprise signal from company language'
  }

  if (/team|factory|manufacturing|plants|locations|warehouse|distributor/.test(content)) {
    return 'Operating footprint visible on website'
  }

  return 'Scale not explicit; likely SMB to mid-market from available site copy'
}

export function detectScaleSignals(rawContent = '', title = '') {
  const content = `${title} ${rawContent}`.toLowerCase()
  const signals = []

  if (/fortune|public company|listed|nasdaq|nyse|börse|stock exchange/.test(content)) {
    signals.push('Public or listed-company signal')
  }

  if (/global|worldwide|international|multinational|across \d+ countries/.test(content)) {
    signals.push('Global footprint mentioned')
  }

  if (/employees|employee|team of|workforce of|headcount/.test(content)) {
    signals.push('Employee-count language found')
  }

  if (/factory|manufacturing plant|production site|plants|facilities|warehouse|r&d center/.test(content)) {
    signals.push('Operating facilities mentioned')
  }

  if (/founded in|since 19|since 20|established in|founded/.test(content)) {
    signals.push('Company history/founding signal')
  }

  return dedupeStrings(signals).slice(0, 4)
}

export function estimateEmployeeBand(rawContent = '', title = '') {
  const content = `${title} ${rawContent}`.toLowerCase()
  const exactMatch = content.match(/(\d{2,6})\+?\s+(employees|employee|staff)/)
  if (exactMatch) {
    const value = Number(exactMatch[1])
    if (value >= 10000) return '10000+'
    if (value >= 1000) return '1000-9999'
    if (value >= 200) return '200-999'
    if (value >= 50) return '50-199'
    return '1-49'
  }

  if (/fortune|public company|multinational/.test(content)) return '1000+'
  if (/global|worldwide|factories|plants|manufacturing sites/.test(content)) return '200+'
  if (/team|engineering team|sales team|warehouse/.test(content)) return '50+'
  return 'Unknown'
}

export function extractFoundedYear(rawContent = '', title = '') {
  const content = `${title} ${rawContent}`
  const match = content.match(/(?:founded in|established in|since)\s+(19\d{2}|20\d{2})/i)
  return match ? match[1] : ''
}

export function extractHeadquarters(rawContent = '') {
  const content = rawContent.replace(/\s+/g, ' ')
  const match = content.match(/(?:headquartered in|headquarters in|based in)\s+([^.,;]{3,80})/i)
  return match ? truncateText(match[1].trim(), 60) : ''
}

export function detectIndustryTags(text = '', keywords = [], segments = []) {
  const lower = text.toLowerCase()
  const tags = []

  keywords.forEach((keyword) => {
    if (lower.includes(keyword.toLowerCase())) {
      tags.push(keyword)
    }
  })

  segments.forEach((segment) => {
    if (lower.includes(segment.toLowerCase())) {
      tags.push(segment)
    }
  })

  ;['solar', 'energy storage', 'battery', 'ev charging', 'automation', 'connector', 'wire harness', 'inverter', 'bess'].forEach((tag) => {
    if (lower.includes(tag)) {
      tags.push(tag)
    }
  })

  return dedupeStrings(tags).slice(0, 8)
}

export function findContactPage(url = '', rawContent = '') {
  const lower = rawContent.toLowerCase()
  if (lower.includes('contact')) {
    return `${url.replace(/\/$/, '')}/contact`
  }

  return url
}

export function deriveCompanyName(candidate, finalUrl, fallbackDomain) {
  const titleName = (candidate.title || '').replace(/\s*[-|].*$/, '').trim()
  return truncateText(
    (titleLooksGeneric(titleName) ? '' : titleName) || extractCompanyNameFromDomain(finalUrl) || fallbackDomain || 'Unknown company',
    80
  )
}
