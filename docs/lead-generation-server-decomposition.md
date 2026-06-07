# `server.js` 线索生成逻辑拆分清单

## Document purpose

本文是 `C:/Users/ADMIN/apply-bot/server.js` 中线索生成逻辑的实施级拆分清单，不是新的架构讨论稿。

它只做三件事：

1. 把当前 `server.js` 中已经存在的 lead-generation 责任组逐一落到目标模块。
2. 给出可以按顺序执行的迁移步骤，确保迁移过程中不破坏现有行为。
3. 约束下一步实现时不要重新争论 schema、评分边界、provider 责任和持久化方向。

本清单默认以下两份文档已经冻结并作为输入，不在这里重定义：

1. [lead-generation-architecture.md](/C:/Users/ADMIN/apply-bot/docs/lead-generation-architecture.md)
2. [lead-generation-canonical-schema.md](/C:/Users/ADMIN/apply-bot/docs/lead-generation-canonical-schema.md)

本次拆分目标是“模块化单体内抽离”，不是大爆炸重写，也不是数据库迁移。

## Current `server.js` responsibility map

当前线索生成逻辑并不是一个独立模块，而是散落在 `server.js` 顶部配置区、通用 helper 区、provider 调用区、启发式分析区、workspace 组装区和 Express 路由区。

下面是当前与 lead-generation 直接相关的责任地图。

### 1. env/config loading

当前位置：

1. `loadEnvFile()`，`TAVILY_API_KEY`，`BRAVE_API_KEY`，`GOOGLE_MAPS_API_KEY`，`blockedResearchDomains`，`defaultTargetTypes`，`defaultExcludeTypes`
2. `searchStrategyTemplates`，`fallbackStrategyTemplates`
3. `industryProfiles`，`countryMarketHints`

当前作用：

1. 加载 `.env.local` / `.env`
2. 保存 provider key
3. 保存行业画像、国家提示、默认 target/exclude 策略
4. 为 `discoverRealCompanies()` 提供 query 生成上下文

目标去向：

1. `server/config/env.js`
2. `server/modules/leads/config/search-strategy.js`
3. `server/modules/leads/config/industry-profiles.js`

目标层级：

1. `route layer` 不能持有这些配置
2. `application layer` 可以读取配置对象
3. `domain layer` 只能依赖稳定业务配置，不依赖 `process.env`
4. `infrastructure layer` 读取 provider key

迁移后不得继续依赖：

1. `discoverRealCompanies()` 直接访问 `process.env`
2. provider adapter 直接访问整份 `server.js`
3. route handler 直接拼 query template

### 2. JSON file persistence helpers

当前位置：

1. `leadWorkspacesJsonPath`
2. `ensureJsonFile()`
3. `readJsonFile()`
4. `writeJsonFile()`

当前作用：

1. 初始化 `data/lead-workspaces.json`
2. 读写 workspace 列表
3. 让 `/api/lead-workspaces*` 路由直接操作 JSON 文件

目标去向：

1. `server/infrastructure/storage/json-file.js`
2. `server/modules/leads/repositories/lead-workspace-repository.js`

目标层级：

1. `infrastructure layer` 负责文件 IO
2. `application layer` 只依赖 repository interface

迁移后不得继续依赖：

1. lead route 直接 `readJsonFile()` / `writeJsonFile()`
2. application service 直接知道 `lead-workspaces.json` 路径
3. verification / scoring 函数直接写文件

备注：

1. JSON 持久化本阶段保留，不改成数据库。
2. 第一阶段的目标是抽象 repository，不是替换存储介质。

### 3. provider search functions

当前位置：

1. `fetchJson()`
2. `fetchText()`
3. `searchWithTavily()`
4. `searchWithBrave()`
5. `searchWithGoogleMapsNew()`
6. `searchWithGoogleMaps()`

当前作用：

1. 调第三方 API
2. 把 provider 原始结果粗略归一成当前临时 shape
3. 同时夹带 website、address、phone、placeId 等 provider 特有字段

目标去向：

