import {
  buildIndustryCandidates,
  buildSearchStrategy
} from '../../config/search-strategy.js'
import { analyzeCompanyWebsite as analyzeCompanyWebsiteModule } from '../analyzers/company-website-analyzer.js'
import { buildWorkspaceFromCompanies as buildWorkspaceFromCompaniesModule } from '../workspace/build-workspace-from-companies.js'
import { buildSeededWorkspace as buildSeededWorkspaceModule } from '../workspace/build-seeded-workspace.js'
import { mergeProviderCandidates as mergeProviderCandidatesModule } from '../../domain/entity-resolution/provider-candidate-merger.js'
import { isLikelyCompanyCandidate as isLikelyCompanyCandidateModule } from '../../domain/entity-resolution/company-candidate-filter.js'
import { dedupeStrings } from '../../shared/text-utils.js'

function deriveAnalyzedCompanyTypes(company = {}) {
  const businessType = String(company.businessType || '').toLowerCase()
  const marketRole = String(company.marketRole || '').toLowerCase()
  const types = []

  if (businessType.includes('manufacturer')) {
    types.push('manufacturer')
  }

  if (businessType.includes('system integrator')) {
    types.push('system-integrator')
  }

  if (businessType.includes('project developer')) {
    types.push('project-developer')
  }

  if (businessType.includes('distributor')) {
    types.push('distributor')
  }

  if (businessType.includes('service provider')) {
    types.push('service-provider')
  }

  if (marketRole === 'potential-buyer') {
    types.push('buyer')
  }

  if (marketRole === 'channel-partner') {
    types.push('channel-partner', 'distributor')
  }

  if (marketRole === 'peer-supplier' || marketRole === 'research-source') {
    types.push(marketRole)
  }

  return dedupeStrings(types)
}

function companyMatchesTypeFilter(company, selectedTypes = []) {
  if (!selectedTypes.length) {
    return true
  }

  const companyTypes = deriveAnalyzedCompanyTypes(company)
  return selectedTypes.some((type) => companyTypes.includes(type))
}

