# B2B 外呼线索系统 Canonical Schema 设计文档

## 1. 文档目的

本文档把 [lead-generation-architecture.md](/C:/Users/ADMIN/apply-bot/docs/lead-generation-architecture.md) 已冻结的架构基线，落实为可执行的 schema 设计。它不讨论产品愿景，也不重新定义架构方向，只回答下面几个实现问题：

1. 领域核心对象到底是什么。
2. 每个字段的语义、证据要求、验证层级是什么。
3. provider 原始结果如何归一，哪些字段只能停留在 provider 层。
4. 当前 `LeadCompany` 哪些字段可以继续保留在 UI 层，哪些必须迁入 canonical layer，哪些只能由领域对象派生。

这份文档的用途是让后续开发可以直接开始做三类工作，而不需要重新争论字段语义：

1. 抽 provider adapter。
2. 拆 application service。
3. 重做 `server.js` 中 lead 相关逻辑的实体归并、验证和 DTO 输出。

本文档不是数据库设计稿。这里定义的是 canonical domain schema、provider normalization contract 和 UI DTO 边界，不代表这些对象已经以表、集合或持久化结构存在。

## 2. Schema 设计原则

### 2.1 execution first

本 schema 的目标不是“理论上完整”，而是让开发者可以按对象边界开始拆代码。因此每个对象都必须回答：

1. 这个对象在当前三条业务路径里负责什么。
2. 哪些字段没有就不能创建该对象。
3. 哪些字段允许缺失但不能伪造。
4. 哪些字段绝不能靠猜测、模板或 LLM 补出来。
5. 哪些字段进入“已验证”状态前必须有证据。

### 2.2 canonical 优先，provider 次之，UI 最后

字段优先级固定如下：

1. canonical domain model，定义项目自己的业务语义。
2. provider raw/normalized model，只负责承载外部来源结果，不直接进入 UI 主对象。
3. UI view model，只负责展示、筛选、人工补录、导出体验。

禁止继续让 provider 字段直接决定 UI 主对象结构，也禁止让 `LeadCompany` 反向定义领域模型。

### 2.3 不可猜测字段必须显式声明

以下类型的值，若没有公开证据，必须保留为空、未知或未验证，不能猜：

1. 官方邮箱地址。
2. 公开电话号码。
3. 精确街道地址。
4. 创始年份。
5. 员工规模。
6. 具体联系人姓名、职位、LinkedIn。
7. 公司是否为“官方主体”的最终结论。

### 2.4 synthetic 和 public verified 必须分层

内部生成的联系人占位、开发信草稿、推测性名字、拼接邮箱、猜测电话号码，不能进入 canonical public contact layer。它们只能存在于 UI 或写作辅助层，并且必须与 `PublicContactRecord` 分离。

### 2.5 字段级证据优先于整对象信任

公司对象整体可以有一个验证层级，但真正用于冲突处理和升级验证状态的依据，必须落在字段级 claim 和 evidence 上。不能只因为“这个公司看起来不错”，就默认地址、电话、网站都可信。

## 3. 模型分层

### 3.1 Canonical Domain Model

canonical domain model 是系统内部的标准业务对象，供 application service、entity resolver、verification engine、scoring engine 共享。本文定义的核心对象包括：

1. `CompanyEntity`
2. `AddressRecord`
3. `PublicContactRecord`
4. `EvidenceRecord`
5. `VerificationStatus`
6. `ProviderResult`
7. `AddressAssessmentResult`
8. `LeadWorkspace`
9. `ResearchCase`

### 3.2 Provider Raw / Normalized Model

provider raw model 指 Tavily、Brave、Google Maps、网页抓取等返回的原始内容。normalized model 指 adapter 将这些结果转换后的统一结构。该层必须保留：

1. provider 标识。
2. 查询上下文。
3. 抓取时间。
4. 原始 URL、标题、摘要。
5. provider 特有 metadata。

但该层不能直接输出“这是官方公司”“这是商业地址”“这是可用联系方式”这类最终业务结论。

### 3.3 UI View Model

UI view model 服务于页面展示、人工编辑和工作台交互。当前 `src/types/leads.ts` 中的 `LeadCompany`、`LeadContact`、`LeadDraft`、`LeadWorkspace` 属于这一层。它们可以继续存在，但必须由 canonical layer 映射得到，而不是替代 canonical layer。

## 4. Core Entities

## 4.1 `CompanyEntity`

### 目的

表示系统中被识别、归并和验证的“公司主体”。它是三条业务路径的主锚点：

1. 公司发现路径把候选结果归并为 `CompanyEntity`。
2. 地址判断路径可以把 `AddressAssessmentResult` 挂到某个公司主体，或在暂时无法归属时保持独立。
3. OSINT 尽调路径围绕公司主体挂载证据、地址、公开联系方式和研究结论。

### 必填字段

```json
{
  "entityId": "cmp_01JZ...",
  "canonicalName": "Acme Industrial Components Ltd.",
  "normalizedName": "acme industrial components ltd",
  "verification": {
    "entityStatus": "discovered",
    "officialWebsiteStatus": "unverified",
    "addressStatus": "unverified",
    "publicContactStatus": "unverified"
  },
  "evidenceRefs": ["ev_01JZ..."],
  "sourceRefs": ["prov_01JZ..."]
}
```

必填字段说明：

