# B2B 外呼线索生成系统架构与实施路径

## 1. 文档定位

本文档不是产品愿景，也不是开放式讨论稿。它是 `apply-bot` 内 B2B 外呼线索生成系统的执行架构基线，用来约束后续的 schema 设计、后端拆分、验证策略和实现顺序。

后续开发默认以本文档为准。若实现与本文档冲突，先修改本文档并说明原因，再动代码。禁止在实现过程中临时重定义核心数据模型、责任边界或评分规则。

## 2. Purpose And Non-Goals

### 2.1 目的

本系统服务三条明确业务路径：

1. `国家/区域 + 行业关键词 -> 找公司`
2. `批量地址 -> 判断更像商业地址还是个人地址`
3. `公司/人物线索 -> 结构化 OSINT 尽调`

系统目标不是“尽可能多抓数据”，而是输出可进入销售动作的结构化候选对象，并且让每个结论都能追溯来源、置信度和验证层级。

当前阶段的核心目标只有四个：

1. 建立项目自有的 canonical company model。
2. 把发现、实体归并、验证、评分、导出从 `server.js` 单体逻辑中拆开。
3. 把 Tavily、Brave、Google Maps 变成可替换的数据提供层，而不是业务规则承载层。
4. 让三条业务路径共享同一套实体模型和证据治理方式。

### 2.2 非目标

以下内容不属于当前架构目标：

1. 不做完整 CRM。
2. 不做自动化发信平台。
3. 不把 Apollo、Hunter、LinkedIn 这类联系人数据源当成当前必备内建能力。
4. 不承诺“自动找出最终联系人”，当前只要求输出公司级候选、公开联系方式、验证状态和后续人工补全入口。
5. 不在这一阶段把系统做成多服务部署，当前先完成单仓单后端内的模块化单体。

## 3. Current-State Assessment

### 3.1 当前代码现实

当前线索生成系统已经存在可运行路径，但其本质是“功能堆在一起的单体原型”，而不是可持续扩展的架构。

后端现实：

1. `server.js` 是单文件 Express 后端，长度约 2400 行，混合了通用文件 API、简历处理、prompt 管理、lead discovery、Google Maps 搜索和校验逻辑。
2. 线索系统的主要入口是 `/api/lead-workspaces/discover`，调用 `discoverRealCompanies()`，失败后回退到 `buildWorkspace()` 的种子数据模式。
3. 真实发现流程在一个函数链中完成 provider 查询、候选去重、官网抓取、规则分析、评分、workspace 组装和本地 JSON 落盘。
4. 数据存储当前直接写入 `data/lead-workspaces.json`，没有领域层和持久化层隔离。

前端现实：

1. `src/pages/LeadFinder.tsx` 是主工作台，面向“行业发现 -> 工作区 -> 公司粗排 -> 人工编辑公司详情/联系人/开发信”。
2. `src/pages/GoogleMapsSearch.tsx` 是主动搜索页，直接走 `/api/google-maps/search`，支持地区、评分、电话、网站和抓邮箱开关。
3. `src/pages/GoogleMapsVerify.tsx` 是单个和批量校验页，直接走 Google Maps 校验接口。
4. `src/lib/leadApi.ts` 只是薄 API client，`src/types/leads.ts` 定义的是前端展示和编辑需要的数据结构，不是严格的领域 schema。

Provider 现实：

1. 已集成 key 和调用路径的 provider 是 Tavily、Brave、Google Maps。
2. `discoverRealCompanies()` 同时调用 Tavily、Brave、Google Maps，把 provider 结果拉平后按域名近似去重。
3. 没有独立的 provider adapter 层，也没有 provider 级别的质量打分、失败分类和重试策略。

### 3.2 当前优点

当前代码并非空白，它已经提供了后续架构可以复用的有效起点：

