# 外贸获客系统 - 分阶段实施计划

## 📊 测试结果总结（2026-06-03）

### ✅ 现有功能验证
- ✅ 项目构建: 成功
- ✅ 后端服务 (3010端口): 运行正常
- ✅ 前端服务 (5173端口): 可访问
- ✅ Google Maps 搜索 API: 正常响应
- ✅ 公司验证功能: 正常工作
- ✅ API 密钥配置: 已正确加载

**测试示例结果**:
```
搜索: "solar installer" + "Berlin"
返回: 3个结果
示例公司: SolarX GmbH
评分: 4.9/5.0
网站: http://www.solarxgmbh.de/
```

---

## 🎯 三大工作流实施计划

### **阶段一：完善工作流一 - 国家+行业搜索** （优先级：⭐⭐⭐⭐⭐）

#### 目标
增强现有 Google Maps 搜索功能，自动提取网站联系人信息

#### 技术栈
- **已有**: Google Maps API, Tavily, Brave
- **新增**: cheerio (HTML解析), axios, email-regex

#### 实施步骤

**1.1 安装依赖** (0.5天)
```bash
npm install cheerio email-regex phone-regex
```

**1.2 创建联系人提取模块** (2天)
```
文件: server/modules/leads/providers/contact-extractor.js

功能:
- extractEmails(html): 邮箱提取
- extractPhones(html): 电话提取
- extractLinkedInProfiles(html): LinkedIn 链接
- findContactPage(html, baseUrl): 定位联系页面
- extractContactInfo(websiteUrl): 完整联系信息提取
```

**1.3 扩展现有服务** (1天)
```
修改文件: server/modules/leads/application/services/google-maps-search-service.js

增强功能:
- 可选参数: extractContacts (boolean)
- 集成 contact-extractor
- 并发提取联系人（控制速率）
```

**1.4 前端UI增强** (1天)
```
修改文件: src/pages/GoogleMapsSearch.tsx

新增UI:
- "自动提取联系人" 开关
- 联系人信息显示卡片
- 导出CSV包含联系人
```

**1.5 测试与优化** (0.5天)
- 单元测试：contact-extractor
- 集成测试：完整搜索流程
- 性能优化：并发控制、超时处理

#### 交付物
- ✅ 网站联系人自动提取功能
- ✅ 前端展示联系人信息
- ✅ CSV导出包含联系人数据
- ✅ 测试覆盖率 > 80%

#### 预计工作量: **5天**

---

### **阶段二：实现工作流三 - 批量地址验证** （优先级：⭐⭐⭐⭐）

#### 目标
集成 libpostal 实现地址解析和商业/住宅分类

#### 技术栈
- **核心**: libpostal (C库) + node-postal (Node.js绑定)
- **辅助**: Google Maps API, 现有批量验证服务

#### 实施步骤

**2.1 libpostal 环境准备** (1天)
```bash
# 选项A: Docker 快速验证（推荐先做）
docker pull senzing/libpostal
docker run -it senzing/libpostal

# 选项B: 本地安装（生产环境）
# Windows: 使用 WSL2 或 mingw-w64
# Linux/macOS: 直接编译
git clone https://github.com/openvenues/libpostal
cd libpostal
./bootstrap.sh
./configure --datadir=/path/to/data
make -j4
sudo make install
```

**2.2 安装 Node.js 绑定** (0.5天)
```bash
npm install node-postal
# 验证安装
node -e "const postal = require('node-postal'); console.log(postal.parser.parse_address('123 Main St, NYC'));"
```

**2.3 创建 libpostal 适配器** (1天)
```
文件: server/modules/leads/providers/libpostal-adapter.js

功能:
- parseAddress(addressString): 解析为组件
- normalizeAddress(addressString): 标准化
- hasRequiredComponents(parsed): 完整性检查
- buildQueryFromComponents(components): 构建Google查询
```

**2.4 创建地址分类服务** (2天)
```
文件: server/modules/leads/application/services/address-classification-service.js

功能:
- classifyAddress(rawAddress): 主分类逻辑
  1. libpostal 解析
  2. Google Maps 验证
  3. 根据 place.types 判断类型
- classifyByPlaceTypes(types): 类型判断逻辑
  - COMMERCIAL: 商业地址
  - RESIDENTIAL: 住宅地址
  - MIXED_USE: 混合用途
  - INVALID: 无法解析
  - NOT_FOUND: 未找到
```

