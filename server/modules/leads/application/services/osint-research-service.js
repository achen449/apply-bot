function buildEvidenceRecord(provider, item, index) {
  return {
    evidenceId: `${provider}-evidence-${index + 1}`,
    provider,
    sourceType: provider === 'google-maps' ? 'map' : 'web',
    sourceUrl: item.url || '',
    title: item.title || '',
    snippet: item.snippet || item.address || '',
    address: item.address || '',
    phone: item.phone || '',
    website: item.website || item.url || '',
    placeId: item.placeId || item.googlePlaceId || '',
    queryLabel: item.queryLabel || '',
    trustTier: provider === 'google-maps' ? 'official-map' : 'public-web'
  }
}

function normalizeEntity(value) {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
    : ''
}

function websiteHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function evidenceMatchesSubject(item, companyName, website) {
  const expectedName = normalizeEntity(companyName)
  const observedName = normalizeEntity(item.title)
  const expectedHost = websiteHost(website)
  const observedHost = websiteHost(item.website || item.sourceUrl)
  return Boolean(
    (expectedName && observedName && (observedName.includes(expectedName) || expectedName.includes(observedName)))
      || (expectedHost && observedHost && expectedHost === observedHost)
  )
}

function createProviderAvailability(providerName, available, reason, queriesAttempted, resultCount) {
  return {
    provider: providerName,
    available,
    skipped: !available,
    reason: available ? null : reason || 'not_configured',
    queriesAttempted,
    resultCount
  }
}

function safeErrorReason(error, fallback = 'request_failed') {
  const code = typeof error?.code === 'string' ? error.code.trim() : ''
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  const value = code && !['request_failed', 'provider_error'].includes(code)
    ? code
    : message || code || fallback

  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').slice(0, 240)
}

