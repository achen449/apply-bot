# Apply Bot Lead Research 可验收改造计划

日期：2026-08-07
统一回归样本：`Enphase Energy` / `United States` / `https://enphase.com`
环境变量：本轮不修改 `.env.local` 或 Vercel Environment Variables。

## 目标

把当前“能搜索、能保存，但结果难以区分、信息不完整”的获客流程改成可验收的研究流水线：

```text
输入
  → buyer-side 查询
  → 网页结果转真实公司实体
  → 国家/官网/重复过滤
  → Google Maps 验证
  → 官网公开联系方式补全
  → 统一公司记录
  → Research Run 分 part 保存
  → 线上 Research Runs 可筛选、展开、定位
  → CSV/XLSX 导出
```

## 统一数据契约

### Research Run

每次工作流只保存一个主 Run，但每个阶段必须有明确 `part`：

```json
{
  "id": "run_xxx",
  "workflow": "lead-finder|similar-company|osint|google-maps|enrichment",
  "part": "discovery|entity-normalization|map-verification|contact-enrichment|report|export",
  "title": "Lead Finder: US solar storage buyers",
  "status": "completed|partial|needs_review|failed",
  "queryInput": {},
  "searchCalls": [],
  "verificationCalls": [],
  "enrichmentCalls": [],
  "results": [],
  "errors": [],
  "createdAt": "ISO timestamp",
  "expiresAt": "createdAt + 60 days"
}
```

### 统一公司记录

Lead Finder、Similar Company、Maps 和 OSINT 最终都输出同一结构：

```json
{
  "id": "company_xxx",
  "name": "Enphase Energy, Inc.",
  "website": "https://enphase.com",
  "country": "United States",
  "address": "",
  "phone": "",
  "emails": [
    {
      "value": "info@example.com",
      "type": "generic|sales|procurement|personal|unknown",
      "sourceUrl": "https://example.com/contact",
      "observedAt": "ISO timestamp"
    }
  ],
  "map": {
    "verified": false,
    "placeId": "",
    "confidence": 0,
    "sourceUrl": ""
  },
  "score": 0,
  "reason": "",
  "evidence": [],
  "dataQuality": {
    "hasOfficialWebsite": false,
    "hasMapEvidence": false,
    "hasPublicPhone": false,
    "hasPublicEmail": false,
    "needsReview": true
  }
}
```

未知字段保持空值；邮箱和电话必须有公开来源，不能推测。

## 分 part 实施计划

### Part 1：Research Run 可识别保存

完成内容：

- 为 Lead Finder、Similar Company、OSINT、Maps Verify、Contact Enrichment 统一补齐 `workflow`、`part`、`status`。
- Lead Finder/Similar/OSINT 的 prompt、buyer query、工具调用、验证调用、补全调用和错误分别保存。
- 为每条记录增加 `expiresAt`，只清理 `researchRuns` 和研究缓存，不删除 customers/leads。
- 读 Research Runs 时过滤并清理过期记录。
- Gist 写入保留原有客户字段，避免整个文档被覆盖丢失。

本地验收：

- Enphase 连续执行 Lead Finder、Similar、OSINT 后，Research Runs 数量按预期增加。
- 每条记录都能看到 workflow、part、status、createdAt、expiresAt。
- OSINT 不再出现 `workflow: null`。
- 人工注入一条超过 60 天的研究记录后，读取接口不再返回它，customers/leads 保留。

### Part 2：网页结果转真实公司实体

完成内容：

- 过滤 Wikipedia、博客、教程、产品页、厂商目录、Top 10 列表和新闻文章。
- 从网页标题、URL、snippet 中提取公司实体；使用官网域名作为主要去重键。
- 同一公司不同页面合并为一个候选，保留所有 evidence URL。
- 目标国家必须进入实体过滤和最终评分；不能只把国家拼到搜索字符串里。
- provider 返回异常时返回明确错误，不把“请求失败”伪装成 `ok: true` 且 0 条结果。

本地验收：

- Lead Finder 不出现 `Top 10 ...`、`Wikipedia`、博客标题作为公司名。
- 同一个公司只出现一次。
- 美国查询不返回荷兰/澳大利亚分支，除非标记为跨国总部/分支并说明原因。
- Tavily/Brave 失败时 Research Run 显示 provider error，候选不能仅凭模型常识生成。

### Part 3：Google Maps 验证与字段合并

完成内容：

