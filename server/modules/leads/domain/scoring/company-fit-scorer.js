export function priorityFromScore(score) {
  if (score >= 88) return 'Tier 1'
  if (score >= 74) return 'Tier 2'
  return 'Tier 3'
}

export function classifyBusinessType(rawContent = '', url = '') {
  const content = `${rawContent} ${url}`.toLowerCase()

  if (/distributor|wholesale|channel partner|stockist/.test(content)) {
    return 'Distributor'
  }

  if (/manufacturer|manufacturing|factory|oem|production/.test(content)) {
    return 'Manufacturer'
  }

  if (/integrator|system integration|solutions provider|epc/.test(content)) {
    return 'System Integrator'
  }

  if (/developer|project development|power project/.test(content)) {
    return 'Project Developer'
  }

  return 'Industrial Company'
}

export function classifyMarketRole(industry = '', companyName = '', rawContent = '', businessType = '') {
  const lowerIndustry = industry.toLowerCase()
  const lowerName = companyName.toLowerCase()
  const lowerContent = rawContent.toLowerCase()

  if (/directory|top 10|top 50|top 100|list of|market|research|magazine|media/.test(lowerContent)) {
    return 'research-source'
  }

  if (/distributor/i.test(businessType)) {
    return 'channel-partner'
  }

  if (lowerIndustry.includes('connector') && /connector|connectors|cable harness|interconnect|terminal block/.test(`${lowerName} ${lowerContent}`)) {
    return 'peer-supplier'
  }

  if (/manufacturer|system integrator|project developer/i.test(businessType)) {
    return 'potential-buyer'
  }

  return 'unclear'
}

export function roleScore(role = '') {
  if (role === 'potential-buyer') return 18
  if (role === 'channel-partner') return 4
  if (role === 'peer-supplier') return -16
  if (role === 'research-source') return -30
  return 0
}

export function scoreWebsiteQuality(candidate, url = '', rawContent = '') {
  const lowerUrl = (url || '').toLowerCase()
  const lowerTitle = (candidate.title || '').toLowerCase()
  const lowerContent = rawContent.toLowerCase()
  let score = 0
  const path = lowerUrl.replace(/^https?:\/\/[^/]+/, '') || '/'

  if (url && /^https?:\/\//.test(url)) score += 8
  if (!/linkedin|facebook|instagram|youtube|twitter|x\.com/.test(lowerUrl)) score += 6
  if (/\/(about|company|contact|products|solutions|en)\/?$/.test(path) || path === '/' || path === '') score += 10
  if (/manufacturer|oem|factory|production|solutions|products/.test(lowerContent)) score += 12
  if (/employees|headquarters|founded|locations|global/.test(lowerContent)) score += 8
  if (/gmbh|ag|inc|corp|ltd|llc|company|group/.test(lowerTitle)) score += 6
  if (/about us|who we are|our company|headquartered|founded in|we are a/.test(lowerContent)) score += 12
  if (candidate.provider === 'brave') score += 4
  if (!['home', 'homepage', 'about the company', 'about us', 'energy storage germany', 'solar energy', 'bess', 'large'].includes(lowerTitle.replace(/[^a-z0-9]+/g, ' ').trim())) score += 6

  if (/\.pdf($|\?)/.test(lowerUrl)) score -= 30
  if (/forum|discussion|thread|community/.test(lowerUrl)) score -= 28
  if (/news|blog|article|press|magazine|event|expo|summit|top-\d+|directory|search\/|research|report/.test(lowerUrl)) score -= 20
  if (/news|blog|article|directory|top 10|top 100|list of|guide|market|research|forum|pdf/.test(lowerTitle)) score -= 18
  if (/\/product|\/products\/.+|\/shop|\/store|\/accessories|\/download/.test(path)) score -= 10
  if (/europages\.|chemeurope\.|marketsandmarkets\.|assetphysics\.|modoenergy\.|pfnexus\.|plugsocketmuseum\.|northern-connectors\.|marinehowto\.|pvel\.|engx\.theiet\.org|ensun\.io|energy-storage\.news|solarenergyevents\.com|gtai\.de|eu-startups\.com|solarfeeds\.com|whcsolar\.com|hiitio\.com/.test(lowerUrl)) score -= 35
  if (/copyright|all rights reserved/.test(lowerContent)) score += 2

  return score
}