export function createOsintResearchService({
  googleMapsSearch,
  braveSearch,
  tavilySearch,
  websiteContactEnrichment,
  parserFacade,
  providerAvailability = {}
} = {}) {
  return {
    async research(payload = {}) {
      const evidence = []
      const providerResults = []
      const availability = []
      const publicContacts = []
      const findings = []
      const riskFlags = []
      const unresolvedQuestions = []

      const companyName = payload.companyName || ''
      const website = payload.website ? (String(payload.website).startsWith('http') ? payload.website : `https://${payload.website}`) : ''
      const address = payload.address || ''
      const country = payload.country || ''
      const clues = Array.isArray(payload.clues) ? payload.clues : []

      if (providerAvailability.googleMaps !== false && typeof googleMapsSearch === 'function') {
        try {
          const results = await googleMapsSearch({ query: companyName, location: country, filters: { maxResults: 5 } })
          const normalizedResults = results?.results || results || []
          normalizedResults.forEach((item, index) => {
            evidence.push(buildEvidenceRecord('google-maps', item, index))
            providerResults.push({ provider: 'google-maps', resultType: 'map-result', normalized: { title: item.title, url: item.url, snippet: item.snippet } })
            if (item.phone && evidenceMatchesSubject(item, companyName, website)) {
              publicContacts.push({
                contactId: `contact-phone-${index + 1}`,
                contactType: 'public_phone',
                value: item.phone,
                ownerScope: 'company_level',
                verificationStatus: 'observed',
                evidenceRefs: [`google-maps-evidence-${index + 1}`]
              })
            }
          })
          availability.push(createProviderAvailability('google-maps', true, null, 1, normalizedResults.length))
        } catch (error) {
          const reason = safeErrorReason(error)
          availability.push(createProviderAvailability('google-maps', false, reason, 1, 0))
          unresolvedQuestions.push(`google-maps failed: ${reason}`)
        }
      } else {
        const reason = providerAvailability.googleMapsReason || 'missing_api_key'
        availability.push(createProviderAvailability('google-maps', false, reason, 0, 0))
        unresolvedQuestions.push(`google-maps was skipped: ${reason}`)
      }

      if (providerAvailability.brave !== false && typeof braveSearch === 'function') {
        try {
          const results = await braveSearch({ query: companyName, label: 'company' })
          ;(results || []).forEach((item, index) => {
            evidence.push(buildEvidenceRecord('brave', item, index))
            providerResults.push({ provider: 'brave', resultType: 'web-result', normalized: { title: item.title, url: item.url, snippet: item.snippet } })
          })
          availability.push(createProviderAvailability('brave', true, null, 1, (results || []).length))
        } catch (error) {
          const reason = safeErrorReason(error)
          availability.push(createProviderAvailability('brave', false, reason, 1, 0))
          unresolvedQuestions.push(`brave failed: ${reason}`)
        }
      } else {
        const reason = providerAvailability.braveReason || 'missing_api_key'
        availability.push(createProviderAvailability('brave', false, reason, 0, 0))
        unresolvedQuestions.push(`brave was skipped: ${reason}`)
      }

      if (providerAvailability.tavily !== false && typeof tavilySearch === 'function') {
        try {
          const results = await tavilySearch({ query: companyName, label: 'company' })
          ;(results || []).forEach((item, index) => {
            evidence.push(buildEvidenceRecord('tavily', item, index))
            providerResults.push({ provider: 'tavily', resultType: 'web-result', normalized: { title: item.title, url: item.url, snippet: item.snippet } })
          })
          availability.push(createProviderAvailability('tavily', true, null, 1, (results || []).length))
        } catch (error) {
          const reason = safeErrorReason(error)
          availability.push(createProviderAvailability('tavily', false, reason, 1, 0))
          unresolvedQuestions.push(`tavily failed: ${reason}`)
        }
      } else {
        const reason = providerAvailability.tavilyReason || 'missing_api_key'
        availability.push(createProviderAvailability('tavily', false, reason, 0, 0))
        unresolvedQuestions.push(`tavily was skipped: ${reason}`)
      }

      if (website && typeof websiteContactEnrichment === 'function') {
        try {
          const contact = await websiteContactEnrichment({ website })
          const contactEvidenceRefs = []
          for (const item of contact.evidence || []) {
            const evidenceId = `official-website-contact-${evidence.length + 1}`
            evidence.push({
              evidenceId,
              provider: 'official-website',
              sourceType: 'web',
              sourceUrl: item.sourceUrl || website,
              title: 'Official website public contact',
              snippet: item.value || '',
              queryLabel: 'contact-enrichment',
              trustTier: 'official-website'
            })
            contactEvidenceRefs.push({ value: item.value || '', evidenceId })
          }

          for (const item of contact.emails || []) {
            const evidenceRef = contactEvidenceRefs.find((entry) => entry.value === item.value)?.evidenceId || ''
            publicContacts.push({
              contactId: `contact-email-${publicContacts.length + 1}`,
              contactType: 'public_email',
              value: item.value,
              ownerScope: 'company_level',
              verificationStatus: 'observed',
              sourceUrl: item.sourceUrl || website,
              evidenceRefs: evidenceRef ? [evidenceRef] : []
            })
          }

          if (contact.phone) {
            const evidenceRef = contactEvidenceRefs.find((entry) => entry.value === contact.phone)?.evidenceId || ''
            publicContacts.push({
              contactId: `contact-phone-${publicContacts.length + 1}`,
              contactType: 'public_phone',
              value: contact.phone,
              ownerScope: 'company_level',
              verificationStatus: 'observed',
              sourceUrl: contact.contactPages?.[0] || website,
              evidenceRefs: evidenceRef ? [evidenceRef] : []
            })
          }

          availability.push(createProviderAvailability('official-website', contact.status !== 'unavailable', contact.status === 'unavailable' ? 'no_same_domain_contact_page' : null, contact.calls?.length || 0, (contact.emails || []).length + (contact.phone ? 1 : 0)))
          if (contact.status === 'no_public_email') {
            unresolvedQuestions.push('No public email was found on the official website.')
          } else if (contact.status === 'unavailable') {
            unresolvedQuestions.push('Official website contact enrichment was unavailable or redirected to another domain.')
          }
        } catch (error) {
          const reason = safeErrorReason(error, 'contact_enrichment_failed')
          availability.push(createProviderAvailability('official-website', false, reason, 1, 0))
          unresolvedQuestions.push(`official-website contact enrichment failed: ${reason}`)
        }
      }

      const providerEvidence = evidence.filter((item) => item.provider !== 'system')
      const entityEvidence = providerEvidence
        .filter((item) => item.provider !== 'official-website')
        .filter((item) => evidenceMatchesSubject(item, companyName, website))
      const websiteEvidence = providerEvidence.filter((item) => websiteHost(item.sourceUrl || item.website) === websiteHost(website))

      if (!evidence.length) {
        evidence.push({
          evidenceId: 'system-evidence-1',
          provider: 'system',
          sourceType: 'system',
          sourceUrl: '',
          title: 'No provider evidence collected',
          snippet: 'All external providers were unavailable for this run.',
          queryLabel: '',
          trustTier: 'system'
        })
      }

      if (entityEvidence.length > 0) {
        findings.push({
          findingId: 'finding-company-1',
          findingType: 'company_identity',
          label: 'Company identity observed',
          value: companyName,
          confidence: 0.7,
          verificationStatus: 'observed',
          subjectRef: `subject:${companyName.toLowerCase().replace(/\s+/g, '-')}`,
          evidenceRefs: entityEvidence.map((item) => item.evidenceId)
        })
      }

      if (website && websiteEvidence.length > 0) {
        findings.push({
          findingId: 'finding-website-1',
          findingType: 'official_website',
          label: 'Official website clue',
          value: website,
          confidence: 0.8,
          verificationStatus: 'observed',
          subjectRef: `subject:${companyName.toLowerCase().replace(/\s+/g, '-')}`,
          evidenceRefs: websiteEvidence.map((item) => item.evidenceId)
        })
      }

      if (clues.length > 0 && entityEvidence.length > 0) {
        findings.push({
          findingId: 'finding-clue-1',
          findingType: 'research_clue',
          label: 'User research clues',
          value: clues.join(', '),
          confidence: 0.6,
          verificationStatus: 'observed',
          subjectRef: `subject:${companyName.toLowerCase().replace(/\s+/g, '-')}`,
          evidenceRefs: entityEvidence.map((item) => item.evidenceId)
        })
      }

      const report = {
        schemaVersion: 'osint-report-v1',
        subjectRef: `subject:${companyName.toLowerCase().replace(/\s+/g, '-')}`,
        overview: {
          legalName: null,
          canonicalName: companyName,
          officialWebsite: website || null,
          headquartersAddressRef: address ? 'address-1' : null,
          businessType: null,
          marketRole: null,
          evidenceRefs: evidence.map((item) => item.evidenceId)
        },
        products: [],
        targetApplications: [],
        publicContacts,
        findings,
        riskFlags,
        unresolvedQuestions,
        evidenceRefs: evidence.map((item) => item.evidenceId)
      }

      const publicEmailValues = publicContacts
        .filter((contact) => contact.contactType === 'public_email')
        .map((contact) => contact.value)
      const publicPhone = publicContacts.find((contact) => contact.contactType === 'public_phone')?.value || ''

      let parser = {
        available: parserFacade?.available === true,
        used: false,
        reason: parserFacade?.parseCollectedEvidence ? 'parser_skipped' : 'parser_not_configured',
        error: null,
        contract: null
      }

      if (parser.available && typeof parserFacade.parseCollectedEvidence === 'function' && (providerAvailability.googleMaps === false || providerAvailability.brave === false || providerAvailability.tavily === false)) {
        try {
          const parsed = await parserFacade.parseCollectedEvidence({ evidence, payload, report, findings, publicContacts })
          if (JSON.stringify(parsed).toLowerCase().includes('guess')) {
            throw new Error('parser emitted guessed or inferred public contact data')
          }
          parser = {
            available: true,
            used: true,
            reason: null,
            error: null,
            contract: parsed
          }
        } catch (error) {
          parser = {
            available: true,
            used: false,
            reason: 'parser_failed',
            error: safeErrorReason(error, 'parser_failed'),
            contract: null
          }
        }
      }

      const mapEvidence = entityEvidence.filter((item) => item.provider === 'google-maps')
      const mapsAddressMatched = !address || mapEvidence.some((item) => {
        const expected = normalizeEntity(address)
        const observed = normalizeEntity(item.address || item.snippet)
        return expected && observed && (observed.includes(expected) || expected.includes(observed))
      })
      const mapsMatchStatus = mapEvidence.length > 0 && mapsAddressMatched ? 'partially_verified' : 'unverified'
      const hasProviderFailure = availability.some((entry) => !entry.available)
      const status = entityEvidence.length > 0
        ? (hasProviderFailure || parser.reason === 'parser_failed' || !parser.available ? 'partial' : 'completed')
        : 'needs_review'

      return {
        status,
        mode: payload.mode || 'company_due_diligence',
        subject: {
          companyName,
          website,
          country,
          address,
          phone: publicPhone,
          contactEmails: publicEmailValues,
          personName: '',
          personTitle: '',
          clues,
          subjectRef: `subject:${companyName.toLowerCase().replace(/\s+/g, '-')}`
        },
        compliance: {
          publicSourcesOnly: true,
          noGuessedEmails: true,
          noGuessedPhones: true,
          noInferredPrivateContactData: true,
          unknownStaysNullOrEmpty: true,
          everyMaterialClaimRequiresEvidence: true
        },
        providerAvailability: availability,
        providerResults,
        evidence,
        verification: {
          entityStatus: entityEvidence.length ? 'partially_verified' : 'unverified',
          officialWebsiteStatus: websiteEvidence.length ? 'partially_verified' : 'unverified',
          addressStatus: mapsAddressMatched && mapEvidence.length ? 'partially_verified' : 'unverified',
          publicContactStatus: publicContacts.length ? 'partially_verified' : 'unverified',
          mapsMatchStatus,
          researchStatus: status,
          resolverVersion: 'lead-osint-v1'
        },
        parser,
        report,
        findings,
        publicContacts,
        riskFlags,
        unresolvedQuestions,
        researchCase: {
          researchCaseId: `research-case-${Date.now()}`,
          caseType: payload.mode || 'company_due_diligence',
          subjectRefs: [`subject:${companyName.toLowerCase().replace(/\s+/g, '-')}`],
          findings: findings.map((finding) => finding.findingId),
          evidenceRefs: evidence.map((item) => item.evidenceId)
        }
      }
    }
  }
}
