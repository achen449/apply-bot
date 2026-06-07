import {
  parserFindingTypes,
  researchCaseStatuses,
  researchCaseTypes,
  verificationStatuses
} from './constants.js'
import {
  assertEvidenceRefs,
  compactObject,
  createId,
  createTimestamp,
  ensureArray,
  ensureEnum,
  ensureNonEmptyString,
  normalizeConfidence,
  optionalNullableString,
  optionalString,
  toArray
} from './utils.js'

export function createResearchFinding(input) {
  return compactObject({
    findingId: optionalString(input?.findingId) || createId('finding'),
    findingType: ensureEnum(input?.findingType, parserFindingTypes, 'findingType'),
    label: optionalString(input?.label),
    value: input?.value,
    confidence: normalizeConfidence(input?.confidence),
    verificationStatus: input?.verificationStatus
      ? ensureEnum(input.verificationStatus, verificationStatuses, 'verificationStatus')
      : undefined,
    subjectRef: optionalNullableString(input?.subjectRef),
    evidenceRefs: assertEvidenceRefs(input?.evidenceRefs),
    notes: optionalString(input?.notes)
  })
}

export function createResearchCase(input) {
  const subjectRefs = ensureArray(input?.subjectRefs, 'subjectRefs')
  if (!subjectRefs.length) {
    throw new Error('subjectRefs must include at least one subject reference')
  }

  return compactObject({
    researchCaseId: optionalString(input?.researchCaseId) || createId('rc'),
    caseType: ensureEnum(input?.caseType, researchCaseTypes, 'caseType'),
    createdAt: createTimestamp(input?.createdAt),
    status: ensureEnum(input?.status || 'open', researchCaseStatuses, 'status'),
    workspaceRef: optionalNullableString(input?.workspaceRef),
    subjectRefs,
    researchQuestions: toArray(input?.researchQuestions).map((value) => ensureNonEmptyString(value, 'researchQuestions[]')),
    findings: toArray(input?.findings).map(createResearchFinding),
    riskFlags: toArray(input?.riskFlags).map((value) => ensureNonEmptyString(value, 'riskFlags[]')),
    conclusions: input?.conclusions && typeof input.conclusions === 'object' ? input.conclusions : undefined,
    addressRefs: toArray(input?.addressRefs).filter(Boolean),
    publicContactRefs: toArray(input?.publicContactRefs).filter(Boolean),
    assignee: optionalNullableString(input?.assignee),
    closedAt: input?.closedAt ? createTimestamp(input.closedAt) : undefined,
    evidenceRefs: Array.isArray(input?.evidenceRefs) ? [...new Set(input.evidenceRefs.filter(Boolean))] : []
  })
}

export function createStructuredDueDiligenceReport(input) {
  const overview = input?.overview && typeof input.overview === 'object' ? input.overview : {}
  const products = toArray(input?.products).map((item) => {
    const normalized = item && typeof item === 'object' ? item : {}
    return {
      name: ensureNonEmptyString(normalized.name, 'products[].name'),
      category: ensureNonEmptyString(normalized.category, 'products[].category'),
      evidenceRefs: assertEvidenceRefs(normalized.evidenceRefs, 'products[].evidenceRefs'),
      notes: optionalString(normalized.notes)
    }
  })

  return {
    schemaVersion: input?.schemaVersion || 'osint-report-v1',
    subjectRef: ensureNonEmptyString(input?.subjectRef, 'subjectRef'),
    overview: compactObject({
      legalName: overview.legalName == null ? null : optionalNullableString(overview.legalName),
      canonicalName: overview.canonicalName == null ? null : optionalNullableString(overview.canonicalName),
      officialWebsite: overview.officialWebsite == null ? null : optionalNullableString(overview.officialWebsite),
      headquartersAddressRef: overview.headquartersAddressRef == null ? null : optionalNullableString(overview.headquartersAddressRef),
      businessType: overview.businessType == null ? null : optionalNullableString(overview.businessType),
      marketRole: overview.marketRole == null ? null : optionalNullableString(overview.marketRole),
      evidenceRefs: assertEvidenceRefs(overview.evidenceRefs || input?.evidenceRefs || [], 'overview.evidenceRefs')
    }),
    products,
    targetApplications: toArray(input?.targetApplications).map((item) => ({
      name: ensureNonEmptyString(item?.name, 'targetApplications[].name'),
      evidenceRefs: assertEvidenceRefs(item?.evidenceRefs, 'targetApplications[].evidenceRefs')
    })),
    publicContacts: toArray(input?.publicContacts),
    findings: toArray(input?.findings).map(createResearchFinding),
    riskFlags: toArray(input?.riskFlags).map((item) => ({
      label: ensureNonEmptyString(item?.label, 'riskFlags[].label'),
      severity: optionalString(item?.severity) || 'medium',
      evidenceRefs: assertEvidenceRefs(item?.evidenceRefs, 'riskFlags[].evidenceRefs')
    })),
    unresolvedQuestions: toArray(input?.unresolvedQuestions).map((value) => ensureNonEmptyString(value, 'unresolvedQuestions[]')),
    evidenceRefs: assertEvidenceRefs(input?.evidenceRefs || overview.evidenceRefs, 'evidenceRefs')
  }
}