1. `entityId`，系统内稳定标识，不依赖 provider id。
2. `canonicalName`，当前最可信的主体名称。
3. `normalizedName`，用于归并和去重的标准化名称。
4. `verification`，公司级验证状态容器。
5. `evidenceRefs[]`，至少一条创建该实体的证据引用。
6. `sourceRefs[]`，至少一个来源结果引用。

### 可选字段

1. `legalName`
2. `officialWebsite`
3. `rootDomain`
4. `country`
5. `regions[]`
6. `businessType`
7. `marketRole`
8. `summary`
9. `mainProducts[]`
10. `targetApplications[]`
11. `employeeBand`
12. `foundedYear`
13. `headquartersAddressRef`
14. `addressRefs[]`
15. `publicContactRefs[]`
16. `scores`
17. `tags[]`
18. `notes`

### 绝不能猜测的字段

1. `officialWebsite`
2. `rootDomain`
3. `legalName`
4. `foundedYear`
5. `employeeBand`
6. `headquartersAddressRef`
7. `businessType` 的最终值
8. `marketRole` 的最终值

如果这些字段只有文本暗示，没有可回溯公开证据，则必须保持为空或标记为 `suspected` 状态，不能写成确定值。

### 证据要求

1. 创建 `CompanyEntity` 时，至少需要一条 `EvidenceRecord` 支持“这个主体存在”。
2. `officialWebsite` 进入已验证层前，必须至少有一条网页级或地图级证据支撑，且不能只靠搜索摘要。
3. `businessType`、`marketRole`、`summary` 这类业务语义字段必须能追溯到 evidence claim，不能纯靠 UI 编辑文本覆盖原语义。
4. `foundedYear`、`employeeBand` 若进入 canonical，必须来自公开页面、地图资料、企业目录或其他明确来源证据。

### JSON 示例

```json
{
  "entityId": "cmp_01JZ6M4Q8R8YF2N4A1J8T0QX6G",
  "canonicalName": "Acme Industrial Components Ltd.",
  "normalizedName": "acme industrial components ltd",
  "legalName": "Acme Industrial Components Limited",
  "officialWebsite": "https://www.acmecomponents.com",
  "rootDomain": "acmecomponents.com",
  "country": "CN",
  "regions": ["Guangdong"],
  "businessType": "manufacturer",
  "marketRole": "oem_odm_supplier",
  "summary": "主营工业连接组件与线束组装，面向工业设备和新能源应用。",
  "mainProducts": ["industrial connectors", "cable assemblies"],
  "targetApplications": ["automation equipment", "energy storage systems"],
  "employeeBand": "50_200",
  "foundedYear": 2014,
  "headquartersAddressRef": "addr_01JZ6M8W9P0N6Z1E7M3K4T2Y5A",
  "addressRefs": ["addr_01JZ6M8W9P0N6Z1E7M3K4T2Y5A"],
  "publicContactRefs": ["pct_01JZ6MB1N3K0S6D4R9H2P7Q8W1"],
  "verification": {
    "entityStatus": "verified",
    "officialWebsiteStatus": "verified",
    "addressStatus": "partially_verified",
    "publicContactStatus": "partially_verified",
    "lastVerifiedAt": "2026-06-02T12:00:00.000Z"
  },
  "scores": {
    "companyFitScore": 78,
    "officialWebsiteConfidence": 92,
    "buyerIntentScore": 64,
    "publicContactConfidence": 71
  },
  "evidenceRefs": ["ev_01JZ6MCYH4T3B7L9U5N2A8Q1M6", "ev_01JZ6MFA8D2P4V7K0Q6X1N3R9T"],
  "sourceRefs": ["prov_01JZ6MDX7C5Q9B2W4T8L1K0P3N"],
  "tags": ["lead_discovery", "osint_ready"]
}
```

## 4.2 `AddressRecord`

### 目的

表示一个可独立验证、归一和评分的地址对象。地址不是 `CompanyEntity` 的一个普通字符串字段，而是单独对象，因为当前系统需要支持“批量地址 -> 商业性判断”，并且地址本身存在标准化、地图匹配、主体归属和商业性判定等独立流程。

### 必填字段

```json
{
  "addressId": "addr_01JZ...",
  "rawAddress": "No. 88 Xingye Road, Bao'an District, Shenzhen",
  "verificationStatus": "unverified",
  "evidenceRefs": ["ev_01JZ..."]
}
```

必填字段说明：

1. `addressId`
2. `rawAddress`，原始输入或原始来源文本。
3. `verificationStatus`
4. `evidenceRefs[]`

### 可选字段

1. `normalizedAddress`
2. `country`
3. `region`
4. `city`
5. `district`
6. `postalCode`
7. `geo`，例如 `lat/lng`
8. `addressScope`，例如 `headquarters`、`branch`、`warehouse`、`unknown`
9. `mapsPlaceId`
10. `placeTypes[]`
11. `linkedCompanyEntityId`
12. `businessLikelihoodScore`
13. `businessLikelihoodBand`
14. `assessmentRef`
15. `sourceRefs[]`

### 绝不能猜测的字段

1. `normalizedAddress`
2. `postalCode`
3. `geo`
4. `mapsPlaceId`
5. `linkedCompanyEntityId`
6. `businessLikelihoodScore`

地址标准化结果必须来自解析或 provider 匹配，不能凭人工想当然补全。地址和公司的归属关系也不能因为名字相似就直接写死，必须有证据链或显式弱关联状态。

