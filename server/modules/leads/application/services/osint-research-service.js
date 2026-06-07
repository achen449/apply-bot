import {
  assertPublicContactEvidence,
  createPublicContactRecord,
  createResearchCase,
  createResearchFinding,
  createStructuredDueDiligenceReport,
  createVerificationStatus,
  validateOsintParserOutput
} from '../../domain/osint/index.js'
import { buildEvidenceBundleFromProviderRecords } from '../osint/provider-evidence-helpers.js'

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStringList(values) {
  if (Array.isArray(values)) {
    return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))]
  }

  const singleValue = normalizeText(values)
  return singleValue ? [singleValue] : []
}

function normalizeWebsite(value) {
  const website = normalizeText(value)
  if (!website) {
    return ''
  }

  return /^https?:\/\//i.test(website) ? website : `https://${website}`
}

function normalizeDomain(value) {
  const website = normalizeWebsite(value)
  if (!website) {
    return ''
  }

  try {
    return new URL(website).hostname.replace(/^www\./i, '')
  } catch {
    return website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]
  }
}

function buildSubjectRef(subject) {
  const seed = [subject.companyName, subject.website, subject.address, subject.personName]
    .map((value) => normalizeText(value).toLowerCase())
    .find(Boolean) || 'unknown'
  const slug = seed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'
  return `subject:${slug}`
}

function createSystemEvidence(note, evidenceId = undefined) {
  return {
    evidenceId: evidenceId || `ev-system-${Date.now()}`,
    provider: 'system',
    sourceType: 'manual_note',
    sourceUrl: '',
    title: 'OSINT research note',
    snippet: note,
    rawReference: note,
    queryLabel: 'research_note',
    sourceEntityHint: 'system',
    trustTier: 'manual_review_note',
    fieldClaims: [
      {
        field: 'ResearchCase.note',
        value: note,
        claimType: 'manual_note',
        valueType: 'text'
      }
    ]
  }
}

function buildProviderQueries(subject, mode) {
  const domain = normalizeDomain(subject.website)
  const baseTerms = [subject.companyName, domain, subject.country].filter(Boolean)
  const companyTerms = [subject.companyName, subject.address, subject.country].filter(Boolean)
  const clues = subject.clues.filter(Boolean)
  const personTerms = [subject.personName, subject.personTitle, subject.companyName, domain].filter(Boolean)

  const googleMaps = [
    { query: companyTerms.join(' '), label: 'company_hq_lookup' },
    { query: [subject.companyName, subject.address].filter(Boolean).join(' '), label: 'address_lookup' }
  ]

  const brave = [
    { query: [...baseTerms, 'official website'].filter(Boolean).join(' '), label: 'official_website' },
    { query: [...companyTerms, clues[0]].filter(Boolean).join(' '), label: 'company_profile' },
    { query: clues.length ? [subject.companyName, ...clues.slice(0, 2)].filter(Boolean).join(' ') : '', label: 'company_clues' }
  ]

  const tavily = [
    { query: [...baseTerms, 'company overview'].filter(Boolean).join(' '), label: 'company_overview' },
    { query: [subject.companyName, subject.address, ...clues.slice(0, 1)].filter(Boolean).join(' '), label: 'address_corroboration' }
  ]

  if (mode === 'person_contact_deep_dive') {
    brave.push({ query: personTerms.join(' '), label: 'person_public_presence' })
    tavily.push({ query: [...personTerms, 'public contact'].filter(Boolean).join(' '), label: 'person_contact' })
  }

  return {
    googleMaps: googleMaps.filter((item) => item.query),
    brave: brave.filter((item) => item.query),
    tavily: tavily.filter((item) => item.query)
  }
}

function normalizeProviderRecords(providerName, records) {
  return (Array.isArray(records) ? records : []).map((record) => ({
    ...record,
    provider: record?.provider || providerName,
    resultType: providerName === 'google-maps'
      ? 'place_detail'
      : record?.isLocalPoi
        ? 'local_result'
        : 'search_result'
  }))
}

