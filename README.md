# win-lite-backend

一个使用 **TypeScript** 编写的**零运行时依赖**轻量级 Node.js REST 后端。TypeScript 编译成 CommonJS JavaScript 后，同一份编译产物无需按处理器位数重新编译，即可运行在 32 位（x86 / `ia32`）和 64 位（x64）Windows 上。

运行时只使用 Node.js 内置模块，没有原生模块、没有 `node-gyp`、没有第三方 `dependencies`。TypeScript、`tsx` 和 Node 类型声明仅用于开发与构建，适合作为小型 API、内网工具、Windows 本地服务或后端骨架。

## 已验证环境

以下结果使用 TypeScript 编译后的 JavaScript 测试：

| 环境 | Node.js | 测试结果 |
| --- | --- | --- |
| 64 位 Windows 10 (x64) | v24.19.0 / x64 | 25 / 25 通过 |
| 64 位 Windows 10 + WoW64 | v22.21.1 / ia32 | 25 / 25 通过 |

x86 运行时在 64 位 Windows 的 WoW64 层完成了完整测试；编译产物不含原生模块、指针宽度假设或 64 位专属 API，32 位 Windows 使用同一套官方 `win-x86` 运行时。

## 功能

- 严格模式 TypeScript 源码，编译为 CommonJS，兼容 32/64 位 Windows
- 任务 CRUD：创建、查询、筛选、分页、更新、删除
- 健康检查与运行时/系统信息（可清楚看到 `x64` 或 `ia32`）
- 原生 HTTP 路由：路径参数、静态路由优先、HEAD、404/405
- JSON 请求体解析、大小上限、字段校验、统一错误格式
- 请求 ID、结构化 JSON 日志、安全响应头
- CORS（通配符或来源白名单）与预检请求
- 可选 API Key 鉴权（常量时间比较）
- 每 IP 固定窗口限流（内存实现，可按需关闭）
- JSON 文件持久化：串行写入、临时文件 + `fsync` + 原子改名
- 优雅关机：停止接收新连接、等待在途写入、超时强制关闭
- Windows 启动脚本、TypeScript 环境自检脚本、`.env` 配置
- 可选的 PM2 进程管理配置（单实例 fork，适配文件存储）
- 使用 `node:test` + 编译后测试的自动化测试，不引入测试框架

## 兼容性说明

| Windows | Node.js 运行时 | `process.arch` | 支持 |
| --- | --- | --- | --- |
| 64 位 | `win-x64` | `x64` | 支持 |
| 64 位 | `win-x86` | `ia32` | 支持（WoW64） |
| 32 位 | `win-x86` | `ia32` | 支持 |
| 32 位 | `win-x64` | - | 不可行，32 位系统无法运行 64 位运行时 |

代码本身要求 Node.js **>= 18.2.0**。但需要注意 Node.js 官方的 Windows 32 位构建情况：

> 从 Node.js 23 起，官方不再提供 Windows x86 构建；**Node.js 22 LTS 仍提供官方 `win-x86` 包**。因此 32 位 Windows 请使用 Node.js 22 LTS x86。

可运行的最低 Windows 版本取决于所选 Node.js 运行时。推荐 Windows 10 / 11 或 Windows Server 2016 及以上；更旧的 Windows 需要先确认对应 Node.js 版本仍然支持该系统。本项目已在 Windows 10 上验证。

下载入口：

- 官方下载页：<https://nodejs.org/en/download>
- Node.js 22.21.1 x86 ZIP：<https://nodejs.org/dist/v22.21.1/node-v22.21.1-win-x86.zip>

## 快速开始

