import {
  buildAiMetadata,
  clampScore,
  createId,
  normalizeStringArray,
  normalizeText,
  readAiJson,
  renderPrompt,
  resolvePrompt
} from './ai-service-utils.js'
import { dedupeCompanyCandidates, isLikelyBuyerCandidate } from '../shared/company-result-normalizer.js'

// Default prompt template
const SIMILAR_COMPANY_PROMPT = `你是一位经验丰富的B2B市场研究专家。你的任务是根据提供的样板公司，找到行业内相似的公司。

分析维度包括：
- 行业领域和业务模式
- 目标客户群体
- 产品或服务类型
- 公司规模和发展阶段
- 技术栈和创新方向
- 市场定位和竞争优势

## 工作流程

1. **分析样板公司**
   - 仔细研究样板公司的业务模式、产品服务、目标市场
   - 识别核心特征和关键词
   - 确定搜索策略

2. **使用 search_web 工具搜索**
   - 构建精准的搜索查询
   - 使用行业关键词、竞品词、相关技术栈
   - 搜索多个维度以获得全面结果

3. **使用 verify_company 工具验证**
   - 验证找到的公司是否真实存在
   - 确认公司网站和基本信息
   - 评估公司的活跃度和可信度

4. **相似度评分**
   - 业务相似度（0-40分）：产品服务、商业模式的匹配程度
   - 市场相似度（0-30分）：目标客户、市场定位的相似性
   - 规模相似度（0-30分）：公司发展阶段、团队规模的可比性
   - 总分范围：0-100分

5. **输出结果**
   - 按相似度评分从高到低排序
   - 优先返回最多 {{maxResults}} 家高质量结果；若公开证据不足，可少于该数量，但不能为了凑数编造
   - 提供清晰的相似理由说明
   - 对 shortlist 公司优先调用 verify_company，尽量加入地图验证信号

## 执行预算（必须遵守）

- 最多调用 2 次 search_web 和 1 次 verify_company；完成这些调用后立即输出最终 JSON
- 不要为了增加数量继续搜索；公开证据不足时返回较少结果
- 最终回复必须是可解析的 JSON，不要输出 Markdown 代码围栏或额外解释

## 注意事项

- 确保找到的公司与样板公司在同一行业或相关领域
- 优先考虑业务模式和目标市场的相似性
- 验证公司信息的准确性和时效性
- 避免返回已倒闭或不活跃的公司
- 理由说明要具体、有依据

## 用户输入

样板公司信息：
- 公司名称：{{companyName}}
- 网站：{{website}}
- 描述：{{description}}
- 行业：{{industry}}
- 目标市场：{{targetMarket}}
- 国家：{{country}}
- 最大结果数：{{maxResults}}

## 输出格式（JSON）

{
  "companies": [
    {
      "companyName": "公司名称",
      "website": "公司官网URL",
      "similarityScore": 85,
      "businessSimilarity": 35,
      "marketSimilarity": 25,
      "scaleSimilarity": 25,
      "reason": "相似理由的详细说明"
    }
  ]
}

开始执行。`

function normalizeCompany(company = {}, index) {
  const companyName = normalizeText(company.companyName || company.name, `AI candidate ${index + 1}`)
  const website = normalizeText(company.website || company.url)
  const similarityScore = clampScore(company.similarityScore || company.score, 0)
  const businessSimilarity = clampScore(company.businessSimilarity, 0)
  const marketSimilarity = clampScore(company.marketSimilarity, 0)
  const scaleSimilarity = clampScore(company.scaleSimilarity, 0)
  const reason = normalizeText(company.reason || company.whySimilar || company.description)

  return {
    id: createId('similar-company'),
    name: companyName,
    companyName,
    website,
    similarityScore,
    businessSimilarity,
    marketSimilarity,
    scaleSimilarity,
    reason,
    address: normalizeText(company.address),
    phone: normalizeText(company.phone),
    contactEmails: normalizeStringArray(company.contactEmails || company.emails),
    contactPages: normalizeStringArray(company.contactPages),
    map: company.map || null,
    evidence: Array.isArray(company.evidence) ? company.evidence : [],
    verified: Boolean(company.verified || company.mapVerified),
    mapVerified: Boolean(company.mapVerified || company.verified),
    dataQuality: company.dataQuality || null
  }
}

function websiteHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function buildPartialAiJson(toolCalls = [], sampleCompany = {}, maxResults = 5) {
  const sampleHost = websiteHost(sampleCompany.website)
  const candidates = []

  for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
    if (call?.name !== 'search_web' || call.result?.ok === false) {
      continue
    }

    for (const item of call.result?.results || []) {
      const rawTitle = normalizeText(item.title || item.name)
      const name = rawTitle.split('|')[0].trim()
      const website = normalizeText(item.url || item.website)

      if (!name || !website || (sampleHost && websiteHost(website) === sampleHost)) {
        continue
      }

      candidates.push({
        name,
        companyName: name,
        website,
        similarityScore: 60,
        businessSimilarity: 24,
        marketSimilarity: 18,
        scaleSimilarity: 18,
        reason: `Partial result from public provider evidence: ${normalizeText(item.snippet, 'The company appeared in a related public search result.').slice(0, 420)}`,
        source: item.provider || call.arguments?.provider || 'web-search',
        sourceUrl: website,
        evidence: [{
          type: 'public_web',
          sourceUrl: website,
          title: rawTitle,
          snippet: item.snippet || ''
        }]
      })
    }
  }

  const normalized = dedupeCompanyCandidates(candidates)
    .filter(isLikelyBuyerCandidate)
    .slice(0, Math.max(1, Number(maxResults) || 5))

  return {
    companies: normalized.map((candidate) => ({
      ...candidate,
      companyName: candidate.name
    }))
  }
}

function normalizeEntityKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function buildEvidenceIndex(aiResult = {}) {
  const hosts = new Set()
  const names = new Set()
  const entries = []

  for (const call of Array.isArray(aiResult.toolCalls) ? aiResult.toolCalls : []) {
    if (call?.name === 'search_web' && call.result?.ok !== false) {
      for (const item of call.result?.results || []) {
        const host = websiteHost(item.url || item.website)
        if (host) hosts.add(host)
        const name = normalizeEntityKey(item.title || item.name)
        if (name) names.add(name)
        entries.push({
          host,
          name,
          website: item.url || item.website || '',
          address: item.address || '',
          phone: item.phone || '',
          evidence: [{
            type: 'public_web',
            sourceUrl: item.url || item.website || '',
            title: item.title || item.name || '',
            snippet: item.snippet || ''
          }]
        })
      }
    }

    if (call?.name === 'verify_company' && call.result?.ok !== false) {
      for (const candidate of call.result?.candidates || []) {
        const host = websiteHost(candidate.website || candidate.url)
        if (host) hosts.add(host)
        const name = normalizeEntityKey(candidate.name || candidate.title)
        if (name) names.add(name)
        entries.push({
          host,
          name,
          website: candidate.website || candidate.url || '',
          address: candidate.address || '',
          phone: candidate.phone || '',
          evidence: [{
            type: 'google_maps',
            sourceUrl: candidate.placeId ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(candidate.placeId)}` : '',
            title: candidate.name || candidate.title || '',
            snippet: candidate.address || ''
          }]
        })
      }
    }
  }

  return { hosts, names, entries }
}

function isGroundedCompany(company = {}, evidenceIndex) {
  const host = websiteHost(company.website)
  if (host && evidenceIndex.hosts.has(host)) {
    return true
  }

  const entityKey = normalizeEntityKey(company.companyName || company.name)
  if (!entityKey) {
    return false
  }

  return [...evidenceIndex.names].some((name) => name.includes(entityKey) || entityKey.includes(name))
}

function findProviderEvidence(company = {}, evidenceIndex = {}) {
  const host = websiteHost(company.website)
  const entityKey = normalizeEntityKey(company.companyName || company.name)
  return (evidenceIndex.entries || []).find((entry) => (
    (host && entry.host === host)
      || (entityKey && entry.name && (entry.name.includes(entityKey) || entityKey.includes(entry.name)))
  )) || null
}

async function runProviderFallback(tools = [], { companyName, industry, country, maxResults } = {}) {
  const searchTool = tools.find((tool) => tool?.name === 'search_web' && typeof tool.execute === 'function')
  if (!searchTool) {
    return []
  }

  const queries = [
    `${companyName} competitors ${industry || 'renewable energy'} official website`,
    `${industry || 'renewable energy'} companies ${country || ''} energy storage inverter official website`.trim()
  ]
  const providers = ['tavily', 'brave']
  const calls = []

  for (let index = 0; index < queries.length && calls.length < 2; index += 1) {
    const provider = providers[index] || 'tavily'
    const args = { query: queries[index], provider, country, industry, maxResults }
    try {
      const result = await searchTool.execute(args)
      calls.push({
        id: `fallback-search-${index + 1}`,
        name: 'search_web',
        arguments: args,
        result
      })
    } catch (error) {
      calls.push({
        id: `fallback-search-${index + 1}`,
        name: 'search_web',
        arguments: args,
        result: {
          ok: false,
          error: {
            code: 'provider_search_failed',
            message: error.message || 'Provider fallback search failed.'
          }
        }
      })
    }
  }

  return calls
}

async function normalizeResult({ payload, aiJson, aiResult, companyEnrichmentService }) {
  const candidateCompanies = Array.isArray(aiJson?.companies)
    ? aiJson.companies
        .map((company, index) => normalizeCompany(company, index))
        .filter((company) => company.similarityScore >= 60)
        .filter((company) => isLikelyBuyerCandidate(company))
        .sort((a, b) => b.similarityScore - a.similarityScore)
    : []

  const metadata = buildAiMetadata(aiResult)
  const evidenceIndex = buildEvidenceIndex(aiResult)
  let companies = candidateCompanies
    .filter((company) => isGroundedCompany(company, evidenceIndex))
    .map((company) => {
      const providerEvidence = findProviderEvidence(company, evidenceIndex)
      return {
        ...company,
        // AI controls ranking and explanation only. Identity/contact fields
        // must come from the matched provider evidence or later enrichment.
        website: providerEvidence?.website || '',
        address: providerEvidence?.address || '',
        phone: providerEvidence?.phone || '',
        contactEmails: [],
        contactPages: [],
        map: null,
        verified: false,
        mapVerified: false,
        evidence: providerEvidence?.evidence || []
      }
    })

  if (candidateCompanies.length > 0 && companies.length === 0) {
    metadata.status = 'needs_review'
    metadata.partial = false
    metadata.error = {
      code: 'no_grounded_company_evidence',
      message: 'AI returned companies that could not be matched to successful public search or map evidence.'
    }
  }

  metadata.grounding = {
    candidateCount: candidateCompanies.length,
    groundedCount: companies.length,
    evidenceHostCount: evidenceIndex.hosts.size,
    evidenceNameCount: evidenceIndex.names.size
  }

  if (companyEnrichmentService && typeof companyEnrichmentService.enrichCompanies === 'function') {
    const enrichment = await companyEnrichmentService.enrichCompanies(companies, {
      country: payload.country,
      maxResults: payload.maxResults,
      existingVerificationCalls: metadata.verificationCalls || []
    })
    companies = enrichment.companies.map((company) => ({
      ...company,
      companyName: company.companyName || company.name,
      verified: Boolean(company.mapVerified || company.verified)
    }))
    metadata.verificationCalls = [
      ...(metadata.verificationCalls || []),
      ...enrichment.verificationCalls
    ]
    metadata.enrichmentCalls = enrichment.enrichmentCalls
  }

  const createdAt = new Date().toISOString()
  const firstSearchCall = metadata.searchCalls[0] || {}
  const results = companies.map((company) => ({
    company: {
      title: company.companyName,
      url: company.website,
      snippet: company.reason,
      provider: firstSearchCall.provider || 'ai',
      query: firstSearchCall.query || '',
      queryLabel: 'similar-company',
      capturedAt: createdAt
    },
    profile: {
      name: company.companyName,
      website: company.website,
      keywords: [],
      rawProfile: company.reason
    },
      similarity: company.similarityScore / 100,
    scores: {
      total: company.similarityScore,
      business: company.businessSimilarity,
      market: company.marketSimilarity,
      scale: company.scaleSimilarity
    },
    verified: company.verified,
    address: company.address,
    phone: company.phone,
    contactEmails: company.contactEmails,
    contactPages: company.contactPages,
    mapVerified: company.mapVerified,
    map: company.map,
    evidence: company.evidence,
    dataQuality: company.dataQuality
  }))

  return {
    companies,
    results,
    sampleCompany: {
      name: payload.companyName,
      website: payload.website,
      description: payload.description,
      industry: payload.industry,
      targetMarket: payload.targetMarket,
      country: payload.country
    },
    metadata,
    createdAt
  }
}

export function createSimilarCompanyService({
  aiAgent,
  tools = [],
  promptStorage,
  prompt = SIMILAR_COMPANY_PROMPT,
  companyEnrichmentService
} = {}) {
  if (!aiAgent || typeof aiAgent.executeTask !== 'function') {
    throw new Error('createSimilarCompanyService requires an aiAgent with executeTask.')
  }

  return {
    async findSimilarCompanies(payload = {}) {
      const companyName = normalizeText(payload.companyName || payload.name || payload.sampleCompany?.name)
      if (!companyName) {
        const error = new Error('companyName is required')
        error.code = 'invalid_payload'
        throw error
      }

      const website = normalizeText(payload.website || payload.sampleCompany?.website)
      const description = normalizeText(payload.description || payload.sampleCompany?.description)
      const industry = normalizeText(payload.industry || payload.sampleCompany?.industry)
      const targetMarket = normalizeText(payload.targetMarket || payload.sampleCompany?.targetMarket)
      const country = normalizeText(payload.country || payload.sampleCompany?.country)
      const requestedMaxResults = Number(payload.maxResults) > 0 ? Number(payload.maxResults) : 20
      const maxResults = Math.min(requestedMaxResults, 8)

      const systemPrompt = await resolvePrompt({
        prompt,
        promptStorage,
        promptKey: 'similar-company',
        defaultPrompt: SIMILAR_COMPANY_PROMPT,
        values: {
          companyName,
          website,
          description,
          industry,
          targetMarket,
          country,
          maxResults
        }
      })

      let aiResult

      try {
        aiResult = await aiAgent.executeTask({
          systemPrompt,
          userInput: JSON.stringify({
            sampleCompany: {
              name: companyName,
              website,
              description,
              industry,
              targetMarket
            },
            country,
            maxResults
          }),
          tools,
          maxIterations: 4,
          temperature: 0.2
        })
      } catch (error) {
        const collectedToolCalls = Array.isArray(error?.toolCalls) && error.toolCalls.length > 0
          ? error.toolCalls
          : await runProviderFallback(tools, { companyName, industry, country, maxResults })
        const partialJson = buildPartialAiJson(collectedToolCalls, { website }, maxResults)
        const hasEvidence = partialJson.companies.length > 0

        aiResult = {
          finalText: '',
          parsedJson: partialJson,
          toolCalls: collectedToolCalls,
          iterations: error.iterations || 0,
          messages: error.messages || [],
          status: hasEvidence ? 'partial' : 'failed',
          partial: hasEvidence,
          error: {
            code: error.code || 'ai_partial_failure',
            message: hasEvidence
              ? (error.message || 'AI final response was unavailable after provider evidence was collected.')
              : `${error.message || 'AI final response was unavailable.'} Provider fallback returned no usable company evidence.`
          },
          prompt: {
            key: 'similar-company',
            rendered: systemPrompt
          }
        }
      }

      const result = await normalizeResult({
        payload: {
          companyName,
          website,
          description,
          industry,
          targetMarket,
          country
        },
        aiJson: readAiJson(aiResult) || buildPartialAiJson(aiResult?.toolCalls, { website }, maxResults),
        aiResult: {
          ...aiResult,
          prompt: {
            key: 'similar-company',
            rendered: systemPrompt
          }
        },
        companyEnrichmentService
      })

      return {
        ...result,
        status: result.metadata?.status || 'completed',
        partial: Boolean(result.metadata?.partial),
        error: result.metadata?.error || null
      }
    }
  }
}
