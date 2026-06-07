import { titleCase } from '../../shared/text-utils.js'

export function summarizeBuyingRelevance(rawContent = '', keywords = [], segmentHints = [], country = '') {
  const content = rawContent.toLowerCase()
  const matchedKeywords = keywords.filter((keyword) => content.includes(keyword.toLowerCase())).slice(0, 3)
  const matchedSegments = segmentHints.filter((segment) => content.includes(segment.toLowerCase())).slice(0, 2)
  const reasons = []

  if (matchedKeywords.length) {
    reasons.push(`Website mentions ${matchedKeywords.join(', ')}`)
  }

  if (matchedSegments.length) {
    reasons.push(`Business appears active in ${matchedSegments.join(', ')}`)
  }

  if (/procurement|sourcing|supply chain|supplier/.test(content)) {
    reasons.push('Site language suggests sourcing/supplier management activity')
  }

  if (/manufacturer|oem|integrator|assembler|system/.test(content)) {
    reasons.push('Company type is relevant for component buying conversations')
  }

  if (country && new RegExp(country, 'i').test(rawContent)) {
    reasons.push(`Country match found for ${titleCase(country)}`)
  }

  return reasons.length ? reasons.slice(0, 3).join('. ') : 'Potential fit inferred from company product/application context.'
}

export function scoreBuyerIntent(industry = '', companyName = '', rawContent = '', businessType = '', segmentHints = []) {
  const lowerIndustry = industry.toLowerCase()
  const lowerName = companyName.toLowerCase()
  const lowerContent = rawContent.toLowerCase()
  let score = 0

  const supplierLike = /connector|connectors|cable harness|interconnect|terminal block/.test(lowerName) || /connector|connectors|cable harness|interconnect|terminal block/.test(lowerContent)
  const downstreamLike = segmentHints.some((segment) => lowerContent.includes(segment.toLowerCase()))

  if (/manufacturer|system integrator|project developer/i.test(businessType)) {
    score += 8
  }

  if (/procurement|sourcing|supply chain|supplier|purchasing/.test(lowerContent)) {
    score += 8
  }

  if (downstreamLike) {
    score += 12
  }

  if (lowerIndustry.includes('connector') && supplierLike) {
    score -= 18
  }

  if (/distributor/i.test(businessType)) {
    score -= 8
  }

  return score
}
