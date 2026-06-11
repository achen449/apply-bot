# 外贸获客系统修复与补全路线图

## 目标

把当前系统从“搜索结果展示器”修复为“可保存、可复查、可控成本、可部署、可配置 AI 的外贸获客调研工作台”。

核心目标：

1. Similar Company 不再直接展示 Tavily 网页搜索结果，而是先由 AI 推荐目标公司，再逐个公开资料核验。
2. Lead Finder 不再只返回少量高过滤结果，而是形成“候选池 + 精选池 + 背调报告”。
3. Map Verify 支持公司名、地址、公司名+地址三种输入模式。
4. 所有查询结果可留存、可导出、可同步到 Gist。
5. Tavily / Brave / Google Maps / AI 调用全部可控、可缓存、可限额保护。
6. 所有 API key / token / model / host 只走环境变量，绝不写入 GitHub。

---

## 一、当前问题诊断

### 1. Similar Company 逻辑错误

当前实现问题：

- 当前 `company-similarity-service.js` 直接用 Tavily 搜索 `companies similar to xxx`。
- 返回结果本质是网页、榜单、新闻、目录页，不是 AI 推理出的相似公司。
- Jaccard similarity 只是关键词重叠，不足以判断业务相似性。
- 查询结果没有保存，刷新后丢失。

正确目标：

```text
用户输入公司 / 行业 / 产品 / 目标市场
  -> AI 推荐相似公司和潜在客户公司
  -> Tavily / Brave / Google Maps 逐个查证
  -> AI 根据公开证据生成结构化背调
  -> 保存为 Research Run / Lead Workspace / Gist 数据
```

### 2. Map Verify 输入模式过窄

当前实现问题：

- `verifyCompanyAddress({ companyName, address })` 只拼接公司名和地址。
- Google Maps 查询只取 `maxResults: 1`。
- 不支持“只有公司名，返回多个分部/地址”。
- 不支持“只有地址，反查该地址上的公司/机构”。

正确目标：

```text
公司名 only     -> 返回多个公司地点 / 分部 / 工厂 / 办公室
地址 only       -> 返回地址上的机构、商业/住宅判断、附近 POI
公司名 + 地址   -> 验证是否匹配，返回置信度和候选列表
```

### 3. Lead Finder 结果少且筛选过死

当前实现问题：

- Tavily 查询只跑前 4 个 query。
- Google Maps 只跑前 2 个 query。
- 候选只分析前 24 个。
- `fitScore < 86` 且不是官网时直接过滤，过早丢弃潜在客户。
- 默认 target types 偏窄，不适合连接器销售场景。

正确目标：

```text
候选池：50-100 家
精选池：10-20 家
背调池：3-10 家深度分析
```

### 4. OSINT 背调没有真正结构化

当前实现问题：

- 当前产品抽取靠简单 regex。
- Tavily / Brave 调用了多次，但缺少 AI 归纳层。
- 证据没有被充分组织成“事实 + 来源 + 证据强度”。
- 产品信息没有具体到产品类型。

正确目标：

```text
搜索 API 负责找公开资料
AI 负责基于公开资料生成结构化尽调报告
系统负责保存 evidence 和结论
```

### 5. 查询结果没有持久化

当前实现问题：

- Similar Company、Map Verify、OSINT、Lead Finder 的查询结果没有统一保存模型。
- 用户无法回看历史查询。
- 不能把一次查询转成客户记录或线索工作区。

正确目标：

新增统一 `Research Run` 模型，所有查询都保存。

---

## 二、总体架构修复方案

### 新增核心模块

```text
server/modules/leads/application/services/
  ai-analysis-service.js
  research-run-service.js
  api-budget-service.js
  company-recommendation-service.js
  company-enrichment-service.js
  map-lookup-service.js

server/modules/leads/routes/
  research-run-routes.js
  ai-config-routes.js       # 只返回配置状态，不返回密钥

server/modules/leads/domain/
  research-run-schema.js
  company-enrichment-schema.js
```