1. `server/infrastructure/http/fetch-json.js`
2. `server/infrastructure/http/fetch-text.js`
3. `server/modules/leads/providers/tavily-adapter.js`
4. `server/modules/leads/providers/brave-adapter.js`
5. `server/modules/leads/providers/google-maps-adapter.js`
6. `server/modules/leads/providers/provider-result-normalizer.js`

目标层级：

1. `infrastructure layer`

迁移后不得继续依赖：

1. adapter 内直接调用 `analyzeWebsite()`
2. adapter 内计算 `fitScore`、`marketRole`、`buyerIntentScore`
3. route 层直接选用 Tavily/Brave/Google Maps 的字段

### 4. website analysis heuristics

当前位置：

1. `cleanDomain()`
2. `stripTrackingParams()`
3. `toRootCompanyUrl()`
4. `looksBlockedResearchDomain()`
5. `extractCompanyNameFromDomain()`
6. `extractEmails()`
7. `computeScaleSignal()`
8. `detectScaleSignals()`
9. `estimateEmployeeBand()`
10. `extractFoundedYear()`
11. `extractHeadquarters()`
12. `summarizeBuyingRelevance()`
13. `scoreBuyerIntent()`
14. `classifyMarketRole()`
15. `roleScore()`
16. `scoreWebsiteQuality()`
17. `isLikelyCompanyCandidate()`
18. `classifyBusinessType()`
19. `detectIndustryTags()`
20. `findContactPage()`
21. `analyzeWebsite()`

当前作用：

1. 判断候选是否像真实公司主体
2. 抓官网文本
3. 用启发式规则推断公司类型、市场角色、buyer intent、邮箱、规模、总部等字段
4. 直接生成当前 UI `company` 对象

目标去向：

1. `server/modules/leads/domain/entity-resolution/company-candidate-filter.js`
2. `server/modules/leads/domain/verification/website-verification-rules.js`
3. `server/modules/leads/domain/scoring/company-fit-scorer.js`
4. `server/modules/leads/domain/scoring/buyer-intent-scorer.js`
5. `server/modules/leads/domain/extraction/company-fact-extractors.js`
6. `server/modules/leads/application/analyzers/company-website-analyzer.js`

目标层级：

1. 纯字段提取和规则判断属于 `domain layer`
2. 需要调 `fetchText()` 抓网页的 orchestrator 属于 `application layer`
3. HTTP 获取网页文本属于 `infrastructure layer`

迁移后不得继续依赖：

1. 领域规则直接 import Express
2. 领域规则直接访问 Google Maps 专有字段名
3. `analyzeWebsite()` 直接返回最终路由 DTO

### 5. entity merge / dedup logic

当前位置：

1. `discoverRealCompanies()` 内部 `candidateEvidence` 这段按 domain 聚合的逻辑
2. `matchedQueryCount` / `matchedProviders` / `matchedQueryLabels` 聚合逻辑

当前作用：

1. 按 `cleanDomain(candidate.url)` 做初步去重
2. 合并 address、phone、localDescription、placeSourceUrl
3. 选较长的 `rawContent` 作为当前候选正文

目标去向：

1. `server/modules/leads/domain/entity-resolution/provider-candidate-merger.js`
2. `server/modules/leads/domain/entity-resolution/provider-evidence-collector.js`

目标层级：

1. `domain layer`

迁移后不得继续依赖：

1. 按 route 参数直接决定 merge 规则
2. 直接输出 UI company object
3. 直接写 workspace JSON

说明：

1. 第一阶段可以保留“按 domain 合并”为当前行为兼容策略。
2. 但要把它明确封装成 resolver，不能继续藏在 `discoverRealCompanies()` 中。

### 6. workspace assembly

当前位置：

1. `buildIndustryCandidates()`
2. `buildCompanySignals()`
3. `scoreCompany()`
4. `generateContact()`
5. `generateEmailDraft()`
6. `createWorkspaceSummary()`
7. `enrichCompanyForCRM()`
8. `buildWorkspaceFromCompanies()`
9. `buildWorkspace()`

当前作用：

1. 把公司候选装配成当前前端工作区格式
2. 在真实发现路径中生成联系人草稿和开发信草稿
3. 在 provider 失败时回退到 seed profile workspace

目标去向：

