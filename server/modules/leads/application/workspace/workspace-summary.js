import { dedupeStrings } from '../../shared/text-utils.js'

export function createWorkspaceSummary(companies, contacts, drafts) {
  return {
    companyCount: companies.length,
    contactCount: contacts.length,
    draftCount: drafts.length,
    topProfiles: dedupeStrings(companies.map((company) => company.profile)).slice(0, 4)
  }
}