1. 已经有面向工作区的用户交互模型，前端可以承载“发现、编辑、导出”的闭环。
2. 已经有基本的官网分析、邮箱抽取、业务类型判断、市场角色判断、buyer intent 打分等规则雏形。
3. 已经有真实 provider 接入，而不是纯 mock。
4. 已经验证过“真实搜索失败时回退到种子画像”的降级思路。

### 3.3 当前主要问题

当前实现可用，但不可信、不稳定、也不适合继续堆功能。核心问题如下。

#### 3.3.1 实体解析过弱

当前去重主轴基本依赖域名，辅以部分字段补全。这对以下情况不够：

1. 同一公司多域名。
2. 地区站点与集团站点。
3. Google Maps 条目名称和官网主体名称不一致。
4. 经销商、目录站、媒体页误入官方实体。

这意味着“同一公司多条记录”和“错误把非官方页面当公司”的风险很高。

#### 3.3.2 验证分层不足

当前把“搜到结果”“像官网”“抓到邮箱”“Google Maps 找到条目”混在一起使用，没有统一的 verification tier。

结果是：

1. 用户看到了 `fitScore`，但不知道这个分数建立在几层证据之上。
2. 同一条记录的地址、电话、官网、业务描述可能来自不同来源，但没有证据归档和冲突处理。
3. 后续无法可靠地支持“地址商业性判断”和“OSINT 尽调”两条路径，因为底层证据体系不统一。

#### 3.3.3 地址评分能力缺失

系统已经有 Google Maps 搜索和校验页，但还没有正式的“商业地址 vs 个人地址概率”模型。现状只能看 Google Maps 是否有条目，无法回答第二条业务路径的核心问题。

#### 3.3.4 联系人能力存在合成风险

当前 `buildWorkspace()` 会基于画像种子直接生成联系人和开发信草稿，这在原型阶段可接受，但它本质上是 synthetic contact path，不可被误用为真实联系人发现能力。

因此必须明确：

1. synthetic contact 只能作为内部写作占位，不得混入真实联系人层。
2. 联系人真实度、邮箱状态、来源证据必须单独分层。

#### 3.3.5 模块边界不存在

当前单体内耦合关系如下：

1. provider 搜索逻辑直接决定业务候选。
2. 业务规则直接操作网络抓取结果。
3. API handler 直接承担 orchestration。
4. persistence 直接是 JSON 文件，没有 repository abstraction。

继续在该结构上追加功能，只会让后续 schema 变动、规则升级和 provider 替换越来越痛苦。

## 4. Target Architecture

### 4.1 总体原则

目标形态不是微服务，而是“模块化单体”。先把边界做对，再决定是否拆服务。

依赖方向必须固定为：

1. API Layer
2. Application Layer
3. Domain Layer
4. Infrastructure Layer

禁止反向依赖。业务规则不得直接依赖 Express request/response，也不得直接依赖某个 provider 的返回字段。

### 4.2 目标模块图

```text
UI Pages
  -> leadApi client
  -> HTTP API routes

HTTP API routes
  -> Lead Discovery Application Service
  -> Address Verification Application Service
  -> OSINT Research Application Service

Application Services
  -> Canonical Entity Resolver
  -> Verification Engine
  -> Scoring Engine
  -> Export Assembler
  -> Repositories
  -> Provider Adapters

Domain Core
  -> Company Entity
  -> Address Entity
  -> Contact Entity
  -> Evidence Record
  -> Verification Status
  -> Scoring Policy

Infrastructure
  -> Tavily Adapter
  -> Brave Adapter
  -> Google Maps Adapter
  -> Web Fetch / Content Extraction Adapter
  -> JSON Repository
  -> Later DB Repository
```

### 4.3 三条业务路径的统一方式

三条业务路径不能各自长一套 schema。

统一规则如下：

