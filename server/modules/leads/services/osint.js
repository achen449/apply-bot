import { OSINT_PROMPT } from '../prompts/osint.js'
import {
  asPositiveInteger,
  buildAiMetadata,
  createId,
  getModeLimits,
  normalizeMode,
  normalizeStringArray,
  normalizeText,
  readAiJson,
  resolvePrompt
} from './ai-service-utils.js'

function normalizeEvidence(evidence = [], subject) {
  return evidence.map((item, index) => ({
    evidenceId: normalizeText(item.evidenceId, `evidence-${index + 1}`),
    provider: normalizeText(item.provider),
    sourceType: normalizeText(item.sourceType, 'web'),
    sourceUrl: normalizeText(item.sourceUrl),
    title: normalizeText(item.title),
    snippet: normalizeText(item.snippet),
    queryLabel: normalizeText(item.queryLabel),
    trustTier: normalizeText(item.trustTier, 'other'),
    timestamp: normalizeText(item.timestamp, new Date().toISOString())
  }))
}

function normalizeVerification(verification = {}) {
  return {
    entityStatus: normalizeText(verification.entityStatus, 'unknown'),
    officialWebsiteStatus: normalizeText(verification.officialWebsiteStatus, 'unknown'),
    addressStatus: normalizeText(verification.addressStatus, 'unknown'),
    publicContactStatus: normalizeText(verification.publicContactStatus, 'unknown'),
    mapsMatchStatus: normalizeText(verification.mapsMatchStatus, 'unknown'),
    researchStatus: normalizeText(verification.researchStatus, 'partial'),
    notes: normalizeText(verification.notes)
  }
}

function normalizeProducts(products = []) {
  return products.map((product) => ({
    name: normalizeText(product.name),
    category: normalizeText(product.category),
    description: normalizeText(product.description),
    evidenceRefs: normalizeStringArray(product.evidenceRefs)
  })).filter((p) => p.name)
}

function normalizeApplications(applications = []) {
  return applications.map((app) => ({
    application: normalizeText(app.application),
    description: normalizeText(app.description),
    evidenceRefs: normalizeStringArray(app.evidenceRefs)
  })).filter((a) => a.application)
}

function normalizeFindings(findings = []) {
  return findings.map((finding) => ({
    category: normalizeText(finding.category, 'business'),
    finding: normalizeText(finding.finding),
    evidenceRefs: normalizeStringArray(finding.evidenceRefs)
  })).filter((f) => f.finding)
}

function normalizeRiskFlags(risks = []) {
  return risks.map((risk) => ({
    riskType: normalizeText(risk.riskType, 'inconsistency'),
    description: normalizeText(risk.description),
    severity: normalizeText(risk.severity, 'low'),
    evidenceRefs: normalizeStringArray(risk.evidenceRefs)
  })).filter((r) => r.description)
}

function normalizePublicContacts(contacts = []) {
  return contacts.map((contact) => ({
    type: normalizeText(contact.type),
    value: normalizeText(contact.value),
    context: normalizeText(contact.context),
    evidenceRefs: normalizeStringArray(contact.evidenceRefs)
  })).filter((c) => c.value)
}

function normalizeReport(report = {}) {
  const overview = report.overview || {}

  return {
    overview: {
      legalName: normalizeText(overview.legalName) || null,
      canonicalName: normalizeText(overview.canonicalName),
      officialWebsite: normalizeText(overview.officialWebsite),
      headquartersAddressRef: normalizeText(overview.headquartersAddressRef) || null,
      businessType: normalizeText(overview.businessType),
      marketRole: normalizeText(overview.marketRole),
      foundedYear: asPositiveInteger(overview.foundedYear, null),
      employeeRange: normalizeText(overview.employeeRange) || null,
      evidenceRefs: normalizeStringArray(overview.evidenceRefs)
    },
    products: normalizeProducts(report.products),
    targetApplications: normalizeApplications(report.targetApplications),
    findings: normalizeFindings(report.findings),
    riskFlags: normalizeRiskFlags(report.riskFlags),
    publicContacts: normalizePublicContacts(report.publicContacts),
    unresolvedQuestions: normalizeStringArray(report.unresolvedQuestions)
  }
}

