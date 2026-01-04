import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Button from '@/components/ui/Button'
import { controlButtonVariant, popularLabelsDefaultLimit } from '@/lib/constants'
import { useGraphStore } from '@/stores/graph'
import { useSettingsStore } from '@/stores/settings'
import { useBackendState } from '@/stores/state'
import { SearchHistoryManager } from '@/utils/SearchHistoryManager'
import { getPopularLabels } from '@/api/lightrag'

const GraphRefreshButton = () => {
  const { t } = useTranslation()
  const label = useSettingsStore.use.queryLabel()
  const triggerSearchLabelDropdownRefresh = useSettingsStore.use.triggerSearchLabelDropdownRefresh()

  const [isRefreshing, setIsRefreshing] = useState(false)

  // Pipeline state monitoring
  const pipelineBusy = useBackendState.use.pipelineBusy()
  const prevPipelineBusy = useRef<boolean | undefined>(undefined)
  const shouldRefreshPopularLabelsRef = useRef(false)

  // Dynamic tooltip based on current label state
  const getRefreshTooltip = useCallback(() => {
    if (isRefreshing) {
      return t('graphPanel.graphLabels.refreshingTooltip')
    }

    if (!label || label === '*') {
      return t('graphPanel.graphLabels.refreshGlobalTooltip')
    }
    return t('graphPanel.graphLabels.refreshCurrentLabelTooltip', { label })
  }, [label, t, isRefreshing])

  // Monitor pipeline state changes: busy -> idle
  useEffect(() => {
    if (prevPipelineBusy.current === true && pipelineBusy === false) {
      shouldRefreshPopularLabelsRef.current = true
    }
    prevPipelineBusy.current = pipelineBusy
  }, [pipelineBusy])

  const reloadPopularLabels = useCallback(async () => {
    if (!shouldRefreshPopularLabelsRef.current) return

    try {
      const popularLabels = await getPopularLabels(popularLabelsDefaultLimit)
      SearchHistoryManager.clearHistory()

      if (popularLabels.length === 0) {
        const fallbackLabels = ['entity', 'relationship', 'document', 'concept']
        await SearchHistoryManager.initializeWithDefaults(fallbackLabels)
      } else {
        await SearchHistoryManager.initializeWithDefaults(popularLabels)
      }
    } catch (error) {
      console.error('Failed to reload popular labels:', error)
      const fallbackLabels = ['entity', 'relationship', 'document']
      SearchHistoryManager.clearHistory()
      await SearchHistoryManager.initializeWithDefaults(fallbackLabels)
    } finally {
      shouldRefreshPopularLabelsRef.current = false
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)

    // Clear legend cache to ensure legend is re-generated on refresh
    useGraphStore.getState().setTypeColorMap(new Map<string, string>())

    try {
      let currentLabel = label

      // If queryLabel is empty, set it to '*'
      if (!currentLabel || currentLabel.trim() === '') {
        useSettingsStore.getState().setQueryLabel('*')
        currentLabel = '*'
      }

      // If pipeline just finished, refresh popular labels (regardless of current label)
      if (shouldRefreshPopularLabelsRef.current) {
        await reloadPopularLabels()
        triggerSearchLabelDropdownRefresh()
      }

      if (currentLabel && currentLabel !== '*') {
        // Refresh current label
        useGraphStore.getState().setGraphDataFetchAttempted(false)
        useGraphStore.getState().setLastSuccessfulQueryLabel('')
        useGraphStore.getState().incrementGraphDataVersion()
      } else {
        // Refresh global + popular labels
        try {
          const popularLabels = await getPopularLabels(popularLabelsDefaultLimit)
          SearchHistoryManager.clearHistory()
          if (popularLabels.length === 0) {
            const fallbackLabels = ['entity', 'relationship', 'document', 'concept']
            await SearchHistoryManager.initializeWithDefaults(fallbackLabels)
          } else {
            await SearchHistoryManager.initializeWithDefaults(popularLabels)
          }
        } catch (error) {
          console.error('Failed to reload popular labels:', error)
          const fallbackLabels = ['entity', 'relationship', 'document']
          SearchHistoryManager.clearHistory()
          await SearchHistoryManager.initializeWithDefaults(fallbackLabels)
        }

        useGraphStore.getState().setGraphDataFetchAttempted(false)
        useGraphStore.getState().setLastSuccessfulQueryLabel('')
        useGraphStore.getState().incrementGraphDataVersion()
        triggerSearchLabelDropdownRefresh()
      }
    } catch (error) {
      console.error('Error during refresh:', error)
    } finally {
      setIsRefreshing(false)
    }
  }, [label, reloadPopularLabels, triggerSearchLabelDropdownRefresh])

  return (
    <Button
      size="icon"
      variant={controlButtonVariant}
      onClick={handleRefresh}
      tooltip={getRefreshTooltip()}
      className="mr-2"
      disabled={isRefreshing}
    >
      <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
    </Button>
  )
}

export default GraphRefreshButton