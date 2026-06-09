import { FormEvent, useState } from 'react'
import * as XLSX from 'xlsx'
import { CheckCircle2, Download, ExternalLink, Loader2, MapPin, ShieldCheck, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  verifyCompanyWithGoogleMaps,
  batchVerifyCompaniesWithGoogleMaps,
  type BatchVerificationResult,
  type GoogleMapsMatch,
  type GoogleMapsVerificationResult
} from '@/lib/leadApi'

type WorkbookRow = Record<string, string | number | boolean | null | undefined>

const companyNameHeaders = ['company name', 'company', 'name', '公司名称', '公司名', '客户名称', '客户名', '企业名称']
const addressHeaders = ['address', 'location', 'country', 'city', 'state', 'province', '公司地址', '地址', '国家', '城市', '地区', '省份']

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_\-/()（）]/g, '')
}

function getCellValue(row: WorkbookRow, headers: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader)
  const entry = Object.entries(row).find(([key]) => normalizedHeaders.includes(normalizeHeader(key)))
  const value = entry?.[1]
  return value === undefined || value === null ? '' : String(value).trim()
}

function rowToCompany(row: WorkbookRow) {
  const name = getCellValue(row, companyNameHeaders)
  const address = Object.entries(row)
    .filter(([key]) => addressHeaders.map(normalizeHeader).includes(normalizeHeader(key)))
    .map(([, value]) => value === undefined || value === null ? '' : String(value).trim())
    .filter(Boolean)
    .join(', ')

  return { name, address }
}

