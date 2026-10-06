import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { assignAdminPath } from '@/lib/assignAdminPath'
import { inAppRouterPath } from '@/lib/inAppRouterPath'
import { launchAskUloFromSearch } from '@/lib/launchAskUloFromSearch'
import {
  ADMIN_SEARCH_INVALIDATE_EVENT,
  CATEGORY_META,
  SUGGESTED_ASK_ULO_PROMPTS,
  debounce,
  ensureAdminSearchIndex,
  getCachedAdminSearchItems,
  groupSearchResults,
  hydrateAdminSearchResultDetails,
  loadRecentSearches,
  looksLikeAskUloQuestion,
  pushRecentSearch,
  queryAdminSearchIndex,
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

type DropdownCoords = { top: number; left: number; width: number }

const OPTION_CLASS = [
  'flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors',
].join(' ')

function portalRoot(): HTMLElement {
  // Prefer body so z-index competes with other body-level overlays (tips, modals).
  return document.body
}

export function AdminUniversalSearch({ className }: AdminUniversalSearchProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchGenRef = useRef(0)
  const lastActivateAtRef = useRef(0)
  const flatRowsRef = useRef<FlatRow[]>([])
  const activateRowRef = useRef<(row: FlatRow) => void>(() => {})
  const landlordIdRef = useRef(getActiveLandlordId())
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [matched, setMatched] = useState<UniversalSearchItem[]>([])
  const [indexReady, setIndexReady] = useState(
    () => getCachedAdminSearchItems(getActiveLandlordId()) != null,
  )
  const [indexLoading, setIndexLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [recent, setRecent] = useState<RecentSearchItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [dropdownCoords, setDropdownCoords] = useState<DropdownCoords | null>(null)
  const landlordId = getActiveLandlordId()
  landlordIdRef.current = landlordId

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
    const onInvalidate = () => {
      setIndexReady(getCachedAdminSearchItems(landlordId) != null)
    }
    window.addEventListener(ADMIN_SEARCH_INVALIDATE_EVENT, onInvalidate)
    return () => window.removeEventListener(ADMIN_SEARCH_INVALIDATE_EVENT, onInvalidate)
  }, [landlordId])

  const updateDropdownPosition = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setDropdownCoords({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setDropdownCoords(null)
      return
    }
    updateDropdownPosition()
    window.addEventListener('resize', updateDropdownPosition)
    window.addEventListener('scroll', updateDropdownPosition, true)
    return () => {
      window.removeEventListener('resize', updateDropdownPosition)
      window.removeEventListener('scroll', updateDropdownPosition, true)
    }
  }, [open, updateDropdownPosition])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const warm = getCachedAdminSearchItems(landlordId) != null
    setIndexReady(warm)
    if (warm) {
      setIndexLoading(false)
      return
    }
    setIndexLoading(true)
    void ensureAdminSearchIndex(landlordId).then(() => {
      if (cancelled) return
      setIndexReady(true)
      setIndexLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, landlordId])

  useEffect(() => {
    const q = debouncedQuery.trim()
    if (!q) {
      setMatched([])
      setSearching(false)
      return
    }
    const gen = ++searchGenRef.current
    setSearching(true)
    void queryAdminSearchIndex(landlordId, q)
      .then(async ({ results }) => {
        if (gen !== searchGenRef.current) return
        setMatched(results)
        setSearching(false)
        setIndexReady(true)
        setIndexLoading(false)
        const hydrated = await hydrateAdminSearchResultDetails(landlordId, results)
        if (gen !== searchGenRef.current) return
        setMatched(hydrated)
      })
      .catch(() => {
        if (gen !== searchGenRef.current) return
        setSearching(false)
      })
  }, [debouncedQuery, landlordId])

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

  const launchAskUlo = useCallback(
    (prompt: string) => {
      const q = prompt.trim()
      if (!q) return
      pushRecentSearch(landlordIdRef.current, { title: q, kind: 'ask', query: q })
      setOpen(false)
      setQuery('')
      // Hard navigation — does not use React Router or AskUlo context.
      launchAskUloFromSearch(q, { docked: true })
    },
    [],
  )

  const openRecord = useCallback(
    (item: UniversalSearchItem) => {
      const href = inAppRouterPath((item.href || '').trim() || '/admin')
      pushRecentSearch(landlordId, {
        title: item.title,
        href,
        kind: 'record',
        query: item.title,
      })
      refreshRecent()
      setOpen(false)
      setQuery('')
      // Same hard navigation as the sidebar — SPA navigate/Link can go silent after HMR.
      assignAdminPath(href)
    },
    [landlordId, refreshRecent],
  )

  const activateRow = useCallback(
    (row: FlatRow) => {
      const now = Date.now()
      if (now - lastActivateAtRef.current < 400) return
      lastActivateAtRef.current = now

      if (row.kind === 'record') openRecord(row.item)
      else if (row.kind === 'ask' || row.kind === 'suggest') launchAskUlo(row.prompt)
      else if (row.kind === 'recent') {
        if (row.item.kind === 'ask') launchAskUlo(row.item.query)
        else if (row.item.href) {
          pushRecentSearch(landlordId, row.item)
          refreshRecent()
          setOpen(false)
          setQuery('')
          assignAdminPath(inAppRouterPath(row.item.href))
        } else {
          setQuery(row.item.query)
        }
      }
    },
    [launchAskUlo, landlordId, openRecord, refreshRecent],
  )

  activateRowRef.current = activateRow

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

  flatRowsRef.current = flatRows

  useEffect(() => {
    setActiveIndex(0)
  }, [debouncedQuery, open, flatRows.length])

  // Document capture — works even when the menu is portaled outside #root and
  // React synthetic clicks are dead. Prompt/href live on the DOM node.
  useEffect(() => {
    if (!open) return

    function onClick(e: MouseEvent) {
      if (e.button !== 0) return
      const target = e.target as Element | null
      const option = target?.closest?.(
        '[data-ulo-search-menu] [data-ulo-ask-prompt], [data-ulo-search-menu] [data-ulo-search-href], [data-ulo-search-menu] [data-search-activate]',
      ) as HTMLElement | null
      if (!option) return

      const askPrompt = option.getAttribute('data-ulo-ask-prompt')?.trim()
      if (askPrompt) {
        e.preventDefault()
        e.stopPropagation()
        pushRecentSearch(landlordIdRef.current, {
          title: askPrompt,
          kind: 'ask',
          query: askPrompt,
        })
        setOpen(false)
        setQuery('')
        launchAskUloFromSearch(askPrompt, { docked: true })
        return
      }

      const hrefAttr = option.getAttribute('data-ulo-search-href')?.trim()
      if (hrefAttr) {
        e.preventDefault()
        e.stopPropagation()
        const href = inAppRouterPath(hrefAttr)
        const title =
          option.getAttribute('data-ulo-search-title')?.trim() || href
        pushRecentSearch(landlordIdRef.current, {
          title,
          href,
          kind: 'record',
          query: title,
        })
        setOpen(false)
        setQuery('')
        assignAdminPath(href)
        return
      }

      const key = option.getAttribute('data-search-activate')
      if (!key) return
      const row = flatRowsRef.current.find((r) => r.key === key)
      if (!row) return
      e.preventDefault()
      e.stopPropagation()
      activateRowRef.current(row)
    }

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

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
    } else if (e.key === 'Enter') {
      const row = flatRows[activeIndex]
      if (row) {
        e.preventDefault()
        activateRow(row)
      }
    }
  }

  const showSearching = Boolean(trimmed) && (indexLoading || searching) && matched.length === 0

  const optionActiveClass = (active: boolean, askStyle: boolean) =>
    active
      ? askStyle
        ? 'bg-[#ecfdf5]'
        : 'bg-[#f3f4f6]'
      : askStyle
        ? 'hover:bg-[#f0fdf4]'
        : 'hover:bg-[#f9fafb]'

  const dropdown =
    open && dropdownCoords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            data-ulo-search-menu="1"
            className="fixed z-[300] max-h-[min(70vh,520px)] overflow-y-auto rounded-[16px] border border-[#e5e7eb] bg-white shadow-[0_16px_48px_rgba(16,24,40,0.14)]"
            style={{
              top: dropdownCoords.top,
              left: dropdownCoords.left,
              width: dropdownCoords.width,
            }}
          >
            {!trimmed ? (
              <div className="p-2">
                {recent.length > 0 ? (
                  <section className="mb-2">
                    <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
                      Recent
                    </p>
                    {recent.map((item, i) => {
                      const key = `recent-${i}-${item.query}`
                      const idx = flatRows.findIndex((r) => r.key === key)
                      const active = idx === activeIndex
                      const href =
                        item.kind === 'record' && item.href
                          ? inAppRouterPath(item.href)
                          : null
                      const content = (
                        <>
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
                        </>
                      )
                      const className = [
                        OPTION_CLASS,
                        optionActiveClass(active, item.kind === 'ask'),
                      ].join(' ')
                      if (href) {
                        return (
                          <a
                            key={key}
                            href={href}
                            role="option"
                            aria-selected={active}
                            data-search-activate={key}
                            data-ulo-search-href={href}
                            data-ulo-search-title={item.title}
                            onMouseEnter={() => setActiveIndex(idx >= 0 ? idx : 0)}
                            className={className}
                          >
                            {content}
                          </a>
                        )
                      }
                      return (
                        <button
                          key={key}
                          type="button"
                          role="option"
                          aria-selected={active}
                          data-search-activate={key}
                          data-ulo-ask-prompt={item.kind === 'ask' ? item.query : undefined}
                          onMouseEnter={() => setActiveIndex(idx >= 0 ? idx : 0)}
                          className={className}
                        >
                          {content}
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
                    return (
                      <button
                        key={key}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-search-activate={key}
                        data-ulo-ask-prompt={prompt}
                        onMouseEnter={() => setActiveIndex(idx >= 0 ? idx : 0)}
                        className={[OPTION_CLASS, optionActiveClass(active, true)].join(' ')}
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
                {showSearching ? (
                  <p className="px-3 py-4 text-[13px] text-[#6a7282]">Searching…</p>
                ) : null}

                {!showSearching && matched.length === 0 && !isQuestion ? (
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
                      const href = inAppRouterPath((item.href || '').trim() || '/admin')
                      return (
                        <a
                          key={item.id}
                          href={href}
                          role="option"
                          aria-selected={active}
                          data-search-activate={item.id}
                          data-ulo-search-href={href}
                          data-ulo-search-title={item.title}
                          onMouseEnter={() => setActiveIndex(idx >= 0 ? idx : 0)}
                          className={[OPTION_CLASS, optionActiveClass(active, false)].join(' ')}
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
                        </a>
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
                      return (
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          data-search-activate={askKey}
                          data-ulo-ask-prompt={trimmed}
                          onMouseEnter={() => setActiveIndex(idx >= 0 ? idx : 0)}
                          className={[
                            'flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors',
                            optionActiveClass(active, true),
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
          </div>,
          portalRoot(),
        )
      : null

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
          data-search-index-ready={indexReady ? '1' : '0'}
          className="h-9 w-full rounded-[8px] border border-transparent bg-[#f3f3f5] py-1 pl-10 pr-16 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] placeholder:text-[#717182] outline-none transition-[background-color,border-color,box-shadow] duration-150 hover:bg-[#ececef] focus:border-[#101828]/30 focus:bg-white focus:ring-2 focus:ring-[#101828]/15"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-[#e5e7eb] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#6a7282] sm:inline">
          ⌘K
        </kbd>
      </form>
      {dropdown}
    </div>
  )
}
