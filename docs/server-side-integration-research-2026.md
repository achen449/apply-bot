# 2026 Server-Side Integration Research: Google Maps, Gists, XLSX, Vercel

Date: 2026-06-08
Scope: server-side API usage for a Next.js/React/Vercel lead-generation app. Do not expose provider secrets to browser code.

## Executive recommendations

1. Keep Google Maps, GitHub Gist, Tavily/Brave, and any future provider tokens in server-only environment variables. In Next.js, variables without `NEXT_PUBLIC_` are server-only; only `NEXT_PUBLIC_` variables are bundled for browser code. Evidence: Next.js docs show Route Handlers reading `process.env.DB_HOST`, `process.env.DB_USER`, and `process.env.DB_PASS` server-side ([permalink](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/environment-variables.mdx)); Context7 excerpt also confirms non-`NEXT_PUBLIC_` env vars are server-only by default.
2. Use backend routes/server functions as thin provider adapters. Validate request input, read one secret from `process.env`, call the provider with explicit timeout/error handling, normalize the provider response, then return safe user-facing JSON.
3. For Google Maps company search, prefer Places API (New) Text Search (`POST https://places.googleapis.com/v1/places:searchText`) with `X-Goog-Api-Key` and `X-Goog-FieldMask`; only request fields needed by the UI. Real-world server/service examples use `Content-Type`, `X-Goog-Api-Key`, and `X-Goog-FieldMask` headers ([Skales example](https://github.com/skalesapp/skales/blob/main/apps/web/src/actions/places.ts), [Pinelab strategy test](https://github.com/Pinelab-studio/pinelab-vendure-plugins/blob/main/packages/vendure-plugin-address-lookup/src/config/google-places-lookup-strategy.spec.ts)).
4. For address verification/geocoding, call Geocoding API from the backend. Google documents Geocoding v4 as server-to-server and warns that direct browser calls expose keys to theft/misuse: https://developers.google.com/maps/documentation/geocoding/geocoding-v4-overview
5. For Gist-backed workspaces, create or update private gists server-side using a token with `gist` scope. GitHub documents `POST /gists`, `files`, `content`, `public: false`, and response status `201 Created`: https://docs.github.com/en/rest/gists/gists?apiVersion=2026-03-10
6. For XLSX import/export, use `xlsx` (SheetJS Community Edition) for broad format support and simple JSON conversion; use `exceljs` when styled workbooks, richer worksheet manipulation, or streaming large workbooks matter. SheetJS docs show `read(await file.arrayBuffer())`, `utils.sheet_to_json`, `utils.book_new`, and `write(..., { type: 'buffer', bookType: 'xlsx' })`: https://docs.sheetjs.com/docs/api/ . ExcelJS docs show `workbook.xlsx.load(data)`, `workbook.xlsx.writeBuffer()`, and streaming readers/writers ([permalink](https://github.com/exceljs/exceljs/blob/5bed18b45e824f409b08456b59b87430ded023ab/README.md)).

## 1. Google Maps Places / Geocoding API patterns

### Recommended server route shape

```ts
// app/api/maps/search/route.ts
import { NextResponse } from 'next/server'

const GOOGLE_PLACES_TEXT_SEARCH = 'https://places.googleapis.com/v1/places:searchText'

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Google Maps API key is not configured' }, { status: 500 })
  }

  const { query, countryCode } = await req.json()
  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await fetch(GOOGLE_PLACES_TEXT_SEARCH, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.location',
          'places.websiteUri',
          'places.nationalPhoneNumber',
          'places.rating',
          'places.userRatingCount',
          'places.types',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: query,
        ...(countryCode ? { includedRegionCodes: [countryCode] } : {}),
      }),
    })

    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Google Places search failed', providerStatus: response.status, providerMessage: body.error?.message },
        { status: response.status >= 500 ? 502 : 400 }
      )
    }

    return NextResponse.json({ places: body.places ?? [] })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof DOMException && error.name === 'AbortError' ? 'Google Places search timed out' : 'Google Places search failed' },
      { status: 502 }
    )
  } finally {
    clearTimeout(timeout)
  }
}
```

### Practical notes

- Search route: use Places API (New) Text Search when the input is a company category / phrase such as `connector distributor near Munich`.
- Geocoding route: use Geocoding for canonicalizing addresses, converting address ↔ lat/lng, or verifying formatted address components.
- Field masks are important for Places API (New): they reduce payload/cost and avoid depending on fields the UI does not need. Public examples include `X-Goog-FieldMask` with specific `places.*` fields ([Skales example](https://github.com/skalesapp/skales/blob/main/apps/web/src/actions/places.ts), [TREK example](https://github.com/mauriceboe/TREK/blob/main/server/src/services/mapsService.ts)).
- Normalize Google responses before returning them to React. Do not pass raw provider error blobs to the UI if they include diagnostics or billing/project hints.

## 2. GitHub Gist API workspace creation patterns

### Recommended workspace model

Create one private gist that stores a JSON workspace file, for example `customer-workspace.json`:

```json
{
  "version": 1,
  "updatedAt": "2026-06-08T00:00:00.000Z",
  "customers": [],
  "leadWorkspaces": []
}
```

### Create private workspace gist

```ts
// app/api/workspace/create/route.ts
import { NextResponse } from 'next/server'

export async function POST() {
  const token = process.env.GITHUB_GIST_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'GitHub Gist token is not configured' }, { status: 500 })
  }

  const response = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: 'Lead generation customer workspace',
      public: false,
      files: {
        'customer-workspace.json': {
          content: JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), customers: [], leadWorkspaces: [] }, null, 2),
        },
      },
    }),
  })

  const body = await response.json().catch(() => ({}))
  if (response.status !== 201) {
    return NextResponse.json(
      { error: 'Workspace creation failed', providerStatus: response.status, providerMessage: body.message },
      { status: response.status === 401 || response.status === 403 ? 502 : 400 }
    )
  }

  return NextResponse.json({ gistId: body.id, url: body.html_url })
}
```

### Common Gist failure causes

- Token missing or not deployed to Vercel Production/Preview environment.
- Token lacks `gist` scope. GitHub docs state creating gists requires authentication and read/write gists need the `gist` OAuth scope: https://docs.github.com/en/rest/gists/gists?apiVersion=2026-03-10
- Request body has invalid `files` shape; each file key must contain `{ content: string }`.
- Expecting `200` for create; create returns `201 Created`.
- Using `public: 'false'` as a string instead of boolean `false`. GitHub docs list `public` as boolean/string, but boolean `false` is clearer and avoids accidental truthiness in local validation.

## 3. XLSX import/export library recommendations

### SheetJS (`xlsx`)

Best for: import Excel-like files quickly, convert first sheet to JSON, broad legacy format compatibility, simple workbook generation.

```ts
import * as XLSX from 'xlsx'

export async function parseXlsx(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer())
  const worksheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' })
}

export function buildXlsxBuffer(rows: Record<string, unknown>[]) {
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}
```

Evidence: SheetJS docs show `import * as XLSX from "xlsx"`, `XLSX.read`, `XLSX.write`, `read(await files[0].arrayBuffer())`, and `utils.sheet_to_json`: https://docs.sheetjs.com/docs/api/ and https://docs.sheetjs.com/docs/

### ExcelJS (`exceljs`)

Best for: styled exports, column widths, formulas, richer workbook manipulation, and streaming large files.

```ts
import ExcelJS from 'exceljs'

export async function parseWithExcelJS(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]
  return sheet.getSheetValues()
}

export async function exportStyledWorkbook(rows: Array<{ company: string; website?: string }>) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Leads')
  sheet.columns = [
    { header: 'Company', key: 'company', width: 35 },
    { header: 'Website', key: 'website', width: 45 },
  ]
  sheet.addRows(rows)
  return workbook.xlsx.writeBuffer()
}
```

Evidence: ExcelJS README says it can “Read, manipulate and write spreadsheet data and styles to XLSX and JSON,” imports with `const ExcelJS = require('exceljs')`, and documents buffer loading/writing plus streaming readers/writers ([permalink](https://github.com/exceljs/exceljs/blob/5bed18b45e824f409b08456b59b87430ded023ab/README.md)).

### CSV vs XLSX mismatch fix

If the UI accepts `.xlsx`, do not parse it with CSV string logic. Detect by MIME/extension and route accordingly:

```ts
const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || file.type.includes('spreadsheetml')
if (!isXlsx) throw new Error('Please upload a real .xlsx workbook')
```

For backward compatibility, keep CSV import as a separate branch with explicit `.csv` acceptance.

## 4. Vercel / Next.js environment variable best practices

- Put secrets in Vercel Project Settings for Production/Preview/Development. Vercel docs state environment variables are available during the Build Step and Function execution, and can be scoped per Production/Preview/Development environment: https://vercel.com/docs/environment-variables
- For local development, use `.env.local` in the project root; do not commit it. Use `.env.example` with placeholder names only.
- Do not prefix secrets with `NEXT_PUBLIC_`. Next.js docs state non-`NEXT_PUBLIC_` variables are server-only and `NEXT_PUBLIC_` values are inlined into browser JavaScript at build time: https://nextjs.org/docs/app/guides/environment-variables
- In monorepos or `/src` apps, keep `.env*` at the project root, not inside `/src`. Next.js docs explicitly warn about this location rule.
- Use a server-only module for provider clients:

```ts
// lib/server/env.ts
import 'server-only'

export function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}
```

Then only import it from route handlers/server actions/server components.

Recommended required variables for this project:

```bash
GOOGLE_MAPS_API_KEY=server-side-google-key
GITHUB_GIST_TOKEN=github-token-with-gist-scope
GIST_ID=existing-private-gist-id
TAVILY_API_KEY=optional-server-side-key
BRAVE_API_KEY=optional-server-side-key
```

## 5. External API error handling patterns

### Standard adapter response policy

- `400` from your API: bad user input before calling provider.
- `500` from your API: your deployment is missing configuration.
- `502` from your API: provider failed, provider auth failed, provider returned invalid JSON, or upstream timeout.
- Include `providerStatus` and a safe `providerMessage`; never include tokens, full request headers, or raw exception stacks.
- Use `AbortController` for every provider call.
- Use provider-specific retry only for transient `429`, `500`, `502`, `503`, `504`; do not retry invalid input or auth errors.

### Reusable helper

```ts
type ProviderResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; providerStatus?: number }

export async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs = 15_000): Promise<ProviderResult<T>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = await response.json().catch(() => null)

    if (!response.ok) {
      return {
        ok: false,
        status: response.status >= 500 ? 502 : 400,
        providerStatus: response.status,
        message: body?.error?.message ?? body?.message ?? 'External API request failed',
      }
    }

    return { ok: true, data: body as T }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      message: error instanceof DOMException && error.name === 'AbortError' ? 'External API request timed out' : 'External API request failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}
```

### Integration-specific fixes for current errors

- Workspace creation failing: check `GITHUB_GIST_TOKEN`, `gist` scope, `POST /gists` body, `201` status handling, and Vercel environment scope.
- Search not working: check that server route reads `GOOGLE_MAPS_API_KEY`, sends `X-Goog-Api-Key` plus `X-Goog-FieldMask`, and has Places API (New) enabled/billing configured.
- File format mismatch: make upload accept `.xlsx` and parse `ArrayBuffer` with SheetJS/ExcelJS; do not treat `.xlsx` as CSV text.