function exportBatchResultsXLSX(results: BatchVerificationResult[], sourceRows: WorkbookRow[] = []) {
  if (!results.length) {
    return
  }

  const rows = results.map((result, index) => ({
    ...(sourceRows[index] || {}),
    inputCompanyName: result.input.name,
    inputAddress: result.input.address || '',
    verified: result.verified ? 'YES' : 'NO',
    matchedCompanyName: result.match?.name || '',
    website: result.match?.website || '',
    phone: result.match?.phone || '',
    googleAddress: result.match?.address || '',
    rating: result.match?.rating || '',
    reviewCount: result.match?.reviewCount || 0,
    businessStatus: result.match?.businessStatus || '',
    types: (result.match?.types || []).join('; '),
    placeId: result.match?.placeId || '',
    evidenceUrl: buildSourceUrl(result.match),
    note: result.message || result.error || ''
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Verified Companies')
  const workbookBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true })
  const blob = new Blob([workbookBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `google-maps-verified-${Date.now()}.xlsx`
  link.click()
  URL.revokeObjectURL(link.href)
}

function buildWorkflowHint(message: string) {
  if (message.includes('GOOGLE_MAPS_API_KEY')) {
    return `${message} Google Maps verification uses the server route only, so configure GOOGLE_MAPS_API_KEY in Vercel or the local Node service before retrying.`
  }

  return message
}

function formatStatus(status: string) {
  if (status === 'OPERATIONAL') return '营业中'
  if (status === 'CLOSED_TEMPORARILY') return '暂停营业'
  if (status === 'CLOSED_PERMANENTLY') return '永久关闭'
  return status || '状态未知'
}

function formatTypeLabel(value: string) {
  return value.replace(/_/g, ' ')
}

function buildSourceUrl(match: GoogleMapsMatch | null) {
  if (!match) {
    return ''
  }

  return match.sourceUrl || match.website || (match.placeId ? `https://www.google.com/maps/place/?q=place_id:${match.placeId}` : '')
}

function MatchInfo({ match }: { match: GoogleMapsMatch }) {
  const sourceUrl = buildSourceUrl(match)

  return (
    <div className="space-y-4 text-sm text-emerald-700 dark:text-emerald-300">
      <div className="grid gap-4 md:grid-cols-2">
        <InfoBlock
          title="Verified Company"
          lines={[
            `Name: ${match.name || 'N/A'}`,
            `Address: ${match.address || 'N/A'}`,
            `Phone: ${match.phone || 'N/A'}`,
            `Website: ${match.website || 'N/A'}`
          ]}
        />
        <InfoBlock
          title="Provider Metadata"
          lines={[
            `Provider: ${match.provider || 'google-maps'}`,
            `Workflow Origin: google-maps-verify`,
            `Query Label: ${match.queryLabel || 'company'}`,
            `Query: ${match.query || 'N/A'}`
          ]}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <InfoBlock
          title="Match Quality"
          lines={[
            `Rating: ${match.rating || 'N/A'}`,
            `Review Count: ${match.reviewCount || 0}`,
            `Business Status: ${formatStatus(match.businessStatus)}`,
            `Primary Type: ${match.primaryType ? formatTypeLabel(match.primaryType) : 'N/A'}`
          ]}
        />
        <InfoBlock
          title="Evidence"
          lines={[
            `Source URL: ${sourceUrl || 'N/A'}`,
            `Place ID: ${match.placeId || 'N/A'}`,
            `Coordinates: ${match.location ? `${match.location.lat}, ${match.location.lng}` : 'N/A'}`,
            `Types: ${(match.types || []).map(formatTypeLabel).join(', ') || 'N/A'}`
          ]}
        />
      </div>

      {sourceUrl ? (
        <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700">
          打开证据来源 <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  )
}

function InfoBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl bg-white/60 p-4 text-sm text-stone-700 dark:bg-stone-900/40 dark:text-stone-200">
      <div className="font-semibold text-gray-900 dark:text-white">{title}</div>
      <div className="mt-2 space-y-1">
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  )
}

export default function GoogleMapsVerify() {
  const [companyName, setCompanyName] = useState('')
  const [address, setAddress] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationResult, setVerificationResult] = useState<GoogleMapsVerificationResult | null>(null)
  const [error, setError] = useState('')

  const [batchInput, setBatchInput] = useState('')
  const [isBatchVerifying, setIsBatchVerifying] = useState(false)
  const [batchResults, setBatchResults] = useState<BatchVerificationResult[]>([])
  const [batchError, setBatchError] = useState('')
  const [batchSourceRows, setBatchSourceRows] = useState<WorkbookRow[]>([])

  async function handleSingleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setVerificationResult(null)
    setIsVerifying(true)

    try {
      const result = await verifyCompanyWithGoogleMaps(companyName, address)
      setVerificationResult(result)
    } catch (verifyError) {
      console.error(verifyError)
      const message = verifyError instanceof Error ? verifyError.message : 'Verification failed'
      setError(buildWorkflowHint(message))
    } finally {
      setIsVerifying(false)
    }
  }

  async function handleBatchVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBatchError('')
    setBatchResults([])
    setIsBatchVerifying(true)

    try {
      const lines = batchInput.trim().split('\n').filter(Boolean)
      const companies = lines
        .map((line) => {
          const parts = line.split(',').map((part) => part.trim())
          return {
            name: parts[0] || '',
            address: parts.slice(1).join(', ')
          }
        })
        .filter((company) => company.name)

      if (companies.length === 0) {
        setBatchError('No valid companies found. Use format: Company Name, Address (one per line).')
        return
      }

      const { results } = await batchVerifyCompaniesWithGoogleMaps(companies)
      setBatchResults(results)
    } catch (verifyError) {
      console.error(verifyError)
      const message = verifyError instanceof Error ? verifyError.message : 'Batch verification failed'
      setBatchError(buildWorkflowHint(message))
    } finally {
      setIsBatchVerifying(false)
    }
  }

  async function handleWorkbookImport(file: File) {
    setBatchError('')

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]
      const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : null

      if (!firstSheet) {
        setBatchError('Excel 文件里没有可读取的工作表。')
        return
      }

      const rows = XLSX.utils.sheet_to_json<WorkbookRow>(firstSheet, { defval: '' })
      const companies = rows.map(rowToCompany).filter((company) => company.name)

      if (!companies.length) {
        setBatchError('Excel 里没有识别到公司名称列。支持 Company Name / Company / Name / 公司名称 等表头。')
        return
      }

      setBatchInput(companies.map((company) => [company.name, company.address].filter(Boolean).join(', ')).join('\n'))
      setBatchSourceRows(rows)
      setBatchResults([])
    } catch (importError) {
      console.error(importError)
      setBatchError('Excel 文件读取失败，请确认是 .xlsx 格式。')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Google Maps Verification</h2>
        <p className="mt-2 max-w-4xl text-sm text-gray-600 dark:text-gray-400">
          使用 `/api/lead-workspaces/verify-google-maps` 和 `/api/lead-workspaces/batch-verify-csv` 校验公司名称与地址。返回结果会展示官网、电话、Google Maps 来源元数据和证据链接。
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
        依赖服务端 `GOOGLE_MAPS_API_KEY`。如果出现缺少环境变量提示，请只在 Vercel 或本地 Node 服务端配置，不要把密钥放进浏览器代码。
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-gray-200 shadow-sm dark:border-stone-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <MapPin className="h-5 w-5 text-primary-600" />
              Single Verification
            </CardTitle>
            <CardDescription>
              Verify one company at a time. The response should include address, phone, website, status, provider/source URL, and workflow origin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSingleVerify}>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Company Name
                <input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  placeholder="e.g., Siemens Energy"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Address
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  placeholder="e.g., Berlin, Germany"
                  required
                />
              </label>
              <Button type="submit" disabled={isVerifying} className="w-full">
                {isVerifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Verify Company
              </Button>
              {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
            </form>

            {verificationResult ? (
              <div className="mt-6 space-y-3">
                {verificationResult.verified && verificationResult.match ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/30 dark:bg-emerald-900/10">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                      <ShieldCheck className="h-4 w-4" />
                      Verified on Google Maps
                    </div>
                    <div className="mt-3">
                      <MatchInfo match={verificationResult.match} />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900/30 dark:bg-red-900/10">
                    <div className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-200">
                      <XCircle className="h-4 w-4" />
                      Not Found
                    </div>
                    <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                      {verificationResult.message || 'No matching company found on Google Maps'}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-gray-200 shadow-sm dark:border-stone-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <MapPin className="h-5 w-5 text-primary-600" />
              Batch Excel Verification
            </CardTitle>
            <CardDescription>
              上传 .xlsx 或粘贴表格文本。系统会按公司名称搜索，并把官网、电话、地址和证据链接补到导出的 Excel 里。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleBatchVerify}>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Company List
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) {
                      void handleWorkbookImport(file)
                    }
                  }}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                />
                <textarea
                  value={batchInput}
                  onChange={(event) => {
                    setBatchInput(event.target.value)
                    setBatchSourceRows([])
                  }}
                  rows={8}
                  className="font-mono rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  placeholder={'Siemens Energy, Berlin Germany\nABB E-mobility, Zurich Switzerland\nTesla Energy, Austin USA'}
                  required
                />
              </label>
              <Button type="submit" disabled={isBatchVerifying} className="w-full">
                {isBatchVerifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Verify All Companies
              </Button>
              {batchResults.length > 0 ? (
                <Button type="button" variant="outline" onClick={() => exportBatchResultsXLSX(batchResults, batchSourceRows)} className="w-full">
                  <Download className="mr-2 h-4 w-4" />
                  导出补全后的 Excel
                </Button>
              ) : null}
              {batchError ? <div className="text-sm text-red-600 dark:text-red-400">{batchError}</div> : null}
            </form>

            {batchResults.length > 0 ? (
              <div className="mt-6 space-y-3 max-h-[680px] overflow-y-auto">
                {batchResults.map((result, index) => {
                  const sourceUrl = buildSourceUrl(result.match)

                  return (
                    <div
                      key={`${result.input.name}-${index}`}
                      className={`rounded-2xl border p-4 ${result.verified ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/30 dark:bg-emerald-900/10' : 'border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-900/10'}`}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        {result.verified ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                        <span className={result.verified ? 'text-emerald-800 dark:text-emerald-200' : 'text-red-800 dark:text-red-200'}>
                          {result.input.name}
                        </span>
                      </div>

                      {result.verified && result.match ? (
                        <div className="mt-3 space-y-3 text-xs text-emerald-700 dark:text-emerald-300">
                          <div className="grid gap-3 md:grid-cols-2">
                            <InfoBlock
                              title="Verified Output"
                              lines={[
                                `Address: ${result.match.address || 'N/A'}`,
                                `Phone: ${result.match.phone || 'N/A'}`,
                                `Website: ${result.match.website || 'N/A'}`,
                                `Business Status: ${formatStatus(result.match.businessStatus)}`
                              ]}
                            />
                            <InfoBlock
                              title="Evidence Meta"
                              lines={[
                                `Provider: ${result.match.provider || 'google-maps'}`,
                                `Query Label: ${result.match.queryLabel || 'company'}`,
                                `Source URL: ${sourceUrl || 'N/A'}`,
                                `Workflow Origin: google-maps-batch-verify`
                              ]}
                            />
                          </div>
                          {sourceUrl ? (
                            <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700">
                              Open evidence <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-red-700 dark:text-red-300">
                          {result.message || result.error || 'Not found'}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
