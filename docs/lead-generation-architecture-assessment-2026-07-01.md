# Lead Generation Architecture Assessment

## Current State Summary

The repository currently contains two partially overlapping lead-generation implementations:

- A legacy monolithic API entry in `server/api-routes.js`
- A newer modular lead stack in `server/modules/leads/routes/*` and `server/modules/leads/services/*`

The Vercel entrypoint still routes through the legacy stack:

- `vercel.json` rewrites `/api/:path*` to `/api/server`
- `api/server.js` imports `../server.js`
- `server.js` mounts `./server/api-routes.js`

## Key Misalignments

### 1. Live entrypoint still serves disabled lead routes

The live API entry contains hard-coded `501 lead_feature_unavailable` responses for:

- Similar company search
- OSINT research
- Research runs
- Provider usage
- Address classification
- Multiple Google Maps verification flows

This directly explains the current user-visible failures.

### 2. Implemented services are not the live source of truth

The modular routes and services exist but are not mounted by the production server entry. That creates a split between:

- "code that exists"
- "code that Vercel actually executes"

### 3. Tests and implementation paths drifted apart

The test suite references `server/modules/leads/application/*` modules that do not exist in the current tree, while the actual implementation lives under `server/modules/leads/services/*`.

Result:

- `npm run build` passes
- lead-generation tests do not run
- current test failures are structural, not only behavioral

### 4. Frontend calls mixed route families

The frontend currently mixes:

- `/api/lead-finder`
- `/api/similar-company`
- `/api/companies/find-similar`
- `/api/lead-workspaces/osint-research`

This increases the chance that a visible page is calling a disabled or stale backend route.

### 5. Result visibility is incomplete

Prompt editing exists, but the result pages do not yet consistently surface:

- rendered prompt used for a run
- AI-generated search queries/keywords
- recorded research run details across all workflows

## Assessment

The current architecture does not fully satisfy the requested product behavior.

It is salvageable without a full rewrite because:

- The provider adapters already exist.
- The AI agent already supports tool calls and tool-call metadata.
- Prompt persistence already exists through Gist.
- Several frontend pages already align with the intended workflows.

## Required Architectural Direction

The project should converge on one lead workflow backend:

- Keep `server.js` and the Vercel entrypoint.
- Replace the legacy disabled lead handlers with mounted modular services or equivalent real implementations.
- Use one storage path for prompts, research runs, and customer data.
- Expose rendered prompt + generated queries in result payloads.

That direction is sufficient to satisfy the current user request without introducing a third architecture.