**2.5 创建批量分类 API** (1天)
```
新增路由: POST /api/addresses/batch-classify

输入格式:
{
  "addresses": [
    {"name": "Company A", "address": "123 Main St, Berlin"},
    {"name": "Company B", "address": "456 Oak Ave, Munich"}
  ]
}

输出格式:
{
  "results": [
    {
      "inputName": "Company A",
      "inputAddress": "123 Main St, Berlin",
      "classification": "COMMERCIAL",
      "confidence": 0.9,
      "placeDetails": { ... }
    }
  ]
}
```

**2.6 前端批量上传界面** (2天)
```
新建文件: src/pages/AddressClassifier.tsx

功能:
- Excel/CSV 上传（拖拽 + 选择）
- 地址列映射选择
- 批量分类进度显示
- 结果展示（带过滤）
- 导出分类结果
```

**2.7 测试与文档** (1天)
- 测试多国地址解析
- 分类准确率验证
- 使用文档编写

#### 交付物
- ✅ libpostal 集成完成
- ✅ 地址解析和分类服务
- ✅ 批量上传和分类界面
- ✅ 支持导出分类结果
- ✅ 准确率 > 85%

#### 预计工作量: **8.5天**

---

### **阶段三：开发工作流二 - AI相似公司查找** （优先级：⭐⭐⭐）

#### 目标
使用向量嵌入实现相似公司智能推荐

#### 技术栈
- **嵌入模型**: OpenAI Embeddings API 或 @xenova/transformers (本地)
- **相似度计算**: 余弦相似度
- **可选**: ChromaDB (大数据集)

#### 实施步骤

**3.1 选择嵌入方案** (0.5天)
```bash
# 方案A: OpenAI (推荐，效果最好)
npm install openai

# 方案B: 本地模型 (免费，稍慢)
npm install @xenova/transformers
```

**3.2 创建嵌入服务** (2天)
```
文件: server/modules/leads/application/services/embedding-service.js

功能:
- generateCompanyEmbedding(companyProfile): 生成向量
- batchGenerateEmbeddings(companies): 批量生成
- cosineSimilarity(vecA, vecB): 相似度计算
```

**3.3 公司特征提取** (1天)
```
文件: server/modules/leads/application/services/company-profile-extractor.js

功能:
- extractFromWebsite(url): 从网站提取特征
- extractFromInput(userInput): 从用户输入提取
- buildProfileText(features): 构建特征文本
  - 行业关键词
  - 产品/服务描述
  - 目标市场
  - 公司规模
```

**3.4 相似度搜索服务** (2天)
```
文件: server/modules/leads/application/services/similarity-search-service.js

功能:
- findSimilarCompanies(inputCompany, topN): 查找相似公司
- indexCompanies(companyList): 建立索引
- updateIndex(newCompany): 增量更新
```

**3.5 创建 API 端点** (1天)
```
POST /api/companies/find-similar

输入:
{
  "companyName": "Tesla",
  "website": "https://tesla.com",
  "industry": "Electric Vehicles",
  "topN": 10
}

输出:
{
  "results": [
    {
      "company": { ... },
      "similarity": 0.87,
      "matchedFeatures": ["industry", "products", "market"]
    }
  ]
}
```

**3.6 前端界面** (2天)
```
新建文件: src/pages/SimilarCompanyFinder.tsx

功能:
- 输入参考公司（名称/网址）
- 自动提取公司特征
- 调整搜索参数（行业、地区）
- 展示相似公司列表（相似度评分）
- 一键验证规模（调用Tavily/Brave）
```

**3.7 优化与缓存** (1天)
- 嵌入向量缓存（Redis/内存）
- 相似度计算优化
- 索引持久化

#### 交付物
- ✅ 公司向量嵌入生成
- ✅ 相似度搜索引擎
- ✅ 相似公司查找界面
- ✅ 自动规模验证集成
- ✅ 响应时间 < 3秒

#### 预计工作量: **9.5天**

---

## 📅 总体时间表

| 阶段 | 功能 | 工作量 | 优先级 | 依赖 |
|------|------|--------|--------|------|
| **阶段一** | 网站联系人提取 | 5天 | ⭐⭐⭐⭐⭐ | 无 |
| **阶段二** | 地址分类验证 | 8.5天 | ⭐⭐⭐⭐ | 无 |
| **阶段三** | 相似公司查找 | 9.5天 | ⭐⭐⭐ | 阶段一完成（数据积累）|

