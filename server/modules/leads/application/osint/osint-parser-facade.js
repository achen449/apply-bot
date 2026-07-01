export function createOsintParserFacade(overrides = {}) {
  return {
    available: Boolean(overrides.parseCollectedEvidence),
    async parseCollectedEvidence(...args) {
      if (typeof overrides.parseCollectedEvidence === 'function') {
        return overrides.parseCollectedEvidence(...args)
      }

      return null
    }
  }
}