function dedupeByKey(items, keyBuilder) {
  const seen = new Set()
  const results = []

  for (const item of items) {
    const key = keyBuilder(item)
    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    results.push(item)
  }

  return results
}

function pickEvidenceValue(evidenceRecords, fieldName, predicate = () => true) {
  for (const record of evidenceRecords) {
    if (!predicate(record)) {
      continue
    }

    const claim = (record.fieldClaims || []).find((item) => item.field === fieldName)
    if (claim?.value) {
      return { value: claim.value, evidenceId: record.evidenceId, provider: record.provider }
    }
  }

  return null
}

function extractProducts(evidenceRecords) {
  const productMatches = []
  const regex = /\b(manufactur(?:e|es|er|ing)|automation|connector(?:s)?|cable(?:s)?|solar|battery|inverter|control systems?)\b/gi

  for (const record of evidenceRecords) {
    const text = `${record.title || ''} ${record.snippet || ''}`
    const matches = [...new Set((text.match(regex) || []).map((value) => value.toLowerCase()))]
    for (const match of matches) {
      productMatches.push({
        name: match,
        category: 'observed_public_signal',
        evidenceRefs: [record.evidenceId]
      })
    }
  }

  return dedupeByKey(productMatches, (item) => item.name).slice(0, 6)
}

function buildPublicContacts(providerResults, evidenceRecords, mode) {
  const contacts = []
  const seen = new Set()

  for (const providerResult of providerResults) {
    for (const hint of providerResult.normalized?.contactHints || []) {
      const evidenceRecord = evidenceRecords.find((record) => record.rawReference === providerResult.providerResultId)
      if (!evidenceRecord) {
        continue
      }

      const contactType = hint.contactType === 'public_phone' ? 'public_phone' : hint.contactType === 'public_email' ? 'public_email' : ''
      if (!contactType) {
        continue
      }

      const key = `${contactType}:${hint.value}`.toLowerCase()
      if (seen.has(key)) {
        continue
      }

      seen.add(key)

      const contact = createPublicContactRecord({
        contactType,
        value: hint.value,
        ownerScope: 'company_level',
        verificationStatus: 'observed',
        label: providerResult.normalized?.title || undefined,
        sourceType: hint.sourceType || providerResult.resultType,
        confidenceScore: providerResult.provider === 'google-maps' ? 82 : 70,
        evidenceRefs: [evidenceRecord.evidenceId]
      })

      assertPublicContactEvidence(contact, evidenceRecords)
      contacts.push(contact)
    }
  }

  if (mode === 'person_contact_deep_dive') {
    return contacts.filter((contact) => contact.contactType !== 'named_person_public_contact')
  }

  return contacts
}