### 证据要求

1. `rawAddress` 的存在必须指向至少一条 `EvidenceRecord`。
2. `normalizedAddress` 进入 canonical 后，必须能回溯到标准化工具结果或 provider 结构化地址结果。
3. `businessLikelihoodScore` 只能由 `AddressAssessmentResult` 产出，不能手填。
4. `mapsPlaceId`、`placeTypes[]` 若存在，必须带来源 provider 和抓取时间。

### JSON 示例

```json
{
  "addressId": "addr_01JZ6M8W9P0N6Z1E7M3K4T2Y5A",
  "rawAddress": "No. 88 Xingye Road, Bao'an District, Shenzhen",
  "normalizedAddress": "No. 88 Xingye Road, Bao'an District, Shenzhen, Guangdong, China",
  "country": "CN",
  "region": "Guangdong",
  "city": "Shenzhen",
  "district": "Bao'an",
  "geo": {
    "lat": 22.5711,
    "lng": 113.8938
  },
  "addressScope": "headquarters",
  "mapsPlaceId": "ChIJ...",
  "placeTypes": ["establishment", "point_of_interest"],
  "linkedCompanyEntityId": "cmp_01JZ6M4Q8R8YF2N4A1J8T0QX6G",
  "verificationStatus": "partially_verified",
  "businessLikelihoodScore": 83,
  "businessLikelihoodBand": "likely_business",
  "assessmentRef": "aas_01JZ6MGW0F2P5B8L4Q9R1T6Y3N",
  "evidenceRefs": ["ev_01JZ6MFA8D2P4V7K0Q6X1N3R9T"],
  "sourceRefs": ["prov_01JZ6MH91N4C7B2W8K5T0Q3X6D"]
}
```

## 4.3 `PublicContactRecord`

### 目的

表示已经观察到的公开联系信息。这个对象只承载“公开可见且可追溯”的联系渠道，不承载推测联系人，不承载合成邮箱，不承载销售草稿中生成的虚拟联系人。

### 必填字段

```json
{
  "contactId": "pct_01JZ...",
  "contactType": "public_email",
  "value": "sales@acmecomponents.com",
  "ownerScope": "company_level",
  "verificationStatus": "observed",
  "evidenceRefs": ["ev_01JZ..."]
}
```

必填字段说明：

1. `contactId`
2. `contactType`，允许值示例：`public_email`、`public_phone`、`generic_form`、`named_person_public_contact`
3. `value`
4. `ownerScope`，允许值示例：`company_level`、`location_level`、`person_level`
5. `verificationStatus`
6. `evidenceRefs[]`

### 可选字段

1. `label`，例如 `sales`, `general inquiry`
2. `personName`
3. `personTitle`
4. `department`
5. `linkedCompanyEntityId`
6. `linkedAddressId`
7. `sourceType`
8. `confidenceScore`
9. `isPreferred`
10. `observedAt`
11. `lastCheckedAt`
12. `sourceRefs[]`

### 绝不能猜测的字段

1. `value`
2. `personName`
3. `personTitle`
4. `department`
5. `sourceType`

如果邮箱是根据域名规则猜出来的，或者电话是从第三方推断来的，但没有公开证据，那么它不能创建为 `PublicContactRecord`。这类数据只能放在独立的 synthetic / prospecting suggestion 层。

### 证据要求

1. 每个 `value` 必须至少对应一条公开证据。
2. `named_person_public_contact` 必须同时证明姓名和联系渠道都出现在公开来源中，不能只证明其一。
3. `verificationStatus = verified` 时，至少需要两个条件之一：
   1. 联系方式出现在官方站点。
   2. 联系方式出现在地图或可信目录，并且与公司主体有明确关联。
4. 不允许 guessed email、guessed phone 进入 canonical public contact 层。

### JSON 示例

```json
{
  "contactId": "pct_01JZ6MB1N3K0S6D4R9H2P7Q8W1",
  "contactType": "public_email",
  "value": "sales@acmecomponents.com",
  "ownerScope": "company_level",
  "label": "sales",
  "linkedCompanyEntityId": "cmp_01JZ6M4Q8R8YF2N4A1J8T0QX6G",
  "sourceType": "official_website",
  "verificationStatus": "verified",
  "confidenceScore": 88,
  "observedAt": "2026-06-02T12:05:00.000Z",
  "lastCheckedAt": "2026-06-02T12:05:00.000Z",
  "evidenceRefs": ["ev_01JZ6MCYH4T3B7L9U5N2A8Q1M6"],
  "sourceRefs": ["prov_01JZ6MDX7C5Q9B2W4T8L1K0P3N"]
}
```

## 4.4 `EvidenceRecord`

### 目的

表示一次可引用的证据单元。它是字段级 claim、验证升级、冲突处理和审计追溯的基础。没有 `EvidenceRecord`，任何“已验证”都不成立。

### 必填字段

```json
{
  "evidenceId": "ev_01JZ...",
  "provider": "google_maps",
  "sourceType": "place_detail",
  "capturedAt": "2026-06-02T12:00:00.000Z",
  "trustTier": "provider_structured",
  "fieldClaims": [
    {
      "field": "CompanyEntity.canonicalName",
      "value": "Acme Industrial Components Ltd.",
      "claimType": "observed"
    }
  ]
}
```

必填字段说明：