需要 Node.js >= 18.2 和 npm。首次使用先安装开发依赖并把 TypeScript 编译到 `dist\`：

```bat
cd /d F:\workspace\node-backend
npm install
npm run build
npm start
```

也可以运行 Windows 启动脚本：

```bat
scripts\start.cmd
```

`start.cmd` 会使用编译后的 `dist\index.js`；如果还没有编译，会提示先执行构建。

### 便携目录

编译完成后，目标机器只需要 Node.js 运行时，不需要安装 TypeScript 或任何 `node_modules`。如果项目根目录存在 `node.exe`，`start.cmd` 会优先使用它，因此可以制作免安装 Node.js 的便携目录：

```text
win-lite-backend\
├─ node.exe          <- 对应架构的官方运行时
├─ package.json
├─ dist\             <- 已执行的 npm run build 产物
├─ scripts\start.cmd
├─ data\             <- 首次启动自动创建
└─ .env              <- 可选
```

将整个目录复制到 32 位或 64 位 Windows 后，双击 `scripts\start.cmd` 即可运行。TypeScript 源码和开发依赖不需要随运行时目录分发。

默认监听 `0.0.0.0:3000`。启动后访问：

- 服务首页：<http://127.0.0.1:3000/>
- API 索引：<http://127.0.0.1:3000/api>
- 健康检查：<http://127.0.0.1:3000/api/health>

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

如需自定义配置：

```bat
copy .env.example .env
notepad .env
npm start
```

运行环境自检（会先重新构建）：

```bat
npm run doctor
```

## 在 32 位 Windows 上运行

1. 下载并解压 Node.js 22 LTS **x86** ZIP，例如解压到 `C:\node-v22.21.1-win-x86`。
2. 确认运行时是 32 位：

   ```bat
   C:\node-v22.21.1-win-x86\node.exe -p "process.arch"
   ```

   输出应为 `ia32`。

3. 准备编译产物。TypeScript 只需要在构建时运行，编译出的 CommonJS JavaScript 与处理器位数无关：

   ```bat
   cd /d F:\workspace\node-backend
   npm install
   npm run build
   ```

   也可以在 32 位机器上用 x86 版 npm 构建：

   ```bat
   C:\node-v22.21.1-win-x86\npm.cmd install
   C:\node-v22.21.1-win-x86\npm.cmd run build
   ```

   如果已经有构建好的 `dist\`，目标机器不需要安装 TypeScript 或 `node_modules`。

4. 将 x86 运行时加入当前命令窗口的 `PATH`，然后启动：

   ```bat
   cd /d F:\workspace\node-backend
   set "PATH=C:\node-v22.21.1-win-x86;%PATH%"
   scripts\start.cmd
   ```

   或者直接用绝对路径启动：

   ```bat
   C:\node-v22.21.1-win-x86\node.exe dist\index.js
   ```

5. 验证架构：

   ```powershell
   (Invoke-RestMethod http://127.0.0.1:3000/api/health).runtime
   ```

   `arch` 应为 `ia32`。如果这是 64 位 Windows 上的 32 位进程，`/api/system` 的 `windows.processorArchitectureW6432` 会显示真实的操作系统架构（例如 `AMD64`）。

32 位进程可用地址空间更小。默认 `MAX_BODY_BYTES=1 MiB`、数据文件上限 32 MiB，适合轻量场景；不建议把大文件或大量数据放在 32 位进程里。

## 配置

配置来源优先级：**当前进程环境变量 > 项目根目录 `.env` > 默认值**。`.env` 是简单的 `KEY=VALUE` 格式，支持注释、单/双引号，已有环境变量不会被覆盖。引号内的内容按字面保留，因此 Windows 路径中的反斜杠不会被转义。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址；仅本机使用可改为 `127.0.0.1` |
| `PORT` | `3000` | 监听端口，`0` 表示由系统随机分配 |
| `DATA_FILE` | `data/tasks.json` | 数据文件；相对路径基于项目根目录 |
| `CORS_ORIGIN` | `*` | `*`、逗号分隔的来源白名单，或 `none` 关闭 CORS |
| `API_KEY` | 空（关闭鉴权） | 设置后至少 16 个字符；保护除 `/`、`/api`、`/api/health` 外的接口 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | 限流窗口（毫秒） |
| `RATE_LIMIT_MAX` | `300` | 每 IP 每窗口最大请求数；`0` 关闭限流 |
| `MAX_BODY_BYTES` | `1048576` | JSON 请求体上限，允许 1 KiB 到 10 MiB |
| `TRUST_PROXY` | `false` | 只有前面有可信反向代理时才设为 `true` |
| `LOG_LEVEL` | `info` | `debug`、`info`、`warn`、`error`、`silent` |
| `REQUEST_TIMEOUT_MS` | `30000` | 请求接收超时 |
| `HEADERS_TIMEOUT_MS` | `15000` | 请求头接收超时，自动小于等于请求超时 |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | 优雅关机时等待在途连接的上限 |
| `NODE_ENV` | `development` | 仅作为环境标识出现在 `/api/system` |

Windows `cmd` 临时设置环境变量：

```bat
set PORT=8080
npm start
```

PowerShell：

```powershell
$env:PORT = '8080'
npm start
```

启动时会校验配置。非法端口、过短的 API Key、错误的日志级别等会直接输出明确的配置错误并退出。

## API

### 鉴权

未设置 `API_KEY` 时所有接口公开。

设置后，除 `/`、`/api`、`/api/health` 外的接口都需要以下任意一种请求头：

```http
Authorization: Bearer <API_KEY>
```

```http
X-API-Key: <API_KEY>
```

### 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/` | 服务基本信息 |
| `GET` | `/api` | 端点索引与鉴权状态 |
| `GET` | `/api/health` | 存活检查、运行架构、PID、运行时长 |
| `GET` | `/api/system` | 系统/进程/内存信息（设置 Key 时需鉴权） |
| `GET` | `/api/tasks` | 任务列表 |
| `POST` | `/api/tasks` | 创建任务 |
| `GET` | `/api/tasks/:id` | 获取单个任务 |
| `PATCH` | `/api/tasks/:id` | 部分更新任务 |
| `DELETE` | `/api/tasks/:id` | 删除任务 |

所有 `GET` 路由自动支持 `HEAD`。存在路径但不支持的方法会返回 `405` 和 `Allow` 响应头。

### 列表参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `status` | `all` | `all`、`open`、`completed` |
| `priority` | `all` | `all`、`low`、`medium`、`high` |
| `q` | 空 | 在标题和描述中做不区分大小写的包含搜索，最长 100 字符 |
| `limit` | `20` | 1 到 100 |
| `offset` | `0` | 0 到 1000000 |

任务按创建时间从新到旧返回。

### 任务字段

| 字段 | 规则 |
| --- | --- |
| `title` | 必填（创建时），字符串，去除首尾空白并合并连续空白，1 到 200 字符 |
| `description` | 可选，字符串或 `null`，最长 5000 字符；更新时传 `null` 会清空 |
| `priority` | `low`、`medium`、`high`，默认 `medium` |
| `completed` | 布尔值，默认 `false` |
| `id` | 服务端生成 UUID |
| `createdAt` / `updatedAt` | 服务端生成的 ISO 8601 时间 |

不支持的字段会被拒绝，避免客户端误以为字段已生效。

### 响应格式

成功：

```json
{
  "data": {
    "id": "d6985196-4f04-4611-9444-69663f08a1aa",
    "title": "编写文档",
    "description": "",
    "priority": "high",
    "completed": false,
    "createdAt": "2026-11-19T15:04:30.913Z",
    "updatedAt": "2026-11-19T15:04:30.913Z"
  }
}
```

列表附带分页信息：

```json
{
  "data": [],
  "meta": {
    "total": 0,
    "count": 0,
    "limit": 20,
    "offset": 0,
    "filters": { "status": "all", "priority": "all", "q": "" }
  }
}
```

错误：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "title", "message": "is required" }
    ]
  },
  "requestId": "15f226c7-9607-4908-b27e-9601be88b318"
}
```

每个响应都有 `X-Request-Id` 头，便于把客户端错误与服务端 JSON 日志对应起来。

### PowerShell 示例

```powershell
$base = 'http://127.0.0.1:3000'