1. 公司发现路径输出 `CompanyCandidate`，进入 canonical company pipeline。
2. 地址判断路径输出 `AddressAssessment`，但地址必须能挂回 company 或 standalone subject。
3. OSINT 尽调路径输出 `ResearchCase` 和 `EvidenceRecord`，证据结构必须与公司发现路径共用。

也就是说，三条路径共享同一组底层对象：

1. `Entity`
2. `Evidence`
3. `Verification`
4. `Scoring`

不能出现“Lead Finder 一套字段，Google Maps Verify 另一套字段，OSINT 再来第三套字段”的演化方向。

## 5. Module Responsibilities

### 5.1 API Layer

职责：

1. 请求参数校验。
2. 调用 application service。
3. 返回稳定 DTO。
4. 不包含业务打分、不直接拼装 provider 结果。

现阶段对应：从 `server.js` 内的 lead 相关路由开始抽离。

### 5.2 Application Layer

职责：

1. 编排发现流程。
2. 调度 provider。
3. 调用实体解析、验证、评分、导出。
4. 处理 fallback 策略。
5. 管理 workspace / case 生命周期。

必须拆成至少三个用例服务：

1. `LeadDiscoveryService`
2. `AddressAssessmentService`
3. `OsintResearchService`

### 5.3 Domain Layer

职责：

1. 定义 canonical company schema。
2. 定义 verification status 和 evidence model。
3. 定义评分输入，不定义 provider 细节。
4. 持有“什么叫可信公司、可信地址、可信公开联系信息”的项目自有规则。

这是本项目必须自己拥有的部分，不能外包给第三方库。

### 5.4 Provider Adapters

职责：

1. 把 Tavily、Brave、Google Maps、网页抓取结果转换为统一 provider result shape。
2. 返回原始来源、抓取时间、provider 名称、基础字段和原文摘要。
3. 不做业务判定，不计算最终 fit score。

### 5.5 Entity Resolver

职责：

1. 合并多 provider 候选。
2. 识别官方站与非官方站。
3. 处理同名不同主体、同主体多域名、地区站点与集团站点。
4. 产出 canonical company candidate。

这部分是当前系统最优先补强的薄弱点之一。

### 5.6 Verification Engine

职责：

1. 维护多层验证状态。
2. 区分“发现到”“疑似官方”“官方站已分析”“地图已匹配”“地址已验证”“公开联系信息已验证”。
3. 为每个字段保留证据来源和冲突状态。

### 5.7 Scoring Engine

职责：

1. 公司适配度评分。
2. 地址商业性评分。
3. 联系方式可信度评分。
4. OSINT 风险或价值评分。

评分必须建立在已归一的字段和验证层级上，不能直接吃 provider 原始文本。

### 5.8 Repository Layer

职责：

1. 保存 workspace、case、entity、evidence。
2. 提供读写接口。
3. 隔离当前 JSON 存储与未来数据库迁移。

当前先保留 JSON repository，但必须抽象接口，不能继续在业务代码里直接 `readFileSync/writeFileSync`。

## 6. Canonical Company Schema Direction

### 6.1 原则

当前 `src/types/leads.ts` 的 `LeadCompany` 适合作为 UI 编辑模型，但不能直接当作领域主模型。原因：

1. 字段混合了展示字段、编辑字段、推断字段、输出字段。
2. 没有证据层。
3. 没有验证层。
4. 没有字段级来源冲突模型。

目标是定义一套更严格的 canonical company schema，然后由它映射到前端 DTO。

### 6.2 目标主对象

建议后续 schema 以以下对象为核心。

#### 6.2.1 CompanyEntity

必须包含：

1. `entityId`
2. `canonicalName`
3. `normalizedName`
4. `officialWebsite`
5. `rootDomain`
6. `country`
7. `businessType`
8. `marketRole`
9. `summary`
10. `products`
11. `applications`
12. `headquarters`
13. `foundedYear`
14. `employeeBand`
15. `addresses[]`
16. `publicContacts[]`
17. `verification`
18. `scores`
19. `evidenceRefs[]`
20. `sourceRefs[]`