1. `evidenceId`
2. `provider`
3. `sourceType`
4. `capturedAt`
5. `trustTier`
6. `fieldClaims[]`

### 可选字段

1. `sourceUrl`
2. `title`
3. `snippet`
4. `rawReference`
5. `queryLabel`
6. `sourceEntityHint`
7. `providerRecordId`
8. `language`
9. `contentHash`

### 绝不能猜测的字段

1. `sourceUrl`
2. `providerRecordId`
3. `capturedAt`
4. `fieldClaims[].value`
5. `trustTier`

### 证据要求

1. `fieldClaims[]` 必须明确说明证据在支持哪个字段，不接受无目标的大段文本挂载。
2. 同一条证据可以支持多个字段，但每个字段 claim 必须单独列出。
3. `trustTier` 必须由来源类型和提取方式决定，不能人工随意上调。

### `fieldClaims[]` 推荐结构

```json
{
  "field": "PublicContactRecord.value",
  "value": "sales@acmecomponents.com",
  "claimType": "observed",
  "valueType": "email",
  "subjectRef": "pct_01JZ6MB1N3K0S6D4R9H2P7Q8W1",
  "confidence": 0.92,
  "notes": "邮箱出现在官网 Contact 页面正文。"
}
```

### JSON 示例

```json
{
  "evidenceId": "ev_01JZ6MCYH4T3B7L9U5N2A8Q1M6",
  "provider": "web_fetch",
  "sourceType": "official_website_page",
  "sourceUrl": "https://www.acmecomponents.com/contact",
  "capturedAt": "2026-06-02T12:05:00.000Z",
  "title": "Contact Us | Acme Industrial Components",
  "snippet": "Email us at sales@acmecomponents.com or call +86-755-1234-5678.",
  "rawReference": "html_fragment_sha256:...",
  "trustTier": "official_site_content",
  "fieldClaims": [
    {
      "field": "CompanyEntity.officialWebsite",
      "value": "https://www.acmecomponents.com",
      "claimType": "observed",
      "valueType": "url",
      "subjectRef": "cmp_01JZ6M4Q8R8YF2N4A1J8T0QX6G",
      "confidence": 0.95
    },
    {
      "field": "PublicContactRecord.value",
      "value": "sales@acmecomponents.com",
      "claimType": "observed",
      "valueType": "email",
      "subjectRef": "pct_01JZ6MB1N3K0S6D4R9H2P7Q8W1",
      "confidence": 0.92
    }
  ]
}
```

## 4.5 `VerificationStatus`

### 目的

定义统一的验证层。它不是单一布尔值，而是对主体、官网、地址、公开联系信息分别给出状态，使 UI、评分和导出都能知道“这个结论现在站在第几层证据上”。

### 必填字段

```json
{
  "entityStatus": "discovered",
  "officialWebsiteStatus": "unverified",
  "addressStatus": "unverified",
  "publicContactStatus": "unverified"
}
```

### 可选字段

1. `mapsMatchStatus`
2. `researchStatus`
3. `lastVerifiedAt`
4. `resolverVersion`
5. `notes`

### 绝不能猜测的字段

1. 所有 `*Status` 都不能手动猜测升级。
2. `lastVerifiedAt` 不能编造。
3. `resolverVersion` 不能缺省伪造。

### 证据要求

状态升级必须满足最低证据门槛。推荐统一层级如下：

1. `unverified`，尚无足够证据。
2. `discovered`，有至少一条来源证明该对象被发现，但尚未确认官方性或真实性。
3. `suspected`，有多条弱证据，但存在冲突或缺关键佐证。
4. `partially_verified`，关键字段至少部分被结构化证据支持。
5. `verified`，达到当前项目定义的验证门槛。
6. `conflicted`，存在明确冲突，尚未决议。

不同字段的升级要求：

1. `entityStatus = discovered`，至少一条实体存在证据。
2. `officialWebsiteStatus = suspected`，至少一条 provider 或搜索结果指向该站点，且名称高度匹配。
3. `officialWebsiteStatus = verified`，站点内容、地图详情或其他可信证据确认站点与主体直接关联。
4. `addressStatus = verified`，地址标准化完成，并且与公司主体有明确公开关联。
5. `publicContactStatus = verified`，至少一条公开联系方式被官方站点或明确主体关联来源支持。

### JSON 示例

```json
{
  "entityStatus": "verified",
  "officialWebsiteStatus": "verified",
  "mapsMatchStatus": "partially_verified",
  "addressStatus": "partially_verified",
  "publicContactStatus": "verified",
  "researchStatus": "discovered",
  "lastVerifiedAt": "2026-06-02T12:10:00.000Z",
  "resolverVersion": "schema-v1"
}
```

## 4.6 `ProviderResult`

### 目的

定义 provider adapter 的统一输出结构。所有 Tavily、Brave、Google Maps 搜索、Google Maps 详情、网页抓取结果，都必须先进入 `ProviderResult`，再由 entity resolver 和 verification engine 消费。

### 必填字段

```json
{
  "providerResultId": "prov_01JZ...",
  "provider": "brave_search",
  "resultType": "search_result",
  "capturedAt": "2026-06-02T11:59:00.000Z",
  "queryContext": {
    "path": "lead_discovery",
    "queryLabel": "industrial connector manufacturer germany"
  },
  "raw": {},
  "normalized": {
    "title": "Acme Industrial Components",
    "url": "https://www.acmecomponents.com",
    "snippet": "Industrial connector manufacturer..."
  }
}
```

