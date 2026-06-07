import {
  evidenceClaimTypes,
  evidenceValueTypes,
  providerResultTypes,
  trustTiers,
  verificationStatuses
} from './constants.js'
import {
  assertEvidenceRefs,
  compactObject,
  createId,
  createTimestamp,
  dedupeStrings,
  ensureArray,
  ensureEnum,
  ensureNonEmptyString,
  normalizeConfidence,
  normalizeUrl,
  optionalNullableString,
  optionalString,
  toArray
} from './utils.js'

export function createFieldClaim(input) {
  const field = ensureNonEmptyString(input?.field, 'fieldClaims[].field')
  const value = input?.value

  if (value == null || value === '') {
    throw new Error('fieldClaims[].value is required')
  }

  return compactObject({
    field,
    value,
    claimType: ensureEnum(input?.claimType || 'observed', evidenceClaimTypes, 'fieldClaims[].claimType'),
    valueType: ensureEnum(input?.valueType || 'text', evidenceValueTypes, 'fieldClaims[].valueType'),
    subjectRef: optionalNullableString(input?.subjectRef),
    confidence: normalizeConfidence(input?.confidence),
    notes: optionalString(input?.notes)
  })
}

export function createEvidenceRecord(input) {
  const fieldClaims = ensureArray(input?.fieldClaims, 'fieldClaims').map(createFieldClaim)
  if (!fieldClaims.length) {
    throw new Error('fieldClaims must include at least one claim')
  }

  return compactObject({
    evidenceId: optionalString(input?.evidenceId) || createId('ev'),
    provider: ensureNonEmptyString(input?.provider, 'provider'),
    sourceType: ensureNonEmptyString(input?.sourceType, 'sourceType'),
    sourceUrl: normalizeUrl(input?.sourceUrl),
    title: optionalString(input?.title),
    snippet: optionalString(input?.snippet),
    rawReference: optionalString(input?.rawReference),
    queryLabel: optionalString(input?.queryLabel),
    sourceEntityHint: optionalString(input?.sourceEntityHint),
    providerRecordId: optionalString(input?.providerRecordId),
    language: optionalString(input?.language),
    contentHash: optionalString(input?.contentHash),
    capturedAt: createTimestamp(input?.capturedAt),
    trustTier: ensureEnum(input?.trustTier, trustTiers, 'trustTier'),
    fieldClaims
  })
}

export function createVerificationStatus(input = {}) {
  return compactObject({
    entityStatus: ensureEnum(input.entityStatus || 'discovered', verificationStatuses, 'entityStatus'),
    officialWebsiteStatus: ensureEnum(input.officialWebsiteStatus || 'unverified', verificationStatuses, 'officialWebsiteStatus'),
    addressStatus: ensureEnum(input.addressStatus || 'unverified', verificationStatuses, 'addressStatus'),
    publicContactStatus: ensureEnum(input.publicContactStatus || 'unverified', verificationStatuses, 'publicContactStatus'),
    mapsMatchStatus: input.mapsMatchStatus ? ensureEnum(input.mapsMatchStatus, verificationStatuses, 'mapsMatchStatus') : undefined,
    researchStatus: input.researchStatus ? ensureEnum(input.researchStatus, verificationStatuses, 'researchStatus') : undefined,
    lastVerifiedAt: input.lastVerifiedAt ? createTimestamp(input.lastVerifiedAt) : undefined,
    resolverVersion: optionalString(input.resolverVersion),
    notes: optionalString(input.notes)
  })
}

export function createProviderResult(input) {
  const queryContext = input?.queryContext && typeof input.queryContext === 'object' ? input.queryContext : {}
  const normalized = input?.normalized && typeof input.normalized === 'object' ? input.normalized : {}

  return {
    providerResultId: optionalString(input?.providerResultId) || createId('prov'),
    provider: ensureNonEmptyString(input?.provider, 'provider'),
    providerRecordId: optionalString(input?.providerRecordId),
    resultType: ensureEnum(input?.resultType, providerResultTypes, 'resultType'),
    capturedAt: createTimestamp(input?.capturedAt),
    queryContext,
    raw: input?.raw && typeof input.raw === 'object' ? input.raw : {},
    normalized: {
      title: optionalString(normalized.title),
      url: normalizeUrl(normalized.url),
      domain: optionalString(normalized.domain),
      snippet: optionalString(normalized.snippet),
      companyHints: dedupeStrings(normalized.companyHints),
      addressHints: toArray(normalized.addressHints)
        .filter((item) => item && typeof item === 'object')
        .map((item) => compactObject({
          rawAddress: optionalString(item.rawAddress),
          label: optionalString(item.label)
        }))
        .filter((item) => item.rawAddress),
      contactHints: toArray(normalized.contactHints)
        .filter((item) => item && typeof item === 'object')
        .map((item) => compactObject({
          contactType: optionalString(item.contactType),
          value: optionalString(item.value),
          label: optionalString(item.label),
          personName: optionalString(item.personName),
          personTitle: optionalString(item.personTitle),
          ownerScope: optionalString(item.ownerScope),
          sourceType: optionalString(item.sourceType)
        }))
        .filter((item) => item.contactType && item.value),
      placeTypes: dedupeStrings(normalized.placeTypes),
      geo: normalized.geo && typeof normalized.geo === 'object'
        ? compactObject({
            lat: Number.isFinite(Number(normalized.geo.lat)) ? Number(normalized.geo.lat) : undefined,
            lng: Number.isFinite(Number(normalized.geo.lng)) ? Number(normalized.geo.lng) : undefined
          })
        : undefined,
      rating: Number.isFinite(Number(normalized.rating)) ? Number(normalized.rating) : undefined,
      reviewCount: Number.isFinite(Number(normalized.reviewCount)) ? Number(normalized.reviewCount) : undefined,
      language: optionalString(normalized.language)
    },
    httpStatus: Number.isFinite(Number(input?.httpStatus)) ? Number(input.httpStatus) : undefined,
    latencyMs: Number.isFinite(Number(input?.latencyMs)) ? Number(input.latencyMs) : undefined,
    error: input?.error ? String(input.error) : undefined
  }
}

export function createFieldEvidenceLink(field, value, evidenceRefs, extras = {}) {
  return compactObject({
    field: ensureNonEmptyString(field, 'field'),
    value,
    evidenceRefs: assertEvidenceRefs(evidenceRefs),
    verificationStatus: extras.verificationStatus
      ? ensureEnum(extras.verificationStatus, verificationStatuses, 'verificationStatus')
      : undefined,
    notes: optionalString(extras.notes)
  })
}