Invoke-RestMethod "$base/api/health"

$body = @{
  title       = '编写文档'
  description = '从 README 开始'
  priority    = 'high'
} | ConvertTo-Json

$created = Invoke-RestMethod "$base/api/tasks" `
  -Method Post `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))

$id = $created.data.id
Invoke-RestMethod "$base/api/tasks/$id"

$patch = @{ completed = $true } | ConvertTo-Json
Invoke-RestMethod "$base/api/tasks/$id" `
  -Method Patch `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($patch))

Invoke-RestMethod "$base/api/tasks?status=completed&priority=high&limit=20"

Invoke-RestMethod "$base/api/tasks/$id" -Method Delete
```

使用 API Key：

```powershell
$headers = @{ Authorization = 'Bearer replace-with-your-api-key' }
Invoke-RestMethod "$base/api/tasks" -Headers $headers
```

### 状态码

| 状态码 | 含义 |
| --- | --- |
| `200` | 成功 |
| `201` | 创建成功，`Location` 指向新资源 |
| `204` | 删除成功或 CORS 预检成功 |
| `400` | JSON/字段/查询参数/编码无效 |
| `401` | 缺少或错误的 API Key |
| `404` | 路由或任务不存在 |
| `405` | 方法不支持，响应带 `Allow` |
| `413` | 请求体或 URL 过长 |
| `415` | Content-Type 不支持或使用了压缩请求体 |
| `429` | 触发限流，响应带 `Retry-After` |
| `500` | 未预期的服务端错误（不会泄露堆栈） |

## 数据存储

默认数据文件为 `data/tasks.json`：

```json
{
  "version": 1,
  "tasks": []
}
```

写入流程：

1. 在数据目录创建进程唯一的临时文件；
2. 写入完整 JSON 并 `fsync`；
3. 使用原子改名替换正式文件（Windows 上对短暂文件锁会重试）。

因此进程崩溃时不会留下只写了一半的 JSON。并发写请求在进程内串行化。启动时如果数据文件损坏，服务会拒绝启动而不是静默覆盖。

这是单进程、单文件存储：

- 不要用多个后端进程共享同一个数据文件；
- 不要在高并发、多用户场景把它当数据库使用；
- 备份时直接复制 `tasks.json` 即可；
- 如需横向扩展，请换成数据库并增加迁移层。

## 安全建议

默认配置面向本地开发：

- `HOST=0.0.0.0`、`CORS_ORIGIN=*`、无鉴权；
- 数据是全局的，没有用户/租户隔离。

对外提供服务前至少做以下调整：

1. 设置随机 `API_KEY`（至少 16 字符）；
2. 将 `CORS_ORIGIN` 改为明确的前端来源；
3. 通过 IIS、Nginx、Caddy 等反向代理提供 HTTPS；
4. 仅当代理可信时设置 `TRUST_PROXY=true`，否则客户端可伪造 `X-Forwarded-For`；
5. 只在内网使用时将 `HOST` 改为 `127.0.0.1`；
6. 不要把 API Key 写进浏览器前端代码或公开仓库。

内置限流是单进程内存实现。如果部署多个实例，应在网关层做全局限流。

## 使用 PM2（可选）

项目提供 [PM2 Ecosystem File](https://doc.pm2.io/en/runtime/guide/ecosystem-file/) `ecosystem.config.json`。PM2 不加入 `dependencies`，需要单独安装；PM2 7 要求 Node.js >= 18。

先构建，再启动：

```bat
npm install
npm run build
npm install -g pm2

