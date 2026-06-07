import { blockedResearchDomains, countryMarketHints, industryProfiles } from './industry-profiles.js'
import { dedupeStrings, normalizeKey } from '../shared/text-utils.js'

export { blockedResearchDomains, countryMarketHints, industryProfiles }

export const defaultTargetTypes = ['manufacturer', 'system-integrator', 'project-developer']
export const defaultExcludeTypes = ['research-source', 'peer-supplier']

const searchStrategyTemplates = {
  manufacturer: [
    '{segment} manufacturer {country} official website',
    '{segment} oem {country}',
    '{segment} factory {country}',
    '{industry} manufacturer {country} official website'
  ],
  distributor: [
    '{segment} distributor {country} official website',
    '{industry} distributor {country} contact',
    '{segment} supplier {country} official website'
  ],
  'system-integrator': [
    '{segment} system integrator {country} official website',
    '{segment} solutions provider {country}',
    '{industry} integrator {country} company'
  ],
  'project-developer': [
    '{segment} project developer {country}',
    '{segment} epc company {country} official website',
    '{industry} developer {country} company'
  ],
  'service-provider': [
    '{segment} service provider {country} company',
    '{industry} service company {country} official website'
  ],
  buyer: [
    '{segment} company {country} official website',
    '{segment} procurement {country} company',
    '{segment} sourcing {country} company'
  ]
}

const fallbackStrategyTemplates = [
  '{segment} company {country} official website',
  '{industry} company {country} official website',
  '{keyword} {segment} application company {country}',
  '{segment} site:{countryTld} company'
]

function inferCountryTld(country = '') {
  const map = {
    germany: '.de',
    france: '.fr',
    italy: '.it',
    spain: '.es',
    usa: '.com',
    'united states': '.com',
    uk: '.co.uk',
    'united kingdom': '.co.uk',
    japan: '.jp',
    china: '.cn',
    india: '.in'
  }

  return map[normalizeKey(country)] || ''
}

export function normalizeTargetTypes(targetTypes = []) {
  const normalized = dedupeStrings((targetTypes || []).map((item) => normalizeKey(item).replace(/\s+/g, '-')))
  return normalized.length ? normalized : [...defaultTargetTypes]
}

export function normalizeExcludeTypes(excludeTypes = []) {
  const normalized = dedupeStrings((excludeTypes || []).map((item) => normalizeKey(item).replace(/\s+/g, '-')))
  return normalized.length ? normalized : [...defaultExcludeTypes]
}

function applyQueryTemplate(template, context) {
  return template
    .replace(/\{industry\}/g, context.industry)
    .replace(/\{country\}/g, context.country || '')
    .replace(/\{segment\}/g, context.segment || context.industry)
    .replace(/\{keyword\}/g, context.keyword || context.industry)
    .replace(/\{countryTld\}/g, context.countryTld || '.com')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildQueryLabel(template = '') {
  if (template.includes('manufacturer')) return 'manufacturer'
  if (template.includes('system integrator')) return 'system-integrator'
  if (template.includes('project developer') || template.includes('epc')) return 'project-developer'
  if (template.includes('distributor') || template.includes('supplier')) return 'distributor'
  if (template.includes('service provider')) return 'service-provider'
  if (template.includes('site:{countryTld}')) return 'country-tld'
  if (template.includes('{keyword}')) return 'keyword-application'
  return 'company'
}

export function buildIndustryCandidates(industry, keywords, country) {
  const normalizedIndustry = normalizeKey(industry)
  const directProfile = industryProfiles[normalizedIndustry]
  const keywordProfiles = Object.entries(industryProfiles)
    .filter(([key, profile]) => {
      const haystack = [key, profile.label, ...profile.upstreamIndustries, ...profile.searchTerms].join(' ').toLowerCase()
      return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))
    })
    .map(([, profile]) => profile)

  const hintedProfiles = (countryMarketHints[normalizeKey(country)] || [])
    .map((hint) => industryProfiles[hint])
    .filter(Boolean)

  const selectedProfiles = directProfile
    ? [directProfile, ...keywordProfiles]
    : keywordProfiles.length > 0
      ? keywordProfiles
      : hintedProfiles.length > 0
        ? hintedProfiles
        : [industryProfiles['industrial connectors']]

  return dedupeStrings(selectedProfiles.map((profile) => profile.label))
    .map((label) => Object.values(industryProfiles).find((profile) => profile.label === label))
    .filter(Boolean)
}

export function buildSearchStrategy(industry, country, normalizedKeywords, segmentHints, selectedProfiles, targetTypes = [], excludeTypes = []) {
  const normalizedTargetTypes = normalizeTargetTypes(targetTypes)
  const normalizedExcludeTypes = normalizeExcludeTypes(excludeTypes)
  const countryTld = inferCountryTld(country)
  const queryTemplates = dedupeStrings([
    ...normalizedTargetTypes.flatMap((type) => searchStrategyTemplates[type] || []),
    ...fallbackStrategyTemplates
  ])

  const queryContexts = []
  segmentHints.slice(0, 4).forEach((segment) => {
    queryContexts.push({ industry, country, countryTld, segment, keyword: normalizedKeywords[0] || industry })
  })

  normalizedKeywords.slice(0, 3).forEach((keyword) => {
    queryContexts.push({ industry, country, countryTld, segment: segmentHints[0] || industry, keyword })
  })

  selectedProfiles.slice(0, 2).forEach((profile) => {
    queryContexts.push({ industry: profile.label.toLowerCase(), country, countryTld, segment: profile.upstreamIndustries[0] || industry, keyword: normalizedKeywords[0] || industry })
  })

  const queries = dedupeStrings(queryTemplates.flatMap((template) =>
    queryContexts.map((context) => applyQueryTemplate(template, context))
  )).filter((query) => query.trim().replace(/\s+/g, ' ').length > 5)

  const labeledQueries = dedupeStrings(queryTemplates.flatMap((template) =>
    queryContexts.map((context) => JSON.stringify({
      query: applyQueryTemplate(template, context),
      label: buildQueryLabel(template),
      template
    }))
  )).map((item) => JSON.parse(item)).filter((item) => item.query.trim().replace(/\s+/g, ' ').length > 5)

  return {
    targetTypes: normalizedTargetTypes,
    excludeTypes: normalizedExcludeTypes,
    queryTemplates,
    queries,
    labeledQueries
  }
}
