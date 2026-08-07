import { FormEvent, useState } from 'react'
import { Building2, Download, ExternalLink, Globe2, Loader2, Mail, MapPin, Phone, Search, Shield, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface OSINTRequest {
  companyName: string
  website?: string
  address?: string
}

interface OSINTReport {
  companyName: string
  website?: string
  address?: string
  phone?: string
  contactEmails?: string[]
  map?: {
    verified?: boolean
    placeId?: string
    sourceUrl?: string
  } | null
  capturedAt: string

  // 基本信息
  basicInfo?: {
    legalName?: string
    registrationNumber?: string
    businessType?: string
    foundedDate?: string
    status?: string
  }

  // 在线存在
  onlinePresence?: {
    officialWebsite?: string
    publicPhone?: string
    publicEmails?: string[]
    socialMedia?: {
      platform: string
      url: string
      verified?: boolean
    }[]
    domainInfo?: {
      registrar?: string
      registrationDate?: string
      expiryDate?: string
    }
  }

  // 声誉信息
  reputation?: {
    overallScore?: number
    reviews?: {
      source: string
      rating: number
      count: number
    }[]
    complaints?: {
      source: string
      count: number
      severity?: string
    }[]
    mediaPresence?: {
      positive: number
      neutral: number
      negative: number
    }
  }

  // 风险标记
  riskFlags?: {
    category: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    description: string
    source?: string
  }[]

  // 关联信息
  associations?: {
    relatedCompanies?: string[]
    keyPeople?: {
      name: string
      role: string
    }[]
    locations?: string[]
  }

  // 数据源
  sources?: {
    name: string
    url?: string
    lastChecked: string
  }[]
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

function getSeverityColor(severity: string) {
  switch (severity) {
    case 'critical':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
    case 'high':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
    case 'medium':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
    case 'low':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
  }
}

function InfoBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200">
      <div className="font-semibold">{title}</div>
      <div className="mt-2 space-y-1">
        {lines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    </div>
  )
}

function OSINTReportCard({ report }: { report: OSINTReport }) {
  return (
    <div className="space-y-6">
      {/* 基本信息 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-900">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{report.companyName}</h3>
            {report.basicInfo?.legalName && report.basicInfo.legalName !== report.companyName && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">法定名称: {report.basicInfo.legalName}</p>
            )}

            <div className="mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-400">
              {report.website && (
                <div className="flex items-center gap-2">
                  <Globe2 className="h-4 w-4 flex-shrink-0" />
                  <a
                    href={report.website.startsWith('http') ? report.website : `https://${report.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 transition-colors hover:text-primary-600"
                  >
                    {report.website}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {report.address && (
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{report.address}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 flex-shrink-0" />
                {report.phone ? <a href={`tel:${report.phone}`} className="hover:text-primary-600">{report.phone}</a> : <span>未发现公开电话</span>}
              </div>
              <div className="flex items-start gap-2">
                <Mail className="mt-0.5 h-4 w-4 flex-shrink-0" />
                {report.contactEmails?.length ? <div className="flex flex-wrap gap-2">{report.contactEmails.map((email) => <a key={email} href={`mailto:${email}`} className="break-all text-primary-600 hover:underline">{email}</a>)}</div> : <span>未发现公开邮箱</span>}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Google Maps：{report.map?.verified ? `已验证${report.map.placeId ? ` · ${report.map.placeId}` : ''}` : '待复核'}</div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {report.basicInfo?.status && (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                report.basicInfo.status.toLowerCase().includes('active') || report.basicInfo.status.includes('营业')
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
              }`}>
                {report.basicInfo.status}
              </span>
            )}
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatCapturedAt(report.capturedAt)}
            </span>
          </div>
        </div>

        {report.basicInfo && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <InfoBlock
              title="工商信息"
              lines={[
                report.basicInfo.registrationNumber ? `注册号: ${report.basicInfo.registrationNumber}` : '注册号: N/A',
                report.basicInfo.businessType ? `企业类型: ${report.basicInfo.businessType}` : '企业类型: N/A',
                report.basicInfo.foundedDate ? `成立日期: ${report.basicInfo.foundedDate}` : '成立日期: N/A'
              ].filter(Boolean)}
            />
            {report.onlinePresence?.domainInfo && (
              <InfoBlock
                title="域名信息"
                lines={[
                  report.onlinePresence.domainInfo.registrar ? `注册商: ${report.onlinePresence.domainInfo.registrar}` : '注册商: N/A',
                  report.onlinePresence.domainInfo.registrationDate ? `注册日期: ${report.onlinePresence.domainInfo.registrationDate}` : '注册日期: N/A',
                  report.onlinePresence.domainInfo.expiryDate ? `到期日期: ${report.onlinePresence.domainInfo.expiryDate}` : '到期日期: N/A'
                ].filter(Boolean)}
              />
            )}
          </div>
        )}
      </div>

      {/* 风险标记 */}
      {report.riskFlags && report.riskFlags.length > 0 && (
        <Card className="border-gray-200 dark:border-stone-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              风险标记
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report.riskFlags.map((flag, index) => (
                <div
                  key={index}
                  className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">{flag.category}</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${getSeverityColor(flag.severity)}`}>
                          {flag.severity}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{flag.description}</p>
                      {flag.source && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">来源: {flag.source}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 声誉信息 */}
      {report.reputation && (
        <Card className="border-gray-200 dark:border-stone-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-primary-600" />
              声誉评估
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {report.reputation.overallScore !== undefined && (
                <div className="rounded-2xl bg-primary-50 p-4 dark:bg-primary-900/20">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">综合评分</div>
                  <div className="mt-1 text-3xl font-bold text-primary-700 dark:text-primary-300">
                    {report.reputation.overallScore}/100
                  </div>
                </div>
              )}

              {report.reputation.reviews && report.reputation.reviews.length > 0 && (
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">用户评价</h4>
                  <div className="grid gap-3 md:grid-cols-2">
                    {report.reputation.reviews.map((review, index) => (
                      <div key={index} className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{review.source}</span>
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            ⭐ {review.rating}/5
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">{review.count} 条评价</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.reputation.mediaPresence && (
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">媒体曝光</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl bg-emerald-50 p-3 text-center dark:bg-emerald-900/20">
                      <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                        {report.reputation.mediaPresence.positive}
                      </div>
                      <div className="text-xs text-emerald-600 dark:text-emerald-400">正面</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 p-3 text-center dark:bg-gray-800">
                      <div className="text-2xl font-bold text-gray-700 dark:text-gray-300">
                        {report.reputation.mediaPresence.neutral}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">中性</div>
                    </div>
                    <div className="rounded-xl bg-red-50 p-3 text-center dark:bg-red-900/20">
                      <div className="text-2xl font-bold text-red-700 dark:text-red-300">
                        {report.reputation.mediaPresence.negative}
                      </div>
                      <div className="text-xs text-red-600 dark:text-red-400">负面</div>
                    </div>
                  </div>
                </div>
              )}

              {report.reputation.complaints && report.reputation.complaints.length > 0 && (
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">投诉记录</h4>
                  <div className="space-y-2">
                    {report.reputation.complaints.map((complaint, index) => (
                      <div key={index} className="flex items-center justify-between rounded-xl bg-stone-50 p-3 dark:bg-stone-800">
                        <span className="text-sm text-gray-700 dark:text-gray-300">{complaint.source}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">{complaint.count} 条</span>
                          {complaint.severity && (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getSeverityColor(complaint.severity)}`}>
                              {complaint.severity}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 在线存在 */}
      {report.onlinePresence?.socialMedia && report.onlinePresence.socialMedia.length > 0 && (
        <Card className="border-gray-200 dark:border-stone-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe2 className="h-5 w-5 text-primary-600" />
              社交媒体
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {report.onlinePresence.socialMedia.map((social, index) => (
                <a
                  key={index}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3 transition-shadow hover:shadow-md dark:border-stone-700 dark:bg-stone-900"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{social.platform}</span>
                    {social.verified && (
                      <CheckCircle2 className="h-4 w-4 text-blue-600" />
                    )}
                  </div>
                  <ExternalLink className="h-4 w-4 text-gray-400" />
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 关联信息 */}
      {report.associations && (
        <Card className="border-gray-200 dark:border-stone-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-primary-600" />
              关联信息
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {report.associations.keyPeople && report.associations.keyPeople.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">关键人员</h4>
                  <div className="space-y-2">
                    {report.associations.keyPeople.map((person, index) => (
                      <div key={index} className="rounded-xl bg-stone-50 p-3 dark:bg-stone-800">
                        <div className="font-medium text-gray-900 dark:text-white">{person.name}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">{person.role}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.associations.relatedCompanies && report.associations.relatedCompanies.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">关联公司</h4>
                  <div className="space-y-2">
                    {report.associations.relatedCompanies.map((company, index) => (
                      <div key={index} className="rounded-xl bg-stone-50 p-3 text-sm dark:bg-stone-800">
                        {company}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.associations.locations && report.associations.locations.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">业务地点</h4>
                  <div className="space-y-2">
                    {report.associations.locations.map((location, index) => (
                      <div key={index} className="flex items-start gap-2 rounded-xl bg-stone-50 p-3 dark:bg-stone-800">
                        <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{location}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 数据源 */}
      {report.sources && report.sources.length > 0 && (
        <Card className="border-gray-200 dark:border-stone-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Info className="h-5 w-5 text-primary-600" />
              数据来源
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              {report.sources.map((source, index) => (
                <div key={index} className="flex items-center justify-between rounded-xl bg-stone-50 p-3 dark:bg-stone-800">
                  <div className="flex-1">
                    {source.url ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm font-medium text-primary-600 transition-colors hover:text-primary-700"
                      >
                        {source.name}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{source.name}</span>
                    )}
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {formatCapturedAt(source.lastChecked)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function OSINT() {
  const [companyName, setCompanyName] = useState('')
  const [website, setWebsite] = useState('')
  const [address, setAddress] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [report, setReport] = useState<OSINTReport | null>(null)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setReport(null)
    setIsSearching(true)

    try {
      const response = await fetch('/api/osint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          companyName,
          website: website || undefined,
          address: address || undefined
        } as OSINTRequest)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setReport(data)
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : 'OSINT背调失败'
      setError(message)
    } finally {
      setIsSearching(false)
    }
  }

  function handleExportJSON() {
    if (!report) return

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `osint-${report.companyName}-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">OSINT 公司背调</h2>
        <p className="mt-2 max-w-4xl text-sm text-gray-600 dark:text-gray-400">
          输入公司名称、网站或地址，系统将生成结构化背调报告，包含工商信息、在线声誉、风险标记和关联信息。
        </p>
      </div>

      <Card className="border-gray-200 shadow-sm dark:border-stone-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Search className="h-5 w-5 text-primary-600" />
            背调信息
          </CardTitle>
          <CardDescription>
            至少输入公司名称，网站和地址为可选项，提供更多信息可获得更准确的背调结果。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              公司名称 *
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                placeholder="例如：阿里巴巴集团、Tesla Inc"
                required
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                公司网站
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  placeholder="例如：www.example.com"
                  type="url"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                公司地址
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  placeholder="例如：杭州市余杭区文一西路969号"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
              OSINT背调通过公开信息源进行，包括工商数据、社交媒体、新闻报道等。结果仅供参考，不构成法律意见。
            </div>

            <div className="flex gap-3">
              <Button type="submit" disabled={isSearching} className="flex-1">
                {isSearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shield className="mr-2 h-4 w-4" />}
                开始背调
              </Button>
              {report && (
                <Button type="button" onClick={handleExportJSON} variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  导出 JSON
                </Button>
              )}
            </div>
            {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
          </form>
        </CardContent>
      </Card>

      {report && <OSINTReportCard report={report} />}
    </div>
  )
}
