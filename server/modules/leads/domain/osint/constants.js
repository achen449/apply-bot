export const OSINT_SCHEMA_VERSION = 'osint-v1'
export const OSINT_RESOLVER_VERSION = 'osint-schema-v1'
export const OSINT_PARSER_VERSION = 'osint-parser-v1'

export const verificationStatuses = Object.freeze([
  'unverified',
  'discovered',
  'suspected',
  'partially_verified',
  'verified',
  'conflicted'
])

export const trustTiers = Object.freeze([
  'provider_search_snippet',
  'provider_structured',
  'official_site_content',
  'official_site_structured_contact',
  'third_party_directory',
  'manual_review_note'
])

export const evidenceClaimTypes = Object.freeze([
  'observed',
  'derived',
  'conflict',
  'manual_note'
])

export const evidenceValueTypes = Object.freeze([
  'text',
  'url',
  'email',
  'phone',
  'address',
  'number',
  'boolean',
  'date',
  'entity_name'
])

export const contactTypes = Object.freeze([
  'public_email',
  'public_phone',
  'generic_form',
  'named_person_public_contact'
])

export const contactOwnerScopes = Object.freeze([
  'company_level',
  'location_level',
  'person_level'
])

export const researchCaseTypes = Object.freeze([
  'company_due_diligence',
  'person_contact_due_diligence'
])

export const researchCaseStatuses = Object.freeze([
  'open',
  'in_progress',
  'completed',
  'blocked'
])

export const parserModes = Object.freeze([
  'company_due_diligence',
  'person_contact_deep_dive'
])

export const providerResultTypes = Object.freeze([
  'search_result',
  'local_result',
  'place_detail',
  'extract_result',
  'web_page',
  'manual_note'
])

export const parserComplianceRules = Object.freeze([
  'public_sources_only',
  'no_guessed_emails',
  'no_guessed_phones',
  'no_inferred_private_contact_data',
  'unknown_stays_null_or_empty',
  'every_material_claim_requires_evidence'
])

export const parserFindingTypes = Object.freeze([
  'official_website',
  'company_name',
  'legal_name',
  'business_type',
  'market_role',
  'main_product',
  'target_application',
  'address',
  'public_contact',
  'person_role',
  'person_contact_linkage',
  'risk_flag',
  'ownership_signal',
  'compliance_signal'
])

export const parserSourceTypes = Object.freeze([
  'search_result',
  'local_result',
  'place_detail',
  'official_website_page',
  'official_website_contact_page',
  'third_party_directory_page',
  'provider_extract'
])
