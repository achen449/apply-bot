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

  const evidence = normalizeEvidence(aiJson?.evidence, subject)
  const verification = normalizeVerification(aiJson?.verification)
  const report = normalizeReport(aiJson?.report)
  const metadata = buildAiMetadata(aiResult)

  return {
    researchRun: {
      id: createId('research'),
      status: normalizeText(aiJson?.status, 'completed'),
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

export function createOsintService({ aiAgent, tools = [], promptStorage, gistStorage, prompt = OSINT_PROMPT } = {}) {
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

      const result = normalizeResearchRun({
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

      if (gistStorage && typeof gistStorage.saveResearchRun === 'function') {
        try {
          await gistStorage.saveResearchRun(result.researchRun)
        } catch (error) {
          console.error('Failed to save research run to Gist:', error)
        }
      }

      return result
    }
  }
}