npm run pm2:start
```

32 位环境应使用 **同一个 x86 Node** 安装和调用 PM2，避免 PM2 启动 64 位运行时：

```bat
cd /d F:\workspace\node-backend
C:\node-v22.21.1-win-x86\npm.cmd install -g pm2

rem 如果已有其他 Node 架构启动的 PM2 守护进程，先停止它
pm2 kill

C:\node-v22.21.1-win-x86\pm2.cmd start ecosystem.config.json
```

Windows 上 PM2 使用固定的本机守护进程。切换 32/64 位运行时前要先 `pm2 kill`，启动后再用 `/api/health` 确认 `runtime.arch` 是 `ia32`。

常用命令：

| 命令 | 作用 |
| --- | --- |
| `npm run pm2:start` | 按 `ecosystem.config.json` 启动 |
| `npm run pm2:status` | 查看状态 |
| `npm run pm2:logs` | 查看实时日志 |
| `npm run pm2:restart` | 重新构建后重启，刷新环境变量 |
| `npm run pm2:stop` | 停止进程 |
| `npm run pm2:delete` | 从 PM2 进程列表移除 |
| `npm run pm2:save` | 保存进程列表，供 `pm2 resurrect` 使用 |

配置要点：

- **只运行 1 个实例**：数据层是单进程 JSON 文件存储，不要改成 PM2 cluster 或多实例。
- 使用 `fork` 模式、进程异常自动重启，并在连续快速失败后停止重试（`max_restarts`）。
- 应用在监听成功后发送 PM2 `ready` 信号，配置使用 `wait_ready`。
- `max_memory_restart` 默认 `256M`；数据量较大时可在 `ecosystem.config.json` 中调整。
- `kill_timeout` 为 12 秒，与应用默认 10 秒优雅关机等待匹配；如果调大 `SHUTDOWN_TIMEOUT_MS`，也要同步调整。
- `NODE_ENV=production` 由 PM2 配置注入；端口、数据文件、API Key 等仍由 `.env` 或系统环境变量控制。

修改代码后重新部署：

```bat
npm run build
npm run pm2:restart
```

PM2 日志位置可用 `pm2 info win-lite-backend` 查看。PM2 本身不提供 Windows 开机服务；如果需要真正的 Windows 服务，可使用下面的 NSSM 方式，或让任务计划程序在开机时以同一账户执行 `pm2 resurrect`。

## 注册为 Windows 服务

先执行 `npm run build` 生成 `dist\`，然后可以使用 [NSSM](https://nssm.cc/) 将编译后的 Node.js 进程注册为服务。32 位系统请使用 x86 `node.exe`：

```bat
cd /d F:\workspace\node-backend
npm run build
mkdir logs

