import { cleanDomain, dedupeStrings } from '../../shared/text-utils.js'

export function mergeProviderCandidates(candidates) {
  const candidateEvidence = new Map()

  candidates.forEach((candidate) => {
    const domain = cleanDomain(candidate.url || candidate.title)
    if (!domain) {
      return
    }

    if (!candidateEvidence.has(domain)) {
      candidateEvidence.set(domain, {
        ...candidate,
        matchedQueryCount: 1,
        matchedProviders: [candidate.provider],
        matchedQueryLabels: [candidate.queryLabel || 'company']
      })
      return
    }

    const current = candidateEvidence.get(domain)
    current.matchedQueryCount += 1
    current.matchedProviders = dedupeStrings([...(current.matchedProviders || []), candidate.provider])
    current.matchedQueryLabels = dedupeStrings([...(current.matchedQueryLabels || []), candidate.queryLabel || 'company'])

    if (!current.address && candidate.address) {
      current.address = candidate.address
    }

    if (!current.phone && candidate.phone) {
      current.phone = candidate.phone
    }

    if (!current.localDescription && candidate.localDescription) {
      current.localDescription = candidate.localDescription
    }

    if (!current.placeSourceUrl && candidate.placeSourceUrl) {
      current.placeSourceUrl = candidate.placeSourceUrl
    }

    if ((candidate.rawContent || '').length > (current.rawContent || '').length) {
      current.rawContent = candidate.rawContent
      current.snippet = candidate.snippet
      current.title = candidate.title
      current.url = candidate.url
    }
  })

  return [...candidateEvidence.values()]
}
