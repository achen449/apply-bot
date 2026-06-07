import { FormEvent, useState } from 'react'
import { Building2, CheckCircle2, Loader2, MapPin, ShieldQuestion } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { classifyAddresses, type AddressClassificationResult } from '@/lib/leadApi'

const defaultInput = 'Exide Technologies, Av. Partenón 12 Madrid Spain\nGamesa Electric, Parque Tecnológico de Bizkaia Zamudio Spain\nPower Electronics, Ronda del Camp de l\'Aviació 4 Llíria Valencia Spain'

function badgeClass(classification: string) {
  if (classification === 'COMMERCIAL') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-900/10 dark:text-emerald-200'
  }

  if (classification === 'RESIDENTIAL') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-200'
  }

  return 'border-gray-200 bg-gray-50 text-gray-700 dark:border-stone-700 dark:bg-stone-900 dark:text-gray-300'
}

export default function AddressClassifier() {
  const [input, setInput] = useState(defaultInput)
  const [isClassifying, setIsClassifying] = useState(false)
  const [results, setResults] = useState<AddressClassificationResult[]>([])
  const [error, setError] = useState('')
  const [hasSubmitted, setHasSubmitted] = useState(false)

  async function handleClassify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResults([])
    setHasSubmitted(true)
    setIsClassifying(true)

    try {
      const addresses = input
        .trim()
        .split('\n')
        .map((line) => {
          const [name = '', ...addressParts] = line.split(',').map((part) => part.trim())
          return { name, address: addressParts.join(', ') }
        })
        .filter((item) => item.name && item.address)

      if (!addresses.length) {
        setError('请输入有效格式：公司名, 地址（一行一家公司）。')
        return
      }

      const data = await classifyAddresses(addresses)
      setResults(data.results)
    } catch (classifyError) {
      console.error(classifyError)
      setError(classifyError instanceof Error ? classifyError.message : '地址分类失败')
    } finally {
      setIsClassifying(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">地址商业属性判断</h2>
        <p className="mt-2 max-w-4xl text-sm text-gray-600 dark:text-gray-400">
          复用 Google Maps place.types 判断地址更像商业、住宅还是混合用途，不引入 libpostal 等重依赖。
        </p>
      </div>

      <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MapPin className="h-5 w-5 text-primary-600" />
            批量地址输入
          </CardTitle>
          <CardDescription>
            每行一个：公司名, 地址。适合粘贴 Excel 导出的公司地址清单。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleClassify}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={8}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 font-mono text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
              required
            />
            <Button type="submit" disabled={isClassifying} className="w-full">
              {isClassifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldQuestion className="mr-2 h-4 w-4" />}
              判断地址类型
            </Button>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
              依赖后端 `POST /api/addresses/batch-classify`。如果出现环境变量错误，请在 Vercel 或本地服务端设置 `GOOGLE_MAPS_API_KEY`，前端不会暴露实际密钥值。
            </div>
            {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
          </form>
        </CardContent>
      </Card>

      {hasSubmitted && !isClassifying && !error && results.length === 0 ? (
        <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
          <CardContent className="p-6 text-sm text-gray-500 dark:text-gray-400">
            这次请求没有返回可展示的分类结果。请检查输入格式是否为“公司名, 地址”，或确认服务端 Google Maps 环境变量已经配置。
          </CardContent>
        </Card>
      ) : null}

      {results.length > 0 ? (
        <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Building2 className="h-5 w-5 text-primary-600" />
              分类结果
            </CardTitle>
            <CardDescription>共处理 {results.length} 条地址。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {results.map((item, index) => (
                <div key={`${item.input.name}-${index}`} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-900">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{item.input.name}</h3>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{item.input.address}</p>
                    </div>
                    <div className={`rounded-full border px-3 py-1 text-sm font-semibold ${badgeClass(item.result.classification)}`}>
                      {item.result.classification} · {Math.round(item.result.confidence * 100)}%
                    </div>
                  </div>
                  <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">{item.result.reason}</div>
                  {item.result.placeDetails ? (
                    <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-700 dark:bg-stone-800 dark:text-gray-300">
                      <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        {item.result.placeDetails.name}
                      </div>
                      <div className="mt-2 space-y-1">
                        <div>地址：{item.result.placeDetails.address || 'N/A'}</div>
                        <div>电话：{item.result.placeDetails.phone || 'N/A'}</div>
                        <div>类型：{item.result.placeDetails.types.join(', ') || 'N/A'}</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
