import { createEvidenceRecord, createFieldClaim, createProviderResult } from '../../domain/osint/evidence.js'
import { createId, optionalString } from '../../domain/osint/utils.js'

function inferTrustTier(providerResult) {
  if (providerResult.provider === 'google_maps' || providerResult.resultType === 'place_detail') {
    return 'provider_structured'
  }

  if (providerResult.resultType === 'extract_result' || providerResult.resultType === 'web_page') {
    return 'official_site_content'
  }

  return 'provider_search_snippet'
}

function inferSourceType(providerResult) {
  if (providerResult.resultType === 'place_detail') {
    return 'place_detail'
  }

  if (providerResult.resultType === 'extract_result' || providerResult.resultType === 'web_page') {
    return 'official_website_page'
  }

  if (providerResult.resultType === 'local_result') {
    return 'local_result'
  }

  return 'search_result'
}

function buildHintClaims(providerResult) {
  const claims = []
  const normalized = providerResult.normalized || {}

  if (normalized.title) {
    claims.push(createFieldClaim({
      field: 'CompanyEntity.canonicalName',
      value: normalized.title,
      claimType: 'observed',
      valueType: 'entity_name'
    }))
  }

  if (normalized.url) {
    claims.push(createFieldClaim({
      field: 'CompanyEntity.officialWebsite',
      value: normalized.url,
      claimType: 'observed',
      valueType: 'url'
    }))
  }

  for (const hint of normalized.addressHints || []) {
    if (!hint.rawAddress) {
      continue
    }

    claims.push(createFieldClaim({
      field: 'AddressRecord.rawAddress',
      value: hint.rawAddress,
      claimType: 'observed',
      valueType: 'address'
    }))
  }

  for (const hint of normalized.contactHints || []) {
    if (!hint.value || !hint.contactType) {
      continue
    }

    claims.push(createFieldClaim({
      field: 'PublicContactRecord.value',
      value: hint.value,
      claimType: 'observed',
      valueType: hint.contactType === 'public_phone' ? 'phone' : hint.contactType === 'public_email' ? 'email' : 'text'
    }))
  }

  return claims
}

export function normalizeProviderRecord(input, context = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {}

  return createProviderResult({
    providerResultId: source.providerResultId || createId('prov'),
    provider: source.provider || metadata.provider || context.provider || 'unknown_provider',
    providerRecordId: metadata.placeId || metadata.id || source.providerRecordId,
    resultType: context.resultType || source.resultType || metadata.resultType || 'search_result',
    capturedAt: source.capturedAt || context.capturedAt,
    queryContext: {
      path: context.path || 'osint_research',
      queryLabel: source.queryLabel || context.queryLabel || 'company',
      query: source.query || context.query || ''
    },
    raw: source,
    normalized: {
      title: source.title || metadata.title || metadata.name,
      url: source.url || metadata.url || source.placeSourceUrl,
      domain: metadata.domain,
      snippet: source.snippet || source.rawContent || metadata.snippet || metadata.description,
      companyHints: [source.title || metadata.name].filter(Boolean),
      addressHints: [
        source.address ? { rawAddress: source.address } : null,
        metadata.address ? { rawAddress: metadata.address } : null,
        metadata.formatted_address ? { rawAddress: metadata.formatted_address } : null
      ].filter(Boolean),
      contactHints: [
        source.phone ? { contactType: 'public_phone', value: source.phone, sourceType: inferSourceType({ resultType: context.resultType || 'search_result' }) } : null,
        metadata.phone ? { contactType: 'public_phone', value: metadata.phone, sourceType: inferSourceType({ resultType: context.resultType || 'search_result' }) } : null,
        metadata.email ? { contactType: 'public_email', value: metadata.email, sourceType: inferSourceType({ resultType: context.resultType || 'search_result' }) } : null
      ].filter(Boolean),
      placeTypes: metadata.placeTypes || metadata.types || [],
      geo: metadata.geo || metadata.location,
      rating: metadata.rating,
      reviewCount: metadata.reviewCount
    }
  })
}

export function providerResultToEvidence(providerResult, overrides = {}) {
  const normalizedProviderResult = createProviderResult(providerResult)
  const fieldClaims = buildHintClaims(normalizedProviderResult)

  return createEvidenceRecord({
    evidenceId: overrides.evidenceId,
    provider: normalizedProviderResult.provider,
    sourceType: overrides.sourceType || inferSourceType(normalizedProviderResult),
    sourceUrl: overrides.sourceUrl || normalizedProviderResult.normalized.url,
    title: overrides.title || normalizedProviderResult.normalized.title,
    snippet: overrides.snippet || normalizedProviderResult.normalized.snippet,
    rawReference: overrides.rawReference || normalizedProviderResult.providerResultId,
    queryLabel: overrides.queryLabel || optionalString(normalizedProviderResult.queryContext?.queryLabel),
    sourceEntityHint: overrides.sourceEntityHint || normalizedProviderResult.normalized.title,
    providerRecordId: overrides.providerRecordId || normalizedProviderResult.providerRecordId,
    capturedAt: overrides.capturedAt || normalizedProviderResult.capturedAt,
    trustTier: overrides.trustTier || inferTrustTier(normalizedProviderResult),
    fieldClaims
  })
}

export function buildEvidenceBundleFromProviderRecords(records, context = {}) {
  return (Array.isArray(records) ? records : []).map((record) => {
    const providerResult = normalizeProviderRecord(record, context)
    return {
      providerResult,
      evidenceRecord: providerResultToEvidence(providerResult)
    }
  })
}
