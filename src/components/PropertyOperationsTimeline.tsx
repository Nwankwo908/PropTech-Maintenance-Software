import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchPropertyOperationsTimeline,
  formatTimelineCategoryLabel,
  formatTimelineContextLine,
  formatWorkflowTimestamp,
  PROPERTY_OPERATIONS_TIMELINE_CATEGORIES,
  type PropertyOperationsTimelineCategory,
  type PropertyOperationsTimelineEvent,
  type PropertyOperationsTimelineScope,
} from '@/lib/propertyOperationsGraph'
import { supabase } from '@/lib/supabase'

const CATEGORY_STYLES: Record<PropertyOperationsTimelineCategory, string> = {
  maintenance: 'bg-[#e8f4ff] text-[#0030b5]',
  rent: 'bg-[#fff8e6] text-[#92600a]',
  move_in: 'bg-[#e8f4ff] text-[#0030b5]',
  move_out: 'bg-[#fff1e8] text-[#b52a00]',
  inspection: 'bg-[#f3eeff] text-[#4a2d8a]',
  vendor: 'bg-[#ecfdf3] text-[#047857]',
  admin: 'bg-secondary text-neutral-variant',
}

const SOURCE_LABELS: Record<string, string> = {
  sms: 'SMS',
  dashboard: 'Dashboard',
  vendor_portal: 'Vendor portal',
  edge_function: 'Automation',
  automation: 'Automation',
}

type PropertyOperationsTimelineProps = {
  scope: PropertyOperationsTimelineScope | null
  landlordId?: string | null
  limit?: number
  title?: string
  emptyMessage?: string
  showCategoryFilters?: boolean
  className?: string
}

function hasScope(scope: PropertyOperationsTimelineScope | null): scope is PropertyOperationsTimelineScope {
  if (!scope) return false
  const unitId = 'unitId' in scope ? scope.unitId?.trim() : undefined
  const residentId = scope.residentId?.trim()
  return Boolean(unitId || residentId)
}

export function PropertyOperationsTimeline({
  scope,
  landlordId,
  limit = 100,
  title = 'Connected history',
  emptyMessage = 'No property operations events recorded yet.',
  showCategoryFilters = true,
  className = '',
}: PropertyOperationsTimelineProps) {
  const [events, setEvents] = useState<PropertyOperationsTimelineEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<
    PropertyOperationsTimelineCategory | 'all'
  >('all')

  const load = useCallback(async () => {
    if (!hasScope(scope)) {
      setEvents([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const rows = await fetchPropertyOperationsTimeline({
        scope,
        landlordId,
        limit,
      })
      setEvents(rows)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [scope, landlordId, limit])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!supabase || !hasScope(scope)) return

    const scopeKey = `${
      'unitId' in scope && scope.unitId ? scope.unitId : 'none'
    }:${scope.residentId ?? 'none'}`

    const channel = supabase
      .channel(`property-ops-timeline-${scopeKey}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'property_operations_graph' },
        () => {
          void load()
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'operations_graph_events' },
        () => {
          void load()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load, scope])

  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(
      PROPERTY_OPERATIONS_TIMELINE_CATEGORIES.map((category) => [category, 0]),
    ) as Record<PropertyOperationsTimelineCategory, number>

    for (const event of events) {
      counts[event.category] += 1
    }

    return counts
  }, [events])

  const filteredEvents = useMemo(() => {
    if (activeCategory === 'all') return events
    return events.filter((event) => event.category === activeCategory)
  }, [activeCategory, events])

  if (!hasScope(scope)) {
    return (
      <div className={['rounded-[10px] border border-secondary bg-[#fafafa] px-4 py-6', className].join(' ')}>
        <p className="text-[13px] text-neutral">Select a unit or resident to view connected history.</p>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-[14px] font-semibold text-extended-3">{title}</h3>
          <p className="mt-1 text-[12px] text-neutral">
            Maintenance, rent, move-in/out, inspections, vendor activity, and admin actions from the
            property operations graph.
          </p>
        </div>
        {!loading ? (
          <p className="shrink-0 text-[12px] tabular-nums text-neutral">
            {events.length} event{events.length === 1 ? '' : 's'}
          </p>
        ) : null}
      </div>

      {showCategoryFilters ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            className={[
              'inline-flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
              activeCategory === 'all'
                ? 'bg-primary text-white'
                : 'bg-secondary text-neutral-variant hover:bg-[#ececec]',
            ].join(' ')}
          >
            All
            <span className="tabular-nums opacity-80">{events.length}</span>
          </button>
          {PROPERTY_OPERATIONS_TIMELINE_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              disabled={categoryCounts[category] === 0}
              className={[
                'inline-flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                activeCategory === category
                  ? CATEGORY_STYLES[category]
                  : 'bg-secondary text-neutral-variant hover:bg-[#ececec]',
              ].join(' ')}
            >
              {formatTimelineCategoryLabel(category)}
              <span className="tabular-nums opacity-80">{categoryCounts[category]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b52a00]">
          {error}
        </div>
      ) : null}

      {loading && !events.length ? (
        <p className="py-8 text-center text-[13px] text-neutral">Loading connected history…</p>
      ) : null}

      {!loading && !filteredEvents.length ? (
        <p className="py-8 text-center text-[13px] text-neutral">{emptyMessage}</p>
      ) : null}

      {filteredEvents.length ? (
        <ol className="relative space-y-0 border-l border-secondary pl-4">
          {filteredEvents.map((event, index) => {
            const context = formatTimelineContextLine(event)
            const sourceLabel = SOURCE_LABELS[event.eventSource] ?? event.eventSource

            return (
              <li key={event.id} className="relative pb-5 last:pb-0">
                <span
                  className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-primary"
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={[
                        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                        CATEGORY_STYLES[event.category],
                      ].join(' ')}
                    >
                      {formatTimelineCategoryLabel(event.category)}
                    </span>
                    <span className="text-[11px] uppercase tracking-[0.04em] text-neutral">
                      {sourceLabel}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <p className="text-[13px] font-medium text-extended-3">{event.label}</p>
                    <p className="text-[12px] text-neutral">
                      {formatWorkflowTimestamp(event.createdAt)}
                    </p>
                  </div>

                  {event.message ? (
                    <p className="mt-1 text-[12px] leading-4 text-neutral">{event.message}</p>
                  ) : null}

                  {context ? (
                    <p className="mt-1 text-[12px] text-neutral">{context}</p>
                  ) : null}

                  {event.maintenanceRequestId ? (
                    <p className="mt-1 font-mono text-[11px] text-neutral">
                      Ticket {event.maintenanceRequestId.slice(0, 8)}…
                    </p>
                  ) : null}

                  {index === 0 ? (
                    <p className="mt-1 text-[11px] uppercase tracking-[0.04em] text-neutral">
                      Latest
                    </p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}
