import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
// import { MiniMap } from '@react-sigma/minimap'
import { SigmaContainer, useRegisterEvents, useSigma } from '@react-sigma/core'
import { Settings as SigmaSettings } from 'sigma/settings'
import { GraphSearchOption, OptionItem } from '@react-sigma/graph-search'
import { EdgeArrowProgram, NodePointProgram, NodeCircleProgram } from 'sigma/rendering'
import { NodeBorderProgram } from '@sigma/node-border'
import { EdgeCurvedArrowProgram, createEdgeCurveProgram } from '@sigma/edge-curve'
import { Search } from 'lucide-react'

import FocusOnNode from '@/components/graph/FocusOnNode'
import LayoutsControl from '@/components/graph/LayoutsControl'
import GraphControl from '@/components/graph/GraphControl'
// import ThemeToggle from '@/components/ThemeToggle'
import ZoomControl from '@/components/graph/ZoomControl'
import FullScreenControl from '@/components/graph/FullScreenControl'
import Settings from '@/components/graph/Settings'
import GraphSearch from '@/components/graph/GraphSearch'
import GraphLabels from '@/components/graph/GraphLabels'
import GraphTagFilter from '@/components/graph/GraphTagFilter'
import PropertiesView from '@/components/graph/PropertiesView'
import SettingsDisplay from '@/components/graph/SettingsDisplay'
import Legend from '@/components/graph/Legend'
import LegendButton from '@/components/graph/LegendButton'
import GraphFusionControl from '@/components/graph/GraphFusionControl'

import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'
import { labelColorDarkTheme, labelColorLightTheme } from '@/lib/constants'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

import '@react-sigma/core/lib/style.css'
import '@react-sigma/graph-search/lib/style.css'

// Function to create sigma settings based on theme
const createSigmaSettings = (isDarkTheme: boolean): Partial<SigmaSettings> => ({
  allowInvalidContainer: true,
  defaultNodeType: 'default',
  defaultEdgeType: 'curvedNoArrow',
  renderEdgeLabels: false,
  edgeProgramClasses: {
    arrow: EdgeArrowProgram,
    curvedArrow: EdgeCurvedArrowProgram,
    curvedNoArrow: createEdgeCurveProgram()
  },
  nodeProgramClasses: {
    default: NodeBorderProgram,
    circel: NodeCircleProgram,
    point: NodePointProgram
  },
  labelGridCellSize: 60,
  labelRenderedSizeThreshold: 12,
  enableEdgeEvents: true,
  labelColor: {
    color: isDarkTheme ? labelColorDarkTheme : labelColorLightTheme,
    attribute: 'labelColor'
  },
  edgeLabelColor: {
    color: isDarkTheme ? labelColorDarkTheme : labelColorLightTheme,
    attribute: 'labelColor'
  },
  edgeLabelSize: 8,
  labelSize: 12
  // minEdgeThickness: 2
  // labelFont: 'Lato, sans-serif'
})

const GraphEvents = () => {
  const registerEvents = useRegisterEvents()
  const sigma = useSigma()
  const [draggedNode, setDraggedNode] = useState<string | null>(null)

  useEffect(() => {
    // Register the events
    registerEvents({
      downNode: (e) => {
        setDraggedNode(e.node)
        sigma.getGraph().setNodeAttribute(e.node, 'highlighted', true)
      },
      // On mouse move, if the drag mode is enabled, we change the position of the draggedNode
      mousemovebody: (e) => {
        if (!draggedNode) return
        // Get new position of node
        const pos = sigma.viewportToGraph(e)
        sigma.getGraph().setNodeAttribute(draggedNode, 'x', pos.x)
        sigma.getGraph().setNodeAttribute(draggedNode, 'y', pos.y)

        // Prevent sigma to move camera:
        e.preventSigmaDefault()
        e.original.preventDefault()
        e.original.stopPropagation()
      },
      // On mouse up, we reset the autoscale and the dragging mode
      mouseup: () => {
        if (draggedNode) {
          setDraggedNode(null)
          sigma.getGraph().removeNodeAttribute(draggedNode, 'highlighted')
        }
      },
      // Disable the autoscale at the first down interaction
      mousedown: (e) => {
        // Only set custom BBox if it's a drag operation (mouse button is pressed)
        const mouseEvent = e.original as MouseEvent;
        if (mouseEvent.buttons !== 0 && !sigma.getCustomBBox()) {
          sigma.setCustomBBox(sigma.getBBox())
        }
      }
    })
  }, [registerEvents, sigma, draggedNode])

  return null
}

