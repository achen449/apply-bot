# Lead Generation Repair Plan

## Scope

This repair plan addresses four user goals:

1. Clarify the lead-generation requirements
2. Assess whether the current architecture fits those requirements
3. Define acceptance steps
4. Repair the implementation and ship it

## Repair Strategy

### Phase 1: Reconnect the live API entry

- Remove hard-disabled lead workflow placeholders from the live API path.
- Mount real lead services for:
  - similar-company
  - lead-finder
  - osint
  - address classification
  - Google Maps search/verification
  - research runs / usage stats

### Phase 2: Restore structural consistency

- Add the missing `application/*` compatibility modules referenced by the tests.
- Ensure runtime and tests point to the same behavior.

### Phase 3: Surface prompts and AI search strategy

- Return rendered prompt and AI-generated search/verification queries in response metadata.
- Record those runs in persistent storage when Gist is configured.
- Make the Research Runs view display those records.

### Phase 4: Align the frontend

- Remove route-family drift.
- Ensure each UI screen calls the canonical API route.
- Update result panels to show:
  - prompt key / rendered prompt summary
  - AI-generated search keywords
  - provider evidence
  - verification status

## Acceptance Steps

### Similar company workflow

1. Open `/similar-companies`
2. Submit a sample company
3. Confirm the response returns live results instead of `lead_feature_unavailable`
4. Confirm the response includes visible evidence and verification status
5. Confirm the rendered prompt or prompt source is inspectable

### Lead finder workflow

1. Open `/lead-finder`
2. Submit an industry/product/country request
3. Confirm the returned payload includes AI-generated query templates
4. Confirm the UI shows those generated queries
5. Confirm returned candidates are buyer-oriented and not only peer suppliers

### Google Maps verification workflow

1. Open `/google-maps-verify`
2. Run single verification
3. Run batch verification
4. Confirm both return live results and export works

### Google Maps search workflow

1. Open `/google-maps-search`
2. Run a query with a location
3. Confirm results include address, phone, website, status, types, and export output

### Prompt management

1. Open `/prompts`
2. Load a prompt
3. Save a prompt update
4. Confirm it persists through the backend

### Research run persistence

1. Run at least one AI workflow
2. Open the Research Runs view
3. Confirm the recorded run is visible with query/prompt context

### Quality gates

1. `npm run test:leads`
2. `node --test test/lead-support-routes.test.js`
3. `npm run build`

## Current Baseline Before Repair

- `npm run build`: passes
- `npm run test:leads`: fails because referenced compatibility modules are missing
- `node --test test/lead-support-routes.test.js`: fails for the same reason
