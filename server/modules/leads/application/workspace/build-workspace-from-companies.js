import { industryProfiles } from '../../config/search-strategy.js'
import { dedupeStrings, normalizeKey, slugify, titleCase } from '../../shared/text-utils.js'
import { createWorkspaceSummary } from './workspace-summary.js'

function generateContact(company, role, roleIndex, workspace) {
  const contactSeed = slugify(`${company.name}-${role}`)
  const firstNames = ['Alex', 'Morgan', 'Taylor', 'Jordan', 'Casey', 'Riley']
  const lastNames = ['Chen', 'Miller', 'Garcia', 'Patel', 'Wang', 'Schmidt']
  const firstName = firstNames[(company.name.length + roleIndex) % firstNames.length]
  const lastName = lastNames[(company.segment.length + roleIndex) % lastNames.length]
  const domain = company.website.replace(/^https?:\/\//, '')

  return {
    id: `${workspace.id}-contact-${contactSeed}`,
    companyId: company.id,
    fullName: `${firstName} ${lastName}`,
    title: role,
    department: role.toLowerCase().includes('r&d') || role.toLowerCase().includes('engineering') ? 'Engineering' : 'Procurement',
    seniority: role.toLowerCase().includes('director') ? 'Director' : role.toLowerCase().includes('manager') ? 'Manager' : 'Lead',
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
    emailStatus: 'pattern-generated',
    linkedinUrl: `https://www.linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}-${contactSeed.slice(0, 6)}`,
    confidenceScore: Math.max(60, company.fitScore - roleIndex * 3),
    reason: `${role} is close to sourcing and qualification decisions for ${workspace.industry}.`
  }
}

function generateEmailDraft(workspace, company, contact, profile) {
  const hook = profile.emailAngles[0] || `support ${workspace.industry} sourcing`
  const keywordLine = workspace.keywords[0] ? `especially around ${workspace.keywords[0]}` : `for ${company.segment}`

  return {
    subject: `${company.name} and ${hook}`,
    preview: `Short note on supplier support for ${company.segment}.`,
    body: [
      `Hi ${contact.fullName.split(' ')[0]},`,
      '',
      `I am reaching out because ${company.name} is active in ${company.segment}${workspace.country ? ` across ${titleCase(workspace.country)}` : ''}, and that usually means ongoing sourcing work for critical electrical components ${keywordLine}.`,
      '',
      `We support teams like yours with ${workspace.industry.toLowerCase()} programs focused on ${hook}, with an emphasis on stable lead times, qualification support, and custom adaptation when a standard part is not enough.`,
      '',
      `Based on your role in ${contact.title}, I thought it may be useful to share a short capability summary and a few comparable connector projects relevant to ${company.segment}.`,
      '',
      'If this is relevant, I can send a concise overview with recommended product families and likely fit areas. If someone else owns this category, I would appreciate being pointed to the right person.',
      '',
      'Best regards,',
      '[Your Name]'
    ].join('\n')
  }
}

function enrichCompanyForCRM(company, workspace) {
  return {
    ...company,
    source: company.source || 'seeded-profile',
    sourceUrl: company.sourceUrl || company.website,
    businessType: company.businessType || 'Industrial Company',
    businessSummary: company.businessSummary || company.whyFit,
    mainProducts: company.mainProducts || [workspace.industry],
    targetApplications: company.targetApplications || [company.segment],
    possibleScaleSignal: company.possibleScaleSignal || company.size,
    contactEmails: company.contactEmails || [],
    contactPages: company.contactPages || [company.website],
    phone: company.phone || '',
    address: company.address || '',
    notes: company.notes || '',
    outreachNotes: company.outreachNotes || '',
    pipelineStatus: company.pipelineStatus || 'researching',
    customEmail: company.customEmail || '',
    customContactName: company.customContactName || '',
    customContactTitle: company.customContactTitle || '',
    customLinkedinUrl: company.customLinkedinUrl || '',
    customEmailStatus: company.customEmailStatus || 'not-found'
  }
}

export function buildWorkspaceFromCompanies({ industry, country = '', keywords = [] }, companies, selectedProfiles) {
  const workspaceId = `workspace-${Date.now()}`
  const normalizedKeywords = dedupeStrings(keywords.map((keyword) => keyword.trim()).filter(Boolean))
  const contacts = []
  const drafts = []

  const enrichedCompanies = companies.map((company) => enrichCompanyForCRM({
    ...company,
    id: company.id || `${workspaceId}-company-${slugify(company.name)}`
  }, { industry, country, keywords: normalizedKeywords }))

  enrichedCompanies.forEach((company) => {
    const companyProfile = selectedProfiles.find((item) => normalizeKey(item.label) === normalizeKey(company.profile))
    const fallbackProfile = selectedProfiles[0] || industryProfiles['industrial connectors']
    const profile = companyProfile || fallbackProfile

    ;(profile?.targetRoles || ['Procurement Manager', 'R&D Manager']).slice(0, 2).forEach((role, roleIndex) => {
      const contact = generateContact(company, role, roleIndex, { id: workspaceId, industry, country, keywords: normalizedKeywords })
      contacts.push(contact)

      if (roleIndex === 0) {
        drafts.push({
          id: `${contact.id}-draft`,
          workspaceId,
          companyId: company.id,
          contactId: contact.id,
          ...generateEmailDraft({ id: workspaceId, industry, country, keywords: normalizedKeywords }, company, contact, profile || industryProfiles['industrial connectors'])
        })
      }
    })
  })

  return {
    id: workspaceId,
    industry: titleCase(industry),
    country: country ? titleCase(country) : '',
    keywords: normalizedKeywords,
    createdAt: new Date().toISOString(),
    recommendedSegments: dedupeStrings(enrichedCompanies.map((company) => titleCase(company.segment))),
    providersUsed: [],
    companies: enrichedCompanies,
    contacts,
    drafts,
    summary: createWorkspaceSummary(enrichedCompanies, contacts, drafts)
  }
}
