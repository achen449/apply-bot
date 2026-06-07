function extractKeywords(text) {
  if (!text) {
    return new Set()
  }

  const stopwords = new Set([
    'the', 'and', 'for', 'that', 'with', 'from', 'this', 'have', 'are', 'was', 'were', 'will', 'your',
    'you', 'our', 'their', 'they', 'but', 'not', 'can', 'has', 'had', 'its', 'about', 'into', 'through',
    'over', 'under', 'than', 'them', 'then', 'also', 'more', 'most', 'some', 'such', 'only', 'other',
    'each', 'many', 'much', 'any', 'all', 'out', 'off', 'who', 'how', 'why', 'what', 'when', 'where',
    'which', 'while', 'because', 'being', 'been', 'does', 'did', 'doing', 'after', 'before', 'during',
    'between', 'within', 'without', 'across', 'among', 'onto', 'upon', 'about', 'into', 'per'
  ])

  const words = String(text).toLowerCase().match(/[a-z]{3,}/g) || []
  return new Set(words.filter((word) => !stopwords.has(word)))
}

function buildProfileText(companyName, websiteUrl, providerResult = {}) {
  return [
    companyName,
    websiteUrl,
    providerResult.title,
    providerResult.snippet,
    providerResult.rawContent
  ].filter(Boolean).join(' ')
}

export function createCompanySimilarityService({ tavilyAdapter }) {
  async function extractCompanyProfile(companyName, websiteUrl = '') {
    const query = websiteUrl || companyName
    const [result] = await tavilyAdapter.search(query)
    const profileText = buildProfileText(companyName, websiteUrl, result)

    return {
      name: companyName,
      website: websiteUrl,
      keywords: extractKeywords(profileText),
      rawProfile: profileText.slice(0, 500)
    }
  }

  function calculateSimilarity(profile1, profile2) {
    const keywords1 = profile1?.keywords || new Set()
    const keywords2 = profile2?.keywords || new Set()

    if (!keywords1.size || !keywords2.size) {
      return 0
    }

    const intersection = new Set([...keywords1].filter((keyword) => keywords2.has(keyword)))
    const union = new Set([...keywords1, ...keywords2])

    return intersection.size / union.size
  }

  async function findSimilarCompanies(inputCompany, topN = 10) {
    const inputProfile = await extractCompanyProfile(inputCompany.name, inputCompany.website || '')
    const searchTerms = [
      'companies similar to',
      inputCompany.name,
      inputCompany.industry || '',
      inputCompany.description || ''
    ].filter(Boolean).join(' ')

    const searchResults = await tavilyAdapter.search(searchTerms)
    const candidates = searchResults
      .filter((candidate) => candidate && candidate.title)
      .slice(0, 15)

    const candidateProfiles = await Promise.all(
      candidates.map((candidate) => extractCompanyProfile(candidate.title, candidate.url || ''))
    )

    return candidates
      .map((company, index) => ({
        company,
        profile: {
          ...candidateProfiles[index],
          keywords: [...candidateProfiles[index].keywords]
        },
        similarity: calculateSimilarity(inputProfile, candidateProfiles[index])
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, topN)
  }

  return {
    extractCompanyProfile,
    calculateSimilarity,
    findSimilarCompanies
  }
}