- 对 Lead Finder shortlist 和 Similar Company top 5 逐家公司验证。
- 使用公司名、官网域名、地址进行匹配评分，而不是只取第一个结果。
- 将 Maps 的 `address`、`phone`、`website`、`placeId`、business status、地图来源 URL 合并回统一公司记录。
- `mapVerified=true` 只能来自可信的名称/地址匹配。
- 记录 `verificationCalls` 和每个候选的 confidence。

本地验收：

- Enphase Fremont 总部返回地址、电话、官网、Place ID。
- Lead Finder 返回的公司记录中可以直接看到这些字段，不需要再手动查工具调用 JSON。
- Similar Company 5 家候选至少逐家产生验证结果；失败项明确标记 `needs_review`。
- 批量验证和地址分类接口继续通过。

### Part 4：官网公开联系方式补全

完成内容：

- 新增受控的官网页面抓取阶段：`/contact`、`/contact-us`、`/supplier`、`/vendor`、`/procurement`、`/about` 和 sitemap。
- 只提取页面实际出现的邮箱、电话和联系表单 URL。
- 记录 `sourceUrl`、抓取时间、类型和观察状态。
- 没有邮箱时返回 `no_public_email`，不生成猜测地址。
- 对同一域名缓存结果，避免重复消耗请求和触发超时。

本地验收：

- Google Maps Search 结果可以继续补出官网公开邮箱；如果官网没有公开邮箱，前端显示“未发现公开邮箱”。
- 每个邮箱都能点击来源 URL。
- 不出现模型生成但页面不存在的邮箱。
- 超时只影响联系方式 part，不丢失已完成的 Maps/公司结果。

### Part 5：OSINT 路由统一

完成内容：

- `/api/osint` 和 `/api/lead-workspaces/osint-research` 统一调用同一个真实 OSINT service。
- 移除当前占位返回，保留旧客户端路径兼容。
- OSINT 报告展示主体、业务、产品/应用、风险、公开联系方式、未解决问题和 evidence。
- OSINT 运行写入 Research Run，并标明 `workflow=osint`、`part=report`。

本地验收：

- Monitor 页面调用 `/api/lead-workspaces/osint-research` 后不再只返回空的 `needs_review`。
- Enphase 的地址和电话可在报告中看到，产品/采购信息没有证据时保持未知。
- 运行记录可在 Research Runs 页面按 OSINT 筛选并展开。

### Part 6：Lead Workspace 保存与导出

完成内容：

- Lead Finder 生成 workspace 后调用 Gist-backed workspace repository 保存。
- 返回稳定 `workspaceId`。
- CSV/XLSX 导出读取同一份 workspace，包含公司、官网、国家、地址、电话、邮箱、地图验证和 evidence 来源。
- 导出失败返回可恢复的错误信息。

本地验收：

- 新生成的 Enphase 测试 workspace 可通过 `/api/lead-workspaces/:id/export.csv` 和 `.xlsx` 下载。
- 下载内容包含已补全字段和来源列。
- Gist 中保留 workspace 和 Research Run 两类记录。

### Part 7：线上 Research Runs 页面

完成内容：

- `/logs` 页面明确显示 workflow、part、状态、国家、公司数量、搜索/验证/补全次数和过期时间。
- 支持按 workflow、status、关键词和日期筛选。
- 每个 Run 可展开查看：输入、buyer queries、工具调用、候选公司、地图验证、邮箱来源、错误和导出入口。
- 显示“部分完成”的原因和下一步动作，不把失败显示为空白。
- 空状态、加载状态、超时和重试均有明确反馈。

UI 验收：

- 375px、768px、1024px、1440px 宽度下无横向溢出。
- 展开按钮有键盘 focus、aria-label 和明显的 pressed/hover 状态。
- 状态不只依赖颜色，同时显示文字和图标。
- 长 prompt/query 自动换行，不破坏卡片布局。
- 遵循现有 Lucide 图标、轻量 Flat SaaS 风格和 4.5:1 文本对比度。

### Part 8：测试与发布门禁

本地自动化测试：

- 统一记录 schema、TTL 清理和 workflow/part 标记。
- Lead Finder 实体过滤、国家过滤、去重、地图字段合并。
- Similar Company 逐家公司验证和统一结果字段。
- 官网邮箱提取、来源 URL、无公开邮箱状态和不猜测约束。
- OSINT 两个路由返回同一结构。
- Gist 读写、并发/失败保护和 workspace 导出。
- Research Runs API 的过滤、分页、空状态和错误状态。
- `npm run test:leads`
- 全部 `node --test test/*.js`
- `npm run build`
- `npm run lint`：记录既有错误与本轮新增错误，不能新增错误。

