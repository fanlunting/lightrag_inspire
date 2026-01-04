# GraphTagFilter, GraphLabels, GraphSearch 显示逻辑说明

本文档详细说明这三个组件从前端到后端（Neo4j）的完整显示逻辑。

## 1. GraphTagFilter（图标签过滤器）

### 前端显示逻辑

**组件位置**: `lightrag_webui/src/components/graph/GraphTagFilter.tsx`

**主要功能**:
- 提供一个下拉选择器，允许用户选择多个 `graph_tag` 来过滤图谱数据
- 支持搜索功能，可以输入关键词过滤标签列表
- 显示已选择的标签数量

**显示流程**:
1. **初始化**: 当用户打开下拉框时（`open` 状态变为 `true`），触发数据获取
2. **数据获取**: 
   - 调用 `getGraphTags(query, 300)` API
   - 使用防抖（200ms）优化搜索输入
   - 显示加载状态（`loading`）
3. **标签选择**:
   - 用户点击标签进行多选/取消选择
   - 选中的标签会显示勾选标记
   - 支持清除所有选择
4. **显示状态**:
   - 未选择时显示占位符文本
   - 已选择时显示 "已选择 X 个标签"

**关键代码逻辑**:
```typescript
// 打开下拉框时获取标签列表
useEffect(() => {
  if (!open) return
  fetchOptions(debouncedSearchTerm)
}, [open, debouncedSearchTerm, fetchOptions])

// 获取标签选项
const fetchOptions = useCallback(async (query?: string) => {
  setLoading(true)
  try {
    const tags = await getGraphTags(query || '', 300)
    setOptions(Array.from(new Set(tags)))
  } finally {
    setLoading(false)
  }
}, [])
```

### 后端API实现

**API端点**: `GET /graph/tag/list`

**路由位置**: `lightrag/api/routers/graph_routes.py:186`

**实现逻辑**:
1. **获取所有节点**: 调用 `rag.chunk_entity_relation_graph.get_all_nodes()`
2. **提取graph_tag**: 
   - 遍历所有节点，提取每个节点的 `graph_tag` 属性
   - 如果节点没有 `graph_tag`，且 `include_default=True`，则添加 "default"
   - `graph_tag` 可能包含多个标签（用 `GRAPH_FIELD_SEP` 分隔），需要拆分
3. **过滤和排序**:
   - 如果提供了查询参数 `q`，进行大小写不敏感的过滤
   - 对结果进行排序并限制返回数量（`limit`，默认300）

**关键代码**:
```python
@router.get("/graph/tag/list")
async def list_graph_tags(
    q: str = Query("", description="Optional search query"),
    limit: int = Query(300, description="Maximum number of tags to return"),
    include_default: bool = Query(True, description="Include 'default' when graph_tag is missing")
) -> List[str]:
    graph_db_lock = get_graph_db_lock(enable_logging=False)
    async with graph_db_lock:
        nodes = await rag.chunk_entity_relation_graph.get_all_nodes()
    
    tags: set[str] = set()
    for node in nodes:
        raw = node.get("graph_tag")
        if not raw:
            if include_default:
                tags.add("default")
            continue
        
        # 处理多个标签（用分隔符分隔）
        parts: list[str]
        if isinstance(raw, str):
            parts = [p for p in raw.split(GRAPH_FIELD_SEP) if p]
        elif isinstance(raw, list):
            parts = [str(v) for v in raw if str(v)]
        else:
            parts = [str(raw)]
        
        for t in parts:
            t = t.strip()
            if t:
                tags.add(t)
    
    query = (q or "").strip().lower()
    result = sorted(tags)
    if query:
        result = [t for t in result if query in t.lower()]
    return result[:limit]
```

### Neo4j数据库查询

**方法位置**: `lightrag/kg/neo4j_impl.py:1740`

**Cypher查询**:
```cypher
MATCH (n)
RETURN n
```

**说明**:
- 查询所有节点（不区分workspace，因为workspace通过label实现隔离）
- 返回节点的所有属性，包括 `graph_tag`
- 后端代码会从返回的节点属性中提取 `graph_tag` 值

