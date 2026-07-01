import { dedupeStrings, normalizeKey, titleCase, toRootCompanyUrl } from '../../shared/text-utils.js'

function normalizeCandidate(candidate = {}, country = '', provider = 'tavily') {
  const website = candidate.url || candidate.website || ''
  const title = candidate.title || candidate.name || 'Unknown'
  return {
    id: candidate.id || `candidate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: title,
    website: toRootCompanyUrl(website) || website,
    country: candidate.country || country,
    segment: candidate.segment || candidate.queryLabel || '',
    profile: candidate.profile || candidate.description || '',
    size: candidate.size || '',
    fitScore: candidate.fitScore || candidate.score || 0,
    signals: dedupeStrings(candidate.signals || [candidate.snippet, candidate.rawContent].filter(Boolean)),
    whyFit: candidate.whyFit || candidate.snippet || '',
    priority: candidate.priority || 'medium',
    source: provider,
    sourceUrl: candidate.url || website,
    businessType: candidate.businessType || '',
    marketRole: candidate.marketRole || 'potential-buyer',
    businessSummary: candidate.businessSummary || candidate.snippet || '',
    buyingRelevance: candidate.buyingRelevance || candidate.snippet || '',
    mainProducts: candidate.mainProducts || [],
    targetApplications: candidate.targetApplications || [],
    possibleScaleSignal: candidate.possibleScaleSignal || '',
    scaleSignals: candidate.scaleSignals || [],
    employeeEstimate: candidate.employeeEstimate || '',
    foundedYear: candidate.foundedYear || '',
    headquarters: candidate.headquarters || '',
    officialWebsiteLikely: Boolean(candidate.website || candidate.url),
    matchedQueryCount: candidate.matchedQueryCount || 1,
    matchedProviders: candidate.matchedProviders || [provider],
    matchedQueryLabels: candidate.matchedQueryLabels || [candidate.queryLabel || 'buyer'],
    contactEmails: candidate.contactEmails || [],
    contactPages: candidate.contactPages || [],
    phone: candidate.phone || '',
    address: candidate.address || '',
    notes: candidate.notes || '',
    outreachNotes: candidate.outreachNotes || '',
    pipelineStatus: candidate.pipelineStatus || 'researching',
    customEmail: candidate.customEmail || '',
    customContactName: candidate.customContactName || '',
    customContactTitle: candidate.customContactTitle || '',
    customLinkedinUrl: candidate.customLinkedinUrl || '',
    customEmailStatus: candidate.customEmailStatus || 'not-found'
  }
}

function buildSeededWorkspace(payload) {
  const industry = titleCase(payload.industry || 'Lead Discovery')
  const country = payload.country || ''
  const baseCompany = normalizeCandidate({
    id: 'seeded-company-1',
    title: `${industry} Buyer`,
    url: `https://${normalizeKey(industry || 'buyer').replace(/\s+/g, '-')}.example.com`,
    snippet: `Seeded profile for ${industry} buyers in ${country || 'global markets'}.`,
    rawContent: `Seeded profile for ${industry} buyers in ${country || 'global markets'}.`,
    segment: 'buyer',
    profile: industry,
    fitScore: 65,
    businessType: 'Buyer',
    marketRole: 'potential-buyer',
    businessSummary: `Seeded profile for ${industry} buyers.`,
    buyingRelevance: `Seeded profile for ${industry} buyers.`,
    mainProducts: [payload.keywords?.[0] || 'connectors'],
    targetApplications: ['industrial purchasing'],
    matchedProviders: ['seeded-profile'],
    matchedQueryLabels: ['seeded-profile'],
    officialWebsiteLikely: true
  }, country, 'seeded-profile')

  const seededContact = {
    id: 'seeded-contact-1',
    companyId: baseCompany.id,
    fullName: 'Buying Team',
    title: 'Purchasing',
    department: 'Procurement',
    seniority: 'team',
    email: 'info@example.com',
    emailStatus: 'seeded',
    linkedinUrl: '',
    confidenceScore: 0.2,
    reason: 'Seeded fallback contact'
  }

  const seededDraft = {
    id: 'seeded-draft-1',
    workspaceId: `workspace-${Date.now()}`,
    companyId: baseCompany.id,
    contactId: seededContact.id,
    subject: `Intro to ${baseCompany.name}`,
    preview: baseCompany.whyFit,
    body: baseCompany.businessSummary
  }

  const workspace = {
    id: `workspace-${Date.now()}`,
    industry,
    country,
    keywords: payload.keywords || [],
    createdAt: new Date().toISOString(),
    recommendedSegments: [industry],
    providersUsed: ['seeded-profile'],
    searchStrategy: {
      targetTypes: payload.targetTypes || [],
      excludeTypes: payload.excludeTypes || [],
      queryTemplates: [],
      queryCount: 0,
      evidenceMode: 'seeded-profile'
    },
    companies: [baseCompany],
    contacts: [seededContact],
    drafts: [seededDraft],
    summary: {
      companyCount: 1,
      contactCount: 1,
      draftCount: 1,
      topProfiles: [baseCompany.profile]
    }
  }

  return workspace
}

