import { useCallback, useEffect, useState, useRef } from 'react'
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
  const selectedGraphTags = useSettingsStore.use.selectedGraphTags()
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [selectKey, setSelectKey] = useState(0)
  
  // State to control backend fetch
  // Initialize to FALSE to prevent auto-fetch on mount when tags are persisted
  const [backendFetchAllowed, setBackendFetchAllowed] = useState(false)
  
  // Ref to track if initial mount has happened to avoid clearing on first render if not needed
  const isMounted = useRef(false);

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

  // Handle selectedGraphTags changes
  useEffect(() => {
    // Skip the first render
    if (!isMounted.current) {
        isMounted.current = true;
        return;
    }
    
    // When tags change:
    // 1. Clear current label
    useSettingsStore.getState().setQueryLabel('')
    // 2. Disable backend fetch until user interacts
    setBackendFetchAllowed(false)
    // 3. Force re-render to reset component state (and clear internal cache of AsyncSelect)
    setSelectKey(prev => prev + 1)
  }, [selectedGraphTags])

  const fetchData = useCallback(
    async (query?: string): Promise<string[]> => {
      let results: string[] = [];
      const isGlobalSelect = selectedGraphTags && selectedGraphTags.includes('*');
      const hasSpecificTags = selectedGraphTags && selectedGraphTags.length > 0 && !isGlobalSelect;
      
      const hasTags = isGlobalSelect || hasSpecificTags;

      if (!query || query.trim() === '' || query.trim() === '*') {
        // Empty query:
        if (hasTags) {
           // If backend fetch is not allowed (e.g. after tag change but before user interaction), return empty
           // BUT if it's the initial load (isMounted check might be tricky here, but we can rely on !query), 
           // we might want to avoid auto-fetch too unless explicitly requested.
           // However, if the user *just* loaded the page and has tags selected (persistence), 
           // we probably SHOULD show something? Or maybe wait for interaction?
           // The previous issue was *repeated* fetches. 
           // Let's stick to: only fetch if backendFetchAllowed is true.
           // For initial load, we might want to set backendFetchAllowed to false initially in state?
           // Actually, on initial mount, if tags are present, we probably DO want to fetch once?
           // The issue seen in logs is repeated calls.
           
           if (!backendFetchAllowed) {
             return [];
           }

           // If tags are selected (or *), fetch from backend
           try {
             // If *, pass undefined to fetch all popular labels. Otherwise pass selected tags.
             const tagsToUse = isGlobalSelect ? undefined : selectedGraphTags;
             const popularLabels = await getPopularLabels(popularLabelsDefaultLimit, tagsToUse)
             results = popularLabels
           } catch (error) {
             console.error('Failed to fetch filtered popular labels:', error)
             results = []
           }
        } else {
           // Default behavior: return search history
           results = SearchHistoryManager.getHistoryLabels(dropdownDisplayLimit)
        }
      } else {
        // Non-empty query: call backend search API
        // Always allow backend fetch if user is typing query (implied interaction)
        try {
          const tagsToUse = isGlobalSelect ? undefined : selectedGraphTags;
          const apiResults = await searchLabels(query.trim(), searchLabelsDefaultLimit, tagsToUse)
          results = apiResults.length <= dropdownDisplayLimit
            ? apiResults
            : [...apiResults.slice(0, dropdownDisplayLimit), '...']
        } catch (error) {
          console.error('Search API failed, falling back to local history search:', error)

          // Fallback to local history search
          // Note: Local history doesn't support tag filtering, so this might return invalid results for current filter
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
    [refreshTrigger, selectedGraphTags, backendFetchAllowed] // Intentionally added to trigger re-creation when data changes
  )
  
  const onBeforeOpen = useCallback(async () => {
      // User clicked to open. Allow backend fetch if it was disabled.
      if (!backendFetchAllowed) {
          setBackendFetchAllowed(true);
          // Trigger refresh to ensure fetchData is called again with new allowed state
          setRefreshTrigger(prev => prev + 1);
      }
  }, [backendFetchAllowed]);

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
          onBeforeOpen={onBeforeOpen}
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