export function createLeadDiscoveryService({
  tavilySearch,
  braveSearch,
  googleMapsSearch,
  analyzeCompanyWebsite = analyzeCompanyWebsiteModule,
  buildIndustryCandidatesFn = buildIndustryCandidates,
  buildSearchStrategyFn = buildSearchStrategy,
  isLikelyCompanyCandidate = isLikelyCompanyCandidateModule,
  mergeProviderCandidates = mergeProviderCandidatesModule,
  buildWorkspaceFromCompanies = buildWorkspaceFromCompaniesModule,
  buildSeededWorkspace = buildSeededWorkspaceModule
}) {
  async function discoverRealCompanies({ industry, keywords = [], country = '', targetTypes = [], excludeTypes = [], depth = 'standard' }) {
    const normalizedKeywords = dedupeStrings(keywords.map((keyword) => keyword.trim()).filter(Boolean))
    const selectedProfiles = buildIndustryCandidatesFn(industry, normalizedKeywords, country)
    const segmentHints = dedupeStrings(selectedProfiles.flatMap((profile) => profile.upstreamIndustries.slice(0, 3))).slice(0, 6)
    const strategy = buildSearchStrategyFn(industry, country, normalizedKeywords, segmentHints, selectedProfiles, targetTypes, excludeTypes)
    const queries = strategy.queries
    const labeledQueries = strategy.labeledQueries

    const braveQueries = dedupeStrings([
      ...labeledQueries.slice(0, 3).map((item) => JSON.stringify(item)),
      JSON.stringify({ query: [industry, country, normalizedKeywords[0]].filter(Boolean).join(' '), label: 'company' }),
      JSON.stringify({ query: [normalizedKeywords[0], country].filter(Boolean).join(' '), label: 'company' })
    ]).map((item) => JSON.parse(item)).filter((item) => item.query && item.query.trim().length > 5)

    const depthConfig = {
      economy: { tavilyQueries: 4, braveQueries: 3, mapsQueries: 1, analyzeCandidates: 24, shortlist: 15 },
      standard: { tavilyQueries: 8, braveQueries: 5, mapsQueries: 3, analyzeCandidates: 50, shortlist: 25 },
      deep: { tavilyQueries: 12, braveQueries: 8, mapsQueries: 4, analyzeCandidates: 80, shortlist: 35 }
    }[depth] || { tavilyQueries: 8, braveQueries: 5, mapsQueries: 3, analyzeCandidates: 50, shortlist: 25 }

    const providerResults = await Promise.all([
      Promise.all(labeledQueries.slice(0, depthConfig.tavilyQueries).map((query) => tavilySearch(query))),
      Promise.all(braveQueries.slice(0, depthConfig.braveQueries).map((query) => braveSearch(query))),
      Promise.all(labeledQueries.slice(0, depthConfig.mapsQueries).map((query) => googleMapsSearch(query)))
    ])

    const flattened = providerResults.flat(2).filter((item) => item && item.title)
    const dedupedCandidates = mergeProviderCandidates(
      flattened.filter((candidate) => isLikelyCompanyCandidate(candidate, candidate.rawContent || candidate.snippet || ''))
    )

    if (!dedupedCandidates.length) {
      return null
    }

    const analyzedCompanies = []
    for (const candidate of dedupedCandidates.slice(0, depthConfig.analyzeCandidates)) {
      const analyzed = await analyzeCompanyWebsite(candidate, normalizedKeywords, segmentHints, country)

      if (!companyMatchesTypeFilter(analyzed, strategy.targetTypes)) {
        continue
      }

      if (companyMatchesTypeFilter(analyzed, strategy.excludeTypes)) {
        continue
      }

      analyzedCompanies.push(analyzed)
    }

    analyzedCompanies.sort((a, b) => {
      if ((a.marketRole === 'potential-buyer' ? 1 : 0) !== (b.marketRole === 'potential-buyer' ? 1 : 0)) {
        return (b.marketRole === 'potential-buyer' ? 1 : 0) - (a.marketRole === 'potential-buyer' ? 1 : 0)
      }

      if ((b.officialWebsiteLikely ? 1 : 0) !== (a.officialWebsiteLikely ? 1 : 0)) {
        return (b.officialWebsiteLikely ? 1 : 0) - (a.officialWebsiteLikely ? 1 : 0)
      }

      return b.fitScore - a.fitScore
    })

    const candidatePool = analyzedCompanies
      .filter((company) => company.fitScore >= 40)
      .slice(0, depthConfig.analyzeCandidates)
    const shortlistedCompanies = analyzedCompanies
      .filter((company) => company.officialWebsiteLikely || company.fitScore >= 86)
      .slice(0, depthConfig.shortlist)
    if (!shortlistedCompanies.length) {
      return null
    }

    const workspace = buildWorkspaceFromCompanies({ industry, country, keywords: normalizedKeywords }, shortlistedCompanies, selectedProfiles)
    workspace.candidatePool = candidatePool
    workspace.shortlist = shortlistedCompanies
    workspace.discoveryDepth = depth
    workspace.providersUsed = dedupeStrings(shortlistedCompanies.flatMap((company) => company.matchedProviders || [company.source]).filter(Boolean))
    workspace.searchStrategy = {
      targetTypes: strategy.targetTypes,
      excludeTypes: strategy.excludeTypes,
      queryTemplates: strategy.queryTemplates,
      queryCount: queries.length,
      executedQueryCount: depthConfig.tavilyQueries + braveQueries.length + depthConfig.mapsQueries,
      evidenceMode: 'multi-query-hit-weighting'
    }
    return workspace
  }

  async function discoverWorkspace({ industry, keywords = [], country = '', targetTypes = [], excludeTypes = [], depth = 'standard' }) {
    return await discoverRealCompanies({ industry, keywords, country, targetTypes, excludeTypes, depth })
      || buildSeededWorkspace({ industry, keywords, country })
  }

  return {
    discoverRealCompanies,
    discoverWorkspace
  }
}