1. `server/modules/leads/application/workspace/build-workspace-from-companies.js`
2. `server/modules/leads/application/workspace/build-seeded-workspace.js`
3. `server/modules/leads/application/workspace/workspace-summary.js`
4. `server/modules/leads/application/mappers/lead-workspace-dto-mapper.js`
5. `server/modules/leads/application/fallback/seeded-workspace-fallback.js`

目标层级：

1. workspace 编排属于 `application layer`
2. 联系人占位和草稿生成属于 `application layer` 的临时输出逻辑，不进入 canonical domain

迁移后不得继续依赖：

1. canonical entity 直接携带 synthetic contact
2. domain 层直接生成邮件草稿
3. provider adapter 直接拼 `workspace`

说明：

1. `buildWorkspace()` 里的 synthetic contact / draft 允许暂时保留。
2. 但它必须被明确标注为 fallback / UI 辅助路径，不能混入 public verified contact 层。

### 7. google maps search / verify routes

当前位置：

1. `POST /api/lead-workspaces/verify-google-maps`
2. `POST /api/google-maps/search`
3. `POST /api/lead-workspaces/batch-verify-csv`

当前作用：

1. 单条公司地址校验
2. 主动搜索 Google Maps 结果
3. 批量 CSV/Excel 校验
4. 可选抓取官网邮箱

目标去向：

1. `server/modules/leads/routes/google-maps-routes.js`
2. `server/modules/leads/application/services/google-maps-search-service.js`
3. `server/modules/leads/application/services/address-verification-service.js`
4. `server/modules/leads/application/services/batch-address-verification-service.js`
5. `server/modules/leads/application/mappers/google-maps-dto-mapper.js`

目标层级：

1. route 参数校验属于 `route layer`
2. 调 provider 并组装稳定响应属于 `application layer`
3. Google Places API 调用属于 `infrastructure layer`

迁移后不得继续依赖：

1. route handler 内循环抓官网邮箱
2. route handler 内直接认识 `place.id`、`place.websiteUri` 这类 provider 字段
3. route handler 内直接拼批量验证业务规则

### 8. lead workspace CRUD routes

当前位置：

1. `GET /api/lead-workspaces`
2. `POST /api/lead-workspaces/discover`
3. `PUT /api/lead-workspaces/:id/company/:companyId`
4. `GET /api/lead-workspaces/:id/export.csv`
5. `GET /api/lead-workspaces/:id`

当前作用：

1. 创建 workspace
2. 读取 workspace
3. 更新 workspace 中公司字段
4. 导出 CSV

目标去向：

1. `server/modules/leads/routes/lead-workspace-routes.js`
2. `server/modules/leads/application/services/lead-discovery-service.js`
3. `server/modules/leads/application/services/lead-workspace-query-service.js`
4. `server/modules/leads/application/services/lead-workspace-update-service.js`
5. `server/modules/leads/application/services/lead-workspace-export-service.js`
6. `server/modules/leads/application/mappers/lead-company-update-mapper.js`

目标层级：

1. `route layer` + `application layer`

迁移后不得继续依赖：

1. route 直接读写 JSON 文件
2. route 直接调用 `discoverRealCompanies()`
3. route 直接操作 `workspace.summary`

## Target module tree

建议目标目录如下，保持单体结构，不引入服务拆分：

```text
server/
  config/
    env.js

  infrastructure/
    http/
      fetch-json.js
      fetch-text.js
    storage/
      json-file.js

  modules/
    leads/
      config/
        industry-profiles.js
        search-strategy.js

      routes/
        lead-workspace-routes.js
        google-maps-routes.js

      application/
        services/
          lead-discovery-service.js
          lead-workspace-query-service.js
          lead-workspace-update-service.js
          lead-workspace-export-service.js
          google-maps-search-service.js
          address-verification-service.js
          batch-address-verification-service.js
        analyzers/
          company-website-analyzer.js
        workspace/
          build-workspace-from-companies.js
          build-seeded-workspace.js
          workspace-summary.js
        fallback/
          seeded-workspace-fallback.js
        mappers/
          lead-workspace-dto-mapper.js
          google-maps-dto-mapper.js
          lead-company-update-mapper.js

      domain/
        entity-resolution/
          provider-candidate-merger.js
          provider-evidence-collector.js
          company-candidate-filter.js
        verification/
          website-verification-rules.js
          address-verification-rules.js
          public-contact-verification-rules.js
        scoring/
          company-fit-scorer.js
          buyer-intent-scorer.js
          address-business-scorer.js
        extraction/
          company-fact-extractors.js
        value-objects/
          lead-query.js

      providers/
        tavily-adapter.js
        brave-adapter.js
        google-maps-adapter.js
        provider-result-normalizer.js

      repositories/
        lead-workspace-repository.js
```