### 可选字段

1. `providerRecordId`
2. `httpStatus`
3. `latencyMs`
4. `normalized.companyHints[]`
5. `normalized.addressHints[]`
6. `normalized.contactHints[]`
7. `normalized.placeTypes[]`
8. `normalized.domain`
9. `normalized.language`
10. `error`

### 绝不能猜测的字段

1. `provider`
2. `resultType`
3. `capturedAt`
4. `raw`
5. `normalized.url`
6. `normalized.placeTypes[]`

### 证据要求

1. `ProviderResult` 不是最终证据，但它必须足够完整，能生成 `EvidenceRecord`。
2. adapter 不能丢掉后续追溯所需的 provider metadata。
3. adapter 可以做语法级标准化，但不能做最终业务判定。

### 归一合同

`normalized` 推荐统一字段族：

1. `title`
2. `url`
3. `domain`
4. `snippet`
5. `companyHints[]`
6. `addressHints[]`
7. `contactHints[]`
8. `placeTypes[]`
9. `geo`
10. `rating`
11. `reviewCount`

同一 provider 不一定全部具备这些字段，但字段语义必须一致。

### JSON 示例

```json
{
  "providerResultId": "prov_01JZ6MDX7C5Q9B2W4T8L1K0P3N",
  "provider": "google_maps",
  "providerRecordId": "ChIJ...",
  "resultType": "place_detail",
  "capturedAt": "2026-06-02T12:01:00.000Z",
  "queryContext": {
    "path": "lead_discovery",
    "queryLabel": "industrial connectors shenzhen",
    "workspaceId": "lw_01JZ6M2A4S7Q9D1N5K8T3P6X0R"
  },
  "raw": {
    "name": "Acme Industrial Components Ltd.",
    "formatted_address": "No. 88 Xingye Road, Bao'an District, Shenzhen"
  },
  "normalized": {
    "title": "Acme Industrial Components Ltd.",
    "url": "https://www.acmecomponents.com",
    "domain": "acmecomponents.com",
    "snippet": "Industrial connector manufacturer in Shenzhen.",
    "companyHints": ["Acme Industrial Components Ltd."],
    "addressHints": [
      {
        "rawAddress": "No. 88 Xingye Road, Bao'an District, Shenzhen"
      }
    ],
    "contactHints": [
      {
        "contactType": "public_phone",
        "value": "+86-755-1234-5678"
      }
    ],
    "placeTypes": ["establishment", "point_of_interest"],
    "geo": {
      "lat": 22.5711,
      "lng": 113.8938
    },
    "rating": 4.4,
    "reviewCount": 17
  }
}
```

## 4.7 `AddressAssessmentResult`

### 目的

承载第二条业务路径的正式输出，即“这个地址更像商业地址、混合地址，还是个人地址”的结构化判断。它不是地址本身，而是地址评估结果对象。

### 必填字段

```json
{
  "assessmentId": "aas_01JZ...",
  "targetAddressRef": "addr_01JZ...",
  "assessmentStatus": "completed",
  "businessLikelihoodScore": 83,
  "classification": "likely_business",
  "evidenceRefs": ["ev_01JZ..."]
}
```

### 可选字段

1. `linkedCompanyEntityId`
2. `scoreBreakdown`
3. `matchedPlaceIds[]`
4. `signals[]`
5. `riskFlags[]`
6. `assessedAt`
7. `modelVersion`

### 绝不能猜测的字段

1. `businessLikelihoodScore`
2. `classification`
3. `matchedPlaceIds[]`
4. `linkedCompanyEntityId`

### 证据要求

1. 评估必须引用 `AddressRecord`。
2. 分数必须来自可解释信号，不允许只有黑盒结论。
3. 若结论是 `likely_business` 或 `likely_residential`，至少要能给出主要支撑信号。
4. “Google Maps 搜到了”不能单独构成商业地址结论。

### 推荐 `scoreBreakdown`

```json
{
  "mapsPresence": 20,
  "officialWebsiteLinkage": 25,
  "placeTypeBusinessFit": 18,
  "publicContactCoherence": 10,
  "addressTextSignal": 10
}
```

### JSON 示例

```json
{
  "assessmentId": "aas_01JZ6MGW0F2P5B8L4Q9R1T6Y3N",
  "targetAddressRef": "addr_01JZ6M8W9P0N6Z1E7M3K4T2Y5A",
  "linkedCompanyEntityId": "cmp_01JZ6M4Q8R8YF2N4A1J8T0QX6G",
  "assessmentStatus": "completed",
  "businessLikelihoodScore": 83,
  "classification": "likely_business",
  "scoreBreakdown": {
    "mapsPresence": 20,
    "officialWebsiteLinkage": 25,
    "placeTypeBusinessFit": 18,
    "publicContactCoherence": 10,
    "addressTextSignal": 10
  },
  "signals": [
    "地图条目存在且名称与公司主体高度一致",
    "官网联系方式页出现相同城市和区域",
    "地点类别更接近商业实体而非纯住宅"
  ],
  "riskFlags": [],
  "assessedAt": "2026-06-02T12:15:00.000Z",
  "modelVersion": "address-assessment-v1",
  "evidenceRefs": ["ev_01JZ6MFA8D2P4V7K0Q6X1N3R9T", "ev_01JZ6MCYH4T3B7L9U5N2A8Q1M6"]
}
```