### 调用链目标

```text
Frontend
  -> Backend Route
    -> Research Run Service 创建运行记录
    -> API Budget Service 检查缓存/限额
    -> Provider Adapters 调 Tavily / Brave / Google Maps
    -> AI Analysis Service 调中转站模型
    -> Company Enrichment Service 结构化结果
    -> Gist Customer Data Service 同步
    -> Research Run Service 保存最终结果
```

---

## 三、环境变量与密钥安全

### 必须新增 / 保留的环境变量

```env
# Tavily，可配置两个 key 轮换使用
TAVILY_API_KEY=
TAVILY_API_KEY_BACKUP=

# Brave，可配置两个 key 轮换使用
BRAVE_API_KEY=
BRAVE_API_KEY_BACKUP=

# Google Maps
GOOGLE_MAPS_API_KEY=

# Gist 数据库
GIST_ID=
GITHUB_GIST_TOKEN=
GIST_CUSTOMER_DATA_FILENAME=customer-data.json

# AI 中转站配置
AI_API_HOST=
AI_API_KEY=
AI_MODEL=
AI_PROVIDER=openai-compatible
AI_TIMEOUT_MS=60000
AI_MAX_TOKENS=4000

# 成本控制
API_CACHE_TTL_HOURS=24
API_DAILY_TAVILY_LIMIT=80
API_DAILY_BRAVE_LIMIT=80
API_DAILY_GOOGLE_MAPS_LIMIT=200
API_DAILY_AI_LIMIT=100
```

### Vercel 配置方式

所有密钥都只放在 Vercel Environment Variables：

```text
Vercel Dashboard
  -> Project
  -> Settings
  -> Environment Variables
```

不要写入：

- `.env.local`
- `.env.example` 的真实值
- README
- docs
- 测试文件
- Git commit message
- GitHub issue / PR 描述

### `.env.example` 规则

`.env.example` 只能写占位符：

```env
TAVILY_API_KEY=your_tavily_api_key
TAVILY_API_KEY_BACKUP=your_backup_tavily_api_key
BRAVE_API_KEY=your_brave_api_key
BRAVE_API_KEY_BACKUP=your_backup_brave_api_key
AI_API_HOST=https://your-ai-proxy.example.com/v1
AI_API_KEY=your_ai_api_key
AI_MODEL=your_model_name
```

### 防止密钥进 GitHub

提交前必须检查：

```powershell
git diff --cached -- . ':!package-lock.json' | Select-String -Pattern "ghp_|tvly-|BSA|AIza|sk-|api_key|API_KEY|TOKEN"
```

如果有输出，立刻停止提交。

建议新增 npm 脚本：

```json
{
  "scripts": {
    "secrets:check": "node scripts/check-secrets.js"
  }
}
```

---

## 四、Gist 同步方案

### 当前问题

Gist 已经能读写客户数据，但 Similar Company、Map Verify、OSINT 查询结果没有统一进入 Gist。

### 目标 Gist JSON 结构

```json
{
  "customers": [],
  "companies": [],
  "leadWorkspaces": [],
  "researchRuns": [],
  "searchCache": [],
  "apiUsage": []
}
```

### Research Run 模型

```json
{
  "id": "run_20260610_xxx",
  "type": "similar_company | lead_finder | map_lookup | osint",
  "input": {},
  "status": "running | completed | failed",
  "createdAt": "",
  "updatedAt": "",
  "providerCalls": [
    {
      "provider": "tavily",
      "query": "",
      "cacheHit": false,
      "keySlot": "primary | backup",
      "status": "success | skipped | failed"
    }
  ],
  "results": [],
  "evidence": [],
  "summary": "",
  "errors": []
}
```

### 同步策略

1. 本地开发优先写 `data/lead-workspaces.json`。
2. Vercel 生产环境优先写 Gist。
3. 每次查询完成后保存 Research Run。
4. 用户点击“保存为客户”时，把公司写入 `companies` 或 `customers`。
5. 用户点击“保存为工作区”时，把结果写入 `leadWorkspaces`。

