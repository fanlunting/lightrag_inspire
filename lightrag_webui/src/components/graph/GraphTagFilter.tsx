import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/Command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { getGraphTags } from '@/api/lightrag'

type Props = {
  value: string[]
  onChange: (tags: string[]) => void
  className?: string
}

const normalizeTags = (tags: string[]) =>
  Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean))).sort()

const GraphTagFilter = ({ value, onChange, className }: Props) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchTerm = useDebounce(searchTerm, 200)
  const selected = useMemo(() => normalizeTags(value), [value])

  const fetchOptions = useCallback(async (query?: string) => {
    setLoading(true)
    try {
      const tags = await getGraphTags(query || '', 300)
      // keep stable ordering; backend already sorts, but enforce uniqueness
      setOptions(Array.from(new Set(tags)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    fetchOptions(debouncedSearchTerm)
  }, [open, debouncedSearchTerm, fetchOptions])

  const toggleTag = useCallback(
    (tag: string) => {
      const next = selected.includes(tag)
        ? selected.filter((t) => t !== tag)
        : normalizeTags([...selected, tag])
      onChange(next)
    },
    [onChange, selected]
  )

  const clearAll = useCallback(() => {
    onChange([])
  }, [onChange])

  const buttonLabel = useMemo(() => {
    if (selected.length === 0) return t('graphPanel.graphTagFilter.placeholder')
    return t('graphPanel.graphTagFilter.selectedCount', { count: selected.length })
  }, [selected.length, t])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={t('graphPanel.graphTagFilter.label')}
          className={cn(
            'bg-background/60 w-[220px] justify-between rounded-xl border-1 opacity-60 backdrop-blur-lg transition-all hover:opacity-100',
            className
          )}
          tooltip={t('graphPanel.graphTagFilter.tooltip')}
          side="bottom"
        >
          <div className="min-w-0 flex-1 truncate text-left">{buttonLabel}</div>
          <div className="ml-2 flex items-center gap-1">
            {selected.length > 0 && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                aria-label={t('graphPanel.graphTagFilter.clear')}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  clearAll()
                }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
            <ChevronsUpDown className="opacity-50" size={10} />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('p-0 w-[260px]', className)}
        onCloseAutoFocus={(e) => e.preventDefault()}
        align="start"
        sideOffset={8}
        collisionPadding={5}
      >
        <Command shouldFilter={false}>
          <div className="relative w-full border-b">
            <CommandInput
              placeholder={t('graphPanel.graphTagFilter.searchPlaceholder')}
              value={searchTerm}
              onValueChange={(v) => setSearchTerm(v)}
            />
            {loading && (
              <div className="absolute top-1/2 right-2 flex -translate-y-1/2 transform items-center">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
          </div>
          <CommandList>
            {!loading && options.length === 0 && (
              <CommandEmpty>{t('graphPanel.graphTagFilter.noResults')}</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((tag) => {
                const isSelected = selected.includes(tag)
                // cmdk filtering workaround: empty value shows all when searchTerm empty
                const itemValue = searchTerm.trim() === '' ? '' : tag
                return (
                  <CommandItem
                    key={tag}
                    value={itemValue}
                    onSelect={() => toggleTag(tag)}
                    className="truncate"
                  >
                    <div className="min-w-0 flex-1 truncate" title={tag}>
                      {tag}
                    </div>
                    <Check className={cn('ml-auto h-3 w-3', isSelected ? 'opacity-100' : 'opacity-0')} />
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default GraphTagFilter