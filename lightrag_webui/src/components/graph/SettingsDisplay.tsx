import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'
import { useTranslation } from 'react-i18next'
import { fusionTagAny } from '@/lib/constants'

/**
 * Component that displays current values of important graph settings
 * Positioned to the right of the toolbar at the bottom-left corner
 */
const SettingsDisplay = () => {
  const { t } = useTranslation()
  const graphQueryMaxDepth = useSettingsStore.use.graphQueryMaxDepth()
  const graphMaxNodes = useSettingsStore.use.graphMaxNodes()
  const sigmaGraph = useGraphStore.use.sigmaGraph()
  const fusionTagFilter = useGraphStore.use.fusionTagFilter()

  const nodeCount = sigmaGraph?.nodes?.().length ?? 0
  const edgeCount = sigmaGraph?.edges?.().length ?? 0
  const fusionEdgeCount = (() => {
    if (!sigmaGraph) return 0
    let count = 0
    sigmaGraph.forEachEdge((edge) => {
      const fusionTag = sigmaGraph.getEdgeAttribute(edge, 'fusion_tag')
      const relationshipType = sigmaGraph.getEdgeAttribute(edge, 'relationship_type')
      if (fusionTag || relationshipType === 'SAME_AS' || relationshipType === 'SIMILAR') count += 1
    })
    return count
  })()

  return (
    <div className="absolute bottom-4 left-[calc(1rem+2.5rem)] flex flex-wrap items-center gap-2 text-xs text-gray-400">
      <div>{t('graphPanel.sideBar.settings.depth')}: {graphQueryMaxDepth}</div>
      <div>{t('graphPanel.sideBar.settings.max')}: {graphMaxNodes}</div>
      <div>{t('graphPanel.status.nodes', 'Nodes')}: {nodeCount}</div>
      <div>{t('graphPanel.status.edges', 'Edges')}: {edgeCount}</div>
      <div>{t('graphPanel.status.fusionEdges', 'Fusion edges')}: {fusionEdgeCount}</div>
      {fusionTagFilter && (
        <div className="text-primary/80">
          {t('graphPanel.status.fusionFilter', 'Fusion filter')}: {fusionTagFilter === fusionTagAny ? t('graphPanel.status.anyFusion', 'ANY') : fusionTagFilter}
        </div>
      )}
    </div>
  )
}

export default SettingsDisplay