nssm install win-lite-backend "C:\node-v22.21.1-win-x86\node.exe" "F:\workspace\node-backend\dist\index.js"
nssm set win-lite-backend AppDirectory "F:\workspace\node-backend"
nssm set win-lite-backend AppStdout "F:\workspace\node-backend\logs\stdout.log"
nssm set win-lite-backend AppStderr "F:\workspace\node-backend\logs\stderr.log"
nssm set win-lite-backend Start SERVICE_AUTO_START
nssm start win-lite-backend
```

服务账户需要对 `dist\` 有读取权限、对数据目录有读写权限。若需要局域网访问，还要在 Windows 防火墙中放行对应 TCP 端口。

## 项目结构

```text
.
├─ src/
│  ├─ index.ts              # 进程入口、.env、信号处理
│  ├─ config.ts             # 环境配置校验
│  ├─ app.ts                # 中间件管线、错误处理、请求日志
│  ├─ server.ts             # HTTP 服务、监听、优雅关机
│  ├─ domain.ts             # Task/Input 等共享类型
│  ├─ context.ts            # 请求上下文与路由处理器类型
│  ├─ doctor.ts             # 环境与 32/64 位检查
│  ├─ http/                 # 路由、JSON 请求体、响应工具
│  ├─ middleware/           # CORS、API Key、限流
│  ├─ routes/               # 健康检查、系统信息、任务 API
│  ├─ store/task-store.ts   # 原子 JSON 持久化
│  └─ lib/                  # 日志、错误、校验、运行时检查等
├─ dist/                    # npm run build 生成的 CommonJS（git 忽略）
├─ scripts/start.cmd        # Windows 一键启动
├─ test/                    # TypeScript 测试源码
├─ test-support/            # TypeScript 测试辅助代码
├─ data/                    # 默认数据目录
├─ ecosystem.config.json    # PM2 单实例配置
├─ tsconfig.json            # 生产构建配置
├─ tsconfig.test.json       # 测试编译配置
├─ .env.example
├─ package.json             # dependencies 为 0，构建工具在 devDependencies
└─ package-lock.json
```

## 开发与测试

```bat
npm install

