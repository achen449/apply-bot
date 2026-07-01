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
    companyName,
    website,
    similarityScore,
    businessSimilarity,
    marketSimilarity,
    scaleSimilarity,
    reason,
    verified: Boolean(company.verified || company.mapVerified)
  }
}

function normalizeResult({ payload, aiJson, aiResult }) {
  const companies = Array.isArray(aiJson?.companies)
    ? aiJson.companies
        .map((company, index) => normalizeCompany(company, index))
        .filter((company) => company.similarityScore >= 60)
        .sort((a, b) => b.similarityScore - a.similarityScore)
    : []

  const metadata = buildAiMetadata(aiResult)

  return {
    companies,
    sampleCompany: {
      name: payload.companyName,
      website: payload.website,
      description: payload.description,
      industry: payload.industry,
      targetMarket: payload.targetMarket,
      country: payload.country
    },
    metadata,
    createdAt: new Date().toISOString()
  }
}

export function createSimilarCompanyService({ aiAgent, tools = [], promptStorage, prompt = SIMILAR_COMPANY_PROMPT } = {}) {
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

      const aiResult = await aiAgent.executeTask({
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
        maxIterations: 3,
        temperature: 0.2
      })

      return normalizeResult({
        payload: {
          companyName,
          website,
          description,
          industry,
          targetMarket,
          country
        },
        aiJson: readAiJson(aiResult),
        aiResult: {
          ...aiResult,
          prompt: {
            key: 'similar-company',
            rendered: systemPrompt
          }
        }
      })
    }
  }
}
