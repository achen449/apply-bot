# 外贸获客系统 - 超轻量化实施方案

**设计原则**: 复用现有代码 > 使用现有API > 最小化新依赖

---

## 📊 现有能力清单（无需新增）

### ✅ 已实现的功能

#### 联系人提取（已完整）
- `extractEmails(content)` - 邮箱提取（正则表达式）
- `findContactPage(url, content)` - 联系页面定位
- `extractHeadquarters(content)` - 总部地址
- `company-website-analyzer.js` - 完整网站分析流程

#### 公司信息提取（已完整）
- `estimateEmployeeBand(content)` - 员工规模估算
- `detectScaleSignals(content)` - 规模信号检测
- `extractFoundedYear(content)` - 成立年份
- `classifyBusinessType()` - 业务类型分类

#### API 集成（已完整）
- Google Maps API: 返回 name, address, phone, website, **types[]**
- Tavily API: search + extract (raw_content)
- Brave API: search

---

## 🎯 三大工作流 - 轻量化实现

### **工作流一：国家+行业搜索 + 联系人提取**

#### 现状
✅ **已完成 90%** - 只需增强电话号码提取

#### 实施方案（0.5天工作量）

**文件**: `server/modules/leads/domain/extraction/company-fact-extractors.js`

**新增函数**:
```javascript
export function extractPhones(text = '') {
  // 国际电话格式: +XX XXX XXX XXXX
  const international = text.match(/\+\d{1,3}[\s.-]?\d{1,4}[\s.-]?\d{1,4}[\s.-]?\d{1,4}/g) || []
  
  // 美国格式: (123) 456-7890 或 123-456-7890
  const us = text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || []
  
  // 欧洲格式: 0123 456 789
  const eu = text.match(/0\d{3,4}[\s]?\d{3,4}[\s]?\d{3,4}/g) || []
  
  return dedupeStrings([...international, ...us, ...eu])
}
```

**修改文件**: `server/modules/leads/application/analyzers/company-website-analyzer.js`

在第50行后添加：
```javascript
const phones = extractPhones(pageContent)
```

在返回对象中添加（第101行附近）：
```javascript
contactPhones: phones.slice(0, 3),
```

**前端展示**（已有UI，只需显示新字段）:
- `GoogleMapsSearch.tsx` 已经显示 phone（第227-233行）
- 只需在CSV导出中添加 `contactPhones` 列

**总结**: 
- ✅ 无需新依赖
- ✅ 复用现有提取框架
- ✅ 5分钟实现 + 10分钟测试

---

### **工作流二：相似公司查找（AI驱动）**

#### 现状
❌ 未实现 - 但可用轻量方案

#### 实施方案（2天工作量）

**方案：使用 OpenCode 内置的 AI 模型**

**步骤1: 调用 OpenCode AI 生成公司特征文本**

```javascript
// 新文件: server/modules/leads/application/services/company-similarity-service.js

export function createCompanySimilarityService({ openCodeAI }) {
  
  // 使用 AI 提取公司特征
  async function extractCompanyProfile(companyName, websiteUrl) {
    // 1. 用 Tavily 获取公司网站内容
    const extractResult = await tavilyExtract([websiteUrl])
    const content = extractResult[0]?.raw_content || ''
    
    // 2. 用 OpenCode AI 总结公司特征
    const prompt = `
Based on this company website content, extract key characteristics:
- Industry and sector
- Products/services offered
- Target market (B2B/B2C, industry verticals)
- Company size indicators
- Geographic presence

Content: ${content.slice(0, 3000)}

Return a structured profile in JSON format.
`
    
    const profile = await openCodeAI.complete(prompt)
    return JSON.parse(profile)
  }
  
  // 3. 简单相似度计算（关键词匹配）
  function calculateSimilarity(profile1, profile2) {
    const keywords1 = new Set(profile1.industry.split(' '))
    const keywords2 = new Set(profile2.industry.split(' '))
    
    const intersection = [...keywords1].filter(k => keywords2.has(k)).length
    const union = new Set([...keywords1, ...keywords2]).size
    
    return intersection / union // Jaccard 相似度
  }
  
  return { extractCompanyProfile, calculateSimilarity }
}
```

**步骤2: API 端点**

