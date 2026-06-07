import { buildIndustryCandidates } from '../../config/search-strategy.js'
import { dedupeStrings, slugify, titleCase } from '../../shared/text-utils.js'
import { buildWorkspaceFromCompanies } from './build-workspace-from-companies.js'
import { createWorkspaceSummary } from './workspace-summary.js'

function buildCompanySignals(segment, country, keywords) {
  const normalizedCountry = country ? titleCase(country) : 'Global'

  return [
    `Active in ${segment}`,
    country ? `Commercial footprint in ${normalizedCountry}` : 'Cross-border sourcing potential',
    keywords[0] ? `Keyword match: ${keywords[0]}` : 'Likely to buy electromechanical components',
    'Medium-to-large team structure suitable for supplier outreach'
  ]
}

function scoreCompany(name, segmentIndex, companyIndex, keywords, country) {
  const keywordBoost = keywords.some((keyword) => name.toLowerCase().includes(keyword.toLowerCase())) ? 8 : 0
  const countryBoost = country ? 5 : 0
  return Math.max(62, 88 - segmentIndex * 5 - companyIndex * 2 + keywordBoost + countryBoost)
}

export function buildSeededWorkspace({ industry, keywords = [], country = '' }) {
  const normalizedKeywords = dedupeStrings(keywords.map((keyword) => keyword.trim()).filter(Boolean))
  const selectedProfiles = buildIndustryCandidates(industry, normalizedKeywords, country)
  const workspaceId = `workspace-${Date.now()}`

  const segments = selectedProfiles.flatMap((profile) =>
    profile.upstreamIndustries.slice(0, 3).map((segment) => ({
      profile,
      name: segment
    }))
  )

  const companies = []

  segments.forEach(({ profile, name: segment }, segmentIndex) => {
    const companySeeds = profile.companySeeds[segment] || []

    companySeeds.slice(0, 5).forEach((companyName, companyIndex) => {
      const fitScore = scoreCompany(companyName, segmentIndex, companyIndex, normalizedKeywords, country)
      companies.push({
        id: `${workspaceId}-company-${slugify(companyName)}`,
        name: companyName,
        website: `https://www.${slugify(companyName)}.com`,
        country: country ? titleCase(country) : 'Global',
        segment,
        profile: profile.label,
        size: companyIndex < 2 ? 'Enterprise' : companyIndex < 4 ? 'Upper Mid-Market' : 'Mid-Market',
        fitScore,
        signals: buildCompanySignals(segment, country, normalizedKeywords),
        whyFit: `${companyName} is a likely buyer in ${segment} where ${industry.toLowerCase()} matters for qualification, sourcing resilience, and product delivery.`,
        priority: companyIndex < 2 ? 'Tier 1' : 'Tier 2'
      })
    })
  })

  const workspace = buildWorkspaceFromCompanies({ industry, country, keywords: normalizedKeywords }, companies, selectedProfiles)
  workspace.id = workspaceId
  workspace.providersUsed = ['seeded-profile']
  workspace.recommendedSegments = dedupeStrings(segments.map((segment) => titleCase(segment.name)))
  workspace.summary = createWorkspaceSummary(workspace.companies, workspace.contacts, workspace.drafts)
  return workspace
}
