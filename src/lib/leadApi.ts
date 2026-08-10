import type {
  CustomerDataDocument,
  CustomerDataResponse,
  LeadCompany,
  LeadCompanyOsintResearch,
  LeadCompanyOsintResearchPayload,
  LeadDiscoveryPayload,
  LeadWorkspace
} from '@/types/leads'

interface ApiErrorPayload {
  error?: string
  code?: string
  missingEnvVars?: string[]
}

function buildMissingEnvMessage(message: string, missingEnvVars: string[]) {
  if (!missingEnvVars.length) {
    return message
  }

  return `${message} Set ${missingEnvVars.join(', ')} in Vercel or your local server env and try again.`
}

async function readApiError(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null) as ApiErrorPayload | null
  const message = payload?.error || fallbackMessage

  if (payload?.code === 'missing_env') {
    return buildMissingEnvMessage(message, payload.missingEnvVars || [])
  }

  if (payload?.code === 'gist_request_failed' || payload?.code === 'gist_update_failed') {
    return 'GitHub Gist storage is unavailable right now. Check the Gist token, Gist ID, and server deployment settings.'
  }

  if (payload?.code === 'invalid_gist_json') {
    return 'The configured Gist file does not contain valid JSON. Replace it with valid customer data JSON and try again.'
  }

  return message
}

async function requestJson<T>(input: RequestInfo | URL, init: RequestInit | undefined, fallbackMessage: string): Promise<T> {
  const response = await fetch(input, init)

  if (!response.ok) {
    throw new Error(await readApiError(response, fallbackMessage))
  }

  return response.json() as Promise<T>
}

export async function fetchLeadWorkspaces(): Promise<LeadWorkspace[]> {
  const data = await requestJson<{ workspaces?: LeadWorkspace[] }>('/api/lead-workspaces', undefined, 'Failed to load workspaces')
  return data.workspaces ?? []
}

export async function createLeadWorkspace(payload: LeadDiscoveryPayload): Promise<LeadWorkspace> {
  const data = await requestJson<{ workspace: LeadWorkspace }>('/api/lead-workspaces/discover', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, 'Failed to create workspace')
  return data.workspace
}

