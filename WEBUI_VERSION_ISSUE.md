# WebUI 使用旧版本 LightRAG 的问题排查

## 问题描述
WebUI 使用的 LightRAG 感觉不是修改之后的版本。

## 可能的原因和解决方案

### 1. 后端服务未重启
**问题**: 如果修改了 LightRAG 的 Python 代码，但后端服务还在运行旧代码。

**解决方案**:
```bash
# 检查是否有运行中的服务
ps aux | grep -E "lightrag-server|uvicorn|gunicorn"

# 停止旧服务（如果存在）
pkill -f lightrag-server
pkill -f uvicorn
pkill -f gunicorn

# 重新启动服务
lightrag-server
# 或
uvicorn lightrag.api.lightrag_server:app --reload
```

### 2. Python 包未重新安装
**问题**: 如果是以可编辑模式安装的 (`pip install -e .`)，修改代码后通常会自动生效，但有时需要重新安装。

**解决方案**:
```bash
# 重新安装（可编辑模式）
pip install -e .

# 或者强制重新安装
pip install -e . --force-reinstall --no-deps
```

### 3. Python 缓存文件 (__pycache__)
**问题**: Python 的字节码缓存可能包含旧代码。

**解决方案**:
```bash
# 清除所有 __pycache__ 目录
find . -type d -name "__pycache__" -exec rm -r {} + 2>/dev/null || true
find . -name "*.pyc" -delete
find . -name "*.pyo" -delete
```

### 4. 浏览器缓存
**问题**: 浏览器可能缓存了旧的 WebUI 前端代码。

**解决方案**:
- 硬刷新浏览器: `Ctrl+Shift+R` (Windows/Linux) 或 `Cmd+Shift+R` (Mac)
- 清除浏览器缓存
- 使用无痕模式测试
- 在开发者工具中禁用缓存

### 5. WebUI 构建文件未更新
**问题**: 如果修改了 WebUI 前端代码，需要重新构建。

**解决方案**:
```bash
cd lightrag_webui
bun run build
# 构建后的文件会输出到 ../lightrag/api/webui
```

### 6. 检查当前运行的版本
**验证方法**:
1. 访问 `/health` 端点查看版本信息:
   ```bash
   curl http://localhost:9621/health
   ```
   或访问 WebUI，查看状态对话框中的版本信息。

2. 检查代码中的版本号:
   - Core version: `lightrag/__init__.py` 中的 `__version__`
   - API version: `lightrag/api/__init__.py` 中的 `__api_version__`

3. 在代码中添加日志或打印语句来确认是否使用了新代码。

### 7. 开发模式 vs 生产模式
**问题**: 开发环境和生产环境可能使用不同的代码路径。

**解决方案**:
- 开发模式: 使用 `uvicorn lightrag.api.lightrag_server:app --reload` (自动重载)
- 生产模式: 使用 `lightrag-server` 或 `lightrag-gunicorn` (需要手动重启)

### 8. 虚拟环境问题
**问题**: 可能在不同的虚拟环境中运行，使用了不同版本的代码。

**解决方案**:
```bash
# 确认当前使用的 Python 环境
which python
which pip

# 确认安装的包位置
pip show lightrag

# 如果使用虚拟环境，确保激活正确的环境
source .venv/bin/activate  # 或你的虚拟环境路径
```

## 推荐的完整重启流程

```bash
# 1. 停止所有相关服务
pkill -f lightrag-server
pkill -f uvicorn
pkill -f gunicorn

# 2. 清除 Python 缓存
find . -type d -name "__pycache__" -exec rm -r {} + 2>/dev/null || true
find . -name "*.pyc" -delete

# 3. 重新安装包（如果使用可编辑模式）
pip install -e . --force-reinstall

# 4. 重新构建 WebUI（如果修改了前端）
cd lightrag_webui
bun run build
cd ..

# 5. 重新启动服务
lightrag-server
# 或开发模式
uvicorn lightrag.api.lightrag_server:app --reload --host 0.0.0.0 --port 9621

# 6. 在浏览器中硬刷新 (Ctrl+Shift+R)
```

## 验证修改是否生效

1. **添加临时日志**: 在修改的代码中添加 `print()` 或 `logger.info()` 语句
2. **检查版本号**: 确认 `/health` 端点返回的版本信息
3. **功能测试**: 测试修改后的功能是否按预期工作
4. **查看日志**: 检查服务日志确认代码路径

## 当前版本信息

- Core version: 1.4.9.9 (在 `lightrag/__init__.py` 中)
- API version: 0254 (在 `lightrag/api/__init__.py` 中)

如果修改后版本号没有变化，可以通过添加功能或日志来验证代码是否更新。