目录说明：

1. `providers/` 只负责 provider adapter，不承载业务规则。
2. `domain/` 只放项目自己的判断规则、评分规则、归并规则。
3. `application/` 只做编排、fallback、DTO 映射、workspace 组装。
4. `repositories/` 先抽 JSON repository，后续可替换数据库实现。

## Extraction order

必须按下面顺序迁移，避免一上来拆路由导致行为难以回归。

### Phase 1. 抽配置和基础设施，不改业务流程

先移动：

1. env 加载
2. provider key 获取
3. `fetchJson()` / `fetchText()`
4. `leadWorkspacesJsonPath` + `readJsonFile()` + `writeJsonFile()` + `ensureJsonFile()`

原因：

1. 这些是所有后续模块都会共享的底座。
2. 先抽它们，不改变 `discoverRealCompanies()` 的控制流。

本阶段允许暂留 `server.js`：

1. `discoverRealCompanies()`
2. 所有 lead route
3. 所有启发式规则

本阶段必须先移走：

1. 文件路径常量和 JSON helper
2. provider key 访问逻辑

### Phase 2. 抽 provider adapters，不改评分和 workspace 装配

先移动：

1. `searchWithTavily()`
2. `searchWithBrave()`
3. `searchWithGoogleMapsNew()`
4. `searchWithGoogleMaps()`

原因：

1. architecture 文档已明确 provider 必须成为可替换数据提供层。
2. 不先抽 provider，后面 application service 仍会被第三方字段绑死。

本阶段允许暂留 `server.js`：

1. `discoverRealCompanies()` 调度顺序
2. `analyzeWebsite()`
3. route handler

本阶段必须先移走：

1. 所有 Tavily/Brave/Google Maps 请求代码
2. provider 原始结果到统一 shape 的归一逻辑

### Phase 3. 抽 entity merge 和候选过滤规则

先移动：

1. `isLikelyCompanyCandidate()`
2. `cleanDomain()`
3. `stripTrackingParams()`
4. `toRootCompanyUrl()`
5. `looksBlockedResearchDomain()`
6. `candidateEvidence` 这段 merge 逻辑

原因：

1. 这是 `discoverRealCompanies()` 中第一块真正的领域逻辑。
2. 不先抽 resolver，后面的 verification 和 scoring 仍会挂在大函数里。

本阶段允许暂留 `server.js`：

1. `analyzeWebsite()`
2. workspace 组装

本阶段必须先移走：

1. provider 候选过滤
2. provider 结果去重与证据聚合

### Phase 4. 抽 website analysis 和 scoring / verification 规则

先移动：

1. `scoreWebsiteQuality()`
2. `classifyBusinessType()`
3. `classifyMarketRole()`
4. `scoreBuyerIntent()`
5. `roleScore()`
6. `detectIndustryTags()`
7. `extractEmails()`
8. `extractFoundedYear()`
9. `extractHeadquarters()`
10. `estimateEmployeeBand()`
11. `computeScaleSignal()`
12. `detectScaleSignals()`
13. `findContactPage()`
14. `summarizeBuyingRelevance()`
15. `analyzeWebsite()`

原因：

1. 这一步完成后，`discoverRealCompanies()` 会从“大量业务细节”收缩成 orchestration。
2. 这也是 canonical schema 文档要求最严格的一块，必须明确 DTO 边界。

本阶段允许暂留 `server.js`：

1. `discoverRealCompanies()` 作为 orchestration 入口
2. lead routes

本阶段必须先移走：

1. 所有网站级业务判定规则
2. 所有 company 分数和验证信号计算