npm run typecheck   # 只做 TypeScript 类型检查
npm test            # 清理并编译测试，自动发现 .test-dist/test/**/*.test.js
npm run build       # 编译到 dist
npm start           # 运行 dist/index.js
npm run dev         # tsx watch src/index.ts，改动后自动重启
npm run doctor      # 构建后执行环境检查
```

`dist/` 和 `.test-dist/` 都是生成目录，不提交到 Git。运行时只需要 `dist/`、`package.json`、`scripts/` 和对应架构的 Node.js，不需要 TypeScript 或 `node_modules`。

在 32 位运行时上运行完整测试，建议显式使用 x86 `node.exe`，确保编译器和测试进程都是 32 位：

```bat
C:\node-v22.21.1-win-x86\node.exe .\node_modules\typescript\bin\tsc -p tsconfig.test.json
C:\node-v22.21.1-win-x86\node.exe --test .test-dist\test\all.test.js
```

也可以先把 x86 运行时放到 `PATH` 最前面，再执行 `npm test`：

```bat
set "PATH=C:\node-v22.21.1-win-x86;%PATH%"
npm test
```

测试会使用系统临时目录，不污染 `data/tasks.json`。

## 常见问题

### `node` 不是内部或外部命令

Node.js 未安装或未加入 `PATH`。32 位系统请安装 x86 ZIP 运行时，并用绝对路径或临时修改 `PATH`。

### Node.js 24 没有 Windows 32 位版本

这是 Node.js 上游的发布策略，不是本项目的问题。32 位 Windows 请使用 Node.js 22 LTS x86；当前项目的代码兼容 Node.js 18.2+。

### 启动时提示找不到 `dist\index.js` 或 `MODULE_NOT_FOUND`

项目现在使用 TypeScript，运行前需要先编译：

```bat
npm install
npm run build
npm start
```

目标机器只运行编译产物时不需要 TypeScript。如果使用便携目录，请在复制前完成构建并带上 `dist\`、`package.json`。

### 目标机器需要安装 TypeScript 吗

不需要。TypeScript 只用于开发和构建；编译后的 `dist\` 是普通 CommonJS JavaScript，运行时依赖仍为 0 个。

### 端口被占用（`EADDRINUSE`）

修改 `.env` 中的 `PORT`，或检查占用进程：

```bat
netstat -ano | findstr :3000
```

### curl 发送中文后返回 `INVALID_ENCODING`

服务端只接受 UTF-8 JSON。中文 Windows `cmd` 中的内联中文字符可能被 curl 按本地代码页发送。请把 JSON 保存为 UTF-8 文件后使用：

```bat
curl -X POST http://127.0.0.1:3000/api/tasks ^
  -H "Content-Type: application/json" ^
  --data-binary @task.json
```

PowerShell 示例已显式使用 `UTF8.GetBytes`，可避免这个问题。

### 浏览器请求被 CORS 拦截

设置 `CORS_ORIGIN` 为实际前端来源，例如：

```ini
CORS_ORIGIN=https://app.example.com
```

修改后重启服务。

### 数据文件损坏，服务无法启动

服务不会自动覆盖损坏文件。先备份 `data/tasks.json`，修复 JSON，或替换为：

```json
{
  "version": 1,
  "tasks": []
}
```

## License

[MIT](LICENSE)