## 4.8 `LeadWorkspace`

### 目的

表示一次线索发现或工作台操作的工作上下文。它不是 canonical entity 本身，而是一个容器，用来保存查询参数、候选集、人工流程状态和输出视图。

### 必填字段

```json
{
  "workspaceId": "lw_01JZ...",
  "workspaceType": "lead_discovery",
  "createdAt": "2026-06-02T11:50:00.000Z",
  "queryContext": {
    "industry": "industrial connectors",
    "country": "Germany",
    "keywords": ["manufacturer", "OEM"]
  },
  "companyEntityRefs": []
}
```

### 可选字段

1. `status`
2. `providersUsed[]`
3. `searchStrategy`
4. `addressAssessmentRefs[]`
5. `researchCaseRefs[]`
6. `uiSummary`
7. `exportRefs[]`
8. `notes`

### 绝不能猜测的字段

1. `providersUsed[]`
2. `companyEntityRefs[]`
3. `researchCaseRefs[]`
4. `uiSummary`

### 证据要求

1. `LeadWorkspace` 本身不承载验证结论，但它引用的实体、评估和研究结果必须可追溯。
2. 工作区中的公司列表必须来源于 canonical entity refs，而不是匿名 JSON 对象堆积。

### JSON 示例

```json
{
  "workspaceId": "lw_01JZ6M2A4S7Q9D1N5K8T3P6X0R",
  "workspaceType": "lead_discovery",
  "status": "active",
  "createdAt": "2026-06-02T11:50:00.000Z",
  "queryContext": {
    "industry": "industrial connectors",
    "country": "Germany",
    "keywords": ["manufacturer", "OEM"],
    "targetTypes": ["manufacturer"],
    "excludeTypes": ["distributor"]
  },
  "providersUsed": ["tavily", "brave_search", "google_maps"],
  "searchStrategy": {
    "queryTemplates": ["industrial connector manufacturer germany", "OEM cable assembly germany"],
    "queryCount": 2
  },
  "companyEntityRefs": ["cmp_01JZ6M4Q8R8YF2N4A1J8T0QX6G"],
  "addressAssessmentRefs": ["aas_01JZ6MGW0F2P5B8L4Q9R1T6Y3N"],
  "researchCaseRefs": [],
  "uiSummary": {
    "companyCount": 1,
    "verifiedCompanyCount": 1
  }
}
```

## 4.9 `ResearchCase`

### 目的

承载第三条业务路径，即“公司或人物线索 -> 结构化 OSINT 尽调”的任务与结论容器。它必须复用 canonical entity、address、public contact 和 evidence 体系，而不是另起一套 markdown-only 结果。

### 必填字段

```json
{
  "researchCaseId": "rc_01JZ...",
  "caseType": "company_due_diligence",
  "createdAt": "2026-06-02T12:20:00.000Z",
  "status": "open",
  "subjectRefs": ["cmp_01JZ..."],
  "evidenceRefs": []
}
```

### 可选字段

1. `workspaceRef`
2. `researchQuestions[]`
3. `findings[]`
4. `riskFlags[]`
5. `conclusions`
6. `addressRefs[]`
7. `publicContactRefs[]`
8. `assignee`
9. `closedAt`

### 绝不能猜测的字段

1. `subjectRefs[]`
2. `findings[]` 中的事实型结论
3. `riskFlags[]`
4. `conclusions`

### 证据要求

1. `ResearchCase` 中每个结构化 finding 都必须可回溯到至少一条 `EvidenceRecord`。
2. 若 case 涉及 person clue，必须区分“公开观察到的人物线索”与“推测联系人”。
3. case 结论若带风险、红旗、主体关系判断，必须显式引用 evidence refs。

### JSON 示例

```json
{
  "researchCaseId": "rc_01JZ6MKC2N5Q8D1W4T7R0P3X9B",
  "caseType": "company_due_diligence",
  "createdAt": "2026-06-02T12:20:00.000Z",
  "status": "open",
  "workspaceRef": "lw_01JZ6M2A4S7Q9D1N5K8T3P6X0R",
  "subjectRefs": ["cmp_01JZ6M4Q8R8YF2N4A1J8T0QX6G"],
  "researchQuestions": [
    "该主体是否为自有工厂而非贸易商",
    "官网与地图主体是否一致"
  ],
  "findings": [
    {
      "findingType": "market_role",
      "value": "likely_manufacturer",
      "confidence": 0.78,
      "evidenceRefs": ["ev_01JZ6MCYH4T3B7L9U5N2A8Q1M6"]
    }
  ],
  "riskFlags": [],
  "evidenceRefs": ["ev_01JZ6MCYH4T3B7L9U5N2A8Q1M6", "ev_01JZ6MFA8D2P4V7K0Q6X1N3R9T"]
}
```

## 5. Provider 结果归一模型

provider adapter 输出必须分两层：

1. `raw`，完整保留 provider 原始关键结构，供追溯和调试。
2. `normalized`，抽成系统可消费的统一字段族。

### 5.1 provider raw model 要求

1. 保留 provider 标识、原始记录 id、抓取时间。
2. 保留原始 URL、标题、摘要、地图地址、电话、评分、类别等关键字段。
3. 不丢失后续可能需要重新解释的字段。

### 5.2 provider normalized model 要求

归一字段必须遵守下列语义：

