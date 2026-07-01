function buildEvidenceRecord(provider, item, index) {
  return {
    evidenceId: `${provider}-evidence-${index + 1}`,
    provider,
    sourceType: provider === 'google-maps' ? 'map' : 'web',
    sourceUrl: item.url || '',
    title: item.title || '',
    snippet: item.snippet || item.address || '',
    queryLabel: item.queryLabel || '',
    trustTier: provider === 'google-maps' ? 'official-map' : 'public-web'
  }
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

export function createOsintResearchService({
  googleMapsSearch,
  braveSearch,
  tavilySearch,
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
        const results = await googleMapsSearch({ query: companyName, location: country, filters: { maxResults: 5 } })
        const normalizedResults = results?.results || results || []
        normalizedResults.forEach((item, index) => {
          evidence.push(buildEvidenceRecord('google-maps', item, index))
          providerResults.push({ provider: 'google-maps', resultType: 'map-result', normalized: { title: item.title, url: item.url, snippet: item.snippet } })
          if (item.phone) {
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
      } else {
        const reason = providerAvailability.googleMapsReason || 'missing_api_key'
        availability.push(createProviderAvailability('google-maps', false, reason, 0, 0))
        unresolvedQuestions.push(`google-maps was skipped: ${reason}`)
      }

      if (providerAvailability.brave !== false && typeof braveSearch === 'function') {
        const results = await braveSearch({ query: companyName, label: 'company' })
        ;(results || []).forEach((item, index) => {
          evidence.push(buildEvidenceRecord('brave', item, index))
          providerResults.push({ provider: 'brave', resultType: 'web-result', normalized: { title: item.title, url: item.url, snippet: item.snippet } })
        })
        availability.push(createProviderAvailability('brave', true, null, 1, (results || []).length))
      } else {
        const reason = providerAvailability.braveReason || 'missing_api_key'
        availability.push(createProviderAvailability('brave', false, reason, 0, 0))
        unresolvedQuestions.push(`brave was skipped: ${reason}`)
      }

      if (providerAvailability.tavily !== false && typeof tavilySearch === 'function') {
        const results = await tavilySearch({ query: companyName, label: 'company' })
        ;(results || []).forEach((item, index) => {
          evidence.push(buildEvidenceRecord('tavily', item, index))
          providerResults.push({ provider: 'tavily', resultType: 'web-result', normalized: { title: item.title, url: item.url, snippet: item.snippet } })
        })
        availability.push(createProviderAvailability('tavily', true, null, 1, (results || []).length))
      } else {
        const reason = providerAvailability.tavilyReason || 'missing_api_key'
        availability.push(createProviderAvailability('tavily', false, reason, 0, 0))
        unresolvedQuestions.push(`tavily was skipped: ${reason}`)
      }

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

      findings.push({
        findingId: 'finding-company-1',
        findingType: 'company_identity',
        label: 'Company identity observed',
        value: companyName,
        confidence: 0.7,
        verificationStatus: 'observed',
        subjectRef: `subject:${companyName.toLowerCase().replace(/\s+/g, '-')}`,
        evidenceRefs: [evidence[0].evidenceId]
      })

      if (website) {
        findings.push({
          findingId: 'finding-website-1',
          findingType: 'official_website',
          label: 'Official website clue',
          value: website,
          confidence: 0.8,
          verificationStatus: 'observed',
          subjectRef: `subject:${companyName.toLowerCase().replace(/\s+/g, '-')}`,
          evidenceRefs: [evidence[0].evidenceId]
        })
      }

      if (clues.length > 0) {
        findings.push({
          findingId: 'finding-clue-1',
          findingType: 'research_clue',
          label: 'User research clues',
          value: clues.join(', '),
          confidence: 0.6,
          verificationStatus: 'observed',
          subjectRef: `subject:${companyName.toLowerCase().replace(/\s+/g, '-')}`,
          evidenceRefs: [evidence[0].evidenceId]
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

      let parser = {
        available: Boolean(parserFacade?.available || parserFacade?.parseCollectedEvidence),
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
            error: error.message,
            contract: null
          }
        }
      }

      const allProvidersAvailable = availability.every((entry) => entry.available)
      const status = allProvidersAvailable || parser.reason === 'parser_failed' ? 'partial' : 'needs_review'

      return {
        status,
        mode: payload.mode || 'company_due_diligence',
        subject: {
          companyName,
          website,
          country,
          address,
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
          entityStatus: evidence.length ? 'partially_verified' : 'unverified',
          officialWebsiteStatus: website ? 'partially_verified' : 'unverified',
          addressStatus: address ? 'partially_verified' : 'unverified',
          publicContactStatus: publicContacts.length ? 'partially_verified' : 'unverified',
          mapsMatchStatus: availability.find((item) => item.provider === 'google-maps')?.available ? 'partially_verified' : 'unverified',
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