**数据流**:
```
Neo4j数据库 
  → get_all_nodes() 返回所有节点
  → 提取每个节点的 graph_tag 属性
  → 去重、排序、过滤
  → 返回给前端
```

---

## 2. GraphLabels（图标签选择器）

### 前端显示逻辑

**组件位置**: `lightrag_webui/src/components/graph/GraphLabels.tsx`

**主要功能**:
- 提供一个下拉选择器，用于选择要查询的实体标签（entity_id）
- 支持搜索功能，可以输入关键词搜索标签
- 显示刷新按钮，可以手动刷新标签列表
- 维护搜索历史记录

**显示流程**:
1. **初始化**:
   - 组件挂载时，如果没有搜索历史，调用 `getPopularLabels()` 初始化历史记录
   - 使用 `SearchHistoryManager` 管理本地搜索历史
2. **下拉框打开**:
   - 如果查询为空，显示搜索历史记录（最多 `dropdownDisplayLimit` 条）
   - 如果查询不为空，调用 `searchLabels(query, searchLabelsDefaultLimit)` API
   - 如果API失败，回退到本地历史记录搜索
3. **标签选择**:
   - 选择标签后，更新 `queryLabel` 状态
   - 触发图谱数据重新加载（通过 `incrementGraphDataVersion()`）
   - 将选中的标签添加到搜索历史
4. **刷新功能**:
   - 点击刷新按钮时，根据当前标签状态执行不同操作：
     - 如果当前是特定标签：刷新该标签的图谱数据
     - 如果当前是 "*"（全部）：刷新全局数据和热门标签列表
   - 监听pipeline状态变化，当pipeline从busy变为idle时，自动刷新热门标签

**关键代码逻辑**:
```typescript
// 获取下拉选项数据
const fetchData = useCallback(
  async (query?: string): Promise<string[]> => {
    let results: string[] = [];
    if (!query || query.trim() === '' || query.trim() === '*') {
      // 空查询：返回搜索历史
      results = SearchHistoryManager.getHistoryLabels(dropdownDisplayLimit)
    } else {
      // 非空查询：调用后端搜索API
      try {
        const apiResults = await searchLabels(query.trim(), searchLabelsDefaultLimit)
        results = apiResults.length <= dropdownDisplayLimit
          ? apiResults
          : [...apiResults.slice(0, dropdownDisplayLimit), '...']
      } catch (error) {
        // 回退到本地历史搜索
        const history = SearchHistoryManager.getHistory()
        const queryLower = query.toLowerCase().trim()
        results = history
          .filter(item => item.label.toLowerCase().includes(queryLower))
          .map(item => item.label)
          .slice(0, dropdownDisplayLimit)
      }
    }
    // 始终在顶部显示 '*'（查询全部）
    const finalResults = ['*', ...results.filter(label => label !== '*')];
    return finalResults;
  },
  [refreshTrigger]
)
```

### 后端API实现

#### 2.1 获取热门标签

**API端点**: `GET /graph/label/popular?limit={limit}`

**路由位置**: `lightrag/api/routers/graph_routes.py:136`

**实现逻辑**:
- 调用 `rag.chunk_entity_relation_graph.get_popular_labels(limit)`
- 返回按节点度数（degree）排序的热门标签列表

#### 2.2 搜索标签

**API端点**: `GET /graph/label/search?q={query}&limit={limit}`

**路由位置**: `lightrag/api/routers/graph_routes.py:160`

**实现逻辑**:
- 调用 `rag.chunk_entity_relation_graph.search_labels(q, limit)`
- 返回模糊匹配的标签列表，按相关性排序

### Neo4j数据库查询

#### 2.1 get_popular_labels

**方法位置**: `lightrag/kg/neo4j_impl.py:1789`

**Cypher查询**:
```cypher
MATCH (n)
WHERE n.entity_id IS NOT NULL
OPTIONAL MATCH (n)-[r]-()
WITH n.entity_id AS label, count(r) AS degree
ORDER BY degree DESC, label ASC
LIMIT $limit
RETURN label
```

**说明**:
- 查询所有有 `entity_id` 的节点
- 计算每个节点的度数（连接的边数）
- 按度数降序排序，度数相同时按标签名称升序
- 返回前 `limit` 个标签