```javascript
// 新路由: POST /api/companies/find-similar

app.post('/api/companies/find-similar', async (req, res) => {
  const { companyName, websiteUrl, topN = 10 } = req.body
  
  // 1. 提取输入公司特征
  const inputProfile = await companySimilarityService.extractCompanyProfile(
    companyName, 
    websiteUrl
  )
  
  // 2. 用 Tavily 搜索相似行业的公司
  const searchQuery = `${inputProfile.industry} companies like ${companyName}`
  const candidates = await tavilyAdapter.search({ query: searchQuery })
  
  // 3. 计算相似度
  const results = await Promise.all(
    candidates.slice(0, 20).map(async (candidate) => {
      const profile = await companySimilarityService.extractCompanyProfile(
        candidate.title,
        candidate.url
      )
      
      const similarity = companySimilarityService.calculateSimilarity(
        inputProfile,
        profile
      )
      
      return { company: candidate, profile, similarity }
    })
  )
  
  // 4. 排序并返回 Top-N
  const sorted = results.sort((a, b) => b.similarity - a.similarity)
  res.json({ results: sorted.slice(0, topN), inputProfile })
})
```

**前端**（新页面）:
- 简单表单：输入公司名 + 网址
- 显示相似公司列表（带相似度评分）
- 一键验证按钮（调用现有 Tavily/Brave）

**总结**:
- ✅ 无需 OpenAI/transformers
- ✅ 使用 OpenCode 内置 AI
- ✅ Tavily API 做搜索和内容提取
- ✅ 简单 Jaccard 相似度（轻量）

---

### **工作流三：批量地址验证（商业 vs 住宅）**

#### 现状
✅ **已完成 70%** - Google Maps 返回 `place.types`

#### 实施方案（1天工作量）

**核心发现**: Google Maps API 已经返回 `place.types` 数组！

**示例返回**:
```javascript
place.types = [
  "store",              // 商店
  "establishment",      // 营业场所
  "point_of_interest",  // 兴趣点
  "street_address"      // 街道地址
]
```

**方案：直接使用 place.types 分类（无需 libpostal）**

**新文件**: `server/modules/leads/application/services/address-classification-service.js`

```javascript
export function createAddressClassificationService({ googleMapsAdapter }) {
  
  function classifyByPlaceTypes(types = []) {
    // 商业类型关键词
    const commercialKeywords = [
      'store', 'establishment', 'point_of_interest', 
      'office', 'factory', 'warehouse', 'restaurant',
      'shopping_mall', 'bank', 'hospital', 'business'
    ]
    
    // 住宅类型关键词
    const residentialKeywords = [
      'street_address', 'premise', 'subpremise',
      'residential', 'apartment', 'housing'
    ]
    
    const commercialScore = types.filter(t => 
      commercialKeywords.includes(t)
    ).length
    
    const residentialScore = types.filter(t => 
      residentialKeywords.includes(t)
    ).length
    
    if (commercialScore > residentialScore) {
      return { 
        type: 'COMMERCIAL', 
        confidence: Math.min(0.95, 0.6 + commercialScore * 0.15) 
      }
    }
    
    if (residentialScore > commercialScore) {
      return { 
        type: 'RESIDENTIAL', 
        confidence: Math.min(0.9, 0.5 + residentialScore * 0.15) 
      }
    }
    
    if (commercialScore === 0 && residentialScore === 0) {
      return { type: 'UNKNOWN', confidence: 0.3 }
    }
    
    return { type: 'MIXED_USE', confidence: 0.6 }
  }
  
  async function classifyAddress(companyName, address) {
    // 1. 用 Google Maps 搜索地址
    const query = `${companyName} ${address}`
    const results = await googleMapsAdapter.searchText(query, { maxResults: 1 })
    
    if (results.length === 0) {
      return {
        classification: 'NOT_FOUND',
        confidence: 0,
        reason: 'Google Maps未找到此地址'
      }
    }
    
    // 2. 提取 place.types
    const place = results[0]
    const types = place.metadata.googleTypes || []
    
    // 3. 分类
    const classification = classifyByPlaceTypes(types)
    
    return {
      classification: classification.type,
      confidence: classification.confidence,
      placeDetails: {
        name: place.title,
        address: place.snippet,
        phone: place.extra.phone,
        website: place.url,
        types: types,
        businessStatus: place.metadata.googleBusinessStatus,
        rating: place.metadata.googleRating
      }
    }
  }
  
  async function batchClassify(addresses) {
    return Promise.all(
      addresses.map(item => 
        classifyAddress(item.name, item.address)
      )
    )
  }
  
  return { classifyAddress, batchClassify }
}
```

