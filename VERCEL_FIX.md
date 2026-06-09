# Vercel Deployment Fix

## 问题诊断

### 症状
- ✅ 前端页面可以访问 (https://apply-bot-wine.vercel.app)
- ❌ 所有API路由返回404错误
- ❌ `/api/google-maps-search` 等端点无法工作

### 根本原因
这是**Vercel部署Express应用的典型问题**：

1. **`vercel.json` 配置不完整**
   - 缺少 `version: 2` 声明
   - 缺少 `functions` 配置（内存、超时）
   - Rewrite规则使用了过时的正则语法 `(.*)`

2. **`api/server.js` 包装器不正确**
   - 没有处理CORS preflight (OPTIONS请求)
   - 没有设置CORS headers
   - 不是async函数，可能导致请求超时

## 修复内容

### 1. 更新 `vercel.json`

```json
{
  "version": 2,                    // ← 必须添加
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "functions": {                   // ← 新增：函数配置
    "api/**/*.js": {
      "memory": 1024,
      "maxDuration": 10
    }
  },
  "rewrites": [
    {
      "source": "/api/:path*",     // ← 修正：使用:path*而不是(.*)
      "destination": "/api/server"
    },
    {
      "source": "/:path*",         // ← 修正
      "destination": "/index.html"
    }
  ]
}
```

### 2. 重写 `api/server.js`

```javascript
import app from '../server.js'

export default async function handler(req, res) {
  // 设置CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  )

  // 处理OPTIONS preflight请求
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  // 传递请求到Express app
  return app(req, res)
}
```

## 关键改进

### ✅ 添加CORS支持
- 所有API响应都包含CORS headers
- 正确处理OPTIONS preflight请求
- 允许跨域访问

### ✅ Serverless函数配置
- 内存: 1024MB (Express应用需要足够内存)
- 超时: 10秒 (足够处理外部API调用)

### ✅ 正确的Rewrite语法
- 使用 `:path*` 而不是 `(.*)`
- Vercel推荐的动态路由语法

## 验证步骤

修复后，推送到GitHub会触发Vercel自动重新部署。部署完成后测试：

```bash
# 1. 测试Google Maps搜索API
curl https://apply-bot-wine.vercel.app/api/google-maps/search \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "restaurants", "location": "New York"}'

# 2. 测试Lead工作区列表
curl https://apply-bot-wine.vercel.app/api/lead-workspaces

# 3. 测试Provider可用性检查
curl https://apply-bot-wine.vercel.app/api/provider-availability
```

预期结果：
- ✅ 返回JSON响应（不是HTML 404页面）
- ✅ 包含CORS headers
- ✅ Vercel Functions日志显示函数执行

## 参考资料

- [Vercel Express.js部署指南](https://vercel.com/guides/using-express-with-vercel)
- [Vercel配置文档](https://vercel.com/docs/projects/project-configuration)
- [社区案例：动态API路由404问题](https://community.vercel.com/t/dynamic-api-routes-returning-html-404-pages)

## 故障排除

如果API仍然返回404：

1. **检查Vercel部署日志**
   - 构建是否成功？
   - Functions是否正确创建？

2. **检查环境变量**
   - 所有必需的env vars是否在Vercel中配置？
   - `TAVILY_API_KEY`, `BRAVE_API_KEY`, `GOOGLE_MAPS_API_KEY`

3. **查看Vercel Functions日志**
   - 函数是否被调用？
   - 是否有运行时错误？

4. **测试本地构建**
   ```bash
   npm run build
   vercel dev  # 本地测试serverless环境
   ```
