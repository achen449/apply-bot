import { FormEvent, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Building2, Download, ExternalLink, Globe2, Loader2, Mail, Radar, Save, Search, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { createLeadWorkspace, fetchCustomerData, fetchLeadWorkspaces, getCustomerDataExportUrl, getLeadWorkspaceExportUrl, runLeadCompanyOsintResearch, saveCustomerData, updateLeadCompany } from '@/lib/leadApi'
import type { CustomerDataDocument, CustomerDataResponse, LeadCompany, LeadCompanyOsintResearch, LeadWorkspace } from '@/types/leads'

const defaultIndustry = 'industrial connectors'
const defaultKeywords = 'mc4, battery connector, wire harness, high current'

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

export default function LeadFinder() {
  const [industry, setIndustry] = useState(defaultIndustry)
  const [country, setCountry] = useState('')
  const [keywords, setKeywords] = useState(defaultKeywords)
  const [targetTypes, setTargetTypes] = useState<string[]>(['manufacturer', 'system-integrator', 'project-developer'])
  const [excludeTypes, setExcludeTypes] = useState<string[]>(['research-source', 'peer-supplier'])
  const [workspaces, setWorkspaces] = useState<LeadWorkspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('')
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')
  const [draftCompany, setDraftCompany] = useState<LeadCompany | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [researchByCompanyId, setResearchByCompanyId] = useState<Record<string, LeadCompanyOsintResearch | undefined>>({})
  const [researchErrorByCompanyId, setResearchErrorByCompanyId] = useState<Record<string, string | undefined>>({})
  const [researchLoadingCompanyId, setResearchLoadingCompanyId] = useState('')
  const [remoteCustomerData, setRemoteCustomerData] = useState<CustomerDataDocument | null>(null)
  const [customerDataMeta, setCustomerDataMeta] = useState<CustomerDataResponse | null>(null)
  const [customerDataMessage, setCustomerDataMessage] = useState('')
  const [customerDataError, setCustomerDataError] = useState('')
  const [isLoadingCustomerData, setIsLoadingCustomerData] = useState(false)
  const [isSavingCustomerData, setIsSavingCustomerData] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchLeadWorkspaces()
        setWorkspaces(data)
        if (data[0]) {
          setSelectedWorkspaceId(data[0].id)
        }
      } catch (loadError) {
        console.error(loadError)
        setError('加载本地线索工作区失败。')
      } finally {
        setIsLoading(false)
      }
    }

    void load()
  }, [])

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0],
    [selectedWorkspaceId, workspaces]
  )

  useEffect(() => {
    if (!selectedWorkspace) {
      setSelectedCompanyId('')
      setDraftCompany(null)
      return
    }

    const nextCompany = selectedWorkspace.companies.find((company) => company.id === selectedCompanyId) || selectedWorkspace.companies[0] || null
    setSelectedCompanyId(nextCompany?.id || '')
    setDraftCompany(nextCompany ? { ...nextCompany } : null)
  }, [selectedWorkspace, selectedCompanyId])

  const selectedCompany = useMemo(
    () => selectedWorkspace?.companies.find((company) => company.id === selectedCompanyId) ?? selectedWorkspace?.companies[0] ?? null,
    [selectedWorkspace, selectedCompanyId]
  )

  const relatedDrafts = useMemo(
    () => selectedWorkspace?.drafts.filter((draft) => draft.companyId === selectedCompany?.id) ?? [],
    [selectedWorkspace, selectedCompany]
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const workspace = await createLeadWorkspace({
        industry,
        country,
        keywords: keywords.split(',').map((item) => item.trim()).filter(Boolean),
        targetTypes,
        excludeTypes
      })

      setWorkspaces((current) => [workspace, ...current])
      setSelectedWorkspaceId(workspace.id)
      setSelectedCompanyId(workspace.companies[0]?.id || '')
    } catch (submitError) {
      console.error(submitError)
      setError(submitError instanceof Error ? submitError.message : '生成线索失败。')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSaveCompany() {
    if (!selectedWorkspace || !draftCompany) {
      return
    }

    setIsSaving(true)
    setError('')

    try {
      const updated = await updateLeadCompany(selectedWorkspace.id, draftCompany.id, draftCompany)
      setWorkspaces((current) => current.map((workspace) => {
        if (workspace.id !== selectedWorkspace.id) {
          return workspace
        }

        return {
          ...workspace,
          companies: workspace.companies.map((company) => company.id === updated.id ? updated : company)
        }
      }))
      setDraftCompany(updated)
    } catch (saveError) {
      console.error(saveError)
      setError(saveError instanceof Error ? saveError.message : '保存失败。')
    } finally {
      setIsSaving(false)
    }
  }

  function updateDraftCompany(patch: Partial<LeadCompany>) {
    setDraftCompany((current) => current ? { ...current, ...patch } : current)
  }

  async function handleRunResearch() {
    if (!draftCompany) {
      return
    }

    setResearchLoadingCompanyId(draftCompany.id)
    setResearchErrorByCompanyId((current) => ({ ...current, [draftCompany.id]: undefined }))

    try {
      const clues = [
        ...(draftCompany.mainProducts || []),
        ...(draftCompany.targetApplications || []),
        draftCompany.segment,
        draftCompany.profile,
        draftCompany.businessType,
        draftCompany.marketRole,
        draftCompany.buyingRelevance
      ].map((item) => item?.trim()).filter(Boolean) as string[]

      const research = await runLeadCompanyOsintResearch({
        mode: 'company_due_diligence',
        companyName: draftCompany.name,
        website: draftCompany.website,
        country: draftCompany.country,
        address: draftCompany.address,
        personName: draftCompany.customContactName,
        personTitle: draftCompany.customContactTitle,
        clues,
        researchQuestions: [
          'Verify official website and company identity.',
          'Identify evidence-backed public company contacts only.',
          'Flag unresolved diligence gaps and public-source risks.'
        ]
      })

      setResearchByCompanyId((current) => ({ ...current, [draftCompany.id]: research }))
    } catch (researchError) {
      console.error(researchError)
      setResearchErrorByCompanyId((current) => ({
        ...current,
        [draftCompany.id]: researchError instanceof Error ? researchError.message : '尽调研究失败。'
      }))
    } finally {
      setResearchLoadingCompanyId('')
    }
  }

  async function handleLoadCustomerData() {
    setCustomerDataError('')
    setCustomerDataMessage('')
    setIsLoadingCustomerData(true)

    try {
      const response = await fetchCustomerData()
      setCustomerDataMeta(response)
      setRemoteCustomerData(response.data)

      const remoteWorkspaces = Array.isArray(response.data?.leadWorkspaces) ? response.data.leadWorkspaces : []

      if (remoteWorkspaces.length > 0) {
        setWorkspaces(remoteWorkspaces)
        setSelectedWorkspaceId(remoteWorkspaces[0]?.id || '')
        setSelectedCompanyId(remoteWorkspaces[0]?.companies?.[0]?.id || '')
        setCustomerDataMessage(`已从 ${response.fileName} 载入 ${remoteWorkspaces.length} 个远程工作区。`)
      } else {
        setCustomerDataMessage(`已读取 ${response.fileName}，但其中还没有保存的 lead workspaces。`)
      }
    } catch (loadError) {
      console.error(loadError)
      setCustomerDataError(loadError instanceof Error ? loadError.message : '加载远程客户数据失败。')
    } finally {
      setIsLoadingCustomerData(false)
    }
  }

  async function handleSaveCustomerData() {
    setCustomerDataError('')
    setCustomerDataMessage('')
    setIsSavingCustomerData(true)

    try {
      const payload: CustomerDataDocument = {
        ...(remoteCustomerData || {}),
        leadWorkspaces: workspaces,
        lastSyncedAt: new Date().toISOString(),
        lastSyncSource: 'lead-finder'
      }

      const response = await saveCustomerData(payload)
      setCustomerDataMeta(response)
      setRemoteCustomerData(response.data)
      setCustomerDataMessage(`已将 ${workspaces.length} 个工作区保存到 ${response.fileName}。`)
    } catch (saveError) {
      console.error(saveError)
      setCustomerDataError(saveError instanceof Error ? saveError.message : '保存远程客户数据失败。')
    } finally {
      setIsSavingCustomerData(false)
    }
  }

  const currentResearch = draftCompany ? researchByCompanyId[draftCompany.id] : undefined
  const currentResearchError = draftCompany ? researchErrorByCompanyId[draftCompany.id] : undefined
  const isResearching = draftCompany ? researchLoadingCompanyId === draftCompany.id : false

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Lead Finder</h2>
          <p className="mt-2 max-w-4xl text-sm text-gray-600 dark:text-gray-400">
            输入行业、关键词和国家后，系统会优先尝试真实搜索公司并访问官网，抽取业务摘要、适配方向和公共联系邮箱。你可以再手动补 Apollo / Hunter 联系人，并把开发信与客户进度记录回本地系统。
          </p>
        </div>
        {selectedWorkspace ? (
          <div className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-900 dark:border-primary-900/40 dark:bg-primary-900/10 dark:text-primary-200">
            最近工作区: <span className="font-semibold">{selectedWorkspace.industry}</span>
            {selectedWorkspace.country ? ` / ${selectedWorkspace.country}` : ' / Global'}
          </div>
        ) : null}
      </div>

      <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Radar className="h-5 w-5 text-primary-600" />
            Discovery Input
          </CardTitle>
          <CardDescription>
            有 `TAVILY_API_KEY` / `BRAVE_API_KEY` / `GOOGLE_MAPS_API_KEY` 时会优先使用真实搜索；没有时自动回退到本地行业种子数据。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 lg:grid-cols-4" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 lg:col-span-2">
              行业
              <input value={industry} onChange={(event) => setIndustry(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="例如 industrial connectors" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              国家
              <input value={country} onChange={(event) => setCountry(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="例如 Germany" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              关键词
              <input value={keywords} onChange={(event) => setKeywords(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="逗号分隔" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 lg:col-span-2">
              Target Types
              <input value={targetTypes.join(', ')} onChange={(event) => setTargetTypes(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="manufacturer, system-integrator, project-developer" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 lg:col-span-2">
              Exclude Types
              <input value={excludeTypes.join(', ')} onChange={(event) => setExcludeTypes(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white" placeholder="research-source, peer-supplier" />
            </label>
            <div className="lg:col-span-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-gray-500 dark:text-gray-400">系统输出的是粗筛和官网分析结果，适合你再去 Apollo / Hunter 做联系人补全。</div>
              <Button type="submit" disabled={isSubmitting} className="min-w-[180px]">
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                生成目标公司列表
              </Button>
            </div>
            {error ? <div className="lg:col-span-4 text-sm text-red-600 dark:text-red-400">{error}</div> : null}
          </form>
        </CardContent>
      </Card>

      <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-xl">Customer Data Sync</CardTitle>
              <CardDescription>
                通过 `GET /api/customer-data` 和 `PUT /api/customer-data` 把 Lead Finder 工作区读写到 Gist。保存时会保留远程 JSON 里的其它字段，只更新 `leadWorkspaces`。
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <a href={getCustomerDataExportUrl()}>
                <Button type="button" variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  导出完整 Excel
                </Button>
              </a>
              <Button type="button" variant="outline" onClick={handleLoadCustomerData} disabled={isLoadingCustomerData}>
                {isLoadingCustomerData ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                载入远程客户数据
              </Button>
              <Button type="button" onClick={handleSaveCustomerData} disabled={isSavingCustomerData || workspaces.length === 0}>
                {isSavingCustomerData ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                保存当前工作区
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <InfoBlock title="远程存储" lines={[
              `Storage: ${customerDataMeta?.storage || 'gist'}`,
              `File: ${customerDataMeta?.fileName || 'customer-data.json'}`,
              `Exists: ${customerDataMeta?.exists ? 'Yes' : customerDataMeta ? 'No' : 'Unknown'}`,
              `Updated: ${customerDataMeta?.updatedAt ? formatDate(customerDataMeta.updatedAt) : 'Not loaded yet'}`
            ]} />
            <InfoBlock title="当前同步范围" lines={[
              `Lead Workspaces: ${workspaces.length}`,
              `Selected Workspace: ${selectedWorkspace?.industry || 'None'}`,
              `Remote Workspaces: ${Array.isArray(remoteCustomerData?.leadWorkspaces) ? remoteCustomerData.leadWorkspaces.length : 0}`,
              `Remote Customers: ${Array.isArray(remoteCustomerData?.customers) ? remoteCustomerData.customers.length : 0}`
            ]} />
            <InfoBlock title="操作说明" lines={[
              'Load: pull remote JSON from Gist into this UI.',
              'Save: merge current lead workspaces back into the same JSON document.',
              'Missing env: set GIST_ID and GITHUB_GIST_TOKEN in Vercel/local env.',
              'Secrets never appear in this page.'
            ]} />
          </div>

          {customerDataMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-900/10 dark:text-emerald-200">
              {customerDataMessage}
            </div>
          ) : null}

          {customerDataError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-300">
              {customerDataError}
            </div>
          ) : null}

          {!customerDataMessage && !customerDataError ? (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
              先点击“载入远程客户数据”检查 Gist 连接，再决定是否把当前 Lead Finder 工作区保存回远程 JSON。
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Workspace History</CardTitle>
            <CardDescription>保存最近 25 次搜索结果，方便按市场和行业反复筛选。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? <div className="text-sm text-gray-500 dark:text-gray-400">正在加载...</div> : null}
            {!isLoading && workspaces.length === 0 ? <div className="text-sm text-gray-500 dark:text-gray-400">还没有生成过工作区。</div> : null}
            {workspaces.map((workspace) => {
              const active = workspace.id === selectedWorkspace?.id
              return (
                <button key={workspace.id} type="button" onClick={() => setSelectedWorkspaceId(workspace.id)} className={`w-full rounded-2xl border px-4 py-3 text-left transition ${active ? 'border-primary-300 bg-primary-50 dark:border-primary-900/50 dark:bg-primary-900/10' : 'border-gray-200 bg-white hover:border-primary-200 hover:bg-gray-50 dark:border-stone-700 dark:bg-stone-900'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-gray-900 dark:text-white">{workspace.industry}</div>
                    <Sparkles className="h-4 w-4 text-primary-600" />
                  </div>
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{workspace.country || 'Global'} · {formatDate(workspace.createdAt)}</div>
                  <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">Providers: {(workspace.providersUsed || ['seeded-profile']).join(', ')}</div>
                  {workspace.searchStrategy ? <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Strategy: {workspace.searchStrategy.targetTypes.join(', ')} | exclude {workspace.searchStrategy.excludeTypes.join(', ')} | {workspace.searchStrategy.queryCount} queries</div> : null}
                </button>
              )
            })}
          </CardContent>
        </Card>

        {selectedWorkspace ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <MetricCard icon={Building2} label="目标公司" value={selectedWorkspace.summary.companyCount} />
              <MetricCard icon={UserRound} label="建议联系人" value={selectedWorkspace.summary.contactCount} />
              <MetricCard icon={Mail} label="开发信草稿" value={selectedWorkspace.summary.draftCount} />
              <MetricCard icon={Globe2} label="推荐赛道" value={selectedWorkspace.recommendedSegments.length} />
            </div>

            <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="text-xl">Company Ranking</CardTitle>
                    <CardDescription>这里是粗排结果。进入右侧详情后，你可以继续编辑邮箱、联系人、开发信和跟进状态。</CardDescription>
                  </div>
                  <a href={getLeadWorkspaceExportUrl(selectedWorkspace.id)}>
                    <Button variant="outline">
                      <Download className="mr-2 h-4 w-4" />
                      导出 Excel
                    </Button>
                  </a>
                </div>
              </CardHeader>
              <CardContent className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                <div className="space-y-3">
                  {selectedWorkspace.companies.map((company) => {
                    const active = company.id === selectedCompany?.id
                    return (
                      <button key={company.id} type="button" onClick={() => setSelectedCompanyId(company.id)} className={`w-full rounded-2xl border px-4 py-4 text-left transition ${active ? 'border-primary-300 bg-primary-50 dark:border-primary-900/50 dark:bg-primary-900/10' : 'border-gray-200 bg-white hover:border-primary-200 hover:bg-gray-50 dark:border-stone-700 dark:bg-stone-900'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-gray-900 dark:text-white">{company.name}</div>
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{company.segment} · {company.businessType || company.profile}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-gray-500 dark:text-gray-400">Fit</div>
                            <div className="text-xl font-bold text-primary-700 dark:text-primary-300">{company.fitScore}</div>
                          </div>
                        </div>
                        <div className="mt-3 text-sm text-gray-600 dark:text-gray-300 line-clamp-3">{company.buyingRelevance || company.businessSummary || company.whyFit}</div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{company.priority}</span>
                          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-700 dark:bg-stone-800 dark:text-stone-200">{company.pipelineStatus || 'researching'}</span>
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">{company.size}</span>
                          {company.marketRole ? <span className="rounded-full bg-violet-100 px-2.5 py-1 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200">{company.marketRole}</span> : null}
                          {company.matchedQueryCount ? <span className="rounded-full bg-orange-100 px-2.5 py-1 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200">{company.matchedQueryCount} query hits</span> : null}
                          {company.officialWebsiteLikely ? <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">likely official</span> : null}
                        </div>
                      </button>
                    )
                  })}
                </div>

                {draftCompany ? (
                  <div className="space-y-6">
                    <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
                      <CardHeader>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <CardTitle className="text-xl">{draftCompany.name}</CardTitle>
                            <CardDescription>{draftCompany.businessType || draftCompany.profile} · {(draftCompany.source || 'seeded-profile').toUpperCase()}</CardDescription>
                          </div>
                          <div className="flex gap-2">
                            <a href={draftCompany.website} target="_blank" rel="noreferrer">
                              <Button variant="outline"><ExternalLink className="mr-2 h-4 w-4" />官网</Button>
                            </a>
                            <Button variant="outline" onClick={handleRunResearch} disabled={isResearching}>
                              {isResearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                              公司尽调
                            </Button>
                            <Button onClick={handleSaveCompany} disabled={isSaving}>
                              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                              保存信息
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div className="grid gap-4 md:grid-cols-2">
                          <InfoBlock title="评分与信号" lines={[`Fit Score: ${draftCompany.fitScore}`, `Priority: ${draftCompany.priority}`, `Scale: ${draftCompany.possibleScaleSignal || draftCompany.size}`, `Employee Band: ${draftCompany.employeeEstimate || 'Unknown'}`, `Country: ${draftCompany.country}`]} />
                          <InfoBlock title="来源" lines={[`Provider: ${(draftCompany.matchedProviders || [draftCompany.source || 'seeded-profile']).join(', ')}`, `Profile: ${draftCompany.profile}`, `Segment: ${draftCompany.segment}`, `Market Role: ${draftCompany.marketRole || 'unclear'}`, `Query Hits: ${draftCompany.matchedQueryCount || 1}`, `Query Labels: ${(draftCompany.matchedQueryLabels || []).join(', ') || 'company'}`, `Official Website Likely: ${draftCompany.officialWebsiteLikely ? 'Yes' : 'No'}`, `Source URL: ${draftCompany.sourceUrl || draftCompany.website}`]} />
                        </div>

                        <EditableTextarea label="官网业务摘要" value={draftCompany.businessSummary || ''} onChange={(value) => updateDraftCompany({ businessSummary: value })} />
                        <EditableTextarea label="采购相关性 / 开发切入点" value={draftCompany.buyingRelevance || ''} onChange={(value) => updateDraftCompany({ buyingRelevance: value })} rows={4} />

                        <div className="grid gap-4 md:grid-cols-2">
                          <EditableInput label="总部 / Base" value={draftCompany.headquarters || ''} onChange={(value) => updateDraftCompany({ headquarters: value })} />
                          <EditableInput label="成立年份" value={draftCompany.foundedYear || ''} onChange={(value) => updateDraftCompany({ foundedYear: value })} />
                        </div>

                        <EditableTextarea label="规模信号" value={[draftCompany.possibleScaleSignal || '', ...(draftCompany.scaleSignals || [])].filter(Boolean).join(', ')} onChange={(value) => updateDraftCompany({ scaleSignals: value.split(',').map((item) => item.trim()).filter(Boolean) })} rows={3} />

                        <div className="grid gap-4 md:grid-cols-2">
                          <EditableInput label="主联系人姓名" value={draftCompany.customContactName || ''} onChange={(value) => updateDraftCompany({ customContactName: value })} />
                          <EditableInput label="主联系人职位" value={draftCompany.customContactTitle || ''} onChange={(value) => updateDraftCompany({ customContactTitle: value })} />
                          <EditableInput label="邮箱" value={draftCompany.customEmail || ''} onChange={(value) => updateDraftCompany({ customEmail: value })} />
                          <EditableInput label="LinkedIn" value={draftCompany.customLinkedinUrl || ''} onChange={(value) => updateDraftCompany({ customLinkedinUrl: value })} />
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <EditableTextarea label="官网公开邮箱" value={(draftCompany.contactEmails || []).join(', ')} onChange={(value) => updateDraftCompany({ contactEmails: value.split(',').map((item) => item.trim()).filter(Boolean) })} rows={3} />
                          <EditableTextarea label="主要产品 / 应用" value={[...(draftCompany.mainProducts || []), ...(draftCompany.targetApplications || [])].join(', ')} onChange={(value) => {
                            const items = value.split(',').map((item) => item.trim()).filter(Boolean)
                            updateDraftCompany({ mainProducts: items.slice(0, 4), targetApplications: items.slice(4, 8) })
                          }} rows={3} />
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                            客户进度
                            <select value={draftCompany.pipelineStatus || 'researching'} onChange={(event) => updateDraftCompany({ pipelineStatus: event.target.value })} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-white">
                              {['not_started', 'researching', 'contact_found', 'email_ready', 'sent', 'replied', 'sampling', 'quoting', 'won', 'lost'].map((status) => (
                                <option key={status} value={status}>{status}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                            邮箱状态
                            <select value={draftCompany.customEmailStatus || 'not-found'} onChange={(event) => updateDraftCompany({ customEmailStatus: event.target.value })} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-white">
                              {['not-found', 'found', 'verified', 'risky', 'invalid'].map((status) => (
                                <option key={status} value={status}>{status}</option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <EditableTextarea label="开发备注" value={draftCompany.notes || ''} onChange={(value) => updateDraftCompany({ notes: value })} rows={4} />
                        <EditableTextarea label="开发信 / 跟进记录" value={draftCompany.outreachNotes || ''} onChange={(value) => updateDraftCompany({ outreachNotes: value })} rows={6} />
                      </CardContent>
                    </Card>

                    <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <ShieldCheck className="h-5 w-5 text-primary-600" />
                          Due Diligence Research
                        </CardTitle>
                        <CardDescription>
                          使用公开来源校验公司主体、官网、公开联络方式和未解问题。仅显示返回的 `publicContacts`，不会补猜联系人。
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-stone-50 p-4 text-sm dark:border-stone-700 dark:bg-stone-900/60 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white">研究对象</div>
                            <div className="mt-1 text-gray-600 dark:text-gray-400">{draftCompany.name} · {draftCompany.country || 'Unknown country'} · {draftCompany.website || 'No website clue'}</div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs">
                            <StatusChip tone={currentResearch ? statusTone(currentResearch.status) : 'gray'}>
                              {currentResearch ? `status: ${currentResearch.status}` : 'not started'}
                            </StatusChip>
                            <StatusChip tone={currentResearch?.verification.researchStatus === 'verified' ? 'green' : currentResearch ? 'amber' : 'gray'}>
                              {currentResearch ? `verification: ${currentResearch.verification.researchStatus}` : 'verification pending'}
                            </StatusChip>
                            <StatusChip tone="gray">{`evidence: ${currentResearch?.evidence.length || 0}`}</StatusChip>
                          </div>
                        </div>

                        {currentResearchError ? <div className="text-sm text-red-600 dark:text-red-400">{currentResearchError}</div> : null}
                        {!currentResearch && !currentResearchError ? <div className="text-sm text-gray-500 dark:text-gray-400">触发一次公司尽调后，这里会显示来源可用性、公开证据摘要、风险标记和未解决问题。</div> : null}

                        {currentResearch ? (
                          <div className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-3">
                              <InfoBlock title="研究概览" lines={[
                                `Mode: ${currentResearch.mode}`,
                                `Entity: ${currentResearch.report.overview.canonicalName || currentResearch.subject.companyName || 'unknown'}`,
                                `Website: ${currentResearch.report.overview.officialWebsite || 'unverified'}`,
                                `Address Status: ${currentResearch.verification.addressStatus}`
                              ]} />
                              <InfoBlock title="处理状态" lines={[
                                `Parser: ${currentResearch.parser.used ? 'used' : currentResearch.parser.available ? 'available_not_used' : 'not_configured'}`,
                                `Public Contacts: ${currentResearch.verification.publicContactStatus}`,
                                `Maps Match: ${currentResearch.verification.mapsMatchStatus}`,
                                `Research Case: ${currentResearch.researchCase.status}`
                              ]} />
                              <InfoBlock title="证据覆盖" lines={[
                                `Providers with results: ${new Set(currentResearch.providerResults.map((item) => item.provider)).size}`,
                                `Evidence Records: ${currentResearch.evidence.length}`,
                                `Findings: ${currentResearch.findings.length}`,
                                `Open Questions: ${currentResearch.unresolvedQuestions.length}`
                              ]} />
                            </div>

                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
                              <div className="space-y-4">
                                <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-semibold text-gray-900 dark:text-white">Provider Availability</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">source/provider QA</div>
                                  </div>
                                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                                    {currentResearch.providerAvailability.map((provider) => (
                                      <div key={provider.provider} className="rounded-xl border border-gray-200 bg-stone-50 p-3 text-sm dark:border-stone-700 dark:bg-stone-800">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="font-medium text-gray-900 dark:text-white">{provider.provider}</div>
                                          <StatusChip tone={provider.available ? 'green' : 'gray'}>{provider.available ? 'available' : 'skipped'}</StatusChip>
                                        </div>
                                        <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
                                          <div>Queries: {provider.queriesAttempted}</div>
                                          <div>Results: {provider.resultCount}</div>
                                          <div>Reason: {provider.reason || 'n/a'}</div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </section>

                                <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Findings</div>
                                  <div className="mt-3 space-y-3">
                                    {currentResearch.findings.length === 0 ? <div className="text-sm text-gray-500 dark:text-gray-400">No structured findings yet.</div> : null}
                                    {currentResearch.findings.map((finding, index) => (
                                      <article key={`${finding.findingType}-${index}`} className="rounded-xl border border-gray-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <div className="font-medium text-gray-900 dark:text-white">{finding.label}</div>
                                          <StatusChip tone={finding.verificationStatus === 'discovered' ? 'blue' : 'amber'}>{finding.verificationStatus}</StatusChip>
                                          <StatusChip tone="gray">{finding.findingType}</StatusChip>
                                        </div>
                                        <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">{finding.value}</div>
                                        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Confidence: {typeof finding.confidence === 'number' ? `${Math.round(finding.confidence * 100)}%` : 'n/a'} · Evidence: {finding.evidenceRefs.join(', ') || 'none'}</div>
                                      </article>
                                    ))}
                                  </div>
                                </section>

                                <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Public Contacts</div>
                                  <div className="mt-3 space-y-3">
                                    {currentResearch.publicContacts.length === 0 ? <div className="text-sm text-gray-500 dark:text-gray-400">没有观察到有证据支撑的公开联系方式。</div> : null}
                                    {currentResearch.publicContacts.map((contact) => (
                                      <article key={contact.contactId} className="rounded-xl border border-gray-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <div className="font-medium text-gray-900 dark:text-white">{contact.value}</div>
                                          <StatusChip tone="blue">{contact.contactType}</StatusChip>
                                          <StatusChip tone={contact.verificationStatus === 'observed' ? 'green' : 'amber'}>{contact.verificationStatus}</StatusChip>
                                        </div>
                                        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Scope: {contact.ownerScope} · Source: {contact.sourceType || 'public'} · Evidence: {contact.evidenceRefs.join(', ')}</div>
                                      </article>
                                    ))}
                                  </div>
                                </section>
                              </div>

                              <div className="space-y-4">
                                <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Risk Flags</div>
                                  <div className="mt-3 space-y-2">
                                    {currentResearch.riskFlags.length === 0 ? <div className="text-sm text-gray-500 dark:text-gray-400">No explicit risk flags returned.</div> : null}
                                    {currentResearch.riskFlags.map((risk, index) => (
                                      <div key={`${risk.label}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-100">
                                        <div className="flex items-start gap-2">
                                          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                          <div>
                                            <div className="font-medium">{risk.label}</div>
                                            <div className="mt-1 text-xs opacity-80">Severity: {risk.severity} · Evidence: {risk.evidenceRefs.join(', ') || 'none'}</div>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </section>

                                <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Unresolved Questions</div>
                                  <div className="mt-3 space-y-2">
                                    {currentResearch.unresolvedQuestions.length === 0 ? <div className="text-sm text-gray-500 dark:text-gray-400">No unresolved questions returned.</div> : null}
                                    {currentResearch.unresolvedQuestions.map((question) => (
                                      <div key={question} className="rounded-xl border border-gray-200 bg-stone-50 px-3 py-2 text-sm text-gray-700 dark:border-stone-700 dark:bg-stone-800 dark:text-gray-300">{question}</div>
                                    ))}
                                  </div>
                                </section>

                                <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Products And Scope</div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {currentResearch.report.products.length === 0 ? <span className="text-sm text-gray-500 dark:text-gray-400">No product signals extracted.</span> : null}
                                    {currentResearch.report.products.map((product) => (
                                      <StatusChip key={`${product.name}-${product.category}`} tone="gray">{product.name}</StatusChip>
                                    ))}
                                  </div>
                                </section>

                                <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Compliance Guardrails</div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {Object.entries(currentResearch.compliance).map(([key, value]) => (
                                      <StatusChip key={key} tone={value ? 'green' : 'amber'}>{compactLabel(key)}</StatusChip>
                                    ))}
                                  </div>
                                </section>

                                <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Evidence Provenance</div>
                                  <div className="mt-3 space-y-2">
                                    {currentResearch.evidence.slice(0, 6).map((record) => (
                                      <article key={record.evidenceId} className="rounded-xl border border-gray-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <StatusChip tone="gray">{record.provider}</StatusChip>
                                          <StatusChip tone="gray">{record.sourceType}</StatusChip>
                                          <div className="text-xs text-gray-500 dark:text-gray-400">{record.evidenceId}</div>
                                        </div>
                                        <div className="mt-2 text-sm font-medium text-gray-900 dark:text-white">{record.title || 'Untitled evidence'}</div>
                                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">{record.queryLabel || 'research'}{record.sourceUrl ? ` · ${record.sourceUrl}` : ''}</div>
                                        <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">{record.snippet || 'No snippet available.'}</div>
                                      </article>
                                    ))}
                                    {currentResearch.evidence.length > 6 ? <div className="text-xs text-gray-500 dark:text-gray-400">仅显示前 6 条证据，完整计数为 {currentResearch.evidence.length}。</div> : null}
                                  </div>
                                </section>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>

                    <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-lg">Auto Drafts</CardTitle>
                        <CardDescription>系统根据行业和岗位生成的初版话术，你可以复制后继续改。</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {relatedDrafts.length === 0 ? <div className="text-sm text-gray-500 dark:text-gray-400">当前公司没有自动草稿。</div> : null}
                        {relatedDrafts.map((draft) => (
                          <article key={draft.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
                            <div className="text-sm font-semibold text-gray-900 dark:text-white">{draft.subject}</div>
                            <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{draft.preview}</div>
                            <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-stone-50 p-4 text-sm leading-6 text-stone-700 dark:bg-stone-800 dark:text-stone-100">{draft.body}</pre>
                          </article>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500 dark:border-stone-700 dark:text-gray-400">选择一家公司查看详情。</div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="border-dashed border-gray-300 dark:border-stone-700">
            <CardContent className="flex min-h-[320px] items-center justify-center text-sm text-gray-500 dark:text-gray-400">先生成一个行业工作区，再查看自动发现结果。</CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: number }) {
  return (
    <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="rounded-2xl bg-primary-50 p-3 text-primary-700 dark:bg-primary-900/20 dark:text-primary-200"><Icon className="h-5 w-5" /></div>
        <div>
          <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function InfoBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200">
      <div className="font-semibold">{title}</div>
      <div className="mt-2 space-y-1">{lines.map((line) => <div key={line}>{line}</div>)}</div>
    </div>
  )
}

function EditableInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-white" />
    </label>
  )
}

function EditableTextarea({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
      {label}
      <textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-white" />
    </label>
  )
}

function StatusChip({ children, tone }: { children: string; tone: 'green' | 'amber' | 'blue' | 'gray' }) {
  const toneClassName = {
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
    blue: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200',
    gray: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200'
  }[tone]

  return <span className={`rounded-full px-2.5 py-1 text-xs ${toneClassName}`}>{children}</span>
}

function statusTone(status: string): 'green' | 'amber' | 'blue' | 'gray' {
  if (status === 'completed') {
    return 'green'
  }
  if (status === 'partial') {
    return 'amber'
  }
  if (status === 'needs_review') {
    return 'blue'
  }
  return 'gray'
}

function compactLabel(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (match) => match.toUpperCase())
}
