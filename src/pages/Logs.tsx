import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  Mail,
  RefreshCw,
  Search
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fetchResearchRuns, type ResearchRunRecord } from '@/lib/leadApi'

type RunStatus = 'completed' | 'partial' | 'needs_review' | 'failed' | string

function formatDate(value?: string) {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function statusLabel(status?: RunStatus) {
  switch (status) {
    case 'completed': return '已完成'
    case 'partial': return '部分完成'
    case 'failed': return '失败'
    case 'needs_review': return '待复核'
    default: return status || '未知状态'
  }
}

function statusIcon(status?: RunStatus) {
  if (status === 'completed') return CheckCircle2
  if (status === 'failed') return AlertCircle
  if (status === 'partial' || status === 'needs_review') return AlertTriangle
  return Clock
}

function statusClass(status?: RunStatus) {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200'
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200'
  if (status === 'partial') return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200'
  return 'border-slate-200 bg-slate-50 text-slate-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200'
}

function asString(value: unknown) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try { return JSON.stringify(value) } catch { return String(value) }
}

function formatList(values: unknown[] | undefined) {
  return (values || []).map(asString).filter(Boolean)
}

function StatusBadge({ status }: { status?: RunStatus }) {
  const Icon = statusIcon(status)
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(status)}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  )
}

function KeyValue({ label, value, href }: { label: string; value?: unknown; href?: string }) {
  const text = asString(value) || '未记录'
  return (
    <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
      <div className="text-xs font-medium text-stone-500 dark:text-stone-400">{label}</div>
      {href ? (
        <a className="mt-1 block break-words text-sm text-primary-700 underline-offset-2 hover:underline dark:text-primary-300" href={href} target="_blank" rel="noreferrer">
          {text}
        </a>
      ) : (
        <div className="mt-1 break-words text-sm text-stone-800 dark:text-stone-100">{text}</div>
      )}
    </div>
  )
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null || (Array.isArray(value) && value.length === 0) || (!Array.isArray(value) && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0)) {
    return null
  }

  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-700 dark:bg-stone-800 dark:text-stone-200">{JSON.stringify(value, null, 2)}</pre>
    </div>
  )
}