#### 6.2.2 AddressRecord

必须包含：

1. `addressId`
2. `rawAddress`
3. `normalizedAddress`
4. `country`
5. `region`
6. `city`
7. `postalCode`
8. `geo`
9. `addressTypeGuess`
10. `businessLikelihoodScore`
11. `verificationStatus`
12. `evidenceRefs[]`

#### 6.2.3 PublicContactRecord

必须包含：

1. `contactId`
2. `contactType`，例如 `public_email`、`public_phone`、`generic_form`、`named_person`
3. `value`
4. `ownerScope`，例如 `company_level`、`location_level`、`person_level`
5. `sourceType`
6. `verificationStatus`
7. `confidenceScore`
8. `evidenceRefs[]`

#### 6.2.4 EvidenceRecord

必须包含：

1. `evidenceId`
2. `provider`
3. `sourceUrl`
4. `sourceType`
5. `capturedAt`
6. `title`
7. `snippet`
8. `rawReference`
9. `fieldClaims[]`
10. `trustTier`

### 6.3 评分字段方向

`fitScore` 不能继续是单一大分。后续必须至少拆成：

1. `companyFitScore`
2. `officialSiteConfidence`
3. `buyerIntentScore`
4. `addressBusinessLikelihood`
5. `publicContactConfidence`

UI 可继续显示一个综合分，但领域层必须保留子分维度。

### 6.4 与现有前端类型的关系

后续 `LeadCompany` 不删除，但降级为 view model。映射规则如下：

1. `LeadCompany.name` 来自 `CompanyEntity.canonicalName`
2. `LeadCompany.website` 来自 `CompanyEntity.officialWebsite`
3. `LeadCompany.contactEmails` 来自 `PublicContactRecord` 的公共邮箱聚合
4. `LeadCompany.fitScore` 来自综合分映射
5. `LeadCompany.custom*` 字段继续保留为用户手工补录层，不进入 canonical evidence

## 7. Reuse Vs Self-Build Decisions

### 7.1 必须自己掌握的部分

以下能力必须由本项目自己定义和拥有：

1. canonical company model
2. entity resolution policy
3. verification tier 设计
4. address business scoring policy
5. public-contact rules
6. fit scoring policy

原因很简单，这些都是业务判断，不是通用爬虫或搜索库能替你决定的。

### 7.2 直接复用的部分

以下内容优先复用，不自己发明轮子：

1. Google Maps API client，优先 `@googlemaps/google-maps-services-js`
2. 地址解析与标准化，优先 `libpostal`
3. 网页抓取与站点遍历，优先 `Crawl4AI` 或 `Crawlee`
4. 正文抽取，优先 `trafilatura`

这些能力的定位是基础设施，不承担业务决策。

### 7.3 延后引入的部分

以下项目可以在后期评估，不进入当前最小执行路径：

1. `Splink`，用于更复杂的实体匹配和记录链接
2. 更重的数据库和搜索索引
3. 外部联系人供应商接入

延后原因：当前首要问题不是算法不够高级，而是 schema、验证层和模块边界没定住。

### 7.4 明确不采纳的方向

当前不采纳“找一个现成 OSS 端到端项目直接改”的路线。原因：

1. 没有可信的端到端 OSS 可以直接覆盖三条业务路径。
2. 业务核心在于规则、验证和实体模型，不在于 provider 接口封装。
3. 盲目接入现成项目会把架构主导权交出去，后面更难统一 schema。

## 8. Phased Implementation Roadmap

本路线图必须严格按顺序执行。后阶段不得在前阶段 schema 未稳定前抢跑。

### Phase 0, 基线冻结

目标：把当前系统定义清楚，而不是继续直接改功能。

交付：

1. 本文档落地。
2. 列出现有 API、前端页面、JSON 数据文件、provider 栈和已知薄弱点。
3. 明确 `LeadCompany` 是 view model，不是领域主模型。