function buildManualParserOutput({
  mode,
  subject,
  subjectRef,
  providerResults,
  evidenceRecords,
  publicContacts,
  providerAvailability,
  researchQuestions,
  parserUsed
}) {
  const nameClaim = pickEvidenceValue(evidenceRecords, 'CompanyEntity.canonicalName')
  const websiteClaim = pickEvidenceValue(
    evidenceRecords,
    'CompanyEntity.officialWebsite',
    (record) => {
      const sourceUrl = normalizeText(record.sourceUrl)
      const subjectDomain = normalizeDomain(subject.website)
      return sourceUrl ? sourceUrl.includes(subjectDomain || sourceUrl) : true
    }
  )
  const addressClaim = pickEvidenceValue(
    evidenceRecords,
    'AddressRecord.rawAddress',
    (record) => record.provider === 'google-maps' || record.provider === 'brave'
  )

  const reportEvidenceRefs = dedupeByKey(evidenceRecords, (record) => record.evidenceId)
    .map((record) => record.evidenceId)

  const findings = []
  if (websiteClaim) {
    findings.push(createResearchFinding({
      findingType: 'official_website',
      label: 'Official website observed',
      value: websiteClaim.value,
      confidence: 0.85,
      verificationStatus: 'partially_verified',
      subjectRef,
      evidenceRefs: [websiteClaim.evidenceId]
    }))
  }

  if (nameClaim) {
    findings.push(createResearchFinding({
      findingType: 'company_name',
      label: 'Canonical company name observed',
      value: nameClaim.value,
      confidence: 0.8,
      verificationStatus: 'discovered',
      subjectRef,
      evidenceRefs: [nameClaim.evidenceId]
    }))
  }

  if (addressClaim) {
    findings.push(createResearchFinding({
      findingType: 'address',
      label: 'Public address evidence observed',
      value: addressClaim.value,
      confidence: 0.82,
      verificationStatus: 'partially_verified',
      subjectRef,
      evidenceRefs: [addressClaim.evidenceId]
    }))
  }

  for (const contact of publicContacts) {
    findings.push(createResearchFinding({
      findingType: 'public_contact',
      label: `${contact.contactType} observed`,
      value: contact.value,
      confidence: 0.76,
      verificationStatus: 'discovered',
      subjectRef,
      evidenceRefs: contact.evidenceRefs
    }))
  }

  const unresolvedQuestions = []
  if (!websiteClaim) {
    unresolvedQuestions.push('Official website remains unverified from current public evidence.')
  }
  if (!addressClaim) {
    unresolvedQuestions.push('Business address still needs corroboration from public place or web evidence.')
  }
  if (!publicContacts.length) {
    unresolvedQuestions.push('No evidence-backed public company contact was observed in collected sources.')
  }
  if (mode === 'person_contact_deep_dive' && !subject.personName) {
    unresolvedQuestions.push('Deep contact mode requires a named person clue for person-level corroboration.')
  }

  for (const entry of providerAvailability) {
    if (!entry.available) {
      unresolvedQuestions.push(`${entry.provider} was skipped: ${entry.reason}.`)
    }
  }

  if (!parserUsed) {
    unresolvedQuestions.push('Structured summary was produced without optional parser assistance and should be manually reviewed before downstream use.')
  }

  const riskFlags = []
  if (!websiteClaim) {
    riskFlags.push({
      label: 'Official website not verified',
      severity: 'medium',
      evidenceRefs: reportEvidenceRefs.slice(0, 1)
    })
  }
  if (subject.address && !addressClaim) {
    riskFlags.push({
      label: 'Provided address not corroborated',
      severity: 'medium',
      evidenceRefs: reportEvidenceRefs.slice(0, 1)
    })
  }

  const report = createStructuredDueDiligenceReport({
    schemaVersion: 'osint-report-v1',
    subjectRef,
    overview: {
      legalName: null,
      canonicalName: nameClaim?.value || subject.companyName || null,
      officialWebsite: websiteClaim?.value || subject.website || null,
      headquartersAddressRef: addressClaim ? `address:${addressClaim.evidenceId}` : null,
      businessType: null,
      marketRole: null,
      evidenceRefs: reportEvidenceRefs
    },
    products: extractProducts(evidenceRecords),
    targetApplications: [],
    publicContacts,
    findings,
    riskFlags,
    unresolvedQuestions,
    evidenceRefs: reportEvidenceRefs
  })

  const availableProviders = providerAvailability.filter((entry) => entry.available).length
  const evidenceBackedProviders = new Set(providerResults.map((result) => result.provider)).size
  const status = evidenceRecords.some((record) => record.provider !== 'system')
    ? unresolvedQuestions.length ? 'partial' : 'completed'
    : 'needs_review'

  return validateOsintParserOutput({
    mode,
    status,
    summary: {
      entityName: report.overview.canonicalName || subject.companyName || subject.website || null,
      officialWebsiteStatus: websiteClaim ? 'partially_verified' : 'unverified',
      publicContactStatus: publicContacts.length ? 'discovered' : 'unverified',
      confidence: evidenceBackedProviders && availableProviders
        ? Math.min(0.92, 0.4 + (evidenceBackedProviders * 0.15) + (reportEvidenceRefs.length * 0.03))
        : 0.2
    },
    report,
    findings,
    publicContacts,
    riskFlags,
    unresolvedQuestions: dedupeByKey(unresolvedQuestions, (item) => item),
    evidenceRefs: reportEvidenceRefs
  })
}