**总计**: 23天 (约5周)

---

## 🏗️ 技术架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React)                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ Maps Search  │ │ Address      │ │ Similar Co.  │        │
│  │              │ │ Classifier   │ │ Finder       │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP/JSON
┌───────────────────────────┴─────────────────────────────────┐
│                   后端 API (Express)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Application Services                     │  │
│  │  • google-maps-search-service                        │  │
│  │  • contact-extractor                                 │  │
│  │  • address-classification-service                    │  │
│  │  • similarity-search-service                         │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Provider Adapters                        │  │
│  │  • google-maps-adapter (已有)                        │  │
│  │  • tavily-adapter (已有)                             │  │
│  │  • brave-adapter (已有)                              │  │
│  │  • libpostal-adapter (新增)                          │  │
│  │  • embedding-service (新增)                          │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────┐
│                    外部服务                                  │
│  • Google Maps Places API (New)                             │
│  • Tavily Search API                                        │
│  • Brave Search API                                         │
│  • libpostal (本地C库)                                      │
│  • OpenAI Embeddings API / 本地模型                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 依赖包清单

### 已安装
```json
{
  "express": "^4.x",
  "cors": "^2.x",
  "multer": "^1.x",
  "axios": "^1.x"
}
```

### 需要新增

#### 阶段一依赖
```bash
npm install cheerio email-regex phone-regex
```

#### 阶段二依赖
```bash
# 需要先安装 libpostal C库
npm install node-postal
```

#### 阶段三依赖
```bash
# 选择一个
npm install openai                    # 方案A
npm install @xenova/transformers      # 方案B
```

---

## 🧪 测试策略

### 单元测试
- 每个新模块必须有单元测试
- 覆盖率目标: > 80%
- 工具: Jest / Vitest

### 集成测试
- API端点测试（Postman/curl）
- 完整工作流测试
- 错误处理测试

### 性能测试
- 批量操作性能（1000条地址）
- 并发请求测试
- API响应时间监控

---

## 🔒 安全考虑

1. **API密钥管理**
   - ✅ 已正确存储在 .env.local
   - ✅ 不在前端暴露
   - ⚠️ 建议添加速率限制

2. **网站爬取**
   - 遵守 robots.txt
   - 添加请求间隔（避免DDoS）
   - 设置合理的超时时间

3. **数据隐私**
   - 用户上传的Excel数据仅临时处理
   - 不永久存储敏感地址信息
   - 遵守GDPR要求

---

## 📊 成功指标

### 功能指标
- [ ] 联系人提取准确率 > 70%
- [ ] 地址分类准确率 > 85%
- [ ] 相似公司推荐相关性 > 80%

### 性能指标
- [ ] API响应时间 < 3秒 (单次)
- [ ] 批量处理速度 > 100条/分钟
- [ ] 系统可用性 > 99%

### 用户体验
- [ ] 前端页面加载 < 2秒
- [ ] 搜索结果展示清晰
- [ ] 错误提示友好

---

## 📝 下一步行动

### 立即开始（本周）
1. ✅ **测试现有功能** - 已完成
2. 🔧 **开始阶段一** - 网站联系人提取
   - 安装依赖
   - 创建 contact-extractor.js
   - 单元测试

### 本月目标
- 完成阶段一和阶段二
- 积累测试数据
- 优化性能

### 下月目标
- 完成阶段三
- 整体系统优化
- 用户文档完善

---

## 🤝 需要决策的问题

1. **嵌入模型选择** (阶段三)
   - 选项A: OpenAI Embeddings (付费，效果最好)
   - 选项B: 本地模型 (免费，需要更多硬件资源)
   - 建议: 先用OpenAI原型验证，后期可切换本地

2. **libpostal 部署方式** (阶段二)
   - 选项A: Docker 容器化
   - 选项B: 直接本地编译
   - 建议: 开发用Docker，生产环境本地编译

3. **向量数据库** (阶段三，可选)
   - 当公司数量 > 10万时考虑
   - 推荐: ChromaDB (开源、易用)

---

**文档版本**: v1.0  
**创建日期**: 2026-06-03  
**最后更新**: 2026-06-03  
**维护者**: AI Assistant + User