1. `companyHints[]` 只表示 provider 暗示的主体名称，不表示 canonical 最终名称。
2. `addressHints[]` 只表示 provider 观察到的地址片段，不表示已标准化地址。
3. `contactHints[]` 只表示 provider 观察到的公开联系方式候选，不表示已验证 public contact。
4. `domain` 是 URL 提取结果，不表示官方域名已经确认。
5. `placeTypes[]` 是 provider 分类标签，不表示地址商业性最终判断。

### 5.3 provider normalization contract

adapter 至少要能统一输出以下对象族中的一部分：

```json
{
  "normalized": {
    "title": "string",
    "url": "string",
    "domain": "string",
    "snippet": "string",
    "companyHints": ["string"],
    "addressHints": [
      {
        "rawAddress": "string"
      }
    ],
    "contactHints": [
      {
        "contactType": "public_email",
        "value": "string"
      }
    ],
    "placeTypes": ["string"],
    "geo": {
      "lat": 0,
      "lng": 0
    }
  }
}
```

## 6. Verification Tier 模型

### 6.1 统一层级

建议全系统统一采用以下验证层：

1. `unverified`
2. `discovered`
3. `suspected`
4. `partially_verified`
5. `verified`
6. `conflicted`

### 6.2 使用规则

1. `discovered` 解决“系统见过这个对象”。
2. `suspected` 解决“有迹象，但关键证据不够”。
3. `partially_verified` 解决“部分关键字段站稳了，但还有缺口”。
4. `verified` 解决“当前项目定义的验证门槛已满足”。
5. `conflicted` 解决“多来源冲突未决，禁止静默覆盖”。

### 6.3 不能跨层偷跑

1. 不能因为 `fitScore` 高就把 `publicContactStatus` 升为 `verified`。
2. 不能因为地图命中就把地址定为商业地址。
3. 不能因为某页面出现域名就自动把 `officialWebsiteStatus` 设为 `verified`。

## 7. Evidence 模型

### 7.1 核心规则

1. 证据对象必须可引用、可追溯、可用于字段级 claim。
2. 证据不是自由文本备注，必须能指出它支持哪个字段。
3. 同一字段允许多条证据并存，用于升级验证或处理冲突。

### 7.2 trust tier 建议

`EvidenceRecord.trustTier` 可采用以下推荐值：

1. `provider_search_snippet`
2. `provider_structured`
3. `official_site_content`
4. `official_site_structured_contact`
5. `third_party_directory`
6. `manual_review_note`

这里的 `manual_review_note` 只能表示人工审阅记录，不等于人工就能无证据确认为真。

## 8. Address Assessment 模型

### 8.1 目标

解决第二条业务路径的核心问题，输出的是“商业性判断结果”，不是仅仅保存一个地址字符串。

### 8.2 最低输入项

地址评估至少应消费：

1. 标准化地址结果。
2. 地图命中情况。
3. place types。
4. 与官网、公司主体、公开联系方式的一致性。
5. 相关文本证据。

### 8.3 最低输出项

1. `businessLikelihoodScore`
2. `classification`
3. `scoreBreakdown`
4. `signals[]`
5. `riskFlags[]`
6. `evidenceRefs[]`

## 9. Public Contact 模型

### 9.1 边界

`PublicContactRecord` 只收公开观察到的联系方式。以下内容不能进入 canonical public contact 层：

1. 猜测邮箱。
2. 猜测电话。
3. LLM 根据公司名称编出的联系人。
4. UI 中的手工 prospecting 备忘。

### 9.2 联系方式类型建议

1. `public_email`
2. `public_phone`
3. `generic_form`
4. `named_person_public_contact`

### 9.3 synthetic contact 的正确位置

若后续仍保留基于画像生成的联系人草稿，它们必须进入独立的 `SyntheticContactSuggestion` 或 UI-only 结构，不能映射成 `PublicContactRecord`。

## 10. Workspace / Research Case 关系模型

### 10.1 `LeadWorkspace` 与 `CompanyEntity`

1. 一个 `LeadWorkspace` 可以引用多个 `CompanyEntity`。
2. 同一个 `CompanyEntity` 可以被多个 `LeadWorkspace` 复用。
3. `LeadWorkspace` 是任务上下文，不是实体拥有者。

### 10.2 `ResearchCase` 与 `LeadWorkspace`

1. `ResearchCase` 可以从某个工作区发起。
2. `ResearchCase` 必须引用已有主体，如公司、地址或公开联系方式。
3. `ResearchCase` 的 findings 继续写回统一 evidence graph，而不是变成孤立文档。

### 10.3 地址路径的独立性

批量地址输入时，`AddressRecord` 和 `AddressAssessmentResult` 可以先独立存在，后续再通过证据挂接到 `CompanyEntity`。这允许系统支持“先评估地址，后做主体归属”。

## 11. Domain Model 与 UI DTO 映射

当前 `src/types/leads.ts` 中 `LeadCompany` 是 UI/view model，不是 canonical domain model。下面明确它的保留项、派生项和迁移项。

### 11.1 `LeadCompany` 可以保留的字段

这些字段可以继续存在于 UI 层，因为它们主要服务展示或人工编辑：

1. `id`
2. `name`
3. `website`
4. `country`
5. `segment`
6. `profile`
7. `signals`
8. `whyFit`
9. `priority`
10. `notes`
11. `outreachNotes`
12. `pipelineStatus`
13. `customEmail`
14. `customContactName`
15. `customContactTitle`
16. `customLinkedinUrl`
17. `customEmailStatus`