export async function updateLeadCompany(workspaceId: string, companyId: string, payload: Partial<LeadCompany>): Promise<LeadCompany> {
  const data = await requestJson<{ company: LeadCompany }>(`/api/lead-workspaces/${workspaceId}/company/${companyId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, 'Failed to update company')
  return data.company
}

export async function runLeadCompanyOsintResearch(payload: LeadCompanyOsintResearchPayload): Promise<LeadCompanyOsintResearch> {
  const data = await requestJson<{ research: LeadCompanyOsintResearch }>('/api/lead-workspaces/osint-research', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, 'Failed to run OSINT research')
  return data.research
}

export function getLeadWorkspaceExportUrl(workspaceId: string) {
  return `/api/lead-workspaces/${workspaceId}/export.xlsx`
}

export function getCustomerDataExportUrl() {
  return '/api/customer-data/export.xlsx'
}

export interface GoogleMapsGeoPoint {
  lat: number
  lng: number
}

export interface GoogleMapsMatch {
  provider: string
  sourceUrl: string
  query: string
  queryLabel: string
  name: string
  address: string
  phone: string
  website: string
  rating: number
  reviewCount: number
  businessStatus: string
  primaryType: string
  types: string[]
  placeId: string
  location: GoogleMapsGeoPoint | null
}

export interface GoogleMapsVerificationResult {
  verified: boolean
  match: GoogleMapsMatch | null
  message?: string
}

export async function verifyCompanyWithGoogleMaps(companyName: string, address: string): Promise<GoogleMapsVerificationResult> {
  return requestJson<GoogleMapsVerificationResult>('/api/lead-workspaces/verify-google-maps', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ companyName, address })
  }, 'Failed to verify company')
}

export interface BatchVerificationInput {
  name: string
  address?: string
}

export interface BatchVerificationResult {
  input: BatchVerificationInput
  verified: boolean
  match: GoogleMapsMatch | null
  message?: string
  error?: string
}

export async function batchVerifyCompaniesWithGoogleMaps(companies: BatchVerificationInput[]): Promise<{ results: BatchVerificationResult[] }> {
  return requestJson<{ results: BatchVerificationResult[] }>('/api/lead-workspaces/batch-verify-csv', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ companies })
  }, 'Failed to batch verify companies')
}

export interface GoogleMapsSearchFilters {
  minRating?: number
  requireWebsite?: boolean
  requirePhone?: boolean
  requireOperational?: boolean
  maxResults?: number
  includeEmails?: boolean
}

export interface GoogleMapsSearchPayload {
  query: string
  location?: string
  filters?: GoogleMapsSearchFilters
}

export interface GoogleMapsPlace {
  provider: string
  query: string
  queryLabel: string
  capturedAt: string
  title: string
  url: string
  snippet: string
  rawContent: string
  address: string
  phone: string
  googlePlaceId: string
  googleRating: number
  googleReviewCount: number
  googleBusinessStatus: string
  googleTypes: string[]
  googlePrimaryType: string
  geo: GoogleMapsGeoPoint | null
  emails?: string[]
  emailDetails?: Array<{ value: string; type?: string; sourceUrl?: string; observedAt?: string }>
  contactPages?: string[]
  contactEmailStatus?: string
  evidence?: Array<{ type?: string; sourceUrl?: string; value?: string; observedAt?: string }>
}

export interface GoogleMapsSearchResult {
  query: string
  count: number
  results: GoogleMapsPlace[]
}

export async function searchGoogleMaps(payload: GoogleMapsSearchPayload): Promise<GoogleMapsSearchResult> {
  return requestJson<GoogleMapsSearchResult>('/api/google-maps/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, 'Failed to search Google Maps')
}

export interface AddressClassificationInput {
  name: string
  address: string
}

export interface AddressClassificationPlaceDetails {
  name: string
  address: string
  phone: string
  website: string
  types: string[]
  businessStatus: string
  rating: number
}

export interface AddressClassificationResult {
  input: AddressClassificationInput
  result: {
    classification: string
    confidence: number
    placeDetails: AddressClassificationPlaceDetails | null
    reason: string
  }
}

export async function classifyAddresses(addresses: AddressClassificationInput[]): Promise<{ results: AddressClassificationResult[] }> {
  return requestJson<{ results: AddressClassificationResult[] }>('/api/addresses/batch-classify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ addresses })
  }, 'Failed to classify addresses')
}

export interface SimilarCompanyInput {
  name: string
  website?: string
  industry?: string
  description?: string
}

export interface SimilarCompanyResult {
  company: {
    title: string
    url: string
    snippet: string
    provider?: string
    query?: string
    queryLabel?: string
    capturedAt?: string
  }
  profile: {
    name: string
    website: string
    keywords: string[]
    rawProfile: string
  }
  similarity: number
  scores?: {
    total?: number
    business?: number
    market?: number
    scale?: number
  }
  verified?: boolean
  mapVerified?: boolean
  map?: {
    verified?: boolean
    placeId?: string
    confidence?: number
    sourceUrl?: string
    businessStatus?: string
  } | null
  address?: string
  phone?: string
  companySize?: string
  companySizeSource?: string
  employeeCount?: string
  employeeRange?: string
  scaleSignals?: string[]
  headquarters?: string
  industry?: string
  products?: string[]
  contactEmails?: string[]
  contactPages?: string[]
  evidence?: Array<{
    type?: string
    sourceUrl?: string
    title?: string
    snippet?: string
    value?: string
  }>
  dataQuality?: {
    hasOfficialWebsite?: boolean
    hasMapEvidence?: boolean
    hasPublicPhone?: boolean
    hasPublicEmail?: boolean
    hasCompanySize?: boolean
    hasScaleSignals?: boolean
    identityStatus?: 'map_verified' | 'official_website' | 'unverified' | string
    mapStatus?: 'verified' | 'candidate_found' | 'not_found' | 'unavailable' | string
    contactStatus?: 'available' | 'not_found' | string
    missingFields?: string[]
    needsReview?: boolean
  } | null
}

export interface SimilarCompanyResponse {
  success?: boolean
  configured?: boolean
  status?: string
  partial?: boolean
  runId?: string | null
  recommendations?: SimilarCompanyResult[]
  results: SimilarCompanyResult[]
  metadata?: {
    prompt?: {
      key?: string
      rendered?: string
    }
    searchCalls?: Array<{
      provider?: string
      query?: string
      ok?: boolean
      resultCount?: number
    }>
    verificationCalls?: Array<{
      companyName?: string
      address?: string
      ok?: boolean
      verified?: boolean
      confidence?: number
    }>
    finalText?: string
    parsedJson?: unknown
    iterations?: number
    resultPolicy?: {
      requestedCount?: number
      candidatePoolTarget?: number
      minimumQualifiedResults?: number
      displayPolicy?: string
      verificationTarget?: number
      displayedCount?: number
      enrichedCount?: number
    }
  }
  error?: string | Record<string, unknown> | null
}

export async function findSimilarCompanies(company: SimilarCompanyInput, topN = 10): Promise<SimilarCompanyResponse> {
  return requestJson<SimilarCompanyResponse>('/api/companies/find-similar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ company, topN })
  }, 'Failed to find similar companies')
}

export interface ResearchRunRecord {
  id: string
  workflow?: string
  part?: string
  status?: 'completed' | 'partial' | 'needs_review' | 'failed' | string
  title?: string
  createdAt?: string
  expiresAt?: string
  prompt?: {
    key?: string
    rendered?: string
  } | null
  searchCalls?: Array<{
    provider?: string
    query?: string
    ok?: boolean
    resultCount?: number
    error?: string | Record<string, unknown> | null
  }>
  verificationCalls?: Array<{
    companyName?: string
    address?: string
    ok?: boolean
    verified?: boolean
    confidence?: number
    candidate?: Record<string, unknown> | null
    candidates?: Array<Record<string, unknown>>
    error?: string | Record<string, unknown> | null
  }>
  enrichmentCalls?: Array<{
    companyName?: string
    website?: string
    status?: string
    emailCount?: number
    contactPages?: string[]
    calls?: Array<Record<string, unknown>>
  }>
  workspace?: LeadWorkspace
  sampleCompany?: SimilarCompanyInput
  queryInput?: Record<string, unknown>
  parts?: Array<{
    id?: string
    workflow?: string
    part?: string
    status?: string
    title?: string
    prompt?: { key?: string; rendered?: string } | null
    buyerQueries?: string[]
    searchCalls?: Array<Record<string, unknown>>
    verificationCalls?: Array<Record<string, unknown>>
    enrichmentCalls?: Array<Record<string, unknown>>
    results?: unknown[]
    evidence?: unknown[]
    report?: Record<string, unknown>
    publicContacts?: unknown[]
    unresolvedQuestions?: string[]
    [key: string]: unknown
  }>
  results?: unknown[]
  errors?: Array<string | Record<string, unknown>>
}

export async function fetchResearchRuns(filters: { workflow?: string; status?: string; query?: string } = {}): Promise<ResearchRunRecord[]> {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })
  const query = params.toString()
  const data = await requestJson<{ runs?: ResearchRunRecord[] }>(`/api/research-runs${query ? `?${query}` : ''}`, undefined, 'Failed to load research runs')
  return data.runs ?? []
}

export async function fetchCustomerData(): Promise<CustomerDataResponse> {
  return requestJson<CustomerDataResponse>('/api/customer-data', undefined, 'Failed to load customer data')
}

export async function saveCustomerData(data: CustomerDataDocument): Promise<CustomerDataResponse> {
  return requestJson<CustomerDataResponse>('/api/customer-data', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ data })
  }, 'Failed to save customer data')
}
