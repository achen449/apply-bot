import { FormEvent, useState } from 'react'
import { AlertCircle, Building2, CheckCircle2, Loader2, Search, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const defaultIndustry = 'industrial connectors'
const defaultKeywords = 'mc4, battery connector, wire harness, high current'

type Mode = 'economy' | 'standard' | 'deep'

interface ToolCall {
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
  status?: 'pending' | 'completed' | 'error'
  result?: string
}

interface ScoredCompany {
  name: string
  score: number
  reasoning: string
  website?: string
  country?: string
  segment?: string
  address?: string
  phone?: string
  contactEmails?: string[]
  mapVerified?: boolean
  dataQuality?: {
    needsReview?: boolean
  } | null
}

interface LeadFinderResponse {
  runId?: string
  status?: string
  partial?: boolean
  workspace?: {
    id?: string
    persistence?: { saved?: boolean; reason?: string }
  }
  companies: ScoredCompany[]
  toolCalls: ToolCall[]
  cacheStatus?: {
    hit: boolean
    key?: string
  }
  metadata?: {
    totalProcessingTime?: number
    mode: Mode
    prompt?: {
      key?: string
      rendered?: string
    }
    searchCalls?: Array<{
      provider?: string
      query?: string
      ok?: boolean
      resultCount?: number
    }>
  }
}

export default function LeadFinder() {
  const [industry, setIndustry] = useState(defaultIndustry)
  const [country, setCountry] = useState('')
  const [keywords, setKeywords] = useState(defaultKeywords)
  const [mode, setMode] = useState<Mode>('standard')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<LeadFinderResponse | null>(null)
  const [promptPreview, setPromptPreview] = useState('')
  const [queryPreview, setQueryPreview] = useState<string[]>([])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    setResult(null)

    try {
      const response = await fetch('/api/lead-finder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry,
          country: country || undefined,
          keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
          mode
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const data: LeadFinderResponse = await response.json()
      setResult(data)
      setPromptPreview(data.metadata?.prompt?.rendered || '')
      setQueryPreview((data.metadata?.searchCalls || []).map((call) => call.query || '').filter(Boolean))
    } catch (submitError) {
      console.error(submitError)
      setError(submitError instanceof Error ? submitError.message : '生成线索失败。')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Lead Finder</h2>
        <p className="mt-2 max-w-4xl text-sm text-gray-600 dark:text-gray-400">
          输入行业、关键词和国家，选择搜索模式，AI 会推理并返回评分公司列表。
        </p>
      </div>

      <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Search className="h-5 w-5 text-primary-600" />
            Discovery Input
          </CardTitle>
          <CardDescription>
            选择搜索模式：economy（快速）、standard（标准）、deep（深度）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 lg:grid-cols-3">
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                行业
                <input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  placeholder="例如 industrial connectors"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                国家
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  placeholder="例如 Germany"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                关键词
                <input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  placeholder="逗号分隔"
                />
              </label>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">搜索模式</label>
              <div className="grid gap-3 sm:grid-cols-3">
                <ModeCard mode="economy" selected={mode === 'economy'} onClick={() => setMode('economy')} />
                <ModeCard mode="standard" selected={mode === 'standard'} onClick={() => setMode('standard')} />
                <ModeCard mode="deep" selected={mode === 'deep'} onClick={() => setMode('deep')} />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                AI 会展示推理过程和评分理由
              </div>
              <Button type="submit" disabled={isSubmitting} className="min-w-[180px]">
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                生成目标公司列表
              </Button>
            </div>
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400">
                {error}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {(promptPreview || queryPreview.length > 0) && (
        <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">Prompt / Buyer Queries</CardTitle>
            <CardDescription>本次 Lead Finder 实际使用的 prompt 和 AI 生成的 buyer-side 查询词。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200 whitespace-pre-wrap">
              {promptPreview || 'N/A'}
            </div>
            <div className="flex flex-wrap gap-2">
              {queryPreview.map((query) => (
                <span key={query} className="rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
                  {query}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-gray-700 dark:text-gray-200">
                <span className="font-semibold">流程状态：</span>
                <span>{result.status === 'completed' ? '已完成' : result.status === 'needs_review' ? '待复核' : result.status || '未记录'}</span>
                {result.partial ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">部分结果</span> : null}
                {result.runId ? <span className="break-all text-xs text-gray-500 dark:text-gray-400">Run: {result.runId}</span> : null}
              </div>
              {result.workspace?.id ? <div className="flex flex-wrap gap-2"><a className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-gray-200 dark:hover:bg-stone-800" href={`/api/lead-workspaces/${result.workspace.id}/export.csv`}>导出 CSV</a><a className="rounded-lg bg-primary-600 px-3 py-2 text-xs text-white hover:bg-primary-700" href={`/api/lead-workspaces/${result.workspace.id}/export.xlsx`}>导出 XLSX</a></div> : null}
            </CardContent>
          </Card>

          {result.cacheStatus && (
            <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  {result.cacheStatus.hit ? (
                    <>
                      <Zap className="h-5 w-5 text-green-600" />
                      <div className="text-sm">
                        <span className="font-semibold text-green-700 dark:text-green-400">缓存命中</span>
                        <span className="ml-2 text-gray-600 dark:text-gray-400">
                          使用已缓存结果，节省时间和成本
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-5 w-5 text-blue-600" />
                      <div className="text-sm">
                        <span className="font-semibold text-blue-700 dark:text-blue-400">新查询</span>
                        <span className="ml-2 text-gray-600 dark:text-gray-400">
                          AI 实时推理生成结果
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {result.toolCalls && result.toolCalls.length > 0 && (
            <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
              <CardHeader>
                <CardTitle className="text-xl">AI 推理过程</CardTitle>
                <CardDescription>查看 AI 如何一步步搜索和分析目标公司</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.toolCalls.map((tool) => (
                  <div
                    key={tool.id}
                    className="rounded-xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {tool.function.name}
                          </span>
                          {tool.status === 'completed' && (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          )}
                          {tool.status === 'pending' && (
                            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                          )}
                          {tool.status === 'error' && (
                            <AlertCircle className="h-4 w-4 text-red-600" />
                          )}
                        </div>
                        <pre className="mt-2 max-h-40 overflow-auto text-xs text-gray-600 dark:text-gray-400">
                          {tool.function.arguments}
                        </pre>
                        {tool.result && (
                          <div className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                            结果: {tool.result.substring(0, 200)}
                            {tool.result.length > 200 && '...'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {result.companies && result.companies.length > 0 && (
            <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
              <CardHeader>
                <CardTitle className="text-xl">公司排名（共 {result.companies.length} 家）</CardTitle>
                <CardDescription>AI 根据适配度评分和理由推荐的目标公司</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {result.companies.map((company, index) => (
                  <div
                    key={`${company.name}-${index}`}
                    className="rounded-xl border border-gray-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-900"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <Building2 className="h-5 w-5 text-gray-400" />
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {company.name}
                          </h3>
                        </div>
                        {company.website && (
                          <a
                            href={company.website}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 text-sm text-primary-600 hover:text-primary-700"
                          >
                            {company.website}
                          </a>
                        )}
                        {(company.country || company.segment) && (
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            {company.country && (
                              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                                {company.country}
                              </span>
                            )}
                            {company.segment && (
                              <span className="rounded-full bg-violet-100 px-2.5 py-1 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200">
                                {company.segment}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                          <span className="break-words text-gray-600 dark:text-gray-300">地址：{company.address || '未发现'}</span>
                          <span className="break-words text-gray-600 dark:text-gray-300">电话：{company.phone || '未发现'}</span>
                          <span className="break-words text-gray-600 dark:text-gray-300">公开邮箱：{company.contactEmails?.join(' | ') || '未发现'}</span>
                          <span className="text-gray-600 dark:text-gray-300">地图：{company.mapVerified ? '已验证' : '待复核'}</span>
                        </div>
                        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{company.reasoning}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500 dark:text-gray-400">评分</div>
                        <div className="text-3xl font-bold text-primary-700 dark:text-primary-300">
                          {company.score}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function ModeCard({ mode, selected, onClick }: { mode: Mode; selected: boolean; onClick: () => void }) {
  const modeConfig = {
    economy: {
      label: 'Economy',
      desc: '快速搜索，基础评分',
      icon: Zap
    },
    standard: {
      label: 'Standard',
      desc: '标准搜索，详细分析',
      icon: Search
    },
    deep: {
      label: 'Deep',
      desc: '深度调研，完整报告',
      icon: Building2
    }
  }

  const config = modeConfig[mode]
  const Icon = config.icon

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        selected
          ? 'border-primary-300 bg-primary-50 dark:border-primary-900/50 dark:bg-primary-900/10'
          : 'border-gray-200 bg-white hover:border-primary-200 hover:bg-gray-50 dark:border-stone-700 dark:bg-stone-900'
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-5 w-5 ${selected ? 'text-primary-600' : 'text-gray-400'}`} />
        <span className="font-semibold text-gray-900 dark:text-white">{config.label}</span>
      </div>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{config.desc}</p>
    </button>
  )
}