function normalizeResearchRun({ payload, mode, aiJson, aiResult }) {
  const subject = {
    companyName: normalizeText(payload.companyName),
    website: normalizeText(payload.website),
    country: normalizeText(payload.country),
    address: normalizeText(payload.address)
  }

  const metadata = buildAiMetadata(aiResult)
  const evidence = filterEvidenceToProviderSources(
    normalizeEvidence(aiJson?.evidence, subject),
    aiResult?.toolCalls
  )
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId))
  const report = filterReportByEvidence(normalizeReport(aiJson?.report), evidenceIds)
  const entityEvidence = evidence.filter((item) => normalizeText(item.title).toLowerCase().includes(normalizeText(subject.companyName).toLowerCase()))
  const mapsVerified = metadata.verificationCalls.some((call) => call.ok !== false && call.verified)
  const verification = {
    entityStatus: entityEvidence.length ? 'partially_verified' : 'unverified',
    officialWebsiteStatus: evidence.some((item) => hostOf(item.sourceUrl) === hostOf(subject.website)) ? 'partially_verified' : 'unverified',
    addressStatus: mapsVerified ? 'partially_verified' : 'unverified',
    publicContactStatus: 'unverified',
    mapsMatchStatus: mapsVerified ? 'partially_verified' : 'unverified',
    researchStatus: evidence.length ? (aiResult?.partial ? 'partial' : 'completed') : 'needs_review',
    notes: ''
  }
  if (!evidence.length) {
    metadata.status = 'needs_review'
    metadata.error = metadata.error || {
      code: 'no_grounded_osint_evidence',
      message: 'AI output contained no evidence matching successful provider results.'
    }
  }

  return {
    researchRun: {
      id: createId('research'),
      status: evidence.length ? normalizeText(aiJson?.status, aiResult?.partial ? 'partial' : 'completed') : 'needs_review',
      subject,
      evidence,
      verification,
      report,
      mode,
      clues: normalizeStringArray(payload.clues),
      researchQuestions: normalizeStringArray(payload.researchQuestions),
      createdAt: new Date().toISOString(),
      providersUsed: [...new Set(metadata.searchCalls.map((call) => call.provider).filter(Boolean))],
      searchCallCount: metadata.searchCalls.length,
      verificationCallCount: metadata.verificationCalls.length,
      iterations: metadata.iterations
    },
    metadata
  }
}

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function collectProviderUrls(toolCalls = []) {
  const urls = new Set()
  for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
    if (call?.result?.ok === false) continue
    for (const item of call.result?.results || []) {
      const url = item.url || item.website
      if (url) urls.add(url)
    }
    for (const item of call.result?.candidates || []) {
      const url = item.url || item.website
      if (url) urls.add(url)
    }
  }
  return urls
}

function filterEvidenceToProviderSources(evidence, toolCalls) {
  const providerUrls = collectProviderUrls(toolCalls)
  return evidence.filter((item) => {
    if (!item.sourceUrl) return false
    const sourceHost = hostOf(item.sourceUrl)
    return [...providerUrls].some((url) => url === item.sourceUrl || (sourceHost && hostOf(url) === sourceHost))
  })
}

function filterReportByEvidence(report, evidenceIds) {
  const keepRefs = (refs) => normalizeStringArray(refs).filter((ref) => evidenceIds.has(ref))
  return {
    ...report,
    overview: {
      ...report.overview,
      evidenceRefs: keepRefs(report.overview?.evidenceRefs),
      officialWebsite: keepRefs(report.overview?.evidenceRefs).length ? report.overview.officialWebsite : ''
    },
    products: report.products.filter((item) => keepRefs(item.evidenceRefs).length).map((item) => ({ ...item, evidenceRefs: keepRefs(item.evidenceRefs) })),
    targetApplications: report.targetApplications.filter((item) => keepRefs(item.evidenceRefs).length).map((item) => ({ ...item, evidenceRefs: keepRefs(item.evidenceRefs) })),
    findings: report.findings.filter((item) => keepRefs(item.evidenceRefs).length).map((item) => ({ ...item, evidenceRefs: keepRefs(item.evidenceRefs) })),
    riskFlags: report.riskFlags.filter((item) => keepRefs(item.evidenceRefs).length).map((item) => ({ ...item, evidenceRefs: keepRefs(item.evidenceRefs) })),
    publicContacts: []
  }
}