### Phase 5. 抽 workspace assembly 和 fallback

先移动：

1. `buildIndustryCandidates()`
2. `buildSearchStrategy()`
3. `buildWorkspaceFromCompanies()`
4. `enrichCompanyForCRM()`
5. `createWorkspaceSummary()`
6. `buildWorkspace()`
7. `generateContact()`
8. `generateEmailDraft()`

原因：

1. 这一步完成后，`discoverRealCompanies()` 只剩 application service 主流程。
2. 同时可以把 fallback workspace 和真实发现 workspace 的边界说明白。

本阶段允许暂留 `server.js`：

1. Express route 注册

本阶段必须先移走：

1. workspace 组装函数
2. seeded fallback 函数

### Phase 6. 抽 application services 和 routes

先移动：

1. `discoverRealCompanies()` -> `LeadDiscoveryService`
2. `/api/lead-workspaces*` -> `lead-workspace-routes.js`
3. `/api/google-maps/search`、`/api/lead-workspaces/verify-google-maps`、`/api/lead-workspaces/batch-verify-csv` -> `google-maps-routes.js`

原因：

1. 只有在前面底层模块已拆开后，route 抽离才不会把单体逻辑原封不动复制到新文件。

最终 `server.js` 应只保留：

1. Express app 初始化
2. 全局 middleware
3. 非 lead 模块路由注册
4. lead 模块路由挂载
5. `app.listen()`

## Function/class ownership decisions

下面给出明确归属，避免实现时反复讨论。

### 应归 `application layer` 的函数

1. `discoverRealCompanies()`，拆为 `LeadDiscoveryService`
2. `buildWorkspaceFromCompanies()`
3. `buildWorkspace()`
4. `createWorkspaceSummary()`
5. `generateContact()`，但只作为 synthetic fallback / workspace 辅助
6. `generateEmailDraft()`，但只作为 synthetic fallback / UI 辅助
7. `enrichCompanyForCRM()`

理由：

1. 这些函数在编排流程、组装输出、处理 fallback。
2. 它们不是纯领域规则，也不是基础设施。

### 应归 `domain layer` 的函数

1. `isLikelyCompanyCandidate()`
2. `scoreWebsiteQuality()`
3. `classifyBusinessType()`
4. `classifyMarketRole()`
5. `scoreBuyerIntent()`
6. `roleScore()`
7. `detectIndustryTags()`
8. `extractFoundedYear()`
9. `extractHeadquarters()`
10. `estimateEmployeeBand()`
11. `computeScaleSignal()`
12. `detectScaleSignals()`
13. `summarizeBuyingRelevance()`
14. provider 结果 merge / dedupe 规则

理由：

1. 这些函数体现的是“本项目怎么看待公司、官网、角色、分数、验证信号”。
2. 它们应独立于 Express、文件系统和第三方 API。

### 应归 `infrastructure layer` 的函数

1. `fetchJson()`
2. `fetchText()`
3. `searchWithTavily()`
4. `searchWithBrave()`
5. `searchWithGoogleMapsNew()`
6. `searchWithGoogleMaps()`
7. `readJsonFile()`
8. `writeJsonFile()`
9. `ensureJsonFile()`
10. env key 读取

理由：

1. 它们面向外部系统和外部介质。

### 应归 `route layer` 的代码

1. `/api/lead-workspaces`
2. `/api/lead-workspaces/discover`
3. `/api/lead-workspaces/:id/company/:companyId`
4. `/api/lead-workspaces/:id/export.csv`
5. `/api/lead-workspaces/:id`
6. `/api/lead-workspaces/verify-google-maps`
7. `/api/google-maps/search`
8. `/api/lead-workspaces/batch-verify-csv`

理由：

1. 它们应只做入参校验、调用 service、返回 DTO。

## DTO boundary rules

这是本次拆分最容易失控的地方，必须硬性约束。