function PartDetails({ part }: { part: NonNullable<ResearchRunRecord['parts']>[number] }) {
  const queries = formatList(part.buyerQueries)
  const searchCalls = part.searchCalls || []
  const verificationCalls = part.verificationCalls || []
  const enrichmentCalls = part.enrichmentCalls || []
  const evidence = Array.isArray(part.evidence) ? part.evidence as Array<Record<string, unknown>> : []

  return (
    <details className="group rounded-xl border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <ChevronRight className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-open:rotate-90" aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-stone-900 dark:text-white">{part.title || part.part}</div>
            <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">part: {part.part || 'report'}</div>
          </div>
        </div>
        <StatusBadge status={part.status} />
      </summary>
      <div className="space-y-4 border-t border-stone-200 px-4 py-4 dark:border-stone-700">
        {part.prompt?.rendered ? (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">实际 Prompt</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-700 dark:bg-stone-800 dark:text-stone-200">{part.prompt.rendered}</pre>
          </div>
        ) : null}

        {queries.length > 0 ? (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Buyer-side 查询词</div>
            <div className="flex flex-wrap gap-2">
              {queries.map((query) => <span key={query} className="max-w-full break-words rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-900 dark:bg-sky-900/30 dark:text-sky-100">{query}</span>)}
            </div>
          </div>
        ) : null}

        {searchCalls.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-700">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-stone-50 text-stone-500 dark:bg-stone-800 dark:text-stone-300">
                <tr><th className="px-3 py-2">Provider</th><th className="px-3 py-2">Query</th><th className="px-3 py-2">结果</th><th className="px-3 py-2">状态</th></tr>
              </thead>
              <tbody>
                {searchCalls.map((call, index) => <tr key={`${asString(call.query)}-${index}`} className="border-t border-stone-200 dark:border-stone-700"><td className="px-3 py-2">{asString(call.provider) || '未记录'}</td><td className="max-w-md break-words px-3 py-2">{asString(call.query) || '未记录'}</td><td className="px-3 py-2">{asString(call.resultCount) || '0'}</td><td className="px-3 py-2">{call.ok === false ? '失败' : '完成'}</td></tr>)}
              </tbody>
            </table>
          </div>
        ) : null}

        {verificationCalls.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">地图验证</div>
            {verificationCalls.map((call, index) => <div key={`${asString(call.companyName)}-${index}`} className="rounded-xl bg-stone-50 p-3 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-200"><div className="font-semibold">{asString(call.companyName) || '未命名公司'}</div><div className="mt-1 break-words">{call.verified ? '已匹配' : '待人工复核'} · confidence {asString(call.confidence) || '0'}</div>{call.error ? <div className="mt-1 break-words text-red-700 dark:text-red-300">错误：{asString(call.error)}</div> : null}</div>)}
          </div>
        ) : null}

        {enrichmentCalls.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">官网联系方式补全</div>
            {enrichmentCalls.map((call, index) => <div key={`${asString(call.website)}-${index}`} className="rounded-xl bg-stone-50 p-3 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-200"><div className="font-semibold">{asString(call.companyName) || '未命名公司'}</div><div className="mt-1 break-words">{asString(call.status) || '未记录'} · 邮箱 {asString(call.emailCount) || '0'} 个</div>{Array.isArray(call.contactPages) && call.contactPages.length > 0 ? <div className="mt-1 break-words">来源页：{call.contactPages.join(' | ')}</div> : null}</div>)}
          </div>
        ) : null}

        {evidence.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Evidence</div>
            {evidence.map((item, index) => <div key={`${asString(item.sourceUrl)}-${index}`} className="rounded-xl bg-stone-50 p-3 text-xs dark:bg-stone-800"><div className="font-semibold text-stone-800 dark:text-stone-100">{asString(item.title) || 'Public evidence'}</div><div className="mt-1 break-words text-stone-600 dark:text-stone-300">{asString(item.snippet || item.value) || '未记录摘要'}</div>{asString(item.sourceUrl) ? <a className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-primary-700 hover:underline dark:text-primary-300" href={asString(item.sourceUrl)} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />来源</a> : null}</div>)}
          </div>
        ) : null}

        <JsonBlock label="本 part 的最终结果" value={part.results} />
        <JsonBlock label="本 part 的报告" value={part.report} />
        <JsonBlock label="公开联系方式" value={part.publicContacts} />

        {part.unresolvedQuestions && part.unresolvedQuestions.length > 0 ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-100"><div className="font-semibold">待处理问题</div><ul className="mt-1 list-disc space-y-1 pl-4">{part.unresolvedQuestions.map((question) => <li key={question}>{question}</li>)}</ul></div> : null}
      </div>
    </details>
  )
}

function CompanyEvidence({ run }: { run: ResearchRunRecord }) {
  const companies = run.workspace?.companies || []
  if (!companies.length) return null

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-stone-900 dark:text-white">可开发公司字段</div>
      {companies.map((company) => (
        <div key={company.id || company.name} className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-white"><Building2 className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />{company.name}</div>{company.website ? <a className="mt-1 block break-all text-xs text-primary-700 hover:underline dark:text-primary-300" href={company.website} target="_blank" rel="noreferrer">{company.website}</a> : null}</div>
            <StatusBadge status={company.dataQuality?.needsReview ? 'needs_review' : 'completed'} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <KeyValue label="地址" value={company.address} />
            <KeyValue label="电话" value={company.phone} />
            <KeyValue label="地图" value={company.mapVerified ? `已验证 · ${company.map?.placeId || '有匹配'}` : '待复核'} />
            <KeyValue label="邮箱状态" value={company.contactEmailStatus || (company.contactEmails?.length ? '已发现公开邮箱' : '未发现公开邮箱')} />
          </div>
          {company.contactEmails?.length ? <div className="mt-3 flex flex-wrap gap-2">{company.contactEmails.map((email) => <a key={email} className="inline-flex max-w-full items-center gap-1 break-all rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-900 hover:underline dark:bg-sky-900/30 dark:text-sky-100" href={`mailto:${email}`}><Mail className="h-3 w-3 shrink-0" aria-hidden="true" />{email}</a>)}</div> : null}
          {company.contactPages?.length ? <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-600 dark:text-stone-300">来源页：{company.contactPages.map((page) => <a key={page} className="break-all text-primary-700 hover:underline dark:text-primary-300" href={page} target="_blank" rel="noreferrer">{page}</a>)}</div> : null}
        </div>
      ))}
    </div>
  )
}

export default function Logs() {
  const [runs, setRuns] = useState<ResearchRunRecord[]>([])
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set())
  const [workflow, setWorkflow] = useState('')
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const loadRuns = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      setRuns(await fetchResearchRuns({ workflow, status, query }))
    } catch (loadError) {
      console.error('Failed to load research runs:', loadError)
      setRuns([])
      setError(loadError instanceof Error ? loadError.message : '读取 Research Runs 失败')
    } finally {
      setIsLoading(false)
    }
  }, [workflow, status, query])

  useEffect(() => { void loadRuns() }, [loadRuns])

  function toggleRun(runId: string) {
    const next = new Set(expandedRuns)
    if (next.has(runId)) next.delete(runId)
    else next.add(runId)
    setExpandedRuns(next)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0"><h2 className="text-3xl font-bold text-gray-900 dark:text-white">Research Runs</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-gray-600 dark:text-gray-400">所有获客流程都在这里按 workflow 和 part 留痕。展开一条记录，可以定位 buyer query、地图验证、官网邮箱来源和失败原因。</p></div>
        <Button type="button" variant="outline" onClick={() => void loadRuns()} disabled={isLoading} className="min-h-11 shrink-0"><RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />刷新记录</Button>
      </div>

      <Card className="border-gray-200 shadow-sm dark:border-stone-700">
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-stone-600 dark:text-stone-300"><span className="inline-flex items-center gap-1"><Filter className="h-3.5 w-3.5" aria-hidden="true" />Workflow</span><select value={workflow} onChange={(event) => setWorkflow(event.target.value)} className="min-h-11 rounded-xl border border-stone-200 bg-white px-3 text-sm font-normal text-stone-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200 dark:border-stone-700 dark:bg-stone-900 dark:text-white"><option value="">全部流程</option><option value="lead-finder">Lead Finder</option><option value="similar-company">Similar Company</option><option value="osint">OSINT</option><option value="google-maps">Google Maps</option></select></label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-stone-600 dark:text-stone-300"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)} className="min-h-11 rounded-xl border border-stone-200 bg-white px-3 text-sm font-normal text-stone-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200 dark:border-stone-700 dark:bg-stone-900 dark:text-white"><option value="">全部状态</option><option value="completed">已完成</option><option value="partial">部分完成</option><option value="needs_review">待复核</option><option value="failed">失败</option></select></label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-stone-600 dark:text-stone-300 md:col-span-2"><span className="inline-flex items-center gap-1"><Search className="h-3.5 w-3.5" aria-hidden="true" />搜索标题、公司或 query</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 rounded-xl border border-stone-200 bg-white px-3 text-sm font-normal text-stone-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="例如 Enphase 或 industrial connectors" /></label>
        </CardContent>
      </Card>

      {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}。可以点击“刷新记录”重试。</div> : null}

      {isLoading ? <Card className="border-gray-200 shadow-sm dark:border-stone-700"><CardContent className="flex items-center justify-center gap-2 p-12 text-sm text-stone-500 dark:text-stone-400"><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />正在读取研究记录…</CardContent></Card> : runs.length === 0 ? <Card className="border-gray-200 shadow-sm dark:border-stone-700"><CardContent className="p-12 text-center text-stone-600 dark:text-stone-300"><FileText className="mx-auto mb-4 h-12 w-12 opacity-50" aria-hidden="true" /><p className="text-lg font-semibold">暂时没有匹配的 Research Run</p><p className="mt-2 text-sm">完成 Lead Finder、Similar Company 或 OSINT 后，记录会自动出现在这里。</p></CardContent></Card> : <div className="space-y-4">{runs.map((run) => {
        const expanded = expandedRuns.has(run.id)
        const companies = run.workspace?.companies || (Array.isArray(run.results) ? run.results : [])
        const parts = run.parts || []
        const resultCount = companies.length || (Array.isArray(run.results) ? run.results.length : 0)
        const Icon = expanded ? ChevronDown : ChevronRight
        return <Card key={run.id} className="overflow-hidden border-gray-200 shadow-sm dark:border-stone-700"><CardHeader className="p-0"><div className="flex items-start gap-3 p-4 sm:p-5"><button type="button" aria-expanded={expanded} aria-controls={`run-details-${run.id}`} aria-label={`${expanded ? '收起' : '展开'} ${run.title || run.id}`} onClick={() => toggleRun(run.id)} className="mt-0.5 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-stone-500 transition hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-stone-800"><Icon className="h-5 w-5" aria-hidden="true" /></button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><CardTitle className="break-words text-lg">{run.title || run.workflow || run.id}</CardTitle><StatusBadge status={run.status} /></div><CardDescription className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"><span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{formatDate(run.createdAt)}</span><span>workflow: {run.workflow || 'unknown'}</span><span>part: {run.part || 'report'}</span></CardDescription></div><div className="hidden shrink-0 text-right text-xs text-stone-500 dark:text-stone-400 sm:block"><div>{resultCount ? `${resultCount} 家公司/地点` : '无公司结果'}</div><div className="mt-1">{parts.length || 0} 个 part</div></div></div></CardHeader>{expanded ? <CardContent id={`run-details-${run.id}`} className="space-y-5 border-t border-stone-200 bg-stone-50/50 p-4 dark:border-stone-700 dark:bg-stone-950/20 sm:p-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><KeyValue label="Run ID" value={run.id} /><KeyValue label="创建时间" value={formatDate(run.createdAt)} /><KeyValue label="过期时间（60天）" value={formatDate(run.expiresAt)} /><KeyValue label="调用计数" value={`搜索 ${(run.searchCalls || []).length} · 验证 ${(run.verificationCalls || []).length} · 补全 ${(run.enrichmentCalls || []).length}`} /></div>{run.queryInput ? <div><div className="mb-2 text-sm font-semibold text-stone-900 dark:text-white">输入与定位</div><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-stone-900 p-3 text-xs leading-5 text-stone-100">{JSON.stringify(run.queryInput, null, 2)}</pre></div> : null}<JsonBlock label="Run 最终结果" value={run.results} />{parts.length ? <div className="space-y-2"><div className="text-sm font-semibold text-stone-900 dark:text-white">执行 parts（逐段可展开）</div>{parts.map((part, index) => <PartDetails key={part.id || `${part.part}-${index}`} part={part} />)}</div> : null}<CompanyEvidence run={run} />{run.errors?.length ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200"><div className="font-semibold">错误与待处理项</div><ul className="mt-1 list-disc space-y-1 pl-5">{run.errors.map((item) => <li key={asString(item)} className="break-words">{asString(item)}</li>)}</ul></div> : null}{run.workspace?.id ? <div className="flex flex-wrap gap-2"><a href={`/api/lead-workspaces/${run.workspace.id}/export.csv`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-sm font-medium text-stone-800 hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"><ExternalLink className="h-4 w-4" aria-hidden="true" />导出 CSV</a><a href={`/api/lead-workspaces/${run.workspace.id}/export.xlsx`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-500"><ExternalLink className="h-4 w-4" aria-hidden="true" />导出 XLSX</a></div> : null}</CardContent> : null}</Card>
      })}</div>}
    </div>
  )
}