### 冲突处理

Gist 写入前要先 fetch 最新版本，再 merge：

```text
fetch latest gist
  -> merge by id
  -> update updatedAt
  -> preserve unrelated sections
  -> patch gist
```

禁止直接覆盖整个 JSON。

---

## 五、API 消耗控制方案

### 1. 查询缓存

新增 `api-cache-service.js` 或放进 `api-budget-service.js`：

缓存 key：

```text
provider + normalizedQuery + optionsHash
```

缓存内容：

```json
{
  "cacheKey": "tavily:solar-inverter-germany",
  "provider": "tavily",
  "query": "solar inverter Germany official website",
  "createdAt": "",
  "expiresAt": "",
  "results": []
}
```

默认缓存时间：

```text
24 小时
```

同一天同一个 query 不重复扣 Tavily / Brave 次数。

### 2. Key 轮换

Tavily / Brave 支持 primary + backup：

```text
TAVILY_API_KEY
TAVILY_API_KEY_BACKUP
BRAVE_API_KEY
BRAVE_API_KEY_BACKUP
```

调用策略：

```text
primary 未超限 -> 用 primary
primary 失败/429/超日限 -> 用 backup
backup 也失败 -> 返回 provider_unavailable，不继续重试烧次数
```

### 3. 每日限额保护

新增 `apiUsage` 记录：

```json
{
  "date": "2026-06-10",
  "provider": "tavily",
  "keySlot": "primary",
  "count": 32,
  "limit": 80
}
```

每次调用前检查：

```text
if count >= limit:
  skip provider
```

### 4. 分层调用，避免一次搜索烧太多

Lead Finder 不要一开始就对 100 家公司全部深度背调。

推荐三层：

```text
Level 1：便宜搜索
  Tavily / Brave 搜候选公司名

Level 2：轻量验证
  每家公司只查官网、标题、snippet、产品关键词

Level 3：深度 OSINT
  只对用户选中的 3-10 家公司调用更多 API + AI
```

### 5. 用户可选模式

前端增加：

```text
省次数模式：少量查询 + 缓存优先
标准模式：适中查询
深度模式：更多 API 调用 + AI 背调
```

对应后端参数：

```json
{
  "depth": "economy | standard | deep"
}
```

---

## 六、AI 中转站接入方案

### 环境变量

```env
AI_API_HOST=https://your-proxy.example.com/v1
AI_API_KEY=your_key
AI_MODEL=gpt-4o-mini-or-your-model
AI_PROVIDER=openai-compatible
```

### AI 服务接口

新增：

```text
server/modules/leads/application/services/ai-analysis-service.js
```

接口：

```js
createAiAnalysisService({ apiHost, apiKey, model })
```

方法：

```js
generateJson({ systemPrompt, userPrompt, schema, temperature })
```

### 兼容 OpenAI 格式

请求格式：

```json
POST {AI_API_HOST}/chat/completions
Authorization: Bearer {AI_API_KEY}

{
  "model": "{AI_MODEL}",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.2,
  "response_format": { "type": "json_object" }
}
```

### AI 禁止事项

AI 只能基于 evidence 输出：

```text
不能编造邮箱
不能猜手机号
不能补全公司规模
不能把搜索结果标题当事实
不能把目录站当官网
```

---

## 七、Similar Company 修复方案

### 新流程

```text
输入：目标公司 / 产品 / 行业 / 国家 / 客户类型
  -> AI 推荐 20-50 家候选公司
  -> 去重、过滤明显无关公司
  -> Tavily / Brave 查每家公司官网和产品
  -> AI 生成每家公司适配理由
  -> 保存 Research Run
```

### 新增接口

```text
POST /api/companies/recommend-similar
POST /api/companies/enrich
POST /api/research-runs/:id/save-to-workspace
```

### 输出字段

