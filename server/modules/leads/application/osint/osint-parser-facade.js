import {
  createOsintParserInput,
  getDefaultOsintParserContract,
  validateOsintParserOutput
} from '../../domain/osint/index.js'

export function createOsintParserFacade({ parseCollectedEvidence } = {}) {
  const contract = getDefaultOsintParserContract()

  return {
    getContract() {
      return contract
    },

    async parse(input) {
      if (typeof parseCollectedEvidence !== 'function') {
        return {
          available: false,
          used: false,
          reason: 'parser_not_configured',
          output: null
        }
      }

      try {
        const parserInput = createOsintParserInput(input)
        const rawOutput = await parseCollectedEvidence(parserInput)

        return {
          available: true,
          used: true,
          reason: null,
          output: validateOsintParserOutput(rawOutput)
        }
      } catch (error) {
        return {
          available: true,
          used: false,
          reason: 'parser_failed',
          error: error instanceof Error ? error.message : String(error),
          output: null
        }
      }
    }
  }
}