const GraphViewer = () => {
  const [isThemeSwitching, setIsThemeSwitching] = useState(false)
  const sigmaRef = useRef<any>(null)
  const prevTheme = useRef<string>('')

  const selectedNode = useGraphStore.use.selectedNode()
  const focusedNode = useGraphStore.use.focusedNode()
  const moveToSelectedNode = useGraphStore.use.moveToSelectedNode()
  const isFetching = useGraphStore.use.isFetching()

  const showPropertyPanel = useSettingsStore.use.showPropertyPanel()
  const showNodeSearchBar = useSettingsStore.use.showNodeSearchBar()
  const enableNodeDrag = useSettingsStore.use.enableNodeDrag()
  const showLegend = useSettingsStore.use.showLegend()
  const theme = useSettingsStore.use.theme()
  const appliedGraphTags = useSettingsStore.use.selectedGraphTags()
  const appliedQueryLabel = useSettingsStore.use.queryLabel()
  const appliedMaxNodes = useSettingsStore.use.graphMaxNodes()
  const backendMaxGraphNodes = useSettingsStore.use.backendMaxGraphNodes()

  // Draft filters: user edits these, but we only fetch after clicking "Search"
  const [draftGraphTags, setDraftGraphTags] = useState<string[]>(appliedGraphTags)
  const [draftQueryLabel, setDraftQueryLabel] = useState<string>(appliedQueryLabel || '*')
  // Keep as text to allow empty/partial input while editing (fixes "can't delete last digit")
  const [draftMaxNodesText, setDraftMaxNodesText] = useState<string>(String(appliedMaxNodes || 100))

  // Keep drafts in sync if applied values change elsewhere
  useEffect(() => setDraftGraphTags(appliedGraphTags), [appliedGraphTags])
  useEffect(() => setDraftQueryLabel(appliedQueryLabel || '*'), [appliedQueryLabel])
  useEffect(() => setDraftMaxNodesText(String(appliedMaxNodes || 100)), [appliedMaxNodes])

  const normalizeMaxNodes = useCallback(
    (text: string) => {
      const maxLimit = backendMaxGraphNodes || 1000
      const parsed = Number.parseInt((text || '').trim(), 10)
      const fallback = appliedMaxNodes || 100
      const value = Number.isFinite(parsed) ? parsed : fallback
      return Math.min(maxLimit, Math.max(1, value))
    },
    [backendMaxGraphNodes, appliedMaxNodes]
  )

  // Memoize sigma settings to prevent unnecessary re-creation
  const memoizedSigmaSettings = useMemo(() => {
    const isDarkTheme = theme === 'dark'
    return createSigmaSettings(isDarkTheme)
  }, [theme])

  // Initialize sigma settings based on theme with theme switching protection
  useEffect(() => {
    // Detect theme change
    const isThemeChange = prevTheme.current && prevTheme.current !== theme
    if (isThemeChange) {
      setIsThemeSwitching(true)
      console.log('Theme switching detected:', prevTheme.current, '->', theme)

      // Reset theme switching state after a short delay
      const timer = setTimeout(() => {
        setIsThemeSwitching(false)
        console.log('Theme switching completed')
      }, 150)

      return () => clearTimeout(timer)
    }
    prevTheme.current = theme
    console.log('Initialized sigma settings for theme:', theme)
  }, [theme])

  // Clean up sigma instance when component unmounts
  useEffect(() => {
    return () => {
      // TAB is mount twice in vite dev mode, this is a workaround

      const sigma = useGraphStore.getState().sigmaInstance;
      if (sigma) {
        try {
          // Destroy sigma，and clear WebGL context
          sigma.kill();
          useGraphStore.getState().setSigmaInstance(null);
          console.log('Cleared sigma instance on Graphviewer unmount');
        } catch (error) {
          console.error('Error cleaning up sigma instance:', error);
        }
      }
    };
  }, []);

  // Note: There was a useLayoutEffect hook here to set up the sigma instance and graph data,
  // but testing showed it wasn't executing or having any effect, while the backup mechanism
  // in GraphControl was sufficient. This code was removed to simplify implementation

  const onSearchFocus = useCallback((value: GraphSearchOption | null) => {
    if (value === null) useGraphStore.getState().setFocusedNode(null)
    else if (value.type === 'nodes') useGraphStore.getState().setFocusedNode(value.id)
  }, [])

  const onSearchSelect = useCallback((value: GraphSearchOption | null) => {
    if (value === null) {
      useGraphStore.getState().setSelectedNode(null)
    } else if (value.type === 'nodes') {
      useGraphStore.getState().setSelectedNode(value.id, true)
    }
  }, [])

  const autoFocusedNode = useMemo(() => focusedNode ?? selectedNode, [focusedNode, selectedNode])
  const searchInitSelectedNode = useMemo(
    (): OptionItem | null => (selectedNode ? { type: 'nodes', id: selectedNode } : null),
    [selectedNode]
  )

  const onGraphTagsChange = useCallback((tags: string[]) => {
    // Draft-only update:
    // - clear GraphLabels selection immediately
    // - do NOT fetch until user clicks "Search"
    setDraftGraphTags(tags)
    setDraftQueryLabel('')

    // Clear selection immediately (UI should not point to stale nodes)
    useGraphStore.getState().clearSelection()
  }, [])

  const hasPendingSearch = useMemo(() => {
    const a = appliedGraphTags
    const b = draftGraphTags
    const tagsEqual =
      a.length === b.length && a.every((v, i) => v === b[i])

    const normalizeLabel = (x: string) => (x || '').trim() || '*'
    const labelEqual = normalizeLabel(appliedQueryLabel) === normalizeLabel(draftQueryLabel)

    const nodesEqual = (appliedMaxNodes || 0) === normalizeMaxNodes(draftMaxNodesText)

    return !(tagsEqual && labelEqual && nodesEqual)
  }, [
    appliedGraphTags,
    draftGraphTags,
    appliedQueryLabel,
    draftQueryLabel,
    appliedMaxNodes,
    draftMaxNodesText,
    normalizeMaxNodes
  ])

  const searchButtonLabel = useMemo(() => {
    // Scheme A: always clickable (unless loading). When drafts differ, it's "apply & query";
    // otherwise it's a "refresh" of the same applied conditions.
    return hasPendingSearch ? '应用并查询' : '刷新'
  }, [hasPendingSearch])

  const searchButtonTooltip = useMemo(() => {
    return hasPendingSearch ? '应用筛选并重新拉取图数据' : '使用当前筛选条件刷新图数据'
  }, [hasPendingSearch])

  const onSearchClick = useCallback(() => {
    // Apply drafts into global settings, then trigger graph re-fetch
    const normalizedLabel = (draftQueryLabel || '').trim() || '*'
    const normalizedMaxNodes = normalizeMaxNodes(draftMaxNodesText)
    useSettingsStore.getState().setSelectedGraphTags(draftGraphTags)
    useSettingsStore.getState().setQueryLabel(normalizedLabel)
    useSettingsStore.getState().setGraphMaxNodes(normalizedMaxNodes)

    const graphState = useGraphStore.getState()
    graphState.clearSelection()
    graphState.setGraphDataFetchAttempted(false)
    graphState.setLastSuccessfulQueryLabel('')
    graphState.incrementGraphDataVersion()
  }, [draftGraphTags, draftQueryLabel, draftMaxNodesText, normalizeMaxNodes])

  // Always render SigmaContainer but control its visibility with CSS
  return (
    <div className="relative h-full w-full overflow-hidden">
      <SigmaContainer
        settings={memoizedSigmaSettings}
        className="!bg-background !size-full overflow-hidden"
        ref={sigmaRef}
      >
        <GraphControl />

        {enableNodeDrag && <GraphEvents />}

        <FocusOnNode node={autoFocusedNode} move={moveToSelectedNode} />

        <div className="absolute top-2 left-2 flex flex-wrap items-start gap-2">
          <div className="order-2">
            <GraphLabels
              value={draftQueryLabel}
              onChange={setDraftQueryLabel}
              graphTags={draftGraphTags}
            />
          </div>
          {showNodeSearchBar && !isThemeSwitching && (
            <>
              <div className="order-1">
                <GraphTagFilter value={draftGraphTags} onChange={onGraphTagsChange} />
              </div>
              <div className="order-3 min-w-[220px]">
                <GraphSearch
                  value={searchInitSelectedNode}
                  onFocus={onSearchFocus}
                  onChange={onSearchSelect}
                />
              </div>
              <div className="order-4">
                <Input
                  type="number"
                  inputMode="numeric"
                  className="bg-background/60 h-8 w-[96px] rounded-xl border-1 px-3 py-1 text-sm opacity-60 backdrop-blur-lg transition-all hover:opacity-100"
                  value={draftMaxNodesText}
                  min={1}
                  max={backendMaxGraphNodes || 1000}
                  title={`最大节点数（≤ ${backendMaxGraphNodes || 1000}）`}
                  onChange={(e) => {
                    // Allow empty input while editing; normalize later on blur/search.
                    setDraftMaxNodesText(e.target.value)
                  }}
                  onBlur={() => {
                    const normalized = normalizeMaxNodes(draftMaxNodesText)
                    setDraftMaxNodesText(String(normalized))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const normalized = normalizeMaxNodes(draftMaxNodesText)
                      setDraftMaxNodesText(String(normalized))
                    }
                  }}
                />
              </div>
              <div className="order-5">
                <Button
                  variant="outline"
                  className="bg-background/60 h-8 rounded-xl border-1 opacity-60 backdrop-blur-lg transition-all hover:opacity-100"
                  onClick={onSearchClick}
                  disabled={isFetching}
                  tooltip={searchButtonTooltip}
                  side="bottom"
                >
                  <Search className="h-4 w-4 mr-2" />
                  {searchButtonLabel}
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="bg-background/60 absolute bottom-2 left-2 flex flex-col rounded-xl border-2 backdrop-blur-lg">
          <LayoutsControl />
          <ZoomControl />
          <FullScreenControl />
          <LegendButton />
          <GraphFusionControl />
          <Settings />
          {/* <ThemeToggle /> */}
        </div>

        {showPropertyPanel && (
          <div className="absolute top-2 right-2 z-10">
            <PropertiesView />
          </div>
        )}

        {showLegend && (
          <div className="absolute bottom-10 right-2 z-0">
            <Legend className="bg-background/60 backdrop-blur-lg" />
          </div>
        )}

        {/* <div className="absolute bottom-2 right-2 flex flex-col rounded-xl border-2">
          <MiniMap width="100px" height="100px" />
        </div> */}

        <SettingsDisplay />
      </SigmaContainer>

      {/* Loading overlay - shown when data is loading or theme is switching */}
      {(isFetching || isThemeSwitching) && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="text-center">
            <div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
            <p>{isThemeSwitching ? 'Switching Theme...' : 'Loading Graph Data...'}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default GraphViewer