固定本地烟测：

1. `Enphase Energy` + `United States` → Maps Search/Verify。
2. Enphase → Similar Company top 5。
3. `industrial connectors` + `United States` + `mc4,battery connector,wire harness,high current` → economy/standard Lead Finder。
4. Enphase → OSINT 两个入口。
5. Research Runs 读取、筛选、展开、过期清理。
6. workspace CSV/XLSX 导出。

只有以下条件全部满足才允许推送：

- 本地测试和 build 通过；
- 环境变量没有被修改；
- 每个工作流都能生成可定位的 Research Run；
- 公司记录直接包含可开发字段或明确标记缺失；
- 没有文章型候选混入公司列表；
- Gist 和导出回归通过；
- 线上页面可以按 workflow/part 找到刚刚生成的记录。

## 实施顺序

1. 先完成 Part 1、2、3，建立统一记录和实体/地图合并基础。
2. 再完成 Part 4、5，补联系方式并修复 OSINT 入口。
3. 完成 Part 6，确保保存后的 workspace 可导出。
4. 完成 Part 7，把所有 part 在线上可见化。
5. 完成 Part 8，使用 Enphase 做完整回归。
6. 通过门禁后执行 `git pull --rebase`、`bd sync`（若仓库已配置 beads）、`git push`，再做线上 smoke test。

## 明确不做

- 不修改任何用户环境变量。
- 不把真实 API key 写入代码、日志、Gist 或计划书。
- 不猜测邮箱、私人电话或采购联系人。
- 不删除客户主数据；60 天只适用于研究运行和缓存。

## 执行记录（2026-08-07）

已完成并在本地落地：

- Research Run 统一补齐 workflow、part、status、parts、expiresAt；旧记录读取时会标记为 `legacy / needs_review`，不再出现空 workflow 或空 parts。
- Lead Finder、Similar Company、OSINT 两个入口、Maps、官网联系方式、workspace 和 CSV/XLSX 导出均使用可追踪的研究记录结构。
- Similar Company 在 AI 最终响应超时或初始请求失败时保留 provider evidence；如果候选无法匹配成功的搜索/地图证据，则只返回 `needs_review`，不把 AI-only 候选当成真实公司。
- 官网联系方式抓取已过滤脚本、元数据、资源路径和跨域跳转；邮箱/电话保留来源页，无公开邮箱返回明确状态，并按域名做本地缓存。
- OSINT fallback 对 Maps、Brave、Tavily 和官网联系方式逐项容错；电话、邮箱进入统一 subject 和 evidence refs；两个 OSINT 入口均返回 runId。

质量门禁结果：

- `node --test test/*.js`：39/39 通过。
- `npm run build`：通过；仅有既有 Vite chunk size warning。
- `npm run lint`：通过。
- 环境变量文件未修改；tracked files 未发现长格式 API token 模式。
- Lead Finder 真实本地 smoke：200，约 77 秒，workspace 与 Research Run 均保存，CSV/XLSX 均可下载。
- Similar Company 真实本地 smoke：provider 无有效结果时返回 200 + `needs_review`，Research Run 保存 discovery/map/contact/report parts。
- OSINT 两个真实入口：均返回 200，均生成 runId、4 个 parts、60 天 expiresAt；官网回归得到 Enphase 电话和公开邮箱来源。
- Research Runs 筛选和旧记录迁移 smoke：workflow、status、query 筛选均返回可定位记录。

外部环境备注：

- 本机到 `places.googleapis.com` 的真实 TLS 请求受本地代理/网络影响（`127.0.0.1:7897` 连接被重置），因此 Maps live smoke 的 provider 请求无法判定为成功；代码路径、失败状态、Maps 字段合并和 mock/provider contract 测试均通过。
- 当前 `.env.local` 实际加载的 AI 数值为 `AI_TIMEOUT_MS=30000`、`AI_MAX_TOKENS=3000`、`AI_REASONING_EFFORT=max`；本轮按要求未修改环境配置。若生产环境应使用 120000/12000，需要在 Vercel/local env 单独核对后再部署，不能由代码推断或覆盖。
- `vercel.json` 的函数 `maxDuration=300` 未修改；最终线上是否使用 300 秒仍需部署后查看 Vercel Runtime/Plan 的实际生效值。
