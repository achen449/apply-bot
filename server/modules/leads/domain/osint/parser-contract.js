import {
  OSINT_PARSER_VERSION,
  OSINT_SCHEMA_VERSION,
  parserComplianceRules,
  parserModes,
  verificationStatuses
} from './constants.js'
import {
  assertEvidenceRefs,
  compactObject,
  ensureArray,
  ensureEnum,
  ensureNonEmptyString,
  normalizeConfidence,
  optionalNullableString,
  optionalString,
  toArray
} from './utils.js'
import { createResearchFinding, createStructuredDueDiligenceReport } from './research-case.js'
import { createPublicContactRecord } from './public-contact.js'
import { createEvidenceRecord, createProviderResult } from './evidence.js'

export function getDefaultOsintParserContract() {
  return {
    parserVersion: OSINT_PARSER_VERSION,
    schemaVersion: OSINT_SCHEMA_VERSION,
    supportedModes: [...parserModes],
    defaultMode: 'company_due_diligence',
    complianceRules: [...parserComplianceRules],
    instructions: {
      company_due_diligence: {
        description: 'Default mode for public-source company due diligence.',
        mustCapture: [
          'company identity and official website evidence',
          'concrete product or service types instead of vague industry labels',
          'address and public contact verification states',
          'risk flags and unresolved questions'
        ]
      },
      person_contact_deep_dive: {
        description: 'Deeper mode for named person and public contact linkage, only when explicitly requested.',
        mustCapture: [
          'publicly observed person name, title, and company linkage',
          'publicly observed contact value linked to that named person',
          'evidence-backed uncertainty when linkage is partial',
          'no guessed or inferred personal contact values'
        ]
      }
    }
  }
}

export function createOsintParserInput(input) {
  const mode = ensureEnum(input?.mode || 'company_due_diligence', parserModes, 'mode')
  const subject = input?.subject && typeof input.subject === 'object' ? input.subject : {}
  const providerResults = ensureArray(input?.providerResults || [], 'providerResults').map(createProviderResult)
  const evidence = ensureArray(input?.evidence || [], 'evidence').map(createEvidenceRecord)

  return {
    parserVersion: OSINT_PARSER_VERSION,
    schemaVersion: OSINT_SCHEMA_VERSION,
    mode,
    language: optionalString(input?.language) || 'zh-CN',
    subject: compactObject({
      subjectType: ensureNonEmptyString(subject.subjectType || 'company', 'subject.subjectType'),
      canonicalName: optionalNullableString(subject.canonicalName),
      website: optionalNullableString(subject.website),
      country: optionalNullableString(subject.country),
      personName: optionalNullableString(subject.personName),
      personTitle: optionalNullableString(subject.personTitle)
    }),
    researchQuestions: toArray(input?.researchQuestions).map((value) => ensureNonEmptyString(value, 'researchQuestions[]')),
    providerResults,
    evidence,
    compliance: {
      publicSourcesOnly: true,
      noGuessedEmails: true,
      noGuessedPhones: true,
      noInferredPrivateContactData: true,
      unknownStaysNullOrEmpty: true,
      everyMaterialClaimRequiresEvidence: true
    }
  }
}

function validateMaterialFieldEvidence(sectionName, records, fieldName) {
  for (const record of records) {
    assertEvidenceRefs(record?.evidenceRefs, `${sectionName}.${fieldName}`)
  }
}

export function validateOsintParserOutput(output) {
  const mode = ensureEnum(output?.mode, parserModes, 'mode')
  const report = createStructuredDueDiligenceReport(output?.report || {})
  const findings = toArray(output?.findings).map(createResearchFinding)
  const publicContacts = toArray(output?.publicContacts).map(createPublicContactRecord)

  validateMaterialFieldEvidence('report', report.products, 'products[].evidenceRefs')
  validateMaterialFieldEvidence('report', report.targetApplications, 'targetApplications[].evidenceRefs')
  validateMaterialFieldEvidence('findings', findings, 'findings[].evidenceRefs')

  if (mode === 'person_contact_deep_dive') {
    const namedContacts = publicContacts.filter((contact) => contact.contactType === 'named_person_public_contact')
    for (const contact of namedContacts) {
      if (contact.ownerScope !== 'person_level') {
        throw new Error('named_person_public_contact must be person_level in person_contact_deep_dive mode')
      }
    }
  }

  return {
    parserVersion: optionalString(output?.parserVersion) || OSINT_PARSER_VERSION,
    schemaVersion: optionalString(output?.schemaVersion) || OSINT_SCHEMA_VERSION,
    mode,
    status: ensureEnum(output?.status || 'completed', ['completed', 'partial', 'needs_review'], 'status'),
    summary: compactObject({
      entityName: optionalNullableString(output?.summary?.entityName),
      officialWebsiteStatus: output?.summary?.officialWebsiteStatus
        ? ensureEnum(output.summary.officialWebsiteStatus, verificationStatuses, 'summary.officialWebsiteStatus')
        : null,
      publicContactStatus: output?.summary?.publicContactStatus
        ? ensureEnum(output.summary.publicContactStatus, verificationStatuses, 'summary.publicContactStatus')
        : null,
      confidence: normalizeConfidence(output?.summary?.confidence)
    }),
    report,
    findings,
    publicContacts,
    riskFlags: toArray(output?.riskFlags).map((item) => ({
      label: ensureNonEmptyString(item?.label, 'riskFlags[].label'),
      severity: optionalString(item?.severity) || 'medium',
      evidenceRefs: assertEvidenceRefs(item?.evidenceRefs, 'riskFlags[].evidenceRefs')
    })),
    unresolvedQuestions: toArray(output?.unresolvedQuestions).map((value) => ensureNonEmptyString(value, 'unresolvedQuestions[]')),
    evidenceRefs: assertEvidenceRefs(output?.evidenceRefs || report.evidenceRefs, 'evidenceRefs')
  }
}
