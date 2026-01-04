import { useCallback, useEffect, useState, useRef } from 'react'
import { AsyncSelect } from '@/components/ui/AsyncSelect'
import { useBackendState } from '@/stores/state'
import {
  dropdownDisplayLimit,
  controlButtonVariant,
  popularLabelsDefaultLimit,
  searchLabelsDefaultLimit
} from '@/lib/constants'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import Button from '@/components/ui/Button'
import { SearchHistoryManager } from '@/utils/SearchHistoryManager'
import { getPopularLabels, searchLabels } from '@/api/lightrag'

type Props = {
  /** Draft label value ('' means empty / not selected yet) */
  value: string
  /** Update draft label value */
  onChange: (label: string) => void
  /** Draft graph tags used to filter dropdown options */
  graphTags: string[]
}

const GraphLabels = ({ value, onChange, graphTags }: Props) => {
  const { t } = useTranslation()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [selectKey, setSelectKey] = useState(0)

  // Pipeline state monitoring
  const pipelineBusy = useBackendState.use.pipelineBusy()
  const prevPipelineBusy = useRef<boolean | undefined>(undefined)
  const shouldRefreshPopularLabelsRef = useRef(false)

  // Dynamic tooltip based on current label state
  const getRefreshTooltip = useCallback(() => {
    if (isRefreshing) {
      return t('graphPanel.graphLabels.refreshingTooltip')
    }

    if (!value || value === '*') {
      return t('graphPanel.graphLabels.refreshGlobalTooltip')
    } else {
      return t('graphPanel.graphLabels.refreshCurrentLabelTooltip', { label: value })
    }
  }, [value, t, isRefreshing])

  // Initialize search history on component mount
  useEffect(() => {
    const initializeHistory = async () => {
      // When graphTags are active, we always use backend-filtered results instead of global history.
      if (graphTags.length > 0) return

      const history = SearchHistoryManager.getHistory()

      if (history.length === 0) {
        // If no history exists, fetch popular labels and initialize
        try {
          const popularLabels = await getPopularLabels(popularLabelsDefaultLimit)
          await SearchHistoryManager.initializeWithDefaults(popularLabels)
        } catch (error) {
          console.error('Failed to initialize search history:', error)
          // No fallback needed, API is the source of truth
        }
      }
    }

    initializeHistory()
  }, [graphTags.length])

  // Force AsyncSelect to re-render when label changes externally (e.g., from entity rename/merge)
  useEffect(() => {
    setSelectKey(prev => prev + 1)
  }, [value])

  // Monitor pipeline state changes: busy -> idle
  useEffect(() => {
    if (prevPipelineBusy.current === true && pipelineBusy === false) {
      console.log('Pipeline changed from busy to idle, marking for popular labels refresh')
      shouldRefreshPopularLabelsRef.current = true
    }
    prevPipelineBusy.current = pipelineBusy
  }, [pipelineBusy])

  // Helper: Reload popular labels from backend
  const reloadPopularLabels = useCallback(async () => {
    if (!shouldRefreshPopularLabelsRef.current) return

    console.log('Reloading popular labels (triggered by pipeline idle)')
    try {
      // Only maintain local history when NOT filtering by graphTags
      if (graphTags.length === 0) {
        const popularLabels = await getPopularLabels(popularLabelsDefaultLimit)
        SearchHistoryManager.clearHistory()

        if (popularLabels.length === 0) {
          const fallbackLabels = ['entity', 'relationship', 'document', 'concept']
          await SearchHistoryManager.initializeWithDefaults(fallbackLabels)
        } else {
          await SearchHistoryManager.initializeWithDefaults(popularLabels)
        }
      }
    } catch (error) {
      console.error('Failed to reload popular labels:', error)
      if (graphTags.length === 0) {
        const fallbackLabels = ['entity', 'relationship', 'document']
        SearchHistoryManager.clearHistory()
        await SearchHistoryManager.initializeWithDefaults(fallbackLabels)
      }
    } finally {
      // Always clear the flag
      shouldRefreshPopularLabelsRef.current = false
    }
  }, [graphTags.length])

  // Helper: Bump dropdown data to trigger refresh
  const bumpDropdownData = useCallback(({ forceSelectKey = false } = {}) => {
    setRefreshTrigger(prev => prev + 1)
    if (forceSelectKey) {
      setSelectKey(prev => prev + 1)
    }
  }, [])

  const fetchData = useCallback(
    async (query?: string): Promise<string[]> => {
      let results: string[] = [];
      if (!query || query.trim() === '' || query.trim() === '*') {
        // Empty query:
        // - if graphTags are active: show filtered popular labels from backend
        // - otherwise: return local search history
        if (graphTags.length > 0) {
          try {
            const popular = await getPopularLabels(popularLabelsDefaultLimit, graphTags)
            results = popular.length <= dropdownDisplayLimit
              ? popular
              : [...popular.slice(0, dropdownDisplayLimit), '...']
          } catch (error) {
            console.error('Popular labels API failed (filtered), returning empty:', error)
            results = []
          }
        } else {
          results = SearchHistoryManager.getHistoryLabels(dropdownDisplayLimit)
        }
      } else {
        // Non-empty query: call backend search API
        try {
          const apiResults = await searchLabels(
            query.trim(),
            searchLabelsDefaultLimit,
            graphTags.length > 0 ? graphTags : undefined
          )
          results = apiResults.length <= dropdownDisplayLimit
            ? apiResults
            : [...apiResults.slice(0, dropdownDisplayLimit), '...']
        } catch (error) {
          console.error('Search API failed, falling back to local history search:', error)

          // Fallback to local history search
          if (graphTags.length === 0) {
            const history = SearchHistoryManager.getHistory()
            const queryLower = query.toLowerCase().trim()
            results = history
              .filter(item => item.label.toLowerCase().includes(queryLower))
              .map(item => item.label)
              .slice(0, dropdownDisplayLimit)
          } else {
            results = []
          }
        }
      }
      // Always show '*' at the top, and remove duplicates
      const finalResults = ['*', ...results.filter(label => label !== '*')];
      return finalResults;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshTrigger, graphTags] // Intentionally added to trigger re-creation when data changes
  )

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)

    try {
      // Only refresh dropdown source (NOT the graph itself).
      // - no graphTags: refresh popular labels history
      // - with graphTags: just bump dropdown to re-fetch filtered options
      if (shouldRefreshPopularLabelsRef.current) {
        await reloadPopularLabels()
      }
      bumpDropdownData({ forceSelectKey: true })
    } catch (error) {
      console.error('Error during refresh:', error)
    } finally {
      setIsRefreshing(false)
    }
  }, [reloadPopularLabels, bumpDropdownData])

  // Handle dropdown before open - reload popular labels if needed
  const handleDropdownBeforeOpen = useCallback(async () => {
    if (shouldRefreshPopularLabelsRef.current && (!value || value === '*')) {
      await reloadPopularLabels()
      bumpDropdownData()
    }
  }, [reloadPopularLabels, bumpDropdownData, value])

  return (
    <div className="flex items-center">
      {/* Always show refresh button */}
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
      <div className="w-full min-w-[280px] max-w-[500px]">
        <AsyncSelect<string>
          key={selectKey} // Force re-render when data changes
          className="min-w-[300px]"
          triggerClassName="max-h-8 w-full overflow-hidden"
          searchInputClassName="max-h-8"
          triggerTooltip={t('graphPanel.graphLabels.selectTooltip')}
          fetcher={fetchData}
          onBeforeOpen={handleDropdownBeforeOpen}
          renderOption={(item) => (
            <div className="truncate" title={item}>
              {item}
            </div>
          )}
          getOptionValue={(item) => item}
          getDisplayValue={(item) => (
            <div className="min-w-0 flex-1 truncate text-left" title={item}>
              {item}
            </div>
          )}
          notFound={<div className="py-6 text-center text-sm">{t('graphPanel.graphLabels.noLabels')}</div>}
          ariaLabel={t('graphPanel.graphLabels.label')}
          placeholder={t('graphPanel.graphLabels.placeholder')}
          searchPlaceholder={t('graphPanel.graphLabels.placeholder')}
          noResultsMessage={t('graphPanel.graphLabels.noLabels')}
          value={value ?? ''}
          onChange={(newLabel) => {
            const currentLabel = value;

            // select the last item means query all
            if (newLabel === '...') {
              newLabel = '*';
            }

            // Handle reselecting the same label
            if (newLabel === currentLabel && newLabel !== '*') {
              newLabel = '*';
            }

            // Add selected label to search history (except for special cases)
            if (graphTags.length === 0) {
              if (newLabel && newLabel !== '*' && newLabel !== '...' && newLabel.trim() !== '') {
                SearchHistoryManager.addToHistory(newLabel);
              }
            }

            // Draft-only update; graph retrieval will be triggered by the outer "Search" button.
            onChange(newLabel);
          }}
          clearable={false}  // Prevent clearing value on reselect
          debounceTime={500}
        />
      </div>
    </div>
  )
}

export default GraphLabels
