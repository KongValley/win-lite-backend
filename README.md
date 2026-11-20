# win-lite-backend

一个**零运行时依赖**的轻量级 Node.js REST 后端。同一份代码无需重新编译，即可运行在 32 位（x86 / `ia32`）和 64 位（x64）Windows 上。

它只使用 Node.js 内置模块，没有原生模块、没有 `node-gyp`、没有第三方运行时依赖，适合作为小型 API、内网工具、Windows 本地服务或后端骨架。

## 已验证环境

| 环境 | Node.js | 测试结果 |
| --- | --- | --- |
| 64 位 Windows 10 (x64) | v24.19.0 / x64 | 25 / 25 通过 |
| 64 位 Windows 10 + WoW64 | v22.21.1 / ia32 | 25 / 25 通过 |

x86 运行时在 64 位 Windows 的 WoW64 层完成了完整测试；代码不含原生模块、指针宽度假设或 64 位专属 API，32 位 Windows 使用同一套官方 `win-x86` 运行时。

## 功能

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
- Windows 启动脚本、环境自检脚本配置（`.env`）
- 基于 `node:test` 的自动化测试，不引入测试框架依赖

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

进入项目目录（无需 `npm install`）：

```bat
cd /d F:\workspace\node-backend
npm start
```

也可以直接运行 Windows 启动脚本：

```bat
scripts\start.cmd
```

如果项目根目录存在 `node.exe`，`start.cmd` 会优先使用它。因此可以把官方 Node.js 运行时解压出的 `node.exe` 放到项目根目录，做成**无需安装 Node.js 的便携目录**：

```text
win-lite-backend\
├─ node.exe          <- 对应架构的官方运行时
├─ src\
├─ scripts\
└─ ...
```

将整个目录复制到 32 位或 64 位 Windows 后，双击 `scripts\start.cmd` 即可运行。

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

运行环境自检：

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

3. 将 x86 运行时加入当前命令窗口的 `PATH`，然后启动：

   ```bat
   cd /d F:\workspace\node-backend
   set "PATH=C:\node-v22.21.1-win-x86;%PATH%"
   scripts\start.cmd
   ```

   或者直接用绝对路径启动：

   ```bat
   C:\node-v22.21.1-win-x86\node.exe src\index.js
   ```

4. 验证架构：

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

## 注册为 Windows 服务

可以使用 [NSSM](https://nssm.cc/) 将 Node.js 进程注册为服务，32 位系统请使用 x86 `node.exe`：

```bat
cd /d F:\workspace\node-backend
mkdir logs

nssm install win-lite-backend "C:\node-v22.21.1-win-x86\node.exe" "F:\workspace\node-backend\src\index.js"
nssm set win-lite-backend AppDirectory "F:\workspace\node-backend"
nssm set win-lite-backend AppStdout "F:\workspace\node-backend\logs\stdout.log"
nssm set win-lite-backend AppStderr "F:\workspace\node-backend\logs\stderr.log"
nssm set win-lite-backend Start SERVICE_AUTO_START
nssm start win-lite-backend
```

服务账户需要对数据目录有读写权限。若需要局域网访问，还要在 Windows 防火墙中放行对应 TCP 端口。

## 项目结构

```text
.
├─ src/
│  ├─ index.js              # 进程入口、.env、信号处理
│  ├─ config.js             # 环境配置校验
│  ├─ app.js                # 中间件管线、错误处理、请求日志
│  ├─ server.js             # HTTP 服务、监听、优雅关机
│  ├─ http/                 # 路由、JSON 请求体、响应工具
│  ├─ middleware/           # CORS、API Key、限流
│  ├─ routes/               # 健康检查、系统信息、任务 API
│  ├─ store/task-store.js   # 原子 JSON 持久化
│  └─ lib/                  # 日志、错误、校验、运行时检查等
├─ scripts/
│  ├─ start.cmd             # Windows 一键启动
│  └─ doctor.js             # 环境与 32/64 位检查
├─ test/                    # node:test 测试
├─ test-support/            # 测试辅助代码
├─ data/                    # 默认数据目录
├─ .env.example
└─ package.json             # 无 dependencies
```

## 开发与测试

```bat
npm test
npm run doctor
```

在 32 位运行时上运行完整测试：

```bat
C:\node-v22.21.1-win-x86\node.exe --test
```

测试会使用系统临时目录，不污染 `data/tasks.json`。开发模式可使用：

```bat
npm run dev
```

`npm run dev` 需要 Node.js 18.11+ 的 `--watch` 支持。

## 常见问题

### `node` 不是内部或外部命令

Node.js 未安装或未加入 `PATH`。32 位系统请安装 x86 ZIP 运行时，并用绝对路径或临时修改 `PATH`。

### Node.js 24 没有 Windows 32 位版本

这是 Node.js 上游的发布策略，不是本项目的问题。32 位 Windows 请使用 Node.js 22 LTS x86；当前项目的代码兼容 Node.js 18.2+。

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
