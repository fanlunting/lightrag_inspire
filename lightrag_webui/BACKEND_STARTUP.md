# WebUI 启动时后端如何启动

## 结论

**前端启动时不会自动启动后端服务**，需要手动启动后端。

## 详细说明

### 1. 前端启动流程

当运行 `bun run dev` 时：

```bash
cd lightrag_webui
bun run dev
```

实际执行的命令是：
```bash
bunx --bun vite
```

这只会启动 **Vite 开发服务器**（通常运行在 `http://localhost:5173` 或类似端口），不会启动后端。

### 2. 前端如何连接后端

前端通过 **HTTP 代理** 连接到后端：

- **配置文件**: `vite.config.ts`
- **代理目标**: `http://localhost:9621` (默认)
- **环境变量**: 通过 `.env.development` 或 `.env.local` 配置

```typescript
// vite.config.ts
server: {
  proxy: import.meta.env.VITE_API_PROXY === 'true' && import.meta.env.VITE_API_ENDPOINTS ?
    Object.fromEntries(
      import.meta.env.VITE_API_ENDPOINTS.split(',').map(endpoint => [
        endpoint,
        {
          target: import.meta.env.VITE_BACKEND_URL || 'http://localhost:9621',
          changeOrigin: true,
          // ...
        }
      ])
    ) : {}
}
```

### 3. 后端启动方式

后端需要**手动启动**，有以下几种方式：

#### 方式 1: 使用 lightrag-server 命令

```bash
# 在项目根目录或包含 .env 文件的目录
lightrag-server

# 或指定端口
lightrag-server --port 9621
```

#### 方式 2: 使用 uvicorn 直接启动（开发模式，支持热重载）

```bash
# 在项目根目录
uvicorn lightrag.api.lightrag_server:app --reload --host 0.0.0.0 --port 9621
```

#### 方式 3: 使用 gunicorn（生产模式）

```bash
lightrag-gunicorn --workers 4
```

### 4. 完整的开发启动流程

**终端 1 - 启动后端**:
```bash
cd /workspace
# 确保当前目录有 .env 文件
uvicorn lightrag.api.lightrag_server:app --reload --host 0.0.0.0 --port 9621
```

**终端 2 - 启动前端**:
```bash
cd /workspace/lightrag_webui
bun run dev
```

### 5. 环境配置

前端通过环境变量配置后端地址：

**`.env.development`** (开发环境):
```bash
VITE_BACKEND_URL=http://localhost:9621
VITE_API_PROXY=true
VITE_API_ENDPOINTS=/api,/documents,/graphs,/graph,/health,/query,/docs,/redoc,/openapi.json,/login,/auth-status,/static
```

**`.env.local`** (本地覆盖):
```bash
VITE_BACKEND_URL=http://localhost:9621
VITE_API_PROXY=true
VITE_API_ENDPOINTS=/api,/documents,/graphs,/graph,/health,/query,/docs,/redoc,/openapi.json,/login,/auth-status
```

### 6. 验证后端是否运行

检查后端是否在运行：

```bash
# 方法 1: 检查进程
ps aux | grep -E "lightrag-server|uvicorn|gunicorn"

# 方法 2: 检查健康端点
curl http://localhost:9621/health

# 方法 3: 检查 API 文档
curl http://localhost:9621/docs
```

### 7. 常见问题

#### Q: 前端启动后无法连接后端？

**A**: 检查：
1. 后端是否已启动
2. 后端端口是否为 9621
3. `.env.development` 中的 `VITE_BACKEND_URL` 是否正确
4. 防火墙是否阻止了连接

#### Q: 如何同时启动前后端？

**A**: 可以使用以下方法：

**方法 1: 使用 concurrently (需要安装)**
```bash
# 安装 concurrently
npm install -g concurrently

# 在项目根目录创建启动脚本
concurrently \
  "uvicorn lightrag.api.lightrag_server:app --reload --port 9621" \
  "cd lightrag_webui && bun run dev"
```

**方法 2: 使用两个终端窗口**
- 终端 1: 启动后端
- 终端 2: 启动前端

**方法 3: 使用 tmux/screen**
```bash
# 使用 tmux 创建两个窗口
tmux new-session -d -s lightrag 'uvicorn lightrag.api.lightrag_server:app --reload --port 9621'
tmux new-window -t lightrag 'cd lightrag_webui && bun run dev'
tmux attach -t lightrag
```

### 8. 生产环境

在生产环境中：
- 前端会被构建为静态文件，输出到 `lightrag/api/webui/`
- 后端会通过 FastAPI 的 `StaticFiles` 直接提供前端文件
- 只需要启动后端服务即可，前端会自动被提供

```bash
# 构建前端
cd lightrag_webui
bun run build

# 启动后端（会自动提供构建好的前端）
lightrag-server
```

## 总结

- ✅ 前端启动：只启动 Vite 开发服务器
- ❌ 后端启动：不会自动启动，需要手动启动
- 🔗 连接方式：通过 HTTP 代理连接到后端
- 📝 配置方式：通过环境变量配置后端地址