1. provider adapter 输出 `ProviderResult` 风格对象，不输出当前 UI `company` 对象。
2. `analyzeWebsite()` 拆分后不得直接返回前端 `LeadCompany`，而应先返回 canonical candidate / analysis result。
3. `LeadWorkspace`、`LeadCompany`、CSV 导出字段仍可继续存在，但只能作为 application DTO / view model。
4. `customEmail`、`customContactName`、`customContactTitle`、`customLinkedinUrl`、`customEmailStatus` 保留在 UI DTO，不进入 canonical public contact 层。
5. synthetic `generateContact()` 结果不得映射成 canonical `PublicContactRecord`。
6. `officialWebsiteLikely`、`fitScore`、`marketRole` 等当前字段若继续返回前端，必须由 application mapper 从 canonical / analysis result 派生。
7. Google Maps 返回值中的 `rating`、`placeId`、`types` 等字段可以继续暴露给现有页面，但要通过 `google-maps-dto-mapper.js` 输出，不能由 route 直接拼接。

## Repository extraction rules

1. 先定义 `LeadWorkspaceRepository` 的读写接口，再把 JSON 实现挂进去。
2. repository 的最小职责是：
   1. `listWorkspaces()`
   2. `getWorkspaceById(id)`
   3. `saveDiscoveredWorkspace(workspace)`
   4. `updateWorkspaceCompany(workspaceId, companyId, patch)`
3. repository 返回的仍可先是当前 workspace JSON shape，不要求本阶段重做数据库模型。
4. repository 不得承载 `discoverRealCompanies()` 的业务逻辑。
5. repository 不得计算 `summary`、`fitScore`、`verification`。
6. route 和 service 以后只能依赖 repository interface，不得再 import `leadWorkspacesJsonPath`。
7. `ensureJsonFile()` 只允许留在 JSON repository 内部。

## Provider adapter extraction rules

1. 一个 provider 一个 adapter 文件，禁止继续让一个大函数同时理解 Tavily、Brave、Google Maps。
2. adapter 只负责：发请求、处理 provider 错误、抽取 provider 原始字段、输出统一 normalized result。
3. adapter 不负责：
   1. 判定是否官方站
   2. 判定是否潜在买家
   3. 计算最终 fit score
   4. 决定是否进入 workspace
4. Brave 的 local result 和 web result 都保留，但必须在 adapter 内被归一成统一结果结构。
5. Google Maps 的 `searchWithGoogleMaps()` 只是 `searchWithGoogleMapsNew()` 的预设参数包装，这种“业务预设”可保留，但应迁到 application service 或 adapter facade，不要再留在 `server.js`。
6. adapter 必须保留 provider/source/query/queryLabel/capturedAt 这类追溯信息。
7. adapter 输出中允许保留 provider-specific metadata，但必须隔离在 metadata 字段或明确命名字段中，不能污染 canonical company 对象。

## Verification/scoring extraction rules

1. 验证规则和评分规则必须从 `analyzeWebsite()` 中拆出来，不能继续揉在一个大函数里。
2. 验证最少要分开：
   1. 候选是否像真实公司主体
   2. 官网是否像官方站
   3. 地址是否来自可信来源
   4. 公共联系方式是否只属于 observed，不属于 verified
3. `fitScore` 目前可继续保留为兼容输出，但内部实现必须改成组合式评分，而不是 `analyzeWebsite()` 内单点累加。
4. `buyerIntentScore` 和 `marketRole` 不能再直接吃 provider 原始字段名，必须只吃归一后的文本和结构化输入。
5. `officialWebsiteLikely` 仍可临时保留，但它必须被视为 verification signal，不是最终 canonical truth。
6. 邮箱抽取 `extractEmails()` 只能产生 observed public contact candidates，不能直接宣布 verified。
7. `address`、`phone`、`website` 这类字段若来自 Google Maps 或 Brave local，必须在后续结构中带来源信息，不能只保留最终字符串。

## Risk controls during migration

迁移期间必须遵守下面的风控规则。

1. 不做 big-bang rewrite，每次只移动一个责任组，并保持接口不变。
2. 每移动一组函数，先做“转发式迁移”：
   1. 新文件导出新实现
   2. `server.js` 原入口临时调用新实现
   3. 行为稳定后再删旧代码