这些字段不等于它们都进入 canonical。特别是 `custom*` 字段应继续视为人工补录或外呼作业层。

### 11.2 `LeadCompany` 中应变成派生字段的部分

以下字段可以继续展示，但应由 canonical layer 计算或聚合得出：

1. `fitScore`，应来自 `scores.companyFitScore` 或综合映射。
2. `officialWebsiteLikely`，应来自 `verification.officialWebsiteStatus`。
3. `matchedQueryCount`
4. `matchedProviders`
5. `matchedQueryLabels`
6. `contactEmails`，应从 `PublicContactRecord` 聚合。
7. `contactPages`，应从 evidence 或 normalized provider result 派生。
8. `phone`，应从 `PublicContactRecord` 聚合。
9. `address`，应从首选 `AddressRecord` 派生。
10. `possibleScaleSignal`
11. `scaleSignals`

### 11.3 必须迁入 canonical layer 的语义字段

以下字段不能继续只挂在 `LeadCompany` 上，它们代表实体语义，必须进入 `CompanyEntity` 或相关 canonical 对象：

1. `businessType`
2. `marketRole`
3. `businessSummary`
4. `buyingRelevance`
5. `mainProducts`
6. `targetApplications`
7. `employeeEstimate`，应重构为 `employeeBand`
8. `foundedYear`
9. `headquarters`
10. `source`
11. `sourceUrl`

理由很直接，这些字段会影响实体归并、验证、评分和导出，不能只留在 UI 文本层。

### 11.4 `LeadContact` 的边界提醒

当前 `LeadContact` 混合了真人联系人、推荐联系人和联系渠道。后续应至少拆成：

1. canonical `PublicContactRecord`，只收公开证据可追溯的联系信息。
2. UI/prospecting contact model，保存人工补录或推测联系人。

本阶段不要求修改代码，只要求后续实现时按此边界处理。

## 12. Required Field 规则

### 12.1 创建对象最低门槛

1. `CompanyEntity`，至少要有 `canonicalName` 或等价主体名证据，且必须有 `evidenceRefs`。
2. `AddressRecord`，至少要有 `rawAddress` 和证据。
3. `PublicContactRecord`，至少要有 `contactType`、`value` 和证据。
4. `EvidenceRecord`，至少要有 provider、sourceType、capturedAt、fieldClaims。
5. `AddressAssessmentResult`，至少要有 targetAddressRef、score、classification、evidence。
6. `LeadWorkspace`，至少要有 workspaceType、createdAt、queryContext。
7. `ResearchCase`，至少要有 caseType、subjectRefs、createdAt、status。

### 12.2 关键字段不得空转验证

以下字段没有证据时，不能标记为 `verified`：

1. `CompanyEntity.officialWebsite`
2. `AddressRecord.normalizedAddress`
3. `PublicContactRecord.value`
4. `AddressAssessmentResult.classification`
5. `ResearchCase.findings[]`

## 13. 冲突处理规则

### 13.1 冲突不是覆盖，是记录

当不同来源对同一字段给出不同值时，系统不能静默覆盖。必须记录：

1. 冲突字段。
2. 各候选值。
3. 对应 evidence refs。
4. 当前决议结果。
5. 决议原因。

### 13.2 决议优先级建议

默认优先级建议如下：

1. 官方站结构化或正文直接声明。
2. 地图详情等强结构化 provider 数据。
3. 可信第三方目录。
4. 搜索摘要或搜索标题。
5. UI 手工备注。

### 13.3 冲突状态的使用

1. 若无法裁决，`VerificationStatus` 应进入 `conflicted`，而不是偷偷取一个值。
2. 冲突解除后，也应保留原冲突证据以便审计。

## 14. 版本演进指导

### 14.1 schema 版本控制原则

后续实现应给以下对象保留版本字段或解析版本入口：

1. `VerificationStatus.resolverVersion`
2. `AddressAssessmentResult.modelVersion`
3. provider adapter 的 normalization version

### 14.2 演进方式

1. 新增字段可以做向后兼容扩展。
2. 改字段语义必须先改本文档或后继 schema 文档，再改代码。
3. 禁止在 UI DTO 上先加字段、事后再补 canonical 定义。

### 14.3 近期优先级

基于当前代码现实，后续最先落地的不是数据库，而是：

1. `ProviderResult` adapter 统一输出。
2. `EvidenceRecord` 和 `VerificationStatus` 的最小实现。
3. `CompanyEntity` 与 `LeadCompany` 的映射层。
4. `AddressRecord` 和 `AddressAssessmentResult` 的独立对象化。

## 15. 实施结论

本 schema 文档落实了架构基线中的几个关键约束：

1. `LeadCompany` 继续保留，但只作为 UI/view model。
2. canonical layer 以 `CompanyEntity`、`AddressRecord`、`PublicContactRecord`、`EvidenceRecord`、`VerificationStatus` 为核心。
3. provider 先归一成 `ProviderResult`，再进入实体归并和验证流程。
4. 地址商业性判断必须落到独立的 `AddressAssessmentResult`。
5. synthetic contact 绝不能混入 public verified contact。

后续若实现与本文档冲突，应先修改 schema 文档并解释原因，再修改代码。禁止跳过 schema 约束直接在 `server.js` 或 `LeadCompany` 上追加临时字段。
