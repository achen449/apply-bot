import { fetchText } from '../../../../infrastructure/http/fetch-text.js'
import { cleanDomain, dedupeStrings, stripTrackingParams, titleCase, toRootCompanyUrl, truncateText } from '../../shared/text-utils.js'
import {
  computeScaleSignal,
  deriveCompanyName,
  detectIndustryTags,
  detectScaleSignals,
  estimateEmployeeBand,
  extractEmails,
  extractFoundedYear,
  extractHeadquarters,
  findContactPage
} from '../../domain/extraction/company-fact-extractors.js'
import {
  classifyBusinessType,
  classifyMarketRole,
  priorityFromScore,
  roleScore,
  scoreWebsiteQuality
} from '../../domain/scoring/company-fit-scorer.js'
import { scoreBuyerIntent, summarizeBuyingRelevance } from '../../domain/scoring/buyer-intent-scorer.js'

export async function analyzeCompanyWebsite(candidate, normalizedKeywords, segmentHints, country) {
  const normalizedUrl = candidate.url && candidate.url.startsWith('http') ? toRootCompanyUrl(candidate.url) : ''
  const url = normalizedUrl
  const fallbackDomain = cleanDomain(url)
  let pageContent = candidate.rawContent || candidate.snippet || ''
  const finalUrl = url

  if (url) {
    try {
      const html = await fetchText(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
        }
      })
      pageContent = `${pageContent}\n${html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')}`
    } catch (error) {
      console.error(`Website fetch failed for ${url}:`, error.message)
    }
  }

  const lowerContent = pageContent.toLowerCase()
  const companyName = deriveCompanyName(candidate, finalUrl, fallbackDomain)
  const industryTags = detectIndustryTags(lowerContent, normalizedKeywords, segmentHints)
  const keywordHits = normalizedKeywords.filter((keyword) => lowerContent.includes(keyword.toLowerCase())).length
  const segmentHits = segmentHints.filter((segment) => lowerContent.includes(segment.toLowerCase())).length
  const websiteQualityScore = scoreWebsiteQuality(candidate, finalUrl || url, pageContent)
  const fitScore = Math.max(35, Math.min(98, 52 + keywordHits * 11 + segmentHits * 8 + websiteQualityScore + (country ? 4 : 0)))
  const emails = extractEmails(pageContent)
  const businessType = classifyBusinessType(lowerContent, finalUrl)
  const marketRole = classifyMarketRole(segmentHints.join(' '), companyName, pageContent, businessType)
  const buyerIntentScore = scoreBuyerIntent(segmentHints.join(' '), companyName, pageContent, businessType, segmentHints)
  const scaleSignals = detectScaleSignals(pageContent, candidate.title)
  const employeeEstimate = estimateEmployeeBand(pageContent, candidate.title)
  const foundedYear = extractFoundedYear(pageContent, candidate.title)
  const headquarters = extractHeadquarters(pageContent)
  const officialWebsiteLikely = websiteQualityScore >= 10
  const buyingRelevance = summarizeBuyingRelevance(pageContent, normalizedKeywords, segmentHints, country)
  const queryMatchBonus = Math.min(16, ((candidate.matchedQueryCount || 1) - 1) * 4)
  const providerBonus = Math.min(8, Math.max(0, ((candidate.matchedProviders || []).length - 1) * 4))
  const finalFitScore = Math.max(20, Math.min(99, fitScore + buyerIntentScore + roleScore(marketRole) + queryMatchBonus + providerBonus))

  return {
    id: `company-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: companyName,
    website: finalUrl || `https://${fallbackDomain}`,
    country: country ? titleCase(country) : 'Global',
    segment: titleCase(segmentHints.find((segment) => lowerContent.includes(segment.toLowerCase())) || segmentHints[0] || 'general industry'),
    profile: titleCase(segmentHints[0] || 'General Industry'),
    size: finalFitScore >= 90 ? 'Enterprise' : finalFitScore >= 80 ? 'Upper Mid-Market' : finalFitScore >= 68 ? 'Mid-Market' : 'Niche / Unknown',
    fitScore: finalFitScore,
    signals: dedupeStrings([
      candidate.provider ? `Found via ${candidate.provider}` : '',
      keywordHits ? `${keywordHits} keyword matches on website` : '',
      segmentHits ? `${segmentHits} target-market signals found` : '',
      businessType,
      officialWebsiteLikely ? 'Likely official company website' : 'Possible aggregator or non-official page'
    ]).slice(0, 4),
    whyFit: truncateText(candidate.snippet || pageContent.replace(/\s+/g, ' ').trim(), 220),
    priority: priorityFromScore(finalFitScore),
    source: candidate.provider || 'search',
    sourceUrl: stripTrackingParams(candidate.placeSourceUrl || candidate.url || finalUrl),
    businessType,
    marketRole,
    businessSummary: truncateText(pageContent.replace(/\s+/g, ' ').trim(), 340),
    buyingRelevance,
    mainProducts: industryTags.length ? industryTags.slice(0, 4) : ['industrial electrical products'],
    targetApplications: dedupeStrings(segmentHints.map((segment) => titleCase(segment))).slice(0, 4),
    possibleScaleSignal: computeScaleSignal(pageContent, candidate.title),
    scaleSignals,
    employeeEstimate,
    foundedYear,
    headquarters,
    officialWebsiteLikely,
    matchedQueryCount: candidate.matchedQueryCount || 1,
    matchedProviders: candidate.matchedProviders || [candidate.provider || 'search'],
    matchedQueryLabels: candidate.matchedQueryLabels || [candidate.queryLabel || 'company'],
    contactEmails: emails.slice(0, 5),
    contactPages: [findContactPage(finalUrl || `https://${fallbackDomain}`, pageContent)],
    phone: candidate.phone || '',
    address: candidate.address || '',
    notes: '',
    outreachNotes: candidate.localDescription ? `Brave local insight: ${truncateText(candidate.localDescription, 500)}` : '',
    pipelineStatus: 'researching',
    customEmail: '',
    customContactName: '',
    customContactTitle: '',
    customLinkedinUrl: '',
    customEmailStatus: 'not-found'
  }
}