async function collectProviderEvidence({ providerName, available, skipReason, queries, search }) {
  if (!available) {
    return {
      availability: {
        provider: providerName,
        available: false,
        skipped: true,
        reason: skipReason || 'missing_api_key',
        queriesAttempted: 0,
        resultCount: 0
      },
      providerResults: [],
      evidenceRecords: []
    }
  }

  const providerResults = []
  const evidenceRecords = []

  for (const query of queries.slice(0, 3)) {
    const rawResults = await search(query)
    const records = normalizeProviderRecords(providerName, rawResults)
    const bundles = buildEvidenceBundleFromProviderRecords(records, {
      provider: providerName,
      resultType: providerName === 'google-maps' ? 'place_detail' : 'search_result',
      queryLabel: query.label,
      query: query.query,
      path: 'osint_research'
    })

    for (const bundle of bundles) {
      providerResults.push(bundle.providerResult)
      evidenceRecords.push(bundle.evidenceRecord)
    }
  }

  const dedupedProviderResults = dedupeByKey(
    providerResults,
    (item) => `${item.provider}|${item.normalized?.url || ''}|${item.normalized?.title || ''}|${item.providerRecordId || ''}`
  )
  const dedupedEvidence = dedupeByKey(
    evidenceRecords,
    (item) => `${item.provider}|${item.sourceUrl || ''}|${item.title || ''}|${item.providerRecordId || ''}|${item.snippet || ''}`
  )

  return {
    availability: {
      provider: providerName,
      available: true,
      skipped: false,
      reason: null,
      queriesAttempted: queries.slice(0, 3).length,
      resultCount: dedupedProviderResults.length
    },
    providerResults: dedupedProviderResults,
    evidenceRecords: dedupedEvidence
  }
}