```json
{
  "companyName": "GoodWe",
  "website": "https://www.goodwe.com",
  "country": "China",
  "category": "solar inverter manufacturer",
  "products": ["string inverter", "hybrid inverter", "energy storage inverter"],
  "employeeScale": "public evidence if found",
  "fitForConnectorSales": {
    "score": 86,
    "reasons": [
      "manufactures inverter and energy storage systems",
      "likely uses power/signal connectors and harnesses"
    ]
  },
  "evidenceUrls": []
}
```

### 修复点

替换当前逻辑：

```text
Tavily 搜 companies similar to xxx
```

改为：

```text
AI 推荐候选 -> Provider 查证 -> AI 结构化背调
```

---

## 八、Map Verify 修复方案

### 新增三种模式

```text
company_locations
address_lookup
company_address_verify
```

### API 设计

```text
POST /api/google-maps/company-locations
POST /api/google-maps/address-lookup
POST /api/google-maps/verify-company-address
```

### 1. 只有公司名

输入：

```json
{
  "companyName": "Schneider Electric",
  "country": "Germany",
  "maxResults": 10
}
```

返回：

```json
{
  "locations": [
    {
      "name": "Schneider Electric GmbH",
      "formattedAddress": "...",
      "phone": "...",
      "website": "...",
      "placeTypes": [],
      "businessStatus": "OPERATIONAL",
      "locationRoleGuess": "hq | office | factory | branch | unknown"
    }
  ]
}
```

### 2. 只有地址

输入：

```json
{
  "address": "...",
  "country": "Germany",
  "maxResults": 10
}
```

返回：

```json
{
  "addressType": "commercial | residential | mixed | unknown",
  "occupants": [],
  "nearbyBusinesses": []
}
```

### 3. 公司名 + 地址

返回多个候选和置信度，而不是只取第一条。

```json
{
  "verified": true,
  "confidence": 0.82,
  "bestMatch": {},
  "candidates": []
}
```

---

## 九、Lead Finder 修复方案

### 输入逻辑

用户卖连接器时，系统要自动扩展客户应用场景。

输入：

```json
{
  "product": "industrial connectors",
  "targetApplications": ["solar", "energy storage", "EV charging"],
  "country": "Germany",
  "depth": "standard"
}
```

系统扩展：

```text
solar inverter manufacturer
PV module manufacturer
BESS integrator
battery pack manufacturer
PCS manufacturer
EV charger manufacturer
DC fast charger manufacturer
control cabinet builder
wire harness manufacturer
```

### 输出分层

```json
{
  "candidatePool": [],
  "shortlist": [],
  "deepDiveReports": [],
  "providerUsage": {},
  "savedRunId": "run_xxx"
}
```

### 筛选策略修改

当前过早过滤：

```text
fitScore < 86 -> 丢弃
```

改为：

```text
低分不丢弃，进入 candidatePool
高分进入 shortlist
用户选择后才 deepDive
```

推荐阈值：

```text
candidatePool: score >= 40
shortlist: score >= 70
deepDive: 用户选择或 score >= 85
```

---

## 十、OSINT 背调修复方案

### 内置 Prompt

新增：

```text
server/modules/leads/application/prompts/osint-company-report.js
```

使用用户提供的 OSINT 规则，核心原则：

```text
只基于公开证据
产品必须具体到产品类型
结论必须附来源
联系方式不得猜测
冲突信息必须标注
信息不足写未找到
```

### 输出结构

```json
{
  "companyOverview": {
    "companyName": "",
    "website": "",
    "industry": "",
    "founded": "",
    "headquarters": "",
    "employeeScale": "",
    "summary": ""
  },
  "productsAndServices": [
    {
      "productName": "",
      "productType": "",
      "targetCustomers": "",
      "applicationScenario": "",
      "evidenceUrls": []
    }
  ],
  "customersAndPartners": [],
  "locations": [],
  "contacts": [],
  "riskNotes": [],
  "informationGaps": [],
  "conclusion": "",
  "evidenceStrength": "high | medium | low"
}
```

### API 消耗策略

OSINT 默认不深挖所有公司。

```text
Lead Finder 只生成候选池
用户点“深度背调”才跑 OSINT deep mode
```

