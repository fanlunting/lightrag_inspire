import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { GitMerge, X, Copy, Filter } from 'lucide-react'

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Badge from '@/components/ui/Badge'
import Checkbox from '@/components/ui/Checkbox'
import Separator from '@/components/ui/Separator'
import { Card } from '@/components/ui/Card'
import NumberInput from '@/components/ui/NumberInput'
import { AsyncSearch } from '@/components/ui/AsyncSearch'

import { getGraphTags, mergeGraphTagsInPlace, type GraphTagsMergeResult } from '@/api/lightrag'
import { useGraphStore } from '@/stores/graph'
import { cn } from '@/lib/utils'

type FusionHistoryItem = {
  fusion_tag: string
  source_graph_tags: string[]
  same_edges: number
  similar_edges: number
  created_at: number
  params: {
    similarity_threshold: number
    top_k: number
    llm_confirm: boolean
  }
}

const HISTORY_KEY = 'LIGHTRAG-GRAPH-FUSION-HISTORY'
const HISTORY_MAX = 30

function loadHistory(): FusionHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(items: FusionHistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)))
  } catch {
    // ignore
  }
}

export default function GraphFusionDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [manualTag, setManualTag] = useState('')

  const [similarityThreshold, setSimilarityThreshold] = useState<number>(0.85)
  const [topK, setTopK] = useState<number>(8)
  const [llmConfirm, setLlmConfirm] = useState<boolean>(true)

  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<GraphTagsMergeResult | null>(null)
  const [history, setHistory] = useState<FusionHistoryItem[]>(() => loadHistory())

  const fusionTagFilter = useGraphStore.use.fusionTagFilter()
  const setFusionTagFilter = useGraphStore.use.setFusionTagFilter()

  const canRun = useMemo(() => selectedTags.length > 0 && !running, [selectedTags.length, running])

  useEffect(() => {
    if (!open) return
    // Reset transient UI when opened, but keep selections
    setResult(null)
  }, [open])

  const addTag = useCallback((tag: string) => {
    const cleaned = tag.trim()
    if (!cleaned) return
    setSelectedTags((prev) => (prev.includes(cleaned) ? prev : [...prev, cleaned]))
  }, [])

  const removeTag = useCallback((tag: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag))
  }, [])

  const clearAll = useCallback(() => {
    setSelectedTags([])
    setManualTag('')
    setResult(null)
  }, [])

  const runFusion = useCallback(async () => {
    if (!canRun) return
    setRunning(true)
    setResult(null)
    try {
      const resp = await mergeGraphTagsInPlace({
        graph_tags: selectedTags,
        similarity_threshold: similarityThreshold,
        top_k: topK,
        llm_confirm: llmConfirm
      })

      setResult(resp.data)
      toast.success(`Fusion completed: similar_edges=${resp.data.similar_edges}`)

      const item: FusionHistoryItem = {
        ...resp.data,
        created_at: Date.now(),
        params: {
          similarity_threshold: similarityThreshold,
          top_k: topK,
          llm_confirm: llmConfirm
        }
      }
      const next = [item, ...history].slice(0, HISTORY_MAX)
      setHistory(next)
      saveHistory(next)
    } catch (e: any) {
      toast.error(e?.message || 'Fusion failed')
    } finally {
      setRunning(false)
    }
  }, [canRun, history, llmConfirm, selectedTags, similarityThreshold, topK])

  const applyFilter = useCallback((fusionTag: string) => {
    setFusionTagFilter(fusionTag)
    toast.message('Applied fusion edge filter in graph viewer')
  }, [setFusionTagFilter])

  const clearFilter = useCallback(() => {
    setFusionTagFilter(null)
    toast.message('Cleared fusion edge filter')
  }, [setFusionTagFilter])

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed')
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-5xl h-[85vh] overflow-hidden p-0">
        <div className="flex h-full flex-col">
          <DialogHeader className="p-6 pb-3">
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="h-4 w-4" />
              图谱融合（按 graph_tag，in-place）
            </DialogTitle>
            <DialogDescription>
              该融合基于 <code>amerge_graph()</code>：不会生成新 graph_tag，不改写节点；只新增 <code>SAME_AS</code>/<code>SIMILAR</code> 边，并写入 <code>fusion_tag</code>。
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto px-6 pb-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">选择要融合的 graph_tag</div>
                  <Button variant="ghost" size="sm" onClick={clearAll} type="button">
                    清空
                  </Button>
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  <AsyncSearch<string>
                    fetcher={async (q) => {
                      const tags = await getGraphTags(q || '', 300)
                      return tags
                    }}
                    renderOption={(tag) => <div className="truncate">{tag}</div>}
                    getOptionValue={(tag) => tag}
                    value={null}
                    onChange={(value) => addTag(value)}
                    onFocus={() => {}}
                    placeholder="搜索并选择 graph_tag（点击添加）"
                    noResultsMessage="没有匹配的 graph_tag"
                  />

                  <div className="flex gap-2">
                    <Input
                      value={manualTag}
                      onChange={(e) => setManualTag(e.target.value)}
                      placeholder="也可手动输入 graph_tag"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTag(manualTag)
                          setManualTag('')
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        addTag(manualTag)
                        setManualTag('')
                      }}
                    >
                      添加
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selectedTags.length === 0 && (
                      <div className="text-sm text-muted-foreground">尚未选择任何 graph_tag</div>
                    )}
                    {selectedTags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1">
                        <span className="max-w-[220px] truncate">{tag}</span>
                        <button
                          type="button"
                          className="ml-1 inline-flex items-center opacity-70 hover:opacity-100"
                          onClick={() => removeTag(tag)}
                          aria-label={`remove ${tag}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              </Card>

              <Card className="p-4">
                <div className="text-sm font-medium">融合参数</div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted-foreground">similarity_threshold</div>
                    <NumberInput
                      value={similarityThreshold}
                      min={0}
                      max={1}
                      stepper={0.01}
                      decimalScale={2}
                      fixedDecimalScale
                      onValueChange={(v) => setSimilarityThreshold(v ?? 0.85)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-muted-foreground">top_k</div>
                    <NumberInput
                      value={topK}
                      min={1}
                      max={100}
                      stepper={1}
                      decimalScale={0}
                      onValueChange={(v) => setTopK(Math.max(1, Math.min(100, v ?? 8)))}
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Checkbox
                    id="llm-confirm"
                    checked={llmConfirm}
                    onCheckedChange={() => setLlmConfirm((v) => !v)}
                  />
                  <label htmlFor="llm-confirm" className="text-sm leading-none">
                    llm_confirm（更慢/更贵，但更准）
                  </label>
                </div>

                <Separator className="my-4" />

                <div className="flex flex-col gap-2">
                  <Button type="button" onClick={runFusion} disabled={!canRun}>
                    {running ? '融合中…' : '开始融合'}
                  </Button>
                  <div className="text-xs text-muted-foreground">
                    提示：当前实现里 SAME_AS 可能为 0（取决于后端实体 ID 的组织方式）。
                  </div>
                </div>
              </Card>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <div className="text-sm font-medium">本次结果</div>
                <div className="mt-3">
                  {!result ? (
                    <div className="text-sm text-muted-foreground">尚未运行</div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">fusion_tag</div>
                          <div className="truncate font-mono">{result.fusion_tag}</div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => copyToClipboard(result.fusion_tag)}
                          >
                            <Copy className="h-4 w-4" />
                            复制
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => applyFilter(result.fusion_tag)}
                          >
                            <Filter className="h-4 w-4" />
                            仅看该融合边
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded border p-2">
                          <div className="text-xs text-muted-foreground">same_edges</div>
                          <div className="font-medium">{result.same_edges}</div>
                        </div>
                        <div className="rounded border p-2">
                          <div className="text-xs text-muted-foreground">similar_edges</div>
                          <div className="font-medium">{result.similar_edges}</div>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-muted-foreground">source_graph_tags</div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {result.source_graph_tags.map((t) => (
                            <Badge key={t} variant="outline">{t}</Badge>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between rounded border p-2">
                        <div className="text-xs text-muted-foreground">
                          当前图谱过滤：{fusionTagFilter ? <span className="font-mono">{fusionTagFilter}</span> : '未启用'}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={clearFilter}
                          disabled={!fusionTagFilter}
                        >
                          清除过滤
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              <Card className="p-4">
                <div className="text-sm font-medium">融合历史（本地）</div>
                <div className="mt-3 space-y-2">
                  {history.length === 0 ? (
                    <div className="text-sm text-muted-foreground">暂无历史</div>
                  ) : (
                    history.map((h) => (
                      <button
                        key={h.fusion_tag}
                        type="button"
                        className={cn(
                          'w-full rounded border p-2 text-left hover:bg-accent transition-colors',
                          result?.fusion_tag === h.fusion_tag && 'border-primary'
                        )}
                        onClick={() => setResult({
                          fusion_tag: h.fusion_tag,
                          source_graph_tags: h.source_graph_tags,
                          same_edges: h.same_edges,
                          similar_edges: h.similar_edges
                        })}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 truncate font-mono text-xs">{h.fusion_tag}</div>
                          <div className="text-xs text-muted-foreground">
                            similar={h.similar_edges}
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {h.source_graph_tags.slice(0, 5).map((t) => (
                            <Badge key={t} variant="secondary" className="py-0 px-1.5">{t}</Badge>
                          ))}
                          {h.source_graph_tags.length > 5 && (
                            <span className="text-xs text-muted-foreground">+{h.source_graph_tags.length - 5}</span>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </div>

          <DialogFooter className="p-6 pt-0">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