function mergeOsintEnrichment(result, enrichment, companyName) {
  const company = enrichment?.companies?.[0]
  if (!company) {
    return result
  }

  const researchRun = result.researchRun
  researchRun.subject = {
    ...researchRun.subject,
    companyName: company.name || company.companyName || companyName,
    website: company.website || researchRun.subject.website,
    address: company.address || researchRun.subject.address,
    phone: company.phone || '',
    contactEmails: company.contactEmails || [],
    map: company.map || null,
    mapVerified: Boolean(company.mapVerified)
  }
  const enrichmentEvidence = (company.evidence || []).map((item, index) => ({
    evidenceId: item.evidenceId || `enrichment-evidence-${index + 1}`,
    provider: item.type === 'google_maps' ? 'google-maps' : 'official-website',
    sourceType: item.type === 'google_maps' ? 'map' : 'web',
    sourceUrl: item.sourceUrl || '',
    title: item.title || '',
    snippet: item.snippet || item.value || '',
    queryLabel: 'contact-enrichment',
    trustTier: item.type === 'google_maps' ? 'official-map' : 'official-website',
    timestamp: item.observedAt || new Date().toISOString()
  }))
  researchRun.evidence = [
    ...researchRun.evidence,
    ...enrichmentEvidence
  ]
  const contactEvidenceRefs = enrichmentEvidence.map((item) => item.evidenceId).filter(Boolean)
  researchRun.report = {
    ...researchRun.report,
    overview: {
      ...researchRun.report.overview,
      canonicalName: researchRun.report.overview.canonicalName || company.name || companyName,
      officialWebsite: company.website || researchRun.report.overview.officialWebsite,
      headquartersAddressRef: company.address ? 'enrichment-address-1' : researchRun.report.overview.headquartersAddressRef
    },
    publicContacts: [
      ...researchRun.report.publicContacts,
      ...(company.phone && company.mapVerified ? [{ type: 'public_phone', value: company.phone, context: 'Google Maps or official website', evidenceRefs: contactEvidenceRefs }] : []),
      ...(company.contactEmails || []).map((email) => ({ type: 'public_email', value: email, context: 'Official website contact page', evidenceRefs: contactEvidenceRefs }))
    ]
  }
  researchRun.verification = {
    ...researchRun.verification,
    addressStatus: company.mapVerified ? 'verified' : researchRun.verification.addressStatus,
    officialWebsiteStatus: ['completed', 'no_public_email'].includes(company.contactEmailStatus) ? 'partially_verified' : researchRun.verification.officialWebsiteStatus,
    publicContactStatus: company.contactEmails?.length || (company.mapVerified && company.phone) ? 'partially_verified' : researchRun.verification.publicContactStatus,
    mapsMatchStatus: company.mapVerified ? 'verified' : researchRun.verification.mapsMatchStatus,
    researchStatus: company.dataQuality?.needsReview ? 'partial' : researchRun.verification.researchStatus
  }
  result.metadata = {
    ...result.metadata,
    enrichmentCalls: enrichment.enrichmentCalls || [],
    verificationCalls: [
      ...(result.metadata.verificationCalls || []),
      ...(enrichment.verificationCalls || [])
    ]
  }

  return result
}

export function createOsintService({
  aiAgent,
  tools = [],
  promptStorage,
  gistStorage,
  prompt = '',
  companyEnrichmentService,
  persistResearchRun = true
} = {}) {
  if (!aiAgent || typeof aiAgent.executeTask !== 'function') {
    throw new Error('createOsintService requires an aiAgent with executeTask.')
  }

  return {
    async investigateCompany(payload = {}) {
      const companyName = normalizeText(payload.companyName)
      if (!companyName) {
        const error = new Error('companyName is required')
        error.code = 'invalid_payload'
        throw error
      }

      const mode = normalizeMode(payload.mode)
      const limits = getModeLimits(mode)
      const clues = normalizeStringArray(payload.clues)
      const researchQuestions = normalizeStringArray(payload.researchQuestions)

      const systemPrompt = await resolvePrompt({
        prompt,
        promptStorage,
        promptKey: 'osint',
        defaultPrompt: OSINT_PROMPT,
        values: {
          companyName,
          website: normalizeText(payload.website),
          country: normalizeText(payload.country),
          address: normalizeText(payload.address),
          mode,
          clues: clues.join(', '),
          researchQuestions: researchQuestions.join(', ')
        }
      })

      const aiResult = await aiAgent.executeTask({
        systemPrompt,
        userInput: JSON.stringify({
          companyName,
          website: normalizeText(payload.website),
          country: normalizeText(payload.country),
          address: normalizeText(payload.address),
          clues,
          researchQuestions,
          mode
        }),
        tools,
        maxIterations: Math.min(limits.maxIterations, mode === 'economy' ? 3 : 4),
        temperature: 0.2
      })

      let result = normalizeResearchRun({
        payload: {
          companyName,
          website: normalizeText(payload.website),
          country: normalizeText(payload.country),
          address: normalizeText(payload.address),
          clues,
          researchQuestions
        },
        mode,
        aiJson: readAiJson(aiResult),
        aiResult: {
          ...aiResult,
          prompt: {
            key: 'osint',
            rendered: systemPrompt
          }
        }
      })

      if (companyEnrichmentService && typeof companyEnrichmentService.enrichCompanies === 'function') {
        const enrichment = await companyEnrichmentService.enrichCompanies([{
          id: `osint-company-${Date.now()}`,
          name: companyName,
          companyName,
          website: normalizeText(payload.website),
          country: normalizeText(payload.country),
          address: normalizeText(payload.address),
          evidence: result.researchRun.evidence
        }], {
          country: normalizeText(payload.country),
          maxResults: 1,
          existingVerificationCalls: result.metadata.verificationCalls || []
        })
        result = mergeOsintEnrichment(result, enrichment, companyName)
      }

      if (persistResearchRun && gistStorage && typeof gistStorage.saveResearchRun === 'function') {
        try {
          await gistStorage.saveResearchRun(result.researchRun)
        } catch (error) {
          console.error('Failed to save research run to Gist:', error?.code || error?.status || 'persistence_failed')
        }
      }

      return result
    }
  }
}
