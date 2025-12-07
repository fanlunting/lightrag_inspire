#!/bin/bash
echo "=== LightRAG 版本检查脚本 ==="
echo ""

echo "1. 检查运行中的服务:"
ps aux | grep -E "lightrag-server|uvicorn|gunicorn" | grep -v grep || echo "  未发现运行中的服务"
echo ""

echo "2. 检查代码中的版本号:"
if [ -f "lightrag/__init__.py" ]; then
    CORE_VERSION=$(grep "__version__" lightrag/__init__.py | head -1 | sed "s/.*= *['\"]\(.*\)['\"].*/\1/")
    echo "  Core version (代码): $CORE_VERSION"
fi

if [ -f "lightrag/api/__init__.py" ]; then
    API_VERSION=$(grep "__api_version__" lightrag/api/__init__.py | head -1 | sed "s/.*= *['\"]\(.*\)['\"].*/\1/")
    echo "  API version (代码): $API_VERSION"
fi
echo ""

echo "3. 检查 Python 缓存:"
PYCACHE_COUNT=$(find . -type d -name "__pycache__" 2>/dev/null | wc -l)
echo "  发现 $PYCACHE_COUNT 个 __pycache__ 目录"
echo ""

echo "4. 检查 WebUI 构建目录:"
if [ -d "lightrag/api/webui" ]; then
    echo "  WebUI 构建目录存在"
    WEBUI_FILES=$(find lightrag/api/webui -type f 2>/dev/null | wc -l)
    echo "  包含 $WEBUI_FILES 个文件"
else
    echo "  WebUI 构建目录不存在（需要运行 bun run build）"
fi
echo ""

echo "5. 尝试检查运行中的服务版本 (如果服务在运行):"
if curl -s http://localhost:9621/health > /dev/null 2>&1; then
    echo "  服务正在运行，获取版本信息:"
    curl -s http://localhost:9621/health | python3 -m json.tool 2>/dev/null | grep -E "core_version|api_version" || echo "  无法解析版本信息"
else
    echo "  服务未运行或无法访问 http://localhost:9621/health"
fi
echo ""

echo "=== 检查完成 ==="