**API 端点**: `POST /api/addresses/batch-classify`

```javascript
app.post('/api/addresses/batch-classify', async (req, res) => {
  const { addresses } = req.body // [{ name, address }]
  const results = await addressClassificationService.batchClassify(addresses)
  res.json({ results, total: results.length })
})
```

**前端**（新页面）:
- Excel/CSV 上传
- 展示分类结果表格
- 导出带分类标签的CSV

**总结**:
- ✅ 无需 libpostal（避免6GB数据）
- ✅ 直接用 Google Maps place.types
- ✅ 复用现有 googleMapsAdapter
- ✅ 准确率预估: 80-85%

---

## 📦 依赖清单

### 需要新增的依赖
**零！所有功能用现有API和代码实现。**

### 可选优化（如果准确率不够）
```bash
# 仅在电话提取准确率 < 70% 时添加
npm install libphonenumber-js  # 2MB，轻量电话解析
```

---

## 📅 实施时间表

| 工作流 | 工作量 | 新增代码 | 新增依赖 |
|--------|--------|----------|----------|
| 工作流一：联系人提取增强 | **0.5天** | 20行 | 0 |
| 工作流三：地址分类 | **1天** | 100行 | 0 |
| 工作流二：相似公司查找 | **2天** | 150行 | 0 |
| **总计** | **3.5天** | **270行** | **0** |

---

## 🎯 实施优先级

### 第一批（0.5天）- 立即可做
1. ✅ 增强电话提取：`extractPhones()`
2. ✅ 前端展示优化

### 第二批（1天）- 本周完成
3. ✅ 地址分类服务：基于 place.types
4. ✅ 批量分类 API
5. ✅ 地址分类前端页面

### 第三批（2天）- 下周完成
6. ✅ 相似公司查找：OpenCode AI + Tavily
7. ✅ 相似度计算（Jaccard）
8. ✅ 前端界面

---

## 🔍 技术对比：轻量 vs 重型方案

| 功能 | 重型方案 | 轻量方案 | 节省 |
|------|----------|----------|------|
| 联系人提取 | cheerio + puppeteer (50MB) | 现有 extractEmails + 正则 | 50MB |
| 地址解析 | libpostal (6GB) | Google Maps place.types | 6GB |
| 相似度搜索 | OpenAI SDK + 向量DB (100MB) | OpenCode AI + Jaccard | 100MB |
| **总计** | **6.15GB + 3个包** | **0 + 0个包** | **6.15GB** |

---

## ✅ 成功指标

### 功能指标
- [ ] 电话提取准确率 > 60% （基于正则）
- [ ] 地址分类准确率 > 80% （基于 place.types）
- [ ] 相似公司推荐相关性 > 70% （基于行业关键词）

### 性能指标
- [ ] API响应时间 < 3秒
- [ ] 批量处理 > 50条/分钟
- [ ] 无新增包体积

### 代码质量
- [ ] 新增代码 < 300行
- [ ] 复用现有函数 > 80%
- [ ] 无新依赖

---

## 🚀 下一步行动

### 立即开始（今天）
```bash
# 第一步：增强电话提取
# 编辑: server/modules/leads/domain/extraction/company-fact-extractors.js
# 添加: extractPhones() 函数（20行代码）
# 测试: 验证电话提取准确率
```

### 明天开始
```bash
# 第二步：地址分类服务
# 创建: server/modules/leads/application/services/address-classification-service.js
# 添加: API路由 POST /api/addresses/batch-classify
# 测试: 用10个真实地址验证分类准确率
```

---

## 💡 关键优势

1. **极致轻量**: 零新依赖，复用现有API
2. **快速交付**: 3.5天完成vs原计划23天
3. **架构稳定**: 不引入新库，不破坏现有结构
4. **易于维护**: 少量新代码，逻辑清晰
5. **成本可控**: 不依赖额外付费服务

---

**下一步**: 请确认这个轻量化方案是否符合您的期望？我可以立即开始实施第一步。
