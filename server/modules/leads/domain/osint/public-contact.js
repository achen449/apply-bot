import { contactOwnerScopes, contactTypes, verificationStatuses } from './constants.js'
import {
  assertEvidenceRefs,
  compactObject,
  createId,
  createTimestamp,
  ensureEnum,
  ensureNonEmptyString,
  normalizeScore,
  optionalNullableString,
  optionalString
} from './utils.js'

function assertNoGuessedContactValue(value, fieldName) {
  const normalized = ensureNonEmptyString(value, fieldName).toLowerCase()
  if (normalized.includes('[guess]') || normalized.includes('guessed') || normalized.includes('inferred')) {
    throw new Error(`${fieldName} must not contain guessed or inferred contact data`)
  }

  return value.trim()
}

export function createPublicContactRecord(input) {
  const contactType = ensureEnum(input?.contactType, contactTypes, 'contactType')
  const ownerScope = ensureEnum(input?.ownerScope, contactOwnerScopes, 'ownerScope')
  const value = assertNoGuessedContactValue(input?.value, 'value')
  const personName = optionalNullableString(input?.personName)
  const personTitle = optionalNullableString(input?.personTitle)

  if (contactType === 'named_person_public_contact') {
    if (!personName || !personTitle) {
      throw new Error('named_person_public_contact requires personName and personTitle')
    }
    if (ownerScope !== 'person_level') {
      throw new Error('named_person_public_contact must use ownerScope person_level')
    }
  }

  return compactObject({
    contactId: optionalString(input?.contactId) || createId('pct'),
    contactType,
    value,
    ownerScope,
    verificationStatus: ensureEnum(input?.verificationStatus || 'observed', ['observed', ...verificationStatuses], 'verificationStatus'),
    evidenceRefs: assertEvidenceRefs(input?.evidenceRefs),
    label: optionalString(input?.label),
    personName,
    personTitle,
    department: optionalNullableString(input?.department),
    linkedCompanyEntityId: optionalNullableString(input?.linkedCompanyEntityId),
    linkedAddressId: optionalNullableString(input?.linkedAddressId),
    sourceType: optionalNullableString(input?.sourceType),
    confidenceScore: normalizeScore(input?.confidenceScore, 'confidenceScore'),
    isPreferred: typeof input?.isPreferred === 'boolean' ? input.isPreferred : undefined,
    observedAt: input?.observedAt ? createTimestamp(input.observedAt) : undefined,
    lastCheckedAt: input?.lastCheckedAt ? createTimestamp(input.lastCheckedAt) : undefined,
    sourceRefs: Array.isArray(input?.sourceRefs) ? input.sourceRefs.filter(Boolean) : undefined
  })
}

export function assertPublicContactEvidence(contactRecord, evidenceRecords = []) {
  const evidenceIds = new Set(evidenceRecords.map((record) => record?.evidenceId).filter(Boolean))

  for (const evidenceRef of contactRecord.evidenceRefs) {
    if (!evidenceIds.has(evidenceRef)) {
      throw new Error(`Missing evidence for public contact reference: ${evidenceRef}`)
    }
  }

  return true
}