**数据流**:
```
Neo4j数据库
  → 查询所有节点及其连接的边
  → 计算每个节点的度数
  → 按度数排序
  → 返回热门标签列表
```

#### 2.2 search_labels

**方法位置**: `lightrag/kg/neo4j_impl.py:1831`

**Cypher查询**（优先使用全文索引）:
```cypher
// 对于非中文文本
CALL db.index.fulltext.queryNodes('entity_id_fulltext_idx', $search_query) 
YIELD node, score
WITH node, score
WHERE node
WITH node.entity_id AS label, toLower(node.entity_id) AS label_lower, score
WITH label, label_lower, score,
     CASE
         WHEN label_lower = $query_lower THEN score + 1000
         WHEN label_lower STARTS WITH $query_lower THEN score + 500
         WHEN label_lower CONTAINS ' ' + $query_lower OR label_lower CONTAINS '_' + $query_lower THEN score + 50
         ELSE score
     END AS final_score
RETURN label
ORDER BY final_score DESC, label ASC
LIMIT $limit
```

**说明**:
- 优先使用Neo4j的全文索引（`entity_id_fulltext_idx`）进行搜索
- 如果索引不可用，回退到 `CONTAINS` 查询
- 支持中文文本搜索（使用CJK分析器）
- 评分规则：
  - 完全匹配：+1000分
  - 以查询词开头：+500分
  - 包含查询词（空格或下划线分隔）：+50分
  - 其他：使用索引评分
- 按最终评分降序排序，评分相同时按标签名称升序

**回退查询**（如果全文索引不可用）:
```cypher
MATCH (n)
WHERE n.entity_id IS NOT NULL 
  AND toLower(n.entity_id) CONTAINS $query_lower
RETURN DISTINCT n.entity_id AS label
ORDER BY 
  CASE 
    WHEN toLower(n.entity_id) = $query_lower THEN 1
    WHEN toLower(n.entity_id) STARTS WITH $query_lower THEN 2
    ELSE 3
  END,
  label ASC
LIMIT $limit
```

**数据流**:
```
Neo4j数据库
  → 使用全文索引搜索（如果可用）
  → 计算相关性评分
  → 按评分和名称排序
  → 返回匹配的标签列表
```

---

## 3. GraphSearch（图节点搜索）

### 前端显示逻辑

**组件位置**: `lightrag_webui/src/components/graph/GraphSearch.tsx`

**主要功能**:
- 提供搜索输入框，用于在当前加载的图谱中搜索节点
- **完全在前端实现**，不调用后端API
- 使用 `MiniSearch` 库进行本地全文搜索

**显示流程**:
1. **初始化搜索引擎**:
   - 当图谱数据加载完成后，创建 `MiniSearch` 实例
   - 索引所有节点的 `label` 属性
   - 配置搜索选项：前缀匹配、模糊匹配（fuzzy: 0.2）、标签权重提升（boost: 2）
2. **搜索执行**:
   - 用户输入查询词时，使用防抖（500ms）优化性能
   - 如果查询为空，返回前 `searchResultLimit` 个节点
   - 如果查询不为空：
     - 使用 `MiniSearch` 搜索匹配的节点
     - 如果结果少于5个，进行中间内容匹配（不要求从开头匹配）
     - 限制返回结果数量（`searchResultLimit`）
3. **结果显示**:
   - 显示匹配的节点，包括节点颜色、大小、标签
   - 如果结果超过限制，显示提示信息