3. 先保持当前前端响应 shape 不变，避免前后端同时改。
4. 在 repository 抽离完成前，不要同时重做 workspace schema。
5. 在 provider adapter 抽离完成前，不要急着重做验证层级。
6. `buildWorkspace()` 的 seeded fallback 必须一直可用，直到真实发现链路完全稳定。
7. `discoverRealCompanies()` 在迁移期间允许暂时继续存在，但其内部职责必须一块块下沉，最后只剩 orchestration。
8. Google Maps 专用页面相关接口要单独回归，避免 lead discovery 改动影响主动搜索页。
9. synthetic contact / draft 路径必须显式标注为临时输出，避免被误当成 canonical verified contact。
10. 本阶段禁止引入数据库迁移、消息队列、事件总线、微服务拆分，这些都会扩大变量面。

## Milestone checklist

下面这份清单应按顺序勾，不允许跳步。

### M1. 基础设施和配置拆出

1. [ ] 建立 `server/config/env.js`
2. [ ] 建立 `server/infrastructure/http/fetch-json.js`
3. [ ] 建立 `server/infrastructure/http/fetch-text.js`
4. [ ] 建立 `server/infrastructure/storage/json-file.js`
5. [ ] 建立 `server/modules/leads/repositories/lead-workspace-repository.js`
6. [ ] `server.js` 的 lead route 不再直接访问 `leadWorkspacesJsonPath`

### M2. provider adapter 拆出

1. [ ] 建立 `tavily-adapter.js`
2. [ ] 建立 `brave-adapter.js`
3. [ ] 建立 `google-maps-adapter.js`
4. [ ] 建立 `provider-result-normalizer.js`
5. [ ] `discoverRealCompanies()` 不再直接包含 HTTP 请求实现

### M3. entity resolution 拆出

1. [ ] 建立 `company-candidate-filter.js`
2. [ ] 建立 `provider-candidate-merger.js`
3. [ ] 建立 `provider-evidence-collector.js`
4. [ ] `discoverRealCompanies()` 不再自己维护 `candidateEvidence` merge 细节

### M4. verification 和 scoring 拆出

1. [ ] 建立 `website-verification-rules.js`
2. [ ] 建立 `company-fit-scorer.js`
3. [ ] 建立 `buyer-intent-scorer.js`
4. [ ] 建立 `company-fact-extractors.js`
5. [ ] 建立 `company-website-analyzer.js`
6. [ ] `analyzeWebsite()` 被拆成 analyzer + domain rules，而不是单体函数

### M5. workspace 组装与 fallback 拆出

1. [ ] 建立 `build-workspace-from-companies.js`
2. [ ] 建立 `build-seeded-workspace.js`
3. [ ] 建立 `workspace-summary.js`
4. [ ] 建立 `lead-workspace-dto-mapper.js`
5. [ ] seeded fallback 仍可输出当前前端可消费的 workspace 结构

### M6. application services 和 routes 拆出

1. [ ] 建立 `lead-discovery-service.js`
2. [ ] 建立 `lead-workspace-query-service.js`
3. [ ] 建立 `lead-workspace-update-service.js`
4. [ ] 建立 `lead-workspace-export-service.js`
5. [ ] 建立 `google-maps-search-service.js`
6. [ ] 建立 `address-verification-service.js`
7. [ ] 建立 `batch-address-verification-service.js`
8. [ ] 建立 `lead-workspace-routes.js`
9. [ ] 建立 `google-maps-routes.js`
10. [ ] `server.js` 中 lead 相关代码只剩路由挂载

## 最终执行约束

下一步实现时，严格按下面的判断执行：

1. 必须先抽 provider adapters 和 application services，不要先改 schema 存储。
2. 必须保留 JSON persistence，只把它包进 repository。
3. 必须保留现有 route 响应形状，直到 mapper 层就位。
4. 可以暂时留在 `server.js` 的只有 orchestration 入口和路由挂载，不应再新增任何 lead-specific 规则进去。
5. 最先必须移动的是配置、JSON helper、provider 调用代码，因为它们是后续所有模块的依赖底座。
6. `discoverRealCompanies()` 是当前最大拆分目标，但不能直接删除，应先瘦身为 application service facade。

如果实施时出现新需求，默认先检查是否违反 architecture / canonical schema 文档，不能在拆分过程中临时改写字段语义。