退出条件：

1. 后续开发不再争论总体方向。
2. 下一阶段可以直接开始 schema 设计。

### Phase 1, Canonical Schema 定稿

目标：先定领域对象，再拆代码。

必须完成：

1. 定义 `CompanyEntity`、`AddressRecord`、`PublicContactRecord`、`EvidenceRecord`、`VerificationStatus`。
2. 定义字段级来源和冲突模型。
3. 定义 provider result 的统一中间格式。
4. 明确前端 DTO 与领域对象的映射。

禁止事项：

1. 禁止先拆 `server.js` 再补 schema。
2. 禁止继续往 `LeadCompany` 上堆新字段代替领域模型。

### Phase 2, Provider Adapter 抽离

目标：把 Tavily、Brave、Google Maps、网页抓取从业务逻辑里抽成 adapter。

必须完成：

1. 每个 provider 返回统一 provider result shape。
2. 保存 provider metadata、source url、captured time、raw snippet。
3. 将搜索、网页抓取、Google Maps 搜索与 Google Maps 校验分开。

禁止事项：

1. 禁止 adapter 内计算 fit score。
2. 禁止 adapter 直接写 workspace JSON。

### Phase 3, Entity Resolution 与 Verification Engine

目标：先解决“是不是同一家公司、是不是官方、证据有几层可信”这两个基础问题。

必须完成：

1. 建立域名、名称、地址、Google Maps 条目之间的实体归并规则。
2. 建立 verification tier，例如 `discovered`、`official_site_likely`、`official_site_verified`、`maps_matched`、`address_verified`、`public_contact_verified`。
3. 所有公司字段都可追溯到 evidence。

禁止事项：

1. 禁止在没有 verification tier 的情况下继续强化打分 UI。
2. 禁止把 synthetic contact 视为真实联系人。

### Phase 4, Lead Discovery Service 重构

目标：重写当前 `discoverRealCompanies()` 的责任边界。

必须完成：

1. 搜索编排从 API handler 中移出。
2. provider 查询、候选归并、官网分析、评分、workspace 组装拆成独立步骤。
3. fallback seeded profile 变成显式降级模式，而不是隐式兜底。

禁止事项：

1. 禁止继续用一个函数包办整条链路。
2. 禁止把失败原因隐藏成统一 fallback 成功。

### Phase 5, Address Assessment 路径落地

目标：正式支持“批量地址 -> 商业性判断”。

必须完成：

1. 引入地址规范化。
2. 构建地址商业性评分输入项，例如 Maps 条目类型、官网关联度、电话/营业状态、地点类别和文本证据。
3. 输出 `AddressAssessmentResult`，并可挂接到 company entity。

禁止事项：

1. 禁止只靠“Google Maps 搜到就算商业地址”。
2. 禁止地址结论无证据来源。

### Phase 6, OSINT Research 路径落地

目标：让“公司/人物线索 -> 结构化尽调”复用既有实体和证据体系。

必须完成：

1. 定义 `ResearchCase`。
2. 支持将公司、地址、公开联系方式、人物线索写入统一 evidence graph。
3. 输出结构化结论，而不是长文本拼接。

禁止事项：

1. 禁止另起一套独立 schema。
2. 禁止把 OSINT 输出只做成 markdown 文本而不落结构字段。

### Phase 7, Repository 与存储升级

目标：让数据层从“文件写哪里算哪里”升级为可迁移结构。

必须完成：

1. 先抽象 JSON repository。
2. 再规划数据库迁移。
3. workspace、entity、evidence、assessment、research case 分表或分集合。

禁止事项：

1. 禁止在未抽象 repository 前直接换数据库。
2. 禁止让应用服务继续依赖具体文件路径。

## 9. Execution Constraints / Must-Not Rules

以下规则是强约束，不是建议。

