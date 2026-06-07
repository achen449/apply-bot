import { cleanDomain } from '../../shared/text-utils.js'
import { blockedResearchDomains } from '../../config/search-strategy.js'

function looksBlockedResearchDomain(url = '') {
  const domain = cleanDomain(url).toLowerCase()
  return blockedResearchDomains.some((blocked) => domain.includes(blocked))
}

function titleLooksGeneric(title = '') {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  return [
    'home',
    'homepage',
    'about the company',
    'about us',
    'energy storage germany',
    'solar energy',
    'bess',
    'large'
  ].includes(normalized)
}

export { looksBlockedResearchDomain, titleLooksGeneric }

export function isLikelyCompanyCandidate(candidate, rawContent = '') {
  const lowerUrl = (candidate.url || '').toLowerCase()
  const lowerTitle = (candidate.title || '').toLowerCase()
  const lowerContent = rawContent.toLowerCase()
  const path = lowerUrl.replace(/^https?:\/\/[^/]+/, '') || '/'

  if (!candidate.url || !candidate.title) {
    return false
  }

  if (candidate.isLocalPoi) {
    return !/linkedin|facebook|instagram|youtube|twitter|x\.com|wikipedia/.test(lowerUrl) && !looksBlockedResearchDomain(lowerUrl)
  }

  if (/linkedin|facebook|instagram|youtube|twitter|x\.com|wikipedia/.test(lowerUrl)) {
    return false
  }

  if (looksBlockedResearchDomain(lowerUrl)) {
    return false
  }

  if (/\.pdf($|\?)/.test(lowerUrl)) {
    return false
  }

  if (/forum|discussion|thread|community/.test(lowerUrl)) {
    return false
  }

  if (/news|blog|article|press-release|event|expo|summit|conference|research|report/.test(lowerUrl) && !/about|company|contact/.test(lowerUrl)) {
    return false
  }

  if (/top 10|top 50|top 100|directory|companies in|list of|guide|market/.test(lowerTitle) && !/official|manufacturer|company/.test(lowerContent)) {
    return false
  }

  if (/\/products\/.+|\/product\/.+|\/shop\/.+|\/store\/.+|\/accessories\/.+/.test(path) && !/about us|our company|headquartered|founded|employees|locations/.test(lowerContent)) {
    return false
  }

  if (path.split('/').filter(Boolean).length > 3 && !/about us|our company|headquartered|founded|employees|locations/.test(lowerContent)) {
    return false
  }

  const identitySignals = [
    /about us|our company|who we are|we are a/.test(lowerContent),
    /headquartered|headquarters|based in|founded in|established in/.test(lowerContent),
    /employees|locations|global|manufacturing/.test(lowerContent),
    /gmbh|ag|inc|corp|ltd|llc|group/.test(lowerTitle),
    path === '/' || /^\/(about|company|contact|en)\/?$/.test(path)
  ].filter(Boolean).length

  return identitySignals >= 2
}
