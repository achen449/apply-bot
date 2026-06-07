export interface LeadCompany {
  id: string
  name: string
  website: string
  country: string
  segment: string
  profile: string
  size: string
  fitScore: number
  signals: string[]
  whyFit: string
  priority: string
  source?: string
  sourceUrl?: string
  businessType?: string
  marketRole?: string
  businessSummary?: string
  buyingRelevance?: string
  mainProducts?: string[]
  targetApplications?: string[]
  possibleScaleSignal?: string
  scaleSignals?: string[]
  employeeEstimate?: string
  foundedYear?: string
  headquarters?: string
  officialWebsiteLikely?: boolean
  matchedQueryCount?: number
  matchedProviders?: string[]
  matchedQueryLabels?: string[]
  contactEmails?: string[]
  contactPages?: string[]
  phone?: string
  address?: string
  notes?: string
  outreachNotes?: string
  pipelineStatus?: string
  customEmail?: string
  customContactName?: string
  customContactTitle?: string
  customLinkedinUrl?: string
  customEmailStatus?: string
}

export interface LeadContact {
  id: string
  companyId: string
  fullName: string
  title: string
  department: string
  seniority: string
  email: string
  emailStatus: string
  linkedinUrl: string
  confidenceScore: number
  reason: string
}

export interface LeadDraft {
  id: string
  workspaceId: string
  companyId: string
  contactId: string
  subject: string
  preview: string
  body: string
}

export interface LeadWorkspaceSummary {
  companyCount: number
  contactCount: number
  draftCount: number
  topProfiles: string[]
}

export interface LeadSearchStrategy {
  targetTypes: string[]
  excludeTypes: string[]
  queryTemplates: string[]
  queryCount: number
  evidenceMode?: string
}

export interface LeadWorkspace {
  id: string
  industry: string
  country: string
  keywords: string[]
  createdAt: string
  recommendedSegments: string[]
  providersUsed?: string[]
  searchStrategy?: LeadSearchStrategy
  companies: LeadCompany[]
  contacts: LeadContact[]
  drafts: LeadDraft[]
  summary: LeadWorkspaceSummary
}

export interface LeadDiscoveryPayload {
  industry: string
  country: string
  keywords: string[]
  targetTypes?: string[]
  excludeTypes?: string[]
}

export interface LeadCompanyOsintResearchPayload {
  mode?: 'company_due_diligence' | 'person_contact_deep_dive'
  companyName?: string
  website?: string
  country?: string
  address?: string
  personName?: string
  personTitle?: string
  clues?: string[]
  researchQuestions?: string[]
}

export interface LeadCompanyOsintProviderAvailability {
  provider: string
  available: boolean
  skipped: boolean
  reason: string | null
  queriesAttempted: number
  resultCount: number
}

export interface LeadCompanyOsintProviderResult {
  provider: string
  resultType: string
  providerResultId?: string
  normalized?: {
    title?: string
    url?: string
    snippet?: string
  }
}

export interface LeadCompanyOsintEvidenceRecord {
  evidenceId: string
  provider: string
  sourceType: string
  sourceUrl: string
  title: string
  snippet: string
  queryLabel?: string
  trustTier?: string
}

export interface LeadCompanyOsintVerification {
  entityStatus: string
  officialWebsiteStatus: string
  addressStatus: string
  publicContactStatus: string
  mapsMatchStatus: string
  researchStatus: string
  resolverVersion: string
  notes?: string
}

export interface LeadCompanyOsintParserInfo {
  available: boolean
  used: boolean
  reason: string | null
  error: string | null
  contract: unknown
}

export interface LeadCompanyOsintFinding {
  findingId?: string
  findingType: string
  label: string
  value: string
  confidence?: number
  verificationStatus: string
  subjectRef?: string
  evidenceRefs: string[]
}

export interface LeadCompanyOsintPublicContact {
  contactId: string
  contactType: string
  value: string
  ownerScope: string
  verificationStatus: string
  label?: string
  sourceType?: string
  confidenceScore?: number
  evidenceRefs: string[]
}

export interface LeadCompanyOsintRiskFlag {
  label: string
  severity: string
  evidenceRefs: string[]
}

export interface LeadCompanyOsintReportOverview {
  legalName: string | null
  canonicalName: string | null
  officialWebsite: string | null
  headquartersAddressRef: string | null
  businessType: string | null
  marketRole: string | null
  evidenceRefs: string[]
}

export interface LeadCompanyOsintReportProduct {
  name: string
  category: string
  evidenceRefs: string[]
}

export interface LeadCompanyOsintReport {
  schemaVersion: string
  subjectRef: string
  overview: LeadCompanyOsintReportOverview
  products: LeadCompanyOsintReportProduct[]
  targetApplications: LeadCompanyOsintReportProduct[]
  publicContacts: LeadCompanyOsintPublicContact[]
  findings: LeadCompanyOsintFinding[]
  riskFlags: LeadCompanyOsintRiskFlag[]
  unresolvedQuestions: string[]
  evidenceRefs: string[]
}

export interface LeadCompanyOsintResearchCase {
  caseType: string
  status: string
  subjectRefs: string[]
  researchQuestions: string[]
  riskFlags: string[]
  publicContactRefs: string[]
  evidenceRefs: string[]
  conclusions: {
    status: string
    summary: {
      entityName: string | null
      officialWebsiteStatus: string
      publicContactStatus: string
      confidence: number
    }
    parserUsed: boolean
  }
}

export interface LeadCompanyOsintCompliance {
  publicSourcesOnly: boolean
  noGuessedEmails: boolean
  noGuessedPhones: boolean
  noInferredPrivateContactData: boolean
  unknownStaysNullOrEmpty: boolean
  everyMaterialClaimRequiresEvidence: boolean
}

export interface LeadCompanyOsintResearch {
  mode: 'company_due_diligence' | 'person_contact_deep_dive'
  status: string
  subject: {
    companyName: string
    website: string
    country: string
    address: string
    personName: string
    personTitle: string
    clues: string[]
    subjectRef: string
  }
  compliance: LeadCompanyOsintCompliance
  providerAvailability: LeadCompanyOsintProviderAvailability[]
  providerResults: LeadCompanyOsintProviderResult[]
  evidence: LeadCompanyOsintEvidenceRecord[]
  verification: LeadCompanyOsintVerification
  parser: LeadCompanyOsintParserInfo
  report: LeadCompanyOsintReport
  findings: LeadCompanyOsintFinding[]
  publicContacts: LeadCompanyOsintPublicContact[]
  riskFlags: LeadCompanyOsintRiskFlag[]
  unresolvedQuestions: string[]
  researchCase: LeadCompanyOsintResearchCase
}

export interface CustomerDataDocument {
  customers?: unknown[]
  leads?: unknown[]
  leadWorkspaces?: LeadWorkspace[]
  lastSyncedAt?: string
  lastSyncSource?: string
  [key: string]: unknown
}

export interface CustomerDataResponse {
  success: boolean
  configured: boolean
  storage: string
  gistId: string
  fileName: string
  exists: boolean
  updatedAt: string | null
  data: CustomerDataDocument
}
