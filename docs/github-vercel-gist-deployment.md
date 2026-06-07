# GitHub + Vercel + Gist Deployment Security Guide

## 1. What this deployment path does

This repository is designed to use GitHub for source control, Vercel for frontend hosting and serverless API execution, and GitHub Gist for lightweight customer/lead JSON storage.

The secure deployment model is:

1. Source code lives in GitHub.
2. Vercel builds the frontend from GitHub.
3. Real secrets live only in local development env files or Vercel Environment Variables.
4. Server-side `/api/*` routes read provider and Gist secrets from runtime environment variables.
5. GitHub Gist stores lightweight customer/lead JSON data, not secrets.

The most important rule never changes: do not commit real API keys, tokens, or sensitive customer data to GitHub.

## 2. Runtime environment contract

The server currently reads these environment variables:

- `TAVILY_API_KEY`
- `BRAVE_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `GIST_ID`
- `GITHUB_GIST_TOKEN`
- `GIST_CUSTOMER_DATA_FILENAME`

These values are loaded by `server/config/env.js` and used by `server.js`.

### Required vs optional

- `TAVILY_API_KEY` is required for Tavily-backed lead research routes.
- `BRAVE_API_KEY` is required when Brave-backed search routes are used.
- `GOOGLE_MAPS_API_KEY` is required for address classification, verification, and map search routes.
- `GIST_ID` is required for gist-backed customer data storage.
- `GITHUB_GIST_TOKEN` is required for gist-backed customer data storage.
- `GIST_CUSTOMER_DATA_FILENAME` is optional. If you do not set it, the runtime defaults to `customer-data.json`.

That optional behavior is part of the current runtime contract and should match your Vercel configuration and any operational docs.

## 3. Public API behavior when env vars are missing

The server is designed to fail safely when required environment variables are missing.

Current behavior:

- Routes that need missing secrets return HTTP `503`.
- Error payloads use `code: "missing_env"`.
- Responses list only missing variable names such as `missingEnvVars`.
- Responses do not expose secret values.
- `GIST_CUSTOMER_DATA_FILENAME` being absent does not count as a missing required env var because the runtime falls back to `customer-data.json`.

Relevant routes already covered by tests include:

- `POST /api/addresses/batch-classify`
- `POST /api/companies/find-similar`
- `GET /api/customer-data`
- `PUT /api/customer-data`

## 4. Safe committed env template

`.env.example` is the only committed environment template.

Use it this way:

1. Copy `.env.example` to `.env.local` for local development.
2. Fill in real values only on your own machine.
3. Never commit `.env.local`, `.env`, or `.env.production`.
4. Never store production or preview secrets in committed files.

The current ignore policy should remain:

- ignore `.env*`
- allow only `.env.example`

## 5. Local development rules

For local development:

- Keep secrets only in `.env.local` or your shell environment.
- Treat any real key that was previously stored in plaintext locally as compromised.
- Replace exposed local values with placeholders after use if the workspace is shared, screen-recorded, or synced.
- Do not paste real values into docs, tests, screenshots, notes, or PR descriptions.

If this repository previously contained real local Tavily, Brave, Google Maps, or GitHub/Gist credentials on disk, rotate them before further use.

## 6. Vercel configuration

In Vercel, open:

`Project Settings > Environment Variables`

Configure these variables there with real values:

- `TAVILY_API_KEY`
- `BRAVE_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `GIST_ID`
- `GITHUB_GIST_TOKEN`

Optional variable:

- `GIST_CUSTOMER_DATA_FILENAME`
  - leave unset to use the runtime default `customer-data.json`
  - set it only if you intentionally want a different filename in the target Gist

Optional future variable:

- `DATABASE_URL`

### Recommended Vercel environments

At minimum, configure secrets for:

- Production
- Preview

Also configure Development in Vercel if you want cloud development behavior to match deployed runtime behavior.

## 7. Do not expose secrets to the frontend

Do not put provider or Gist secrets in any browser-visible variable.

That means:

- do not create `VITE_TAVILY_API_KEY`
- do not create `VITE_BRAVE_API_KEY`
- do not create `VITE_GOOGLE_MAPS_API_KEY`
- do not create `VITE_GITHUB_GIST_TOKEN`
- do not create any other `VITE_*` variable containing private credentials

`VITE_*` variables are bundled into the frontend and are not appropriate for private provider keys or tokens.

All provider and Gist secrets must stay server-side and be read only from runtime environment variables.

## 8. GitHub and Gist usage rules

### GitHub repository

Keep GitHub limited to source code and safe templates.

Never commit:

- real API keys
- personal access tokens
- `.env.local`
- `.env`
- `.env.production`
- exported customer data files
- sensitive lead/customer documents

### GitHub Gist

Use Gist only for lightweight structured data such as:

- customer records
- lead records
- lead workspaces
- small synchronized JSON documents

Do not store secrets in Gist.

Never put these in Gist:

- API keys
- GitHub tokens
- Vercel tokens
- raw credentials of any kind
- highly sensitive personal or financial documents

If `GIST_CUSTOMER_DATA_FILENAME` is unset, the runtime will use `customer-data.json`.

## 9. Key rotation checklist

If real values were ever stored in plaintext locally, shown in logs, screenshared, or committed anywhere, rotate them and replace the deployed values in Vercel.

### Google Maps

1. Create a replacement API key in Google Cloud.
2. Apply the correct API restrictions and application restrictions.
3. Update `GOOGLE_MAPS_API_KEY` in Vercel.
4. Remove or revoke the previously exposed key.

### Brave Search API

1. Generate a replacement key in the Brave Search dashboard.
2. Update `BRAVE_API_KEY` in Vercel.
3. Revoke the previously exposed key if supported by the provider.

### Tavily

1. Generate a replacement key in the Tavily dashboard.
2. Update `TAVILY_API_KEY` in Vercel.
3. Revoke the previously exposed key.

### GitHub / Gist token

1. Create a replacement GitHub token with only the minimum Gist permissions needed.
2. Update `GITHUB_GIST_TOKEN` in Vercel.
3. Confirm `GIST_ID` still points to the intended Gist.
4. Revoke the previously exposed token.

### After rotation

After rotating any key or token:

1. Redeploy or trigger a fresh Vercel deployment if needed.
2. Verify the affected API route returns success instead of `missing_env`.
3. Confirm no local plaintext copy remains in tracked docs, templates, tests, or screenshots.

## 10. Deployment checklist

Before deployment:

- [ ] `.env.example` contains placeholders only
- [ ] `.env.local` is not committed
- [ ] `.gitignore` still ignores `.env*` except `.env.example`
- [ ] no real provider or Gist secrets appear in source, docs, config, or tests
- [ ] Vercel has real values for `TAVILY_API_KEY`, `BRAVE_API_KEY`, `GOOGLE_MAPS_API_KEY`, `GIST_ID`, and `GITHUB_GIST_TOKEN`
- [ ] `GIST_CUSTOMER_DATA_FILENAME` is either unset or intentionally configured
- [ ] no provider or Gist secret is exposed via `VITE_*`
- [ ] previously exposed local keys have been rotated and replaced in Vercel

After deployment:

- [ ] verify `GET /api/customer-data`
- [ ] verify `PUT /api/customer-data`
- [ ] verify provider-backed routes that depend on Tavily, Brave, and Google Maps
- [ ] confirm no secret values appear in frontend responses or logs

## 11. Bottom line

Real API keys and tokens belong only in controlled local development env files or Vercel Environment Variables.

They do not belong in GitHub commits, `.env.example`, `VITE_*` variables, GitHub Gists, docs, tests, or any browser-visible bundle output.