export function createOsintResearchService({
  googleMapsSearch,
  braveSearch,
  tavilySearch,
  parserFacade,
  providerAvailability = {}
}) {
  async function research(rawInput = {}) {
    const mode = rawInput.mode === 'person_contact_deep_dive' ? 'person_contact_deep_dive' : 'company_due_diligence'
    const subject = {
      companyName: normalizeText(rawInput.companyName),
      website: normalizeWebsite(rawInput.website),
      country: normalizeText(rawInput.country),
      address: normalizeText(rawInput.address),
      personName: normalizeText(rawInput.personName),
      personTitle: normalizeText(rawInput.personTitle),
      clues: normalizeStringList(rawInput.clues || rawInput.companyClues || rawInput.personClues)
    }
    const subjectRef = buildSubjectRef(subject)
    const researchQuestions = normalizeStringList(rawInput.researchQuestions)
    const queries = buildProviderQueries(subject, mode)

    const providerRuns = await Promise.all([
      collectProviderEvidence({
        providerName: 'google-maps',
        available: providerAvailability.googleMaps !== false,
        skipReason: providerAvailability.googleMapsReason || 'missing_api_key',
        queries: queries.googleMaps,
        search: async (query) => googleMapsSearch ? googleMapsSearch(query.query, { maxResults: 5 }) : []
      }),
      collectProviderEvidence({
        providerName: 'brave',
        available: providerAvailability.brave !== false,
        skipReason: providerAvailability.braveReason || 'missing_api_key',
        queries: queries.brave,
        search: async (query) => braveSearch ? braveSearch(query) : []
      }),
      collectProviderEvidence({
        providerName: 'tavily',
        available: providerAvailability.tavily !== false,
        skipReason: providerAvailability.tavilyReason || 'missing_api_key',
        queries: queries.tavily,
        search: async (query) => tavilySearch ? tavilySearch(query) : []
      })
    ])

    const providerAvailabilitySummary = providerRuns.map((run) => run.availability)
    const providerResults = providerRuns.flatMap((run) => run.providerResults)
    const externalEvidenceRecords = providerRuns.flatMap((run) => run.evidenceRecords)

    const evidenceRecords = externalEvidenceRecords.length
      ? externalEvidenceRecords
      : [createSystemEvidence('No external provider evidence was collected. Manual review is required.')]

    const publicContacts = buildPublicContacts(providerResults, evidenceRecords, mode)

    const parserResult = parserFacade
      ? await parserFacade.parse({
          mode,
          subject: {
            subjectType: 'company',
            canonicalName: subject.companyName || null,
            website: subject.website || null,
            country: subject.country || null,
            personName: subject.personName || null,
            personTitle: subject.personTitle || null
          },
          researchQuestions,
          providerResults,
          evidence: evidenceRecords
        })
      : { available: false, used: false, reason: 'parser_not_configured', output: null }

    const parsedOutput = parserResult.output || buildManualParserOutput({
      mode,
      subject,
      subjectRef,
      providerResults,
      evidenceRecords,
      publicContacts,
      providerAvailability: providerAvailabilitySummary,
      researchQuestions,
      parserUsed: parserResult.used
    })

    const verification = createVerificationStatus({
      entityStatus: parsedOutput.summary.entityName ? 'discovered' : 'unverified',
      officialWebsiteStatus: parsedOutput.summary.officialWebsiteStatus || 'unverified',
      addressStatus: parsedOutput.findings.some((finding) => finding.findingType === 'address') ? 'partially_verified' : 'unverified',
      publicContactStatus: parsedOutput.summary.publicContactStatus || 'unverified',
      mapsMatchStatus: providerResults.some((result) => result.provider === 'google-maps') ? 'discovered' : 'unverified',
      researchStatus: parsedOutput.status === 'completed' ? 'verified' : parsedOutput.status === 'partial' ? 'partially_verified' : 'unverified',
      resolverVersion: 'osint-research-service-v1',
      notes: parserResult.used ? 'Structured output includes parser-assisted evidence interpretation.' : 'Structured output generated from collected evidence without parser assistance.'
    })

    const researchCase = createResearchCase({
      caseType: mode === 'person_contact_deep_dive' ? 'person_contact_due_diligence' : 'company_due_diligence',
      status: parsedOutput.status === 'completed' ? 'completed' : 'in_progress',
      subjectRefs: [subjectRef],
      researchQuestions: researchQuestions.length ? researchQuestions : ['Verify official website, public company details, and evidence-backed public contacts.'],
      findings: parsedOutput.findings,
      riskFlags: parsedOutput.riskFlags.map((item) => item.label),
      conclusions: {
        status: parsedOutput.status,
        summary: parsedOutput.summary,
        parserUsed: parserResult.used
      },
      publicContactRefs: parsedOutput.publicContacts.map((item) => item.contactId),
      evidenceRefs: parsedOutput.evidenceRefs
    })

    return {
      mode,
      status: parsedOutput.status,
      subject: {
        ...subject,
        subjectRef
      },
      compliance: {
        publicSourcesOnly: true,
        noGuessedEmails: true,
        noGuessedPhones: true,
        noInferredPrivateContactData: true,
        unknownStaysNullOrEmpty: true,
        everyMaterialClaimRequiresEvidence: true
      },
      providerAvailability: providerAvailabilitySummary,
      providerResults,
      evidence: evidenceRecords,
      verification,
      parser: {
        available: Boolean(parserResult.available),
        used: Boolean(parserResult.used),
        reason: parserResult.reason,
        error: parserResult.error || null,
        contract: parserFacade?.getContract ? parserFacade.getContract() : null
      },
      report: parsedOutput.report,
      findings: parsedOutput.findings,
      publicContacts: parsedOutput.publicContacts,
      riskFlags: parsedOutput.riskFlags,
      unresolvedQuestions: parsedOutput.unresolvedQuestions,
      researchCase
    }
  }

  return {
    research
  }
}
