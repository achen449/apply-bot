import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Clock, FileText, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchResearchRuns, type ResearchRunRecord } from '@/lib/leadApi'

function formatDate(value?: string) {
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

export default function Logs() {
  const [runs, setRuns] = useState<ResearchRunRecord[]>([])
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchResearchRuns()
      .then(setRuns)
      .catch((error) => {
        console.error('Failed to load research runs:', error)
        setRuns([])
      })
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Research Runs</h2>
          <p className="mt-2 max-w-4xl text-sm text-gray-600 dark:text-gray-400">
            这里记录 Lead Finder、Similar Company、OSINT 等流程的 prompt、AI 查询词和结果留痕。
          </p>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {isLoading ? 'Loading...' : `${runs.length} run${runs.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      {isLoading ? (
        <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
          <CardContent className="p-12 text-center text-gray-500 dark:text-gray-400">Loading...</CardContent>
        </Card>
      ) : runs.length === 0 ? (
        <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
          <CardContent className="p-12 text-center text-gray-500 dark:text-gray-400">
            <FileText className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p className="text-lg mb-2">No research runs yet</p>
            <p className="text-sm">Runs will appear here after AI workflows complete.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => {
            const isExpanded = expandedRuns.has(run.id)
            const promptPreview = run.prompt?.rendered?.slice(0, 220) || 'N/A'
            const searchQueries = (run.searchCalls || []).map((call) => call.query).filter(Boolean)

            return (
              <Card key={run.id} className="border-gray-200 dark:border-stone-700 shadow-sm">
                <CardHeader
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-stone-800/50 transition-colors"
                  onClick={() => {
                    const next = new Set(expandedRuns)
                    if (next.has(run.id)) next.delete(run.id)
                    else next.add(run.id)
                    setExpandedRuns(next)
                  }}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronDown className="h-5 w-5 text-gray-400" /> : <ChevronRight className="h-5 w-5 text-gray-400" />}
                      <div>
                        <CardTitle className="text-lg font-semibold">{run.title || run.workflow || run.id}</CardTitle>
                        <CardDescription className="mt-1 flex items-center gap-4">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(run.createdAt)}
                          </span>
                          <span>{run.workflow || 'unknown workflow'}</span>
                        </CardDescription>
                      </div>
                    </div>
                    <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-900/20 dark:text-primary-200">
                      <Sparkles className="mr-1 inline h-3 w-3" />
                      prompt + queries
                    </span>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="space-y-4 pt-0 pb-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <InfoBlock
                        title="Prompt"
                        lines={[
                          `Prompt Key: ${run.prompt?.key || 'N/A'}`,
                          `Rendered: ${promptPreview}`,
                          `Search Calls: ${(run.searchCalls || []).length}`,
                          `Verification Calls: ${(run.verificationCalls || []).length}`
                        ]}
                      />
                      <InfoBlock
                        title="Query Inputs"
                        lines={[
                          `Search Queries: ${searchQueries.length ? searchQueries.join(' | ') : 'N/A'}`,
                          `Workflow: ${run.workflow || 'N/A'}`,
                          `Created At: ${formatDate(run.createdAt)}`
                        ]}
                      />
                    </div>

                    {run.workspace ? (
                      <InfoBlock
                        title="Workspace"
                        lines={[
                          `Industry: ${run.workspace.industry || 'N/A'}`,
                          `Country: ${run.workspace.country || 'N/A'}`,
                          `Companies: ${(run.workspace.companies || []).length}`,
                          `Keywords: ${(run.workspace.keywords || []).join(' | ') || 'N/A'}`
                        ]}
                      />
                    ) : null}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
