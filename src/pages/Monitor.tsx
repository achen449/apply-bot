import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Trash2, Building2, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'

interface MonitoredCompany {
  id: string
  name: string
  website: string
  country: string
  notes: string
  addedAt: string
  lastCheckedAt?: string
  lastRunId?: string
  lastSummary?: string
}

export default function Monitor() {
  const [monitoredCompanies, setMonitoredCompanies] = useState<MonitoredCompany[]>([])
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newCompanyWebsite, setNewCompanyWebsite] = useState('')
  const [newCompanyCountry, setNewCompanyCountry] = useState('')
  const [newCompanyNotes, setNewCompanyNotes] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/monitored-companies')
      const data = await response.json()
      setMonitoredCompanies(Array.isArray(data.companies) ? data.companies : [])
    } catch (error) {
      console.error('Failed to load monitored companies:', error)
      setMonitoredCompanies([])
    } finally {
      setIsLoading(false)
    }
  }

  const saveCompanies = async (companies: MonitoredCompany[]) => {
    const response = await fetch('/api/monitored-companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companies })
    })

    if (!response.ok) {
      throw new Error('Failed to save monitored companies')
    }

    setMonitoredCompanies(companies)
  }

  const handleAddCompany = async () => {
    const name = newCompanyName.trim()
    const website = newCompanyWebsite.trim()

    if (!name) {
      alert('请输入公司名称')
      return
    }

    if (!website) {
      alert('请输入公司官网或主要网址')
      return
    }

    if (monitoredCompanies.some((company) => company.name.toLowerCase() === name.toLowerCase())) {
      alert('这家公司已经在监控列表里')
      return
    }

    const nextCompany: MonitoredCompany = {
      id: `company-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      website,
      country: newCompanyCountry.trim(),
      notes: newCompanyNotes.trim(),
      addedAt: new Date().toISOString()
    }

    try {
      await saveCompanies([nextCompany, ...monitoredCompanies])
      setNewCompanyName('')
      setNewCompanyWebsite('')
      setNewCompanyCountry('')
      setNewCompanyNotes('')
    } catch (error) {
      console.error('Failed to add monitored company:', error)
      alert('保存失败，请稍后重试')
    }
  }

  const handleRemoveCompany = async (companyId: string) => {
    try {
      await saveCompanies(monitoredCompanies.filter((company) => company.id !== companyId))
    } catch (error) {
      console.error('Failed to remove monitored company:', error)
      alert('删除失败，请稍后重试')
    }
  }

  const handleRefreshResearch = async (company: MonitoredCompany) => {
    try {
      setRefreshingId(company.id)
      const response = await fetch('/api/lead-workspaces/osint-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: company.name,
          website: company.website,
          country: company.country,
          clues: [company.notes].filter(Boolean),
          mode: 'company_due_diligence'
        })
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to refresh company research')
      }

      const research = result.research || result
      const summary = research.aiStructuredReport?.conclusion
        || research.report?.overview?.canonicalName
        || research.unresolvedQuestions?.[0]
        || '背调已更新，可在 Research Runs 或 OSINT 结果中查看。'

      await saveCompanies(monitoredCompanies.map((item) => item.id === company.id
        ? {
            ...item,
            lastCheckedAt: new Date().toISOString(),
            lastRunId: research.researchCase?.caseId || research.subject?.subjectRef || '',
            lastSummary: summary
          }
        : item))
    } catch (error) {
      console.error('Failed to refresh company research:', error)
      alert('更新背调失败，请检查 API Key / AI / Gist 配置')
    } finally {
      setRefreshingId(null)
    }
  }

  if (isLoading) {
    return <div className="p-6 text-gray-500 dark:text-gray-400">Loading company monitor...</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Company Research Monitor</h1>
        <p className="text-gray-600 dark:text-gray-400">
          跟踪重点目标公司官网和公开信息，按需触发 OSINT 背调更新，沉淀长期客户情报。
        </p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={newCompanyName} onChange={(event) => setNewCompanyName(event.target.value)} placeholder="公司名称，例如 GoodWe" className="w-full px-4 py-2 border border-gray-300 dark:border-stone-600 rounded-lg bg-white dark:bg-stone-800 text-gray-900 dark:text-white" />
            <input value={newCompanyWebsite} onChange={(event) => setNewCompanyWebsite(event.target.value)} placeholder="官网，例如 https://www.goodwe.com" className="w-full px-4 py-2 border border-gray-300 dark:border-stone-600 rounded-lg bg-white dark:bg-stone-800 text-gray-900 dark:text-white" />
            <input value={newCompanyCountry} onChange={(event) => setNewCompanyCountry(event.target.value)} placeholder="国家/市场，可选" className="w-full px-4 py-2 border border-gray-300 dark:border-stone-600 rounded-lg bg-white dark:bg-stone-800 text-gray-900 dark:text-white" />
            <input value={newCompanyNotes} onChange={(event) => setNewCompanyNotes(event.target.value)} placeholder="关注点，例如 BESS / inverter / connector sourcing" className="w-full px-4 py-2 border border-gray-300 dark:border-stone-600 rounded-lg bg-white dark:bg-stone-800 text-gray-900 dark:text-white" />
          </div>
          <div className="flex justify-end">
            <button onClick={handleAddCompany} className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2">
              <Plus size={20} /> 添加监控公司
            </button>
          </div>
        </CardContent>
      </Card>

      {monitoredCompanies.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ShieldCheck size={48} className="mx-auto mb-4 text-gray-400 dark:text-gray-600" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">还没有监控公司</h3>
            <p className="text-gray-600 dark:text-gray-400">添加官网后，可定期触发背调更新公司产品、地址、联系人和风险信息。</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Focus</TableHead>
                  <TableHead>Last Research</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monitoredCompanies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium"><div className="flex items-center gap-2"><Building2 size={18} />{company.name}</div></TableCell>
                    <TableCell><a href={company.website} target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 max-w-md truncate"><span className="truncate">{company.website}</span><ExternalLink size={14} /></a></TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400 max-w-xs truncate">{company.notes || company.country || 'General OSINT'}</TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400 max-w-md">
                      {company.lastCheckedAt ? <div><div>{new Date(company.lastCheckedAt).toLocaleString()}</div><div className="text-xs truncate">{company.lastSummary}</div></div> : '未更新'}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <button onClick={() => handleRefreshResearch(company)} disabled={refreshingId === company.id} className="p-2 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg inline-flex items-center gap-1 disabled:opacity-50" title="更新背调">
                        <RefreshCw size={18} className={refreshingId === company.id ? 'animate-spin' : ''} />
                      </button>
                      <button onClick={() => handleRemoveCompany(company.id)} className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg inline-flex items-center gap-1" title="删除">
                        <Trash2 size={18} />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