---

## 十一、前端修复点

### 1. Similar Company 页面

新增：

```text
输入区：目标公司、产品、行业、国家、深度
结果区：AI 推荐理由、公司规模、产品、适配度、证据
操作：保存、导出、深度背调、加入 Lead Workspace
历史：最近查询
```

### 2. Lead Finder 页面

新增：

```text
候选池 tab
精选池 tab
深度背调 tab
API 使用量提示
保存按钮
导出按钮
```

### 3. Map Verify 页面

新增输入模式切换：

```text
查公司地点
查地址
验证公司+地址
```

### 4. OSINT 页面

新增：

```text
公司背调
精细到个人背调
证据列表
信息缺口
保存报告
```

---

## 十二、实现顺序

### Phase 1：基础设施

1. 更新 `.env.example`，加入 AI / backup keys / limit 配置占位符。
2. 扩展 `loadServerEnv()`，读取新环境变量。
3. 新增 `ai-analysis-service.js`。
4. 新增 `api-budget-service.js`，支持缓存、限额、key 轮换。
5. 新增 `research-run-service.js`，统一保存查询结果。
6. 给 Gist JSON 加 `researchRuns`、`searchCache`、`apiUsage` section。

### Phase 2：Similar Company

1. 新增 `company-recommendation-service.js`。
2. 改造 `company-similarity-service.js`，不再直接搜 similar webpage。
3. 新增 AI 推荐候选。
4. 新增逐个公司 enrichment。
5. 保存 Research Run。
6. 前端展示历史和保存按钮。

### Phase 3：Map Verify

1. 新增 `map-lookup-service.js`。
2. 拆分公司地点、地址反查、公司地址验证三种模式。
3. Google Maps 返回 `maxResults` 从 1 改为可配置。
4. 前端增加模式切换。
5. 查询结果保存为 Research Run。

### Phase 4：Lead Finder

1. 放宽过滤阈值。
2. 增加应用场景扩展。
3. 输出 candidatePool / shortlist / deepDiveReports。
4. 默认 economy / standard 模式减少 API 消耗。
5. 用户选择后再 deep dive。

### Phase 5：OSINT

1. 内置中文 OSINT prompt。
2. AI 基于 evidence 生成结构化报告。
3. 联系方式提取遵守公开证据规则。
4. 产品必须具体到产品类型。
5. 保存报告到 Research Run / Gist。

### Phase 6：测试与部署

1. 单元测试：AI config missing 时返回安全错误。
2. 单元测试：API budget 超限时不继续调用 provider。
3. 单元测试：Research Run 可保存、读取、同步 Gist。
4. 集成测试：Similar Company 推荐 -> enrichment -> 保存。
5. 集成测试：Map Verify 三种输入模式。
6. Vercel 环境变量配置。
7. 线上 smoke test。

---

## 十三、完成标准

### Similar Company

- [ ] AI 先推荐公司，不再直接展示 Tavily 网页搜索结果。
- [ ] 每家公司都有官网、产品、规模线索、适配理由、证据 URL。
- [ ] 查询结果可保存。

### Map Verify

- [ ] 只有公司名可返回多个地点。
- [ ] 只有地址可反查地址上的公司/机构。
- [ ] 公司名 + 地址可返回多个候选和置信度。

### Lead Finder

- [ ] 连接器销售场景可扩展光伏、储能、充电桩、工业自动化客户池。
- [ ] 候选结果不少于配置目标。
- [ ] 不再过早丢弃低置信但可能有价值的公司。

### OSINT

- [ ] 背调报告只基于公开证据。
- [ ] 产品具体到产品类型。
- [ ] 联系方式不猜测。
- [ ] 信息缺口明确写出。

### 安全与成本

- [ ] 所有 key 只在 Vercel env / `.env.local`，不进 GitHub。
- [ ] Tavily / Brave 支持 backup key。
- [ ] 有缓存和每日限额保护。
- [ ] 查询历史保存到 Gist。