### 9.1 架构约束

1. 禁止新增功能直接写回 `server.js` 的 lead 单体逻辑，除非是过渡性接线，且必须有后续迁移计划。
2. 禁止用前端 view model 代替领域模型。
3. 禁止让 provider 原始字段直接进入 UI 主对象而不经过归一。
4. 禁止把评分逻辑散落在 API、adapter、前端三个地方。

### 9.2 数据约束

1. 禁止没有 `evidenceRefs` 的关键字段进入“已验证”状态。
2. 禁止 synthetic contact 与真实 public contact 混存而不标识。
3. 禁止地址记录没有标准化结果就进入地址评分。
4. 禁止同一实体的多来源字段静默覆盖，必须保留冲突信息或决议结果。

### 9.3 实施顺序约束

1. 先 schema，后拆分。
2. 先 adapter，后评分重构。
3. 先 entity resolution 和 verification，后地址评分和 OSINT。
4. 先 JSON repository abstraction，后数据库迁移。

### 9.4 质量约束

1. 每个阶段都必须产出明确 DTO 和领域对象边界。
2. 每个新评分都必须说明输入字段、证据要求和失效条件。
3. 每个 provider adapter 都必须能说明失败类型和空结果语义。
4. 每个字段都要能回答“这个值从哪里来”。

## 10. Success Criteria Per Phase

### Phase 0 成功标准

1. 已有系统边界、provider 栈和薄弱点写清楚。
2. 团队对“先 schema 再拆代码”达成一致。

### Phase 1 成功标准

1. canonical company schema、address schema、contact schema、evidence schema 定稿。
2. `LeadCompany` 与领域模型映射明确。

### Phase 2 成功标准

1. Tavily、Brave、Google Maps、网页抓取都有独立 adapter。
2. adapter 返回统一结构，且不承担业务打分。

### Phase 3 成功标准

1. 多 provider 候选能稳定归并为 canonical company。
2. 每条公司记录具备验证层级和证据追溯。

### Phase 4 成功标准

1. `discoverRealCompanies()` 的职责被拆散。
2. workspace 构建、评分、fallback、导出各自独立。

### Phase 5 成功标准

1. 批量地址输入能输出商业性判断和证据来源。
2. 地址结论不再等同于单一 Maps 命中。

### Phase 6 成功标准

1. OSINT case 与 lead discovery 共用底层实体和证据对象。
2. 输出可结构化消费，而不是只剩文本摘要。

### Phase 7 成功标准

1. 业务层不再直接依赖文件路径。
2. JSON 存储和未来数据库迁移边界清晰。

## 11. Immediate Next Actions

本文档完成后，下一步只做以下两件事，不跳步：

1. 产出 canonical schema 设计文档，明确领域对象、verification tier、evidence model、provider result model。
2. 基于 schema 制定 `server.js` lead 相关逻辑的拆分清单，先拆 adapter 和 application service，再拆评分与 repository。

当前不应直接开始：

1. 新增更多 provider。
2. 优化 UI 展示细节。
3. 继续往 `LeadCompany` 添加更多临时字段。
4. 为 synthetic contact 增加更多伪真实行为。

## 12. Final Decision Summary

这套系统的下一阶段，不是继续“把搜索做得更猛”，而是先把公司实体、证据层、验证层和模块边界定住。

明确结论如下：

1. 当前 `server.js` lead 逻辑是必须拆的单体原型，不是长期架构。
2. 当前 `LeadCompany` 是 UI 模型，不是 canonical domain model。
3. Tavily、Brave、Google Maps 是 provider，不是业务规则来源。
4. entity resolution、verification policy、address scoring、public-contact rules 必须由本项目自己拥有。
5. 后续实施顺序必须是 `schema -> adapter -> entity resolution + verification -> discovery refactor -> address path -> osint path -> repository upgrade`。

偏离这个顺序，后续只会重复返工。