function buildWorkspaceFromAnalyzedCandidates(payload, analyzedCandidates, metadata) {
  const companies = analyzedCandidates.map((candidate) => normalizeCandidate(candidate, payload.country, candidate.source || 'tavily'))
  const shortlisted = companies.filter((company) => company.fitScore >= 70)
  const candidatePool = companies.filter((company) => company.fitScore >= 40)
  const contacts = companies.flatMap((company) => {
    const records = []
    ;(company.contactEmails || []).forEach((email, index) => {
      records.push({
        id: `${company.id}-contact-email-${index + 1}`,
        companyId: company.id,
        fullName: '',
        title: '',
        department: 'Procurement',
        seniority: 'team',
        email,
        emailStatus: 'observed',
        linkedinUrl: '',
        confidenceScore: 0.6,
        reason: 'Public contact signal'
      })
    })
    if (company.phone) {
      records.push({
        id: `${company.id}-contact-phone-1`,
        companyId: company.id,
        fullName: '',
        title: '',
        department: 'General',
        seniority: 'team',
        email: '',
        emailStatus: 'not-found',
        linkedinUrl: '',
        confidenceScore: 0.5,
        reason: `Observed public phone ${company.phone}`
      })
    }
    return records
  })
  const drafts = shortlisted.slice(0, 1).map((company) => ({
    id: `${company.id}-draft`,
    workspaceId: '',
    companyId: company.id,
    contactId: contacts.find((contact) => contact.companyId === company.id)?.id || '',
    subject: `Intro to ${company.name}`,
    preview: company.whyFit,
    body: company.businessSummary
  }))
  const workspace = {
    id: `workspace-${Date.now()}`,
    industry: titleCase(payload.industry || ''),
    country: payload.country || '',
    keywords: payload.keywords || [],
    createdAt: new Date().toISOString(),
    recommendedSegments: dedupeStrings([
      ...(metadata.searchCalls || []).map((call) => call.queryLabel || ''),
      ...(companies.map((company) => company.segment).filter(Boolean))
    ]),
    providersUsed: dedupeStrings(
      companies.flatMap((company) => (company.matchedProviders || []).filter((provider) => provider !== 'seeded-profile'))
    ).filter(Boolean),
    searchStrategy: {
      targetTypes: payload.targetTypes || [],
      excludeTypes: payload.excludeTypes || [],
      queryTemplates: dedupeStrings((metadata.searchCalls || []).map((call) => call.query || '')),
      queryCount: (metadata.searchCalls || []).length,
      evidenceMode: 'multi-query-hit-weighting'
    },
    companies: shortlisted,
    contacts,
    drafts,
    summary: {
      companyCount: shortlisted.length,
      contactCount: contacts.length,
      draftCount: drafts.length,
      topProfiles: dedupeStrings(shortlisted.map((company) => company.profile)).slice(0, 4)
    },
    candidatePool,
    shortlist: shortlisted
  }

  return workspace
}

export function createLeadDiscoveryService({
  tavilySearch,
  braveSearch,
  googleMapsSearch,
  analyzeCompanyWebsite
} = {}) {
  return {
    async discoverWorkspace(payload = {}) {
      const industry = payload.industry ? String(payload.industry).trim() : ''
      const keywords = Array.isArray(payload.keywords) ? payload.keywords.filter(Boolean) : []

      if (!industry) {
        const error = new Error('industry is required')
        error.code = 'invalid_payload'
        throw error
      }

      const searchQueries = [
        `${industry} buyer`,
        `${industry} installer`,
        `${industry} EPC`
      ]

      const searchResults = []
      if (typeof tavilySearch === 'function') {
        const results = await tavilySearch({ query: searchQueries[0], label: 'buyer-intent' })
        searchResults.push(...(results || []))
      }
      if (typeof braveSearch === 'function') {
        const results = await braveSearch({ query: searchQueries[1], label: 'buyer-intent' })
        searchResults.push(...(results || []))
      }
      if (typeof googleMapsSearch === 'function') {
        const results = await googleMapsSearch({ query: searchQueries[2], location: payload.country || '', filters: { maxResults: 10 } })
        searchResults.push(...((results?.results || results) || []))
      }

      const analyzedCandidates = []
      const seenUrls = new Set()
      if (typeof analyzeCompanyWebsite === 'function') {
        for (const candidate of searchResults.slice(0, 12)) {
          const identity = candidate.url || candidate.website || candidate.title || candidate.name
          if (seenUrls.has(identity)) {
            continue
          }
          seenUrls.add(identity)
          const analyzed = await analyzeCompanyWebsite(candidate, keywords, [industry, ...(payload.targetTypes || [])], payload.country || '')
          if (analyzed && analyzed.officialWebsiteLikely !== false) {
            analyzedCandidates.push(analyzed)
          }
        }
      }

      const normalizedTargetTypes = (payload.targetTypes || []).map((value) => normalizeKey(value).replace(/\s+/g, '-'))
      const normalizedExcludeTypes = (payload.excludeTypes || []).map((value) => normalizeKey(value).replace(/\s+/g, '-'))
      const typeMatches = (candidateType, requestedType) => {
        if (!candidateType || !requestedType) {
          return false
        }

        return candidateType === requestedType
          || candidateType.includes(requestedType)
          || requestedType.includes(candidateType)
      }
      const filteredCandidates = analyzedCandidates.filter((candidate) => {
        const candidateType = normalizeKey(candidate.businessType || '').replace(/\s+/g, '-')
        if (normalizedExcludeTypes.some((type) => typeMatches(candidateType, type))) {
          return false
        }
        if (normalizedTargetTypes.length > 0 && !normalizedTargetTypes.some((type) => typeMatches(candidateType, type))) {
          return false
        }
        return true
      })

      const metadata = {
        prompt: null,
        searchCalls: searchQueries.map((query, index) => ({
          provider: index === 0 ? 'tavily' : index === 1 ? 'brave' : 'google-maps',
          query,
          queryLabel: 'buyer-intent',
          ok: true,
          resultCount: searchResults.length
        })),
        verificationCalls: [],
        iterations: 0,
        finalText: '',
        parsedJson: null
      }

      if (filteredCandidates.length > 0) {
        return buildWorkspaceFromAnalyzedCandidates(payload, filteredCandidates, metadata)
      }

      return buildSeededWorkspace(payload)
    }
  }
}
