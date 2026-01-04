import { useCallback, useEffect, useState } from 'react'
import { AsyncSelect } from '@/components/ui/AsyncSelect'
import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'
import {
  dropdownDisplayLimit,
  popularLabelsDefaultLimit,
  searchLabelsDefaultLimit
} from '@/lib/constants'
import { useTranslation } from 'react-i18next'
import { SearchHistoryManager } from '@/utils/SearchHistoryManager'
import { getPopularLabels, searchLabels } from '@/api/lightrag'

const GraphLabels = () => {
  const { t } = useTranslation()
  const label = useSettingsStore.use.queryLabel()
  const dropdownRefreshTrigger = useSettingsStore.use.searchLabelDropdownRefreshTrigger()
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [selectKey, setSelectKey] = useState(0)

  // Initialize search history on component mount
  useEffect(() => {
    const initializeHistory = async () => {
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
  }, [])

  // Force AsyncSelect to re-render when label changes externally (e.g., from entity rename/merge)
  useEffect(() => {
    setSelectKey(prev => prev + 1)
  }, [label])

  // Force AsyncSelect to re-render when dropdown refresh is triggered (e.g., after entity rename)
  useEffect(() => {
    if (dropdownRefreshTrigger > 0) {
      setSelectKey(prev => prev + 1)
    }
  }, [dropdownRefreshTrigger])

  const fetchData = useCallback(
    async (query?: string): Promise<string[]> => {
      let results: string[] = [];
      if (!query || query.trim() === '' || query.trim() === '*') {
        // Empty query: return search history
        results = SearchHistoryManager.getHistoryLabels(dropdownDisplayLimit)
      } else {
        // Non-empty query: call backend search API
        try {
          const apiResults = await searchLabels(query.trim(), searchLabelsDefaultLimit)
          results = apiResults.length <= dropdownDisplayLimit
            ? apiResults
            : [...apiResults.slice(0, dropdownDisplayLimit), '...']
        } catch (error) {
          console.error('Search API failed, falling back to local history search:', error)

          // Fallback to local history search
          const history = SearchHistoryManager.getHistory()
          const queryLower = query.toLowerCase().trim()
          results = history
            .filter(item => item.label.toLowerCase().includes(queryLower))
            .map(item => item.label)
            .slice(0, dropdownDisplayLimit)
        }
      }
      // Always show '*' at the top, and remove duplicates
      const finalResults = ['*', ...results.filter(label => label !== '*')];
      return finalResults;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshTrigger] // Intentionally added to trigger re-creation when data changes
  )

  return (
    <div className="flex items-center">
      <div className="w-full min-w-[280px] max-w-[500px]">
        <AsyncSelect<string>
          key={selectKey} // Force re-render when data changes
          className="min-w-[300px]"
          triggerClassName="max-h-8 w-full overflow-hidden"
          searchInputClassName="max-h-8"
          triggerTooltip={t('graphPanel.graphLabels.selectTooltip')}
          fetcher={fetchData}
          onBeforeOpen={undefined}
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
          value={label !== null ? label : '*'}
          onChange={(newLabel) => {
            const currentLabel = useSettingsStore.getState().queryLabel;

            // select the last item means query all
            if (newLabel === '...') {
              newLabel = '*';
            }

            // Handle reselecting the same label
            if (newLabel === currentLabel && newLabel !== '*') {
              newLabel = '*';
            }

            // Add selected label to search history (except for special cases)
            if (newLabel && newLabel !== '*' && newLabel !== '...' && newLabel.trim() !== '') {
              SearchHistoryManager.addToHistory(newLabel);
            }

            // Reset graphDataFetchAttempted flag to ensure data fetch is triggered
            useGraphStore.getState().setGraphDataFetchAttempted(false);

            // Update the label to trigger data loading
            useSettingsStore.getState().setQueryLabel(newLabel);

            // Force graph re-render and reset zoom/scale (must be AFTER setQueryLabel)
            useGraphStore.getState().incrementGraphDataVersion();
          }}
          clearable={false}  // Prevent clearing value on reselect
          debounceTime={500}
        />
      </div>
    </div>
  )
}

export default GraphLabels