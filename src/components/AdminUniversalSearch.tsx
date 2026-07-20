import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useAskUlo } from '@/components/AskUloContext'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  CATEGORY_META,
  SUGGESTED_ASK_ULO_PROMPTS,
  debounce,
  groupSearchResults,
  loadAdminSearchIndex,
  loadRecentSearches,
  looksLikeAskUloQuestion,
  pushRecentSearch,
  searchAdminIndex,
  type RecentSearchItem,
  type UniversalSearchItem,
} from '@/lib/adminUniversalSearch'

function SearchIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
    </svg>
  )
}

function AskUloSparkleIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      viewBox="10 10 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.66667}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M18.2809 22.9167C18.2065 22.6283 18.0561 22.3651 17.8455 22.1545C17.6349 21.9439 17.3718 21.7936 17.0834 21.7192L11.9709 20.4008C11.8836 20.3761 11.8069 20.3236 11.7522 20.2512C11.6975 20.1789 11.668 20.0907 11.668 20C11.668 19.9093 11.6975 19.8211 11.7522 19.7488C11.8069 19.6765 11.8836 19.6239 11.9709 19.5992L17.0834 18.28C17.3717 18.2057 17.6348 18.0555 17.8454 17.845C18.056 17.6346 18.2063 17.3716 18.2809 17.0833L19.5992 11.9708C19.6237 11.8833 19.6762 11.8061 19.7486 11.7512C19.8211 11.6962 19.9095 11.6665 20.0004 11.6665C20.0914 11.6665 20.1798 11.6962 20.2523 11.7512C20.3247 11.8061 20.3772 11.8833 20.4017 11.9708L21.7192 17.0833C21.7936 17.3717 21.9439 17.6349 22.1545 17.8455C22.3651 18.0561 22.6283 18.2064 22.9167 18.2808L28.0292 19.5983C28.1171 19.6226 28.1946 19.675 28.2499 19.7476C28.3052 19.8201 28.3351 19.9088 28.3351 20C28.3351 20.0912 28.3052 20.1799 28.2499 20.2524C28.1946 20.325 28.1171 20.3774 28.0292 20.4017L22.9167 21.7192C22.6283 21.7936 22.3651 21.9439 22.1545 22.1545C21.9439 22.3651 21.7936 22.6283 21.7192 22.9167L20.4009 28.0292C20.3764 28.1167 20.3239 28.1939 20.2514 28.2489C20.179 28.3038 20.0905 28.3336 19.9996 28.3336C19.9087 28.3336 19.8202 28.3038 19.7478 28.2489C19.6754 28.1939 19.6229 28.1167 19.5984 28.0292L18.2809 22.9167Z" />
      <path d="M26.6666 12.5V15.8333" />
      <path d="M28.3333 14.1667H25" />
      <path d="M13.3334 24.1667V25.8333" />
      <path d="M14.1667 25H12.5" />
    </svg>
  )
}

type FlatRow =
  | { kind: 'record'; item: UniversalSearchItem; key: string }
  | { kind: 'ask'; prompt: string; key: string }
  | { kind: 'recent'; item: RecentSearchItem; key: string }
  | { kind: 'suggest'; prompt: string; key: string }

type AdminUniversalSearchProps = {
  className?: string
}

export function AdminUniversalSearch({ className }: AdminUniversalSearchProps) {
  const navigate = useNavigate()
  const { openAskUloWithPrompt } = useAskUlo()
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [index, setIndex] = useState<UniversalSearchItem[]>([])
  const [indexLoading, setIndexLoading] = useState(false)
  const [recent, setRecent] = useState<RecentSearchItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const landlordId = getActiveLandlordId()

  const applyDebounce = useMemo(
    () =>
      debounce((value: string) => {
        setDebouncedQuery(value)
      }, 140),
    [],
  )

  useEffect(() => {
    applyDebounce(query)
  }, [query, applyDebounce])

  const refreshRecent = useCallback(() => {
    setRecent(loadRecentSearches(landlordId))
  }, [landlordId])

  useEffect(() => {
    refreshRecent()
  }, [refreshRecent])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setIndexLoading(true)
    void (async () => {
      const items = await loadAdminSearchIndex(landlordId)
      if (cancelled) return
      setIndex(items)
      setIndexLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, landlordId])

  useEffect(() => {
    function onGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        window.requestAnimationFrame(() => inputRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const matched = useMemo(
    () => (debouncedQuery.trim() ? searchAdminIndex(index, debouncedQuery) : []),
    [index, debouncedQuery],
  )
  const grouped = useMemo(() => groupSearchResults(matched), [matched])
  const isQuestion = looksLikeAskUloQuestion(query)
  const trimmed = query.trim()

  const flatRows: FlatRow[] = useMemo(() => {
    if (!trimmed) {
      const rows: FlatRow[] = []
      for (const [i, item] of recent.entries()) {
        rows.push({ kind: 'recent', item, key: `recent-${i}-${item.query}` })
      }
      for (const [i, prompt] of SUGGESTED_ASK_ULO_PROMPTS.entries()) {
        rows.push({ kind: 'suggest', prompt, key: `suggest-${i}` })
      }
      return rows
    }
    const rows: FlatRow[] = matched.map((item) => ({
      kind: 'record' as const,
      item,
      key: item.id,
    }))
    if (isQuestion || matched.length === 0) {
      rows.push({
        kind: 'ask',
        prompt: trimmed,
        key: `ask-${trimmed}`,
      })
    }
    return rows
  }, [trimmed, recent, matched, isQuestion])

  useEffect(() => {
    setActiveIndex(0)
  }, [debouncedQuery, open, flatRows.length])

  const launchAskUlo = useCallback(
    (prompt: string) => {
      const q = prompt.trim()
      if (!q) return
      pushRecentSearch(landlordId, { title: q, kind: 'ask', query: q })
      refreshRecent()
      setOpen(false)
      setQuery('')
      openAskUloWithPrompt(q, { docked: true })
    },
    [landlordId, openAskUloWithPrompt, refreshRecent],
  )

  const openRecord = useCallback(
    (item: UniversalSearchItem) => {
      pushRecentSearch(landlordId, {
        title: item.title,
        href: item.href,
        kind: 'record',
        query: item.title,
      })
      refreshRecent()
      setOpen(false)
      setQuery('')
      navigate(item.href)
    },
    [landlordId, navigate, refreshRecent],
  )

  const activateRow = useCallback(
    (row: FlatRow) => {
      if (row.kind === 'record') openRecord(row.item)
      else if (row.kind === 'ask' || row.kind === 'suggest') launchAskUlo(row.prompt)
      else if (row.kind === 'recent') {
        if (row.item.kind === 'ask') launchAskUlo(row.item.query)
        else if (row.item.href) {
          pushRecentSearch(landlordId, row.item)
          refreshRecent()
          setOpen(false)
          setQuery('')
          navigate(row.item.href)
        } else {
          setQuery(row.item.query)
        }
      }
    },
    [launchAskUlo, landlordId, navigate, openRecord, refreshRecent],
  )

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const row = flatRows[activeIndex]
    if (row) {
      activateRow(row)
      return
    }
    if (looksLikeAskUloQuestion(trimmed) || (trimmed && matched.length === 0)) {
      launchAskUlo(trimmed)
      return
    }
    if (matched[0]) openRecord(matched[0])
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(flatRows.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    }
  }

  /** Activate on mousedown so the first press runs (blur/focus races often swallow click). */
  function rowPointerActivate(e: React.MouseEvent, row: FlatRow) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    activateRow(row)
  }

  return (
    <div ref={rootRef} className={['relative min-w-0 flex-1 max-w-[800px]', className].filter(Boolean).join(' ')}>
      <form role="search" onSubmit={onSubmit}>
        <span className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-[#717182]">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search properties, vendors, residents, work orders... or ask Ulo"
          aria-label="Universal search and Ask Ulo"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          className="h-9 w-full rounded-[8px] border border-transparent bg-[#f3f3f5] py-1 pl-10 pr-16 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] placeholder:text-[#717182] outline-none transition-[background-color,border-color,box-shadow] duration-150 hover:bg-[#ececef] focus:border-[#101828]/30 focus:bg-white focus:ring-2 focus:ring-[#101828]/15"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-[#e5e7eb] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#6a7282] sm:inline">
          ⌘K
        </kbd>
      </form>

      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[min(70vh,520px)] overflow-y-auto rounded-[16px] border border-[#e5e7eb] bg-white shadow-[0_16px_48px_rgba(16,24,40,0.14)]"
        >
          {!trimmed ? (
            <div className="p-2">
              {recent.length > 0 ? (
                <section className="mb-2">
                  <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
                    Recent
                  </p>
                  {recent.map((item, i) => {
                    const idx = flatRows.findIndex((r) => r.key === `recent-${i}-${item.query}`)
                    const active = idx === activeIndex
                    const row: FlatRow = {
                      kind: 'recent',
                      item,
                      key: `recent-${i}-${item.query}`,
                    }
                    return (
                      <button
                        key={row.key}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onMouseDown={(e) => rowPointerActivate(e, row)}
                        className={[
                          'flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors',
                          active ? 'bg-[#f0fdf4]' : 'hover:bg-[#f9fafb]',
                        ].join(' ')}
                      >
                        <span className="text-[16px]" aria-hidden>
                          {item.kind === 'ask' ? '💬' : '🕒'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-[#0a0a0a]">
                            {item.title}
                          </span>
                          <span className="block truncate text-[12px] text-[#6a7282]">
                            {item.kind === 'ask' ? 'Ask Ulo' : 'Record'}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </section>
              ) : null}

              <section>
                <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
                  Suggested questions
                </p>
                {SUGGESTED_ASK_ULO_PROMPTS.map((prompt, i) => {
                  const key = `suggest-${i}`
                  const idx = flatRows.findIndex((r) => r.key === key)
                  const active = idx === activeIndex
                  const row: FlatRow = { kind: 'suggest', prompt, key }
                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onMouseDown={(e) => rowPointerActivate(e, row)}
                      className={[
                        'flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors',
                        active ? 'bg-[#ecfdf5]' : 'hover:bg-[#f0fdf4]/80',
                      ].join(' ')}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#B4DFD6]/50 text-[#0A4D38]">
                        <AskUloSparkleIcon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[14px] text-[#0a0a0a]">
                        {prompt}
                      </span>
                    </button>
                  )
                })}
              </section>
            </div>
          ) : (
            <div className="p-2">
              {indexLoading && matched.length === 0 ? (
                <p className="px-3 py-4 text-[13px] text-[#6a7282]">Searching…</p>
              ) : null}

              {!indexLoading && matched.length === 0 && !isQuestion ? (
                <p className="px-3 py-3 text-[13px] text-[#6a7282]">No matching records found.</p>
              ) : null}

              {grouped.map((group) => (
                <section key={group.category} className="mb-1">
                  <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
                    {group.label}
                  </p>
                  {group.items.map((item) => {
                    const idx = flatRows.findIndex((r) => r.key === item.id)
                    const active = idx === activeIndex
                    const meta = CATEGORY_META[item.category]
                    const row: FlatRow = { kind: 'record', item, key: item.id }
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onMouseDown={(e) => rowPointerActivate(e, row)}
                        className={[
                          'flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors',
                          active ? 'bg-[#f3f4f6]' : 'hover:bg-[#f9fafb]',
                        ].join(' ')}
                      >
                        <span className="text-[16px]" aria-hidden>
                          {meta.symbol}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-[#0a0a0a]">
                            {item.title}
                          </span>
                          {item.subtitle ? (
                            <span className="block truncate text-[12px] text-[#6a7282]">
                              {item.subtitle}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    )
                  })}
                </section>
              ))}

              {isQuestion || matched.length === 0 ? (
                <section className="mt-1 border-t border-[#e5e7eb] pt-1">
                  <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#0A4D38]">
                    Ask Ulo
                  </p>
                  {(() => {
                    const askKey = `ask-${trimmed}`
                    const idx = flatRows.findIndex((r) => r.key === askKey)
                    const active = idx === activeIndex
                    const row: FlatRow = { kind: 'ask', prompt: trimmed, key: askKey }
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onMouseDown={(e) => rowPointerActivate(e, row)}
                        className={[
                          'flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors',
                          active ? 'bg-[#ecfdf5]' : 'hover:bg-[#f0fdf4]',
                        ].join(' ')}
                      >
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#B4DFD6]/60 text-[#0A4D38]">
                          <AskUloSparkleIcon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-[#0A4D38]">
                            Ask Ulo
                          </span>
                          <span className="mt-0.5 block text-[14px] leading-5 text-[#0a0a0a]">
                            {matched.length === 0 && !isQuestion
                              ? `Search didn't find a record. Would you like Ask Ulo to answer “${trimmed}” instead?`
                              : `“${trimmed}”`}
                          </span>
                        </span>
                      </button>
                    )
                  })()}
                </section>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
