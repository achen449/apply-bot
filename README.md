# Apply Bot

> Foreign-trade lead generation workspace for discovering, verifying, enriching, exporting, and syncing buyer prospects.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Issues](https://github.com/ZackHu-2001/apply-bot/issues) | [Deployment Security Guide](docs/github-vercel-gist-deployment.md)

---

## What this project does

This repository now focuses on foreign-trade lead generation rather than job-application automation.

It helps a sales or business-development operator:

- discover buyer candidates by industry, keyword, and country
- search local companies through Google Maps workflows
- verify company identity and address quality with Google Maps evidence
- run OSINT-style due diligence using Tavily, Brave, and Google Maps result paths
- find similar companies from a known benchmark account
- sync lightweight customer/lead JSON data through GitHub Gist
- export lead workspaces and customer data as real `.xlsx` workbooks for Excel handoff
- deploy the frontend + API to Vercel without exposing provider secrets to the browser

## Core workflows

### 1. Lead Finder

`Lead Finder` creates lead workspaces from industry + country + keyword input.

The workflow prefers provider-backed discovery when server-side credentials are available:

- `TAVILY_API_KEY`
- `BRAVE_API_KEY`
- `GOOGLE_MAPS_API_KEY`

If those providers are unavailable, the workflow falls back to deterministic seeded profiles so the UI still remains usable for demo and structure testing.

### 2. Google Maps discovery and verification

The Google Maps pages support:

- local company search
- single-company verification
- batch verification from pasted CSV-style rows
- address classification for commercial-vs-residential screening

These flows depend on server-side `GOOGLE_MAPS_API_KEY` only.

### 3. Similar-company and OSINT enrichment

The app can:

- find similar companies from a benchmark account via Tavily-backed search
- run evidence-based company OSINT research
- preserve provider/source metadata for manual review and outreach preparation

### 4. Gist sync and Excel export

The app can:

- read/write customer data through GitHub Gist
- keep lead workspaces inside the synchronized JSON document
- export either a single lead workspace or the customer-data document as `.xlsx`

## Requirements

- Node.js 21+
- npm
- Optional server-side provider credentials for live research:
  - `TAVILY_API_KEY`
  - `BRAVE_API_KEY`
  - `GOOGLE_MAPS_API_KEY`
  - `GIST_ID`
  - `GITHUB_GIST_TOKEN`

## Quick start

```bash
npm install
npm run start
```

Frontend runs through Vite and the backend runs through `server.js`.

For deployment and secret-handling rules, read:

- `docs/github-vercel-gist-deployment.md`
- `.env.example`
- `vercel.json`

## Validation and export expectations

Business-ready use in production assumes:

- server-side provider env vars are configured correctly
- missing-env failures stay secret-safe and actionable
- Gist credentials point to the intended JSON document
- exported workbooks open as real Excel files, not renamed CSV files

## Tech stack

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Express.js
- **Persistence**: local JSON files plus optional GitHub Gist sync
- **Export**: `xlsx`
- **Deployment target**: Vercel serverless API + static frontend build

## Repo notes

There are still legacy job-application files and data structures elsewhere in the repository, but the lead-generation pages and `/api/*` routes described above are the current business-facing workflow under validation.

## License

MIT - see [LICENSE](LICENSE)

