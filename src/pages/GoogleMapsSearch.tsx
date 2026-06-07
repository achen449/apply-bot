import { FormEvent, useMemo, useState } from 'react'
import { Building2, Download, ExternalLink, Globe2, Loader2, Mail, MapPin, Phone, Search, Star } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { searchGoogleMaps, type GoogleMapsPlace, type GoogleMapsSearchResult } from '@/lib/leadApi'

function buildWorkflowHint(message: string) {
  if (message.includes('GOOGLE_MAPS_API_KEY')) {
    return `${message} Google Maps local discovery runs server-side only, so configure GOOGLE_MAPS_API_KEY in Vercel or the local Node server before retrying.`
  }

  return message
}

function formatCapturedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function formatBusinessStatus(status: string) {
  if (status === 'OPERATIONAL') return '营业中'
  if (status === 'CLOSED_TEMPORARILY') return '暂停营业'
  if (status === 'CLOSED_PERMANENTLY') return '永久关闭'
  if (status === 'UNKNOWN') return '状态未知'
  return status || '状态未知'
}

function formatTypeLabel(value: string) {
  return value.replace(/_/g, ' ')
}

function normalizeWebsite(value: string) {
  if (!value) {
    return ''
  }

  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function buildCsvCell(value: string | number) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function PlaceResultCard({ result }: { result: GoogleMapsPlace }) {
  const websiteUrl = normalizeWebsite(result.url)
  const sourceUrl = websiteUrl || `https://www.google.com/maps/place/?q=place_id:${result.googlePlaceId}`

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-stone-700 dark:bg-stone-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-gray-900 dark:text-white">{result.title}</h3>
            <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 dark:bg-primary-900/20 dark:text-primary-200">
              workflow: google-maps
            </span>
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-200">
              provider: {result.provider}
            </span>
            {result.queryLabel ? (
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
                {result.queryLabel}
              </span>
            ) : null}
          </div>

          <div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span className="break-words">{result.address || 'No address returned'}</span>
            </div>
            {result.phone ? (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 flex-shrink-0" />
                <a href={`tel:${result.phone}`} className="transition-colors hover:text-primary-600">
                  {result.phone}
                </a>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Globe2 className="h-4 w-4 flex-shrink-0" />
              {websiteUrl ? (
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-1 truncate transition-colors hover:text-primary-600"
                >
                  <span className="truncate">{result.url}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              ) : (
                <span>No official website returned</span>
              )}
            </div>
            {result.emails && result.emails.length > 0 ? (
              <div className="flex items-start gap-2">
                <Mail className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div className="flex flex-wrap gap-2">
                  {result.emails.map((email) => (
                    <a key={email} href={`mailto:${email}`} className="text-primary-600 transition-colors hover:text-primary-700">
                      {email}
                    </a>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-500 dark:text-gray-500">No public email observed for this result.</div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 text-right">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            {formatBusinessStatus(result.googleBusinessStatus)}
          </span>
          {result.googleRating > 0 ? (
            <div className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-200">
              <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
              {result.googleRating.toFixed(1)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <InfoBlock
          title="Company Snapshot"
          lines={[
            `Primary Type: ${result.googlePrimaryType ? formatTypeLabel(result.googlePrimaryType) : 'N/A'}`,
            `Review Count: ${result.googleReviewCount ?? 0}`,
            `Place ID: ${result.googlePlaceId || 'N/A'}`,
            `Captured At: ${formatCapturedAt(result.capturedAt)}`
          ]}
        />
        <InfoBlock
          title="Source & Evidence"
          lines={[
            `Source Provider: ${result.provider}`,
            `Workflow Origin: google-maps-search`,
            `Source URL: ${sourceUrl}`,
            `Query: ${result.query || 'N/A'}`
          ]}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(result.googleTypes || []).length > 0 ? (
          result.googleTypes.map((type) => (
            <span
              key={type}
              className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-stone-800 dark:text-gray-300"
            >
              {formatTypeLabel(type)}
            </span>
          ))
        ) : (
          <span className="text-xs text-gray-500 dark:text-gray-500">No Google place types returned.</span>
        )}
      </div>

      {result.snippet ? (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
          {result.snippet}
        </div>
      ) : null}
    </div>
  )
}

function InfoBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200">
      <div className="font-semibold">{title}</div>
      <div className="mt-2 space-y-1">
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  )
}

export default function GoogleMapsSearch() {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [minRating, setMinRating] = useState('0')
  const [requireWebsite, setRequireWebsite] = useState(false)
  const [requirePhone, setRequirePhone] = useState(false)
  const [includeEmails, setIncludeEmails] = useState(false)
  const [maxResults, setMaxResults] = useState('20')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<GoogleMapsSearchResult | null>(null)
  const [error, setError] = useState('')

  const resultsSummary = useMemo(() => {
    if (!searchResults) {
      return null
    }

    const withWebsite = searchResults.results.filter((item) => item.url).length
    const withPhone = searchResults.results.filter((item) => item.phone).length
    const withEmail = searchResults.results.filter((item) => (item.emails || []).length > 0).length

    return { withWebsite, withPhone, withEmail }
  }, [searchResults])

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSearchResults(null)
    setIsSearching(true)

    try {
      const results = await searchGoogleMaps({
        query,
        location,
        filters: {
          minRating: Number.parseFloat(minRating),
          requireWebsite,
          requirePhone,
          requireOperational: true,
          maxResults: Number.parseInt(maxResults, 10),
          includeEmails
        }
      })
      setSearchResults(results)
    } catch (searchError) {
      console.error(searchError)
      const message = searchError instanceof Error ? searchError.message : '搜索失败'
      setError(buildWorkflowHint(message))
    } finally {
      setIsSearching(false)
    }
  }

  function handleExportCSV() {
    if (!searchResults || searchResults.results.length === 0) {
      return
    }

    const headers = [
      '公司名称',
      '地址',
      '电话',
      '官网',
      '评分',
      '评论数',
      '营业状态',
      '主类型',
      '全部类型',
      '公开邮箱',
      'Provider',
      'Workflow Origin',
      'Source URL',
      'Query',
      'Captured At'
    ]

    const rows = searchResults.results.map((result) => [
      result.title || '',
      result.address || '',
      result.phone || '',
      result.url || '',
      result.googleRating?.toString() || '',
      result.googleReviewCount?.toString() || '0',
      result.googleBusinessStatus || '',
      result.googlePrimaryType || '',
      (result.googleTypes || []).join('; '),
      (result.emails || []).join('; '),
      result.provider || 'google-maps',
      'google-maps-search',
      result.url || `https://www.google.com/maps/place/?q=place_id:${result.googlePlaceId}`,
      result.query || '',
      result.capturedAt || ''
    ])

    const csv = [headers, ...rows].map((row) => row.map(buildCsvCell).join(',')).join('\n')
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `google-maps-search-${Date.now()}.csv`
    link.click()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Google Maps 潜在客户搜索</h2>
        <p className="mt-2 max-w-4xl text-sm text-gray-600 dark:text-gray-400">
          通过服务端 `/api/google-maps/search` 主动搜索本地公司。结果会尽量展示地址、电话、官网、Google 来源元数据，以及可观察到的公开邮箱。
        </p>
      </div>

      <Card className="border-gray-200 shadow-sm dark:border-stone-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Search className="h-5 w-5 text-primary-600" />
            搜索条件
          </CardTitle>
          <CardDescription>
            输入行业关键词和地区，选择过滤条件开始搜索。例如：“solar installer” + “Berlin”。Google Maps 密钥只允许放在服务端环境变量中。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSearch}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                行业/关键词 *
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  placeholder="例如：solar installer, EV charging station"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                地区
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  placeholder="例如：Berlin, California, Germany"
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                最低评分
                <select
                  value={minRating}
                  onChange={(event) => setMinRating(event.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                >
                  <option value="0">不限</option>
                  <option value="3.0">3.0+</option>
                  <option value="3.5">3.5+</option>
                  <option value="4.0">4.0+</option>
                  <option value="4.5">4.5+</option>
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                最大结果数
                <select
                  value={maxResults}
                  onChange={(event) => setMaxResults(event.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="40">40</option>
                  <option value="60">60</option>
                </select>
              </label>
            </div>

            <div className="space-y-2">
              <label className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={requireWebsite}
                  onChange={(event) => setRequireWebsite(event.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                必须有官网
              </label>
              <label className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={requirePhone}
                  onChange={(event) => setRequirePhone(event.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                必须有电话
              </label>
              <label className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeEmails}
                  onChange={(event) => setIncludeEmails(event.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                自动抓取官网公开邮箱（会变慢）
              </label>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
              依赖服务端 `GOOGLE_MAPS_API_KEY`。如果返回缺少环境变量，请在 Vercel 或本地 Node 服务端配置该密钥；前端不会直接调用 Google，也不会暴露任何 key。
            </div>

            <div className="flex gap-3">
              <Button type="submit" disabled={isSearching} className="flex-1">
                {isSearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                开始搜索
              </Button>
              {searchResults && searchResults.results.length > 0 ? (
                <Button type="button" onClick={handleExportCSV} variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  导出 CSV
                </Button>
              ) : null}
            </div>
            {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
          </form>
        </CardContent>
      </Card>

      {searchResults ? (
        <Card className="border-gray-200 shadow-sm dark:border-stone-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Building2 className="h-5 w-5 text-primary-600" />
              搜索结果
            </CardTitle>
            <CardDescription>
              找到 {searchResults.count} 家公司 · 查询：{searchResults.query}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {resultsSummary ? (
              <div className="grid gap-4 md:grid-cols-3">
                <InfoBlock
                  title="完整度概览"
                  lines={[
                    `With Website: ${resultsSummary.withWebsite}/${searchResults.count}`,
                    `With Phone: ${resultsSummary.withPhone}/${searchResults.count}`,
                    `With Public Email: ${resultsSummary.withEmail}/${searchResults.count}`,
                    'Workflow Origin: google-maps-search'
                  ]}
                />
                <InfoBlock
                  title="Provider Meta"
                  lines={[
                    `Primary Provider: ${searchResults.results[0]?.provider || 'google-maps'}`,
                    `Query Label: ${searchResults.results[0]?.queryLabel || 'company'}`,
                    `Require Website: ${requireWebsite ? 'Yes' : 'No'}`,
                    `Require Phone: ${requirePhone ? 'Yes' : 'No'}`
                  ]}
                />
                <InfoBlock
                  title="Validation Notes"
                  lines={[
                    'Address and phone come from Google Maps place data.',
                    'Official website is only shown if returned by Google.',
                    'Emails are optional and only come from observed public website scraping.',
                    'No guessed private contact data is generated.'
                  ]}
                />
              </div>
            ) : null}

            {searchResults.results.length === 0 ? (
              <div className="py-12 text-center text-gray-500 dark:text-gray-400">
                未找到匹配的公司。尝试调整搜索条件、放宽过滤条件，或确认服务端 Google Maps 环境变量已经配置。
              </div>
            ) : (
              <div className="max-h-[900px] space-y-4 overflow-y-auto">
                {searchResults.results.map((result) => (
                  <PlaceResultCard key={`${result.googlePlaceId || result.title}-${result.capturedAt}`} result={result} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