**关键代码逻辑**:
```typescript
// 创建搜索引擎
useEffect(() => {
  if (!graph || graph.nodes().length === 0 || searchEngine) {
    return
  }

  const newSearchEngine = new MiniSearch({
    idField: 'id',
    fields: ['label'],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: {
        label: 2
      }
    }
  })

  // 添加节点到搜索引擎
  const documents = graph.nodes()
    .filter(id => graph.hasNode(id))
    .map((id: string) => ({
      id: id,
      label: graph.getNodeAttribute(id, 'label')
    }))

  if (documents.length > 0) {
    newSearchEngine.addAll(documents)
  }

  useGraphStore.getState().setSearchEngine(newSearchEngine)
}, [graph, searchEngine])

// 执行搜索
const loadOptions = useCallback(
  async (query?: string): Promise<OptionItem[]> => {
    if (!graph || !searchEngine) {
      return []
    }

    if (!query) {
      // 无查询：返回一些节点供选择
      const nodeIds = graph.nodes()
        .filter(id => graph.hasNode(id))
        .slice(0, searchResultLimit)
      return nodeIds.map(id => ({
        id,
        type: 'nodes'
      }))
    }

    // 有查询：搜索节点
    let result: OptionItem[] = searchEngine.search(query)
      .filter((r: { id: string }) => graph.hasNode(r.id))
      .map((r: { id: string }) => ({
        id: r.id,
        type: 'nodes'
      }))

    // 如果结果少于5个，进行中间内容匹配
    if (result.length < 5) {
      const matchedIds = new Set(result.map(item => item.id))
      const middleMatchResults = graph.nodes()
        .filter(id => {
          if (matchedIds.has(id)) return false
          if (!graph.hasNode(id)) return false
          const label = graph.getNodeAttribute(id, 'label')
          return label &&
                 typeof label === 'string' &&
                 !label.toLowerCase().startsWith(query.toLowerCase()) &&
                 label.toLowerCase().includes(query.toLowerCase())
        })
        .map(id => ({
          id,
          type: 'nodes' as const
        }))
      result = [...result, ...middleMatchResults]
    }

    return result.length <= searchResultLimit
      ? result
      : [
        ...result.slice(0, searchResultLimit),
        {
          type: 'message',
          id: messageId,
          message: t('graphPanel.search.message', { count: result.length - searchResultLimit })
        }
      ]
  },
  [graph, searchEngine, onFocus, t]
)
```

### 后端API

**无后端API调用** - GraphSearch完全在前端实现，只搜索当前已加载到内存中的图谱数据。

### 数据来源

**数据来源**: 当前加载的 `sigmaGraph`（通过 `useGraphStore` 获取）

**说明**:
- GraphSearch搜索的是已经通过 `/graphs` API加载到前端的图谱数据
- 搜索范围仅限于当前显示的节点，不包括未加载的节点
- 如果用户需要搜索整个数据库的节点，应该使用 `GraphLabels` 组件的搜索功能

**数据流**:
```
用户选择标签（GraphLabels）
  → 调用 /graphs API 加载图谱数据
  → 数据存储到 useGraphStore
  → GraphSearch 在本地索引和搜索这些数据
```

---

## 总结

### 三个组件的区别

1. **GraphTagFilter**:
   - 用途：过滤图谱数据（按 `graph_tag`）
   - 数据来源：Neo4j数据库（所有节点）
   - 搜索范围：全局（所有graph_tag）

2. **GraphLabels**:
   - 用途：选择要查询的实体标签（`entity_id`）
   - 数据来源：Neo4j数据库（所有节点）
   - 搜索范围：全局（所有entity_id）
   - 功能：选择标签后触发图谱数据加载

3. **GraphSearch**:
   - 用途：在当前加载的图谱中搜索节点
   - 数据来源：前端内存（已加载的图谱数据）
   - 搜索范围：仅当前显示的节点
   - 特点：完全前端实现，不调用后端API

### 数据流图

```
Neo4j数据库
    ↓
[GraphTagFilter] → 获取所有graph_tag → 用于过滤图谱查询
    ↓
[GraphLabels] → 获取/搜索entity_id → 选择要查询的实体
    ↓
调用 /graphs API（带graph_tag过滤和label参数）
    ↓
加载图谱数据到前端
    ↓
[GraphSearch] → 在本地搜索已加载的节点
```

### Neo4j查询总结

1. **GraphTagFilter**: `MATCH (n) RETURN n` - 获取所有节点
2. **GraphLabels (popular)**: `MATCH (n) WHERE n.entity_id IS NOT NULL OPTIONAL MATCH (n)-[r]-() WITH n.entity_id AS label, count(r) AS degree ORDER BY degree DESC RETURN label`
3. **GraphLabels (search)**: 使用全文索引或 `CONTAINS` 查询搜索 `entity_id`
4. **GraphSearch**: 无Neo4j查询，纯前端搜索
