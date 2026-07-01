import { FormEvent, useState } from 'react'
import { ExternalLink, Globe2, Loader2, Search, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { findSimilarCompanies, type SimilarCompanyResult } from '@/lib/leadApi'

function buildWorkflowHint(message: string) {
  if (message.includes('TAVILY_API_KEY')) {
    return `${message} Similar-company discovery runs through the server-side Tavily route, so configure TAVILY_API_KEY in Vercel or the local Node service before retrying.`
  }

  return message
}

function normalizeWebsite(value: string) {
  if (!value) {
    return ''
  }

  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function formatCapturedAt(value?: string) {
  if (!value) {
    return 'N/A'
  }

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

export default function SimilarCompanyFinder() {
  const [name, setName] = useState('Signify')
  const [website, setWebsite] = useState('https://www.signify.com')
  const [industry, setIndustry] = useState('solar lighting, energy storage, industrial electrical buyers')
  const [description, setDescription] = useState('Find companies with similar public profiles that could buy industrial connectors in Spain and Europe.')
  const [topN, setTopN] = useState('10')
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SimilarCompanyResult[]>([])
  const [error, setError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [promptPreview, setPromptPreview] = useState('')
  const [queryPreview, setQueryPreview] = useState<string[]>([])

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResults([])
    setHasSearched(true)
    setIsSearching(true)

    try {
      const data = await findSimilarCompanies({ name, website, industry, description }, Number.parseInt(topN, 10))
      setResults(data.results)
      setPromptPreview(data.metadata?.prompt?.rendered || '')
      setQueryPreview((data.metadata?.searchCalls || []).map((call) => call.query || '').filter(Boolean))
    } catch (searchError) {
      console.error(searchError)
      const message = searchError instanceof Error ? searchError.message : '相似公司搜索失败'
      setError(buildWorkflowHint(message))
    } finally {
      setIsSearching(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">AI 相似公司推荐</h2>
        <p className="mt-2 max-w-4xl text-sm text-gray-600 dark:text-gray-400">
          通过 `/api/companies/find-similar` 从一个样板公司出发，利用 Tavily 搜索结果与轻量相似度，筛出有公开证据支撑的相似公司候选。
        </p>
      </div>

      <Card className="border-gray-200 shadow-sm dark:border-stone-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary-600" />
            样板公司
          </CardTitle>
          <CardDescription>
            示例已填 Signify。你可以换成任意目标客户或标杆公司。页面只会调用本项目的 `/api/...` 路由，不会直接访问 Tavily。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSearch}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                公司名 *
                <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white" required />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                官网
                <input value={website} onChange={(event) => setWebsite(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white" />
              </label>
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              行业方向
              <input value={industry} onChange={(event) => setIndustry(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              推荐目标描述
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 md:w-48">
              推荐数量
              <select value={topN} onChange={(event) => setTopN(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white">
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="15">15</option>
              </select>
            </label>
            <Button type="submit" disabled={isSearching} className="w-full">
              {isSearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              查找相似公司
            </Button>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
              依赖后端 `POST /api/companies/find-similar`。如果提示缺少环境变量，请在 Vercel 或本地服务端设置 `TAVILY_API_KEY`，不要把密钥写进前端。
            </div>
            {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
          </form>
        </CardContent>
      </Card>

      {promptPreview || queryPreview.length > 0 ? (
        <Card className="border-gray-200 shadow-sm dark:border-stone-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-primary-600" />
              Prompt / Query Preview
            </CardTitle>
            <CardDescription>用于本次相似公司推荐的 prompt 和 AI 生成查询词。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200 whitespace-pre-wrap">
              {promptPreview || 'N/A'}
            </div>
            <div className="flex flex-wrap gap-2">
              {queryPreview.length > 0 ? queryPreview.map((query) => (
                <span key={query} className="rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
                  {query}
                </span>
              )) : <span className="text-sm text-gray-500 dark:text-gray-400">No generated queries yet.</span>}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {hasSearched && !isSearching && !error && results.length === 0 ? (
        <Card className="border-gray-200 shadow-sm dark:border-stone-700">
          <CardContent className="p-6 text-sm text-gray-500 dark:text-gray-400">
            当前没有返回相似公司结果。可以尝试补充官网、收窄行业描述，或确认服务端 Tavily 环境变量已经配置。
          </CardContent>
        </Card>
      ) : null}

      {results.length > 0 ? (
        <Card className="border-gray-200 shadow-sm dark:border-stone-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-primary-600" />
              推荐结果
            </CardTitle>
            <CardDescription>按轻量关键词相似度排序，并保留来源网站、provider、query label、公开描述和官网线索。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {results.map((result, index) => {
                const sourceUrl = normalizeWebsite(result.company.url)
                const profileWebsite = normalizeWebsite(result.profile.website)

                return (
                  <div key={`${result.company.title}-${index}`} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-900">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{result.company.title}</h3>
                          <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 dark:bg-primary-900/20 dark:text-primary-200">
                            workflow: similar-company
                          </span>
                          {result.company.provider ? (
                            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                              provider: {result.company.provider}
                            </span>
                          ) : null}
                          {result.company.queryLabel ? (
                            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
                              {result.company.queryLabel}
                            </span>
                          ) : null}
                          {result.company.query ? (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                              query: {result.company.query}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{result.company.snippet || result.profile.rawProfile}</p>
                      </div>
                      <div className="rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-sm font-semibold text-primary-700 dark:border-primary-900/30 dark:bg-primary-900/10 dark:text-primary-200">
                        {Math.round(result.similarity * 100)}% match
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <InfoBlock
                        title="Company & Website"
                        lines={[
                          `Official Website Clue: ${profileWebsite || 'N/A'}`,
                          `Source URL: ${sourceUrl || 'N/A'}`,
                          `Source Provider: ${result.company.provider || 'tavily'}`,
                          `Workflow Origin: similar-company-finder`,
                          `Captured At: ${formatCapturedAt(result.company.capturedAt)}`
                        ]}
                      />
                      <InfoBlock
                        title="Evidence Context"
                        lines={[
                          `Query Label: ${result.company.queryLabel || 'company'}`,
                          `Query: ${result.company.query || 'N/A'}`,
                          `Captured At: ${formatCapturedAt(result.company.capturedAt)}`,
                          `Observed Summary: ${(result.company.snippet || result.profile.rawProfile || 'N/A').slice(0, 120)}`
                        ]}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {result.profile.keywords.slice(0, 10).map((keyword) => (
                        <span key={keyword} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 dark:bg-stone-800 dark:text-gray-300">{keyword}</span>
                      ))}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3 text-sm">
                      {sourceUrl ? (
                        <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700">
                          打开来源 <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                      {profileWebsite && profileWebsite !== sourceUrl ? (
                        <a href={profileWebsite} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700">
                          打开官网线索 <Globe2 className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
