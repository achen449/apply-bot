import { FormEvent, useState } from 'react'
import { ExternalLink, Loader2, Search, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { findSimilarCompanies, type SimilarCompanyResult } from '@/lib/leadApi'

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

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResults([])
    setHasSearched(true)
    setIsSearching(true)

    try {
      const data = await findSimilarCompanies({ name, website, industry, description }, parseInt(topN))
      setResults(data.results)
    } catch (searchError) {
      console.error(searchError)
      setError(searchError instanceof Error ? searchError.message : '相似公司搜索失败')
    } finally {
      setIsSearching(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">AI 相似公司推荐</h2>
        <p className="mt-2 max-w-4xl text-sm text-gray-600 dark:text-gray-400">
          复用 Tavily 内容与轻量 Jaccard 相似度，从一个样板公司出发找相似目标客户，不新增向量库或重型 AI SDK。
        </p>
      </div>

      <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary-600" />
            样板公司
          </CardTitle>
          <CardDescription>
            示例已填 Signify。你可以换成任意目标客户或标杆公司。
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

      {hasSearched && !isSearching && !error && results.length === 0 ? (
        <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
          <CardContent className="p-6 text-sm text-gray-500 dark:text-gray-400">
            当前没有返回相似公司结果。可以尝试补充官网、收窄行业描述，或确认服务端 Tavily 环境变量已经配置。
          </CardContent>
        </Card>
      ) : null}

      {results.length > 0 ? (
        <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-primary-600" />
              推荐结果
            </CardTitle>
            <CardDescription>按轻量关键词相似度排序，仅作为开发目标初筛。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {results.map((result, index) => (
                <div key={`${result.company.title}-${index}`} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-900">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{result.company.title}</h3>
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{result.company.snippet || result.profile.rawProfile}</p>
                    </div>
                    <div className="rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-sm font-semibold text-primary-700 dark:border-primary-900/30 dark:bg-primary-900/10 dark:text-primary-200">
                      {Math.round(result.similarity * 100)}% match
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {result.profile.keywords.slice(0, 10).map((keyword) => (
                      <span key={keyword} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 dark:bg-stone-800 dark:text-gray-300">{keyword}</span>
                    ))}
                  </div>
                  {result.company.url ? (
                    <a href={result.company.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700">
                      打开来源 <ExternalLink className="h-3 w-3" />
                    </a>
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
