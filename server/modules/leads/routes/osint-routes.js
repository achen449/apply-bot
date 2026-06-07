import express from 'express'

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function hasAtLeastOneSubjectClue(body = {}) {
  const clues = []

  if (Array.isArray(body.clues)) {
    clues.push(...body.clues)
  }
  if (Array.isArray(body.companyClues)) {
    clues.push(...body.companyClues)
  }
  if (Array.isArray(body.personClues)) {
    clues.push(...body.personClues)
  }

  return Boolean(
    normalizeString(body.companyName)
    || normalizeString(body.website)
    || normalizeString(body.address)
    || normalizeString(body.personName)
    || clues.some((value) => normalizeString(value))
  )
}

export function createLeadOsintRouter({ osintResearchService }) {
  const router = express.Router()

  router.post('/osint-research', async (req, res) => {
    try {
      if (!hasAtLeastOneSubjectClue(req.body)) {
        return res.status(400).json({
          error: 'At least one company name, website, address, person name, or clue is required.',
          code: 'invalid_osint_input'
        })
      }

      const result = await osintResearchService.research(req.body || {})
      res.json({ research: result })
    } catch (error) {
      console.error('Error running OSINT research:', error)
      res.status(500).json({
        error: 'Failed to run OSINT research',
        code: 'osint_research_failed'
      })
    }
  })

  return router
}
