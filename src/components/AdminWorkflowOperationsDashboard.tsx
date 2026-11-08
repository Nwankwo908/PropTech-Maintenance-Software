import {
  Component,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import needsYourAttentionIcon from '@/assets/landing/Needs your attention.svg'
import waitingOnOthersIcon from '@/assets/landing/Waiting on others.svg'
import scheduledTodayIcon from '@/assets/calendar.png'
import overdueIcon from '@/assets/landing/Overdue.svg'
import magnifyingGlassIcon from '@/assets/Magnifying glass.svg'
import {
  startLifecycleWorkflow,
  loadResidentsForUnit,
  loadUnitsForWorkflowPicker,
  type InspectionType,
  type LifecycleWorkflowType,
  type ResidentOption,
  type UnitOption,
} from '@/api/lifecycleWorkflow'
import {
  fetchAdminWorkflowDashboard,
  isCancelledOnActiveTasks,
  type AdminWorkflowDashboardData,
  type AdminWorkflowRow,
} from '@/lib/adminWorkflows'
import {
  WORKFLOW_CATEGORY_BADGE,
  WORKFLOW_PIPELINE_PAGE_SUBTITLE,
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  type WorkflowKanbanCard,
  type WorkflowKanbanCategory,
} from '@/lib/adminWorkflowKanban'
import {
  computeActiveTasksKpis,
  type ActiveTasksKpiBucket,
} from '@/lib/activeTasksKpis'
import { fetchWorkflowPipelineDetail, type WorkflowPipelineDetail } from '@/lib/workflowPipelineDetail'
import { WorkflowPipelineDetailPanel } from '@/components/WorkflowPipelineDetailPanel'
import { WorkflowKanbanBoard } from '@/components/workflowKanban/WorkflowKanbanBoard'
import {
  insightWorkOrderHref,
  lookupWorkflowRunIdForTicket,
  pickWorkflowRunIdForTicket,
} from '@/lib/insightWorkOrderDestination'
import {
  mutateSearchParams,
  writeStringParam,
} from '@/lib/adminListUrlState'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errorMessage'

type KanbanCard = WorkflowKanbanCard

type ActiveTasksMetricFilter = ActiveTasksKpiBucket

const UNASSIGNED_ASSIGNEE = '__unassigned__'

const ACTIVE_TASKS_METRIC_KEYS = new Set<ActiveTasksMetricFilter>([
  'needs_attention',
  'waiting_on_others',
  'scheduled_today',
  'overdue',
])

const ACTIVE_TASKS_METRIC_LABELS: Record<ActiveTasksMetricFilter, string> = {
  needs_attention: 'Needs your attention',
  waiting_on_others: 'Waiting on others',
  scheduled_today: 'Scheduled today',
  overdue: 'Overdue',
}

const TASK_TYPE_OPTIONS: { value: WorkflowKanbanCategory; label: string }[] = (
  Object.keys(WORKFLOW_CATEGORY_BADGE) as WorkflowKanbanCategory[]
).map((id) => ({
  value: id,
  label: WORKFLOW_CATEGORY_BADGE[id].label,
}))

const URGENCY_OPTIONS: { value: string; label: string }[] = [
  { value: 'emergency', label: 'Emergency' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

function parseActiveTasksMetricFilter(raw: string | null | undefined): ActiveTasksMetricFilter | null {
  const value = raw?.trim()
  if (value && ACTIVE_TASKS_METRIC_KEYS.has(value as ActiveTasksMetricFilter)) {
    return value as ActiveTasksMetricFilter
  }
  return null
}

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="sa-surface peer h-9 min-w-[140px] cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] shadow-none outline-none hover:border-black/10 hover:bg-[#e8eaee] focus:border-[#0030b5]/45 focus:bg-white focus:ring-2 focus:ring-[#0030b5]/30"
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  )
}

function KpiCard({
  label,
  value,
  title,
  icon,
  selected = false,
  onSelect,
}: {
  label: string
  value: string
  title?: string
  icon?: string
  selected?: boolean
  onSelect?: () => void
}) {
  const className = [
    'sa-enter-scale flex min-w-0 items-center gap-2 rounded-[10px] border px-3 py-3 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] sm:gap-3 sm:px-5 sm:py-4',
    onSelect
      ? 'cursor-pointer outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#101828]/20'
      : '',
    selected ? 'border-[#186179] bg-[#f9fafb]' : 'border-[#e5e7eb] bg-white',
    onSelect && !selected ? 'hover:bg-[#f9fafb]' : '',
  ].join(' ')
  const body = (
    <>
      {icon ? (
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[#f3f4f6]"
          aria-hidden
        >
          <img src={icon} alt="" className="size-[1.15rem] object-contain" />
        </span>
      ) : null}
      <p className="min-w-0 truncate whitespace-nowrap text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
        {label}
      </p>
      <p className="shrink-0 whitespace-nowrap text-[22px] font-medium leading-none tracking-[0.4px] text-[#0a0a0a] tabular-nums sm:text-[28px]">
        {value}
      </p>
      {onSelect ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="ml-auto size-4 shrink-0 text-[#6a7282]"
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </>
  )
  if (!onSelect) {
    return (
      <div className={className} title={title}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={className}
      title={title}
    >
      {body}
    </button>
  )
}

function KpiCardSkeleton() {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-3 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] sm:gap-3 sm:px-5 sm:py-4">
      <div className="size-8 shrink-0 animate-pulse rounded-[8px] bg-[#f3f4f6]" />
      <div className="h-4 w-28 animate-pulse rounded bg-[#f3f4f6]" />
      <div className="h-7 w-10 animate-pulse rounded bg-[#f3f4f6]" />
      <div className="ml-auto size-4 shrink-0 animate-pulse rounded bg-[#f3f4f6]" />
    </div>
  )
}

function ActiveTasksMetricFilterChip({
  filter,
  onClear,
}: {
  filter: ActiveTasksMetricFilter
  onClear: () => void
}) {
  const label = ACTIVE_TASKS_METRIC_LABELS[filter]
  return (
    <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-[#e5e7eb] bg-[#f3f4f6] pl-3 pr-1 text-[12px] font-medium text-[#364153]">
      {label}
      <button
        type="button"
        aria-label={`Remove ${label} filter`}
        onClick={onClear}
        className="inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-[#6a7282] outline-none hover:bg-[#e5e7eb] hover:text-[#101828] focus-visible:ring-2 focus-visible:ring-[#186179]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  )
}

function cardMatchesSearch(card: KanbanCard, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    card.title,
    card.context,
    card.workOrderRef,
    card.workOrderSummary,
    card.issueCategoryLabel,
    card.assignedVendorName,
    card.propertyLabel,
    card.category,
    card.urgency,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

function cardPropertyKey(card: KanbanCard): string {
  return card.propertyId?.trim() || card.propertyLabel?.trim() || ''
}

function cardMatchesDimensionFilters(
  card: KanbanCard,
  filters: {
    property: string
    taskType: string
    urgency: string
    assignee: string
  },
): boolean {
  if (filters.property) {
    const key = cardPropertyKey(card)
    if (!key || key !== filters.property) return false
  }
  if (filters.taskType && card.category !== filters.taskType) return false
  if (filters.urgency) {
    const urgency = card.urgency?.trim().toLowerCase() || ''
    if (urgency !== filters.urgency) return false
  }
  if (filters.assignee) {
    const vendorId = card.assignedVendorId?.trim() || ''
    if (filters.assignee === UNASSIGNED_ASSIGNEE) {
      if (vendorId) return false
    } else if (vendorId !== filters.assignee) {
      return false
    }
  }
  return true
}

function StartLifecycleWorkflowModal({
  open,
  workflow,
  onClose,
  onStarted,
}: {
  open: boolean
  workflow: LifecycleWorkflowType
  onClose: () => void
  onStarted: (workflowRunId: string) => void
}) {
  const unitSelectId = useId()
  const residentSelectId = useId()
  const dateInputId = useId()
  const inspectionTypeId = useId()

  const [units, setUnits] = useState<UnitOption[]>([])
  const [residents, setResidents] = useState<ResidentOption[]>([])
  const [unitId, setUnitId] = useState('')
  const [residentId, setResidentId] = useState('')
  const [moveInDate, setMoveInDate] = useState('')
  const [moveOutDate, setMoveOutDate] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [inspectionType, setInspectionType] = useState<InspectionType>('periodic')
  const [loadingUnits, setLoadingUnits] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const titles: Record<LifecycleWorkflowType, string> = {
    move_in: 'Start move-in workflow',
    move_out: 'Start move-out workflow',
    inspection: 'Start inspection workflow',
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    setUnitId('')
    setResidentId('')
    setMoveInDate('')
    setMoveOutDate('')
    setScheduledAt('')
    setInspectionType('periodic')
    setLoadingUnits(true)
    void loadUnitsForWorkflowPicker()
      .then(setUnits)
      .finally(() => setLoadingUnits(false))
  }, [open, workflow])

  useEffect(() => {
    if (!unitId) {
      setResidents([])
      setResidentId('')
      return
    }
    void loadResidentsForUnit(unitId).then((list) => {
      setResidents(list)
      setResidentId(list.length === 1 ? list[0].id : '')
    })
  }, [unitId])

  if (!open) return null

  const selectedUnit = units.find((unit) => unit.id === unitId)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!unitId) {
      setError('Select a unit.')
      return
    }

    setSubmitting(true)
    setError(null)

    const result = await startLifecycleWorkflow({
      workflow,
      unitId,
      residentId: residentId || undefined,
      unitLabel: selectedUnit?.unit_label,
      building: selectedUnit?.building,
      moveInDate: workflow === 'move_in' ? moveInDate || undefined : undefined,
      moveOutDate: workflow === 'move_out' ? moveOutDate || undefined : undefined,
      scheduledAt: workflow === 'inspection' ? scheduledAt || undefined : undefined,
      inspectionType: workflow === 'inspection' ? inspectionType : undefined,
    })

    setSubmitting(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    onStarted(result.workflow_run_id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="sa-modal w-full max-w-md rounded-[10px] border border-secondary bg-white shadow-lg"
      >
        <div className="border-b border-secondary px-6 py-4">
          <h2 className="text-[16px] font-semibold text-extended-3">{titles[workflow]}</h2>
          <p className="mt-1 text-[13px] text-neutral">
            Creates a workflow run and logs the first graph event.
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-6 py-5">
          {error ? (
            <div className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b52a00]">
              {error}
            </div>
          ) : null}

          <div>
            <label htmlFor={unitSelectId} className="mb-1 block text-[13px] font-medium text-extended-3">
              Unit
            </label>
            <select
              id={unitSelectId}
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              disabled={loadingUnits || submitting}
              className="sa-surface h-10 w-full rounded-lg border border-secondary bg-white px-3 text-[14px] text-extended-3 outline-none focus:border-primary"
            >
              <option value="">{loadingUnits ? 'Loading units…' : 'Select unit'}</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.unit_label}
                  {unit.building ? ` · ${unit.building}` : ''} ({unit.status})
                </option>
              ))}
            </select>
          </div>

          {residents.length ? (
            <div>
              <label
                htmlFor={residentSelectId}
                className="mb-1 block text-[13px] font-medium text-extended-3"
              >
                Resident (optional)
              </label>
              <select
                id={residentSelectId}
                value={residentId}
                onChange={(e) => setResidentId(e.target.value)}
                disabled={submitting}
                className="h-10 w-full rounded-lg border border-secondary bg-white px-3 text-[14px] text-extended-3 outline-none focus:border-primary"
              >
                <option value="">No resident selected</option>
                {residents.map((resident) => (
                  <option key={resident.id} value={resident.id}>
                    {resident.full_name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {workflow === 'move_in' ? (
            <div>
              <label htmlFor={dateInputId} className="mb-1 block text-[13px] font-medium text-extended-3">
                Move-in date (optional)
              </label>
              <input
                id={dateInputId}
                type="date"
                value={moveInDate}
                onChange={(e) => setMoveInDate(e.target.value)}
                disabled={submitting}
                className="h-10 w-full rounded-lg border border-secondary px-3 text-[14px] outline-none focus:border-primary"
              />
            </div>
          ) : null}

          {workflow === 'move_out' ? (
            <div>
              <label htmlFor={dateInputId} className="mb-1 block text-[13px] font-medium text-extended-3">
                Vacate date (optional)
              </label>
              <input
                id={dateInputId}
                type="date"
                value={moveOutDate}
                onChange={(e) => setMoveOutDate(e.target.value)}
                disabled={submitting}
                className="h-10 w-full rounded-lg border border-secondary px-3 text-[14px] outline-none focus:border-primary"
              />
            </div>
          ) : null}

          {workflow === 'inspection' ? (
            <>
              <div>
                <label
                  htmlFor={inspectionTypeId}
                  className="mb-1 block text-[13px] font-medium text-extended-3"
                >
                  Inspection type
                </label>
                <select
                  id={inspectionTypeId}
                  value={inspectionType}
                  onChange={(e) => setInspectionType(e.target.value as InspectionType)}
                  disabled={submitting}
                  className="h-10 w-full rounded-lg border border-secondary bg-white px-3 text-[14px] outline-none focus:border-primary"
                >
                  <option value="move_in">Move-in</option>
                  <option value="move_out">Move-out</option>
                  <option value="periodic">Periodic</option>
                  <option value="annual">Annual</option>
                  <option value="common_area">Common area</option>
                </select>
              </div>
              <div>
                <label htmlFor={dateInputId} className="mb-1 block text-[13px] font-medium text-extended-3">
                  Scheduled at (optional)
                </label>
                <input
                  id={dateInputId}
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  disabled={submitting}
                  className="h-10 w-full rounded-lg border border-secondary px-3 text-[14px] outline-none focus:border-primary"
                />
              </div>
            </>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="sa-press inline-flex h-9 cursor-pointer items-center rounded-[10px] border border-secondary px-4 text-[14px] font-medium text-extended-3 hover:bg-secondary disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !unitId}
              className="sa-press inline-flex h-9 cursor-pointer items-center rounded-[10px] bg-primary px-4 text-[14px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Starting…' : 'Start workflow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function StartWorkflowChooser({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (workflow: LifecycleWorkflowType) => void
}) {
  if (!open) return null
  const options: { id: LifecycleWorkflowType; label: string; desc: string }[] = [
    { id: 'move_in', label: 'Move in', desc: 'Onboard a new resident into a unit.' },
    { id: 'move_out', label: 'Move out', desc: 'Vacate and turn over a unit.' },
    { id: 'inspection', label: 'Inspection', desc: 'Schedule a unit or common-area inspection.' },
  ]
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="sa-modal w-full max-w-sm rounded-[10px] border border-secondary bg-white p-2 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3">
          <h2 className="text-[15px] font-semibold text-extended-3">Start a workflow</h2>
          <p className="mt-0.5 text-[12px] text-neutral">Choose a lifecycle workflow to launch.</p>
        </div>
        <div className="flex flex-col gap-1 p-2">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onPick(opt.id)}
              className="sa-card flex cursor-pointer flex-col rounded-[10px] border border-secondary px-3 py-2.5 text-left hover:bg-secondary"
            >
              <span className="text-[14px] font-medium text-extended-3">{opt.label}</span>
              <span className="text-[12px] text-neutral">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

class WorkflowKanbanBoardErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Active Tasks] kanban crashed', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] text-[#b52a00]">
          <p>Active Tasks hit a display error. Try refreshing this board.</p>
          <p className="mt-1 text-[12px] text-[#9b1c1c]">{this.state.error.message}</p>
          <button
            type="button"
            className="mt-3 rounded-[8px] bg-[#101828] px-3 py-1.5 text-[13px] font-medium text-white"
            onClick={() => {
              this.setState({ error: null })
              this.props.onRetry()
            }}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function AdminWorkflowOperationsDashboard() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const selectedRunId = searchParams.get('run')?.trim() || null
  const ticketDeepLink = searchParams.get('ticket')?.trim() || null
  const metricFilter = useMemo(
    () => parseActiveTasksMetricFilter(searchParams.get('metric')),
    [searchParams],
  )
  const searchQuery = searchParams.get('q') ?? ''
  const propertyFilter = searchParams.get('property')?.trim() || ''
  const taskTypeFilter = searchParams.get('type')?.trim() || ''
  const urgencyFilter = searchParams.get('urgency')?.trim().toLowerCase() || ''
  const assigneeFilter = searchParams.get('assignee')?.trim() || ''
  const setSearchQuery = useCallback(
    (value: string) => {
      setSearchParams(
        mutateSearchParams(searchParams, (next) => {
          writeStringParam(next, 'q', value)
        }),
        { replace: true },
      )
    },
    [searchParams, setSearchParams],
  )
  const writeDimensionFilter = useCallback(
    (key: 'property' | 'type' | 'urgency' | 'assignee', value: string) => {
      setSearchParams(
        mutateSearchParams(searchParams, (next) => {
          writeStringParam(next, key, value)
        }),
        { replace: true },
      )
    },
    [searchParams, setSearchParams],
  )
  const [data, setData] = useState<AdminWorkflowDashboardData | null>(null)
  const [vendorNameById, setVendorNameById] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [highlightRunId, setHighlightRunId] = useState<string | null>(null)

  const [chooserOpen, setChooserOpen] = useState(false)
  const [startModalWorkflow, setStartModalWorkflow] = useState<LifecycleWorkflowType | null>(null)
  const [pipelineDetail, setPipelineDetail] = useState<WorkflowPipelineDetail | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(false)

  const openRun = useCallback(
    (runId: string) => {
      const id = runId.trim()
      if (!id) return
      if (searchParams.get('run')?.trim() === id) return
      setSearchParams(
        mutateSearchParams(searchParams, (next) => {
          next.set('run', id)
        }),
        { replace: false },
      )
    },
    [searchParams, setSearchParams],
  )

  const closeRun = useCallback(() => {
    if (!searchParams.get('run')) return
    setSearchParams(
      mutateSearchParams(searchParams, (next) => {
        next.delete('run')
      }),
      { replace: true },
    )
  }, [searchParams, setSearchParams])

  const writeMetricFilter = useCallback(
    (metric: ActiveTasksMetricFilter | null) => {
      setSearchParams(
        mutateSearchParams(searchParams, (next) => {
          writeStringParam(next, 'metric', metric ?? '')
        }),
        { replace: true },
      )
    },
    [searchParams, setSearchParams],
  )

  const toggleMetricFilter = useCallback(
    (metric: ActiveTasksMetricFilter) => {
      writeMetricFilter(metricFilter === metric ? null : metric)
    },
    [metricFilter, writeMetricFilter],
  )

  const allRuns = useMemo<AdminWorkflowRow[]>(() => {
    if (!data) return []
    return collectAdminWorkflowRuns(data)
  }, [data])

  const allCards = useMemo<KanbanCard[]>(() => {
    const runMetadata = data?.runMetadata ?? {}
    return allRuns
      .filter((row) => !isCancelledOnActiveTasks(row))
      .map((row) => {
        const card = buildWorkflowKanbanCard(row, runMetadata[row.id])
        const vendorId = card.assignedVendorId?.trim() || ''
        if (!vendorId) return card
        const vendorName = vendorNameById.get(vendorId)?.trim() || null
        return vendorName ? { ...card, assignedVendorName: vendorName } : card
      })
  }, [allRuns, data?.runMetadata, vendorNameById])

  const kpis = useMemo(() => computeActiveTasksKpis(allCards), [allCards])

  const dimensionFilters = useMemo(
    () => ({
      property: propertyFilter,
      taskType: taskTypeFilter,
      urgency: urgencyFilter,
      assignee: assigneeFilter,
    }),
    [propertyFilter, taskTypeFilter, urgencyFilter, assigneeFilter],
  )

  const propertyOptions = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const card of allCards) {
      const key = cardPropertyKey(card)
      const label = card.propertyLabel?.trim()
      if (!key || !label) continue
      if (!byKey.has(key)) byKey.set(key, label)
    }
    return [...byKey.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [allCards])

  const taskTypeOptions = useMemo(() => {
    const present = new Set(allCards.map((card) => card.category))
    return TASK_TYPE_OPTIONS.filter((option) => present.has(option.value))
  }, [allCards])

  const urgencyOptions = useMemo(() => {
    const present = new Set(
      allCards
        .map((card) => card.urgency?.trim().toLowerCase() || '')
        .filter(Boolean),
    )
    const fromStatic = URGENCY_OPTIONS.filter((option) => present.has(option.value))
    const extras = [...present]
      .filter((value) => !URGENCY_OPTIONS.some((option) => option.value === value))
      .sort()
      .map((value) => ({
        value,
        label: value.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
      }))
    return [...fromStatic, ...extras]
  }, [allCards])

  const assigneeOptions = useMemo(() => {
    const byId = new Map<string, string>()
    let hasUnassigned = false
    for (const card of allCards) {
      const vendorId = card.assignedVendorId?.trim()
      if (!vendorId) {
        hasUnassigned = true
        continue
      }
      const name =
        card.assignedVendorName?.trim() ||
        vendorNameById.get(vendorId)?.trim() ||
        'Assigned vendor'
      if (!byId.has(vendorId)) byId.set(vendorId, name)
    }
    const options = [...byId.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
    if (hasUnassigned) {
      options.unshift({ value: UNASSIGNED_ASSIGNEE, label: 'Unassigned' })
    }
    return options
  }, [allCards, vendorNameById])

  const cards = useMemo<KanbanCard[]>(() => {
    let filtered = allCards.filter((card) => cardMatchesDimensionFilters(card, dimensionFilters))
    filtered = filtered.filter((card) => cardMatchesSearch(card, searchQuery))
    if (!metricFilter) return filtered
    const allowed = new Set(kpis.runIdsByBucket[metricFilter])
    return filtered.filter((card) => allowed.has(card.id))
  }, [allCards, dimensionFilters, searchQuery, metricFilter, kpis])

  const load = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    const loadStartedAt =
      typeof performance !== 'undefined' ? performance.now() : Date.now()

    try {
      const dashboard = await fetchAdminWorkflowDashboard()
      setData(dashboard)
      const vendorIds = [
        ...new Set(
          collectAdminWorkflowRuns(dashboard)
            .map((row) => row.assignedVendorId?.trim() || '')
            .filter(Boolean),
        ),
      ]
      if (vendorIds.length === 0) {
        setVendorNameById(new Map())
      } else {
        const { data: vendors, error: vendorsError } = await supabase
          .from('vendors')
          .select('id, name')
          .eq('landlord_id', getActiveLandlordId())
          .in('id', vendorIds)
        if (vendorsError) {
          console.error('[active-tasks] vendors fetch', vendorsError.message)
          setVendorNameById(new Map())
        } else {
          const next = new Map<string, string>()
          for (const vendor of vendors ?? []) {
            const id = typeof vendor.id === 'string' ? vendor.id.trim() : ''
            const name = typeof vendor.name === 'string' ? vendor.name.trim() : ''
            if (id && name) next.set(id, name)
          }
          setVendorNameById(next)
        }
      }
      const elapsedMs =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - loadStartedAt
      if (import.meta.env.DEV) {
        console.info(
          `[active-tasks] dashboard hydrate ${Math.round(elapsedMs)}ms runs=${collectAdminWorkflowRuns(dashboard).length}`,
        )
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Something went wrong. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!ticketDeepLink || selectedRunId || loading || !data) return
    const local = pickWorkflowRunIdForTicket(allRuns, ticketDeepLink, data.runMetadata)
    if (local) {
      setSearchParams(
        mutateSearchParams(searchParams, (next) => {
          next.delete('ticket')
          next.set('run', local)
        }),
        { replace: true },
      )
      return
    }
    let cancelled = false
    void lookupWorkflowRunIdForTicket(ticketDeepLink).then((runId) => {
      if (cancelled) return
      if (runId && allRuns.some((row) => row.id === runId)) {
        setSearchParams(
          mutateSearchParams(searchParams, (next) => {
            next.delete('ticket')
            next.set('run', runId)
          }),
          { replace: true },
        )
        return
      }
      navigate(insightWorkOrderHref({ ticketId: ticketDeepLink }), { replace: true })
    })
    return () => {
      cancelled = true
    }
  }, [ticketDeepLink, selectedRunId, loading, data, allRuns, searchParams, setSearchParams, navigate])

  useEffect(() => {
    if (!selectedRunId || loading) return
    const element = document.getElementById(`workflow-card-${selectedRunId}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    setHighlightRunId(selectedRunId)
    const timer = window.setTimeout(() => setHighlightRunId(null), 3200)
    return () => window.clearTimeout(timer)
  }, [selectedRunId, loading, cards])

  useEffect(() => {
    if (!selectedRunId || !data) {
      setPipelineDetail(null)
      setPipelineLoading(false)
      return
    }

    let cancelled = false
    setPipelineLoading(true)
    setPipelineDetail(null)
    const detailStartedAt =
      typeof performance !== 'undefined' ? performance.now() : Date.now()

    void fetchWorkflowPipelineDetail(selectedRunId, allRuns, data.runMetadata).then((result) => {
      if (cancelled) return
      const elapsedMs =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - detailStartedAt
      if (import.meta.env.DEV) {
        console.info(
          `[active-tasks] pipeline detail ${Math.round(elapsedMs)}ms run=${selectedRunId}`,
        )
      }
      setPipelineDetail(result)
      setPipelineLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [selectedRunId, data, allRuns])

  useEffect(() => {
    const client = supabase
    if (!client) return

    const channel = client
      .channel('admin-workflow-runs')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workflow_runs' },
        () => {
          void load()
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'workflow_events' },
        () => {
          void load()
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [load])

  return (
    <main className="w-full min-w-0 overflow-x-hidden px-4 pb-12 sm:px-6 lg:px-8">
      <div className="py-6">
        <h1 className="sa-enter text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
          Active Tasks
        </h1>
        <p className="sa-enter mt-1 max-w-3xl text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
          {WORKFLOW_PIPELINE_PAGE_SUBTITLE}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {loading ? (
          <>
            <KpiCardSkeleton />
            <KpiCardSkeleton />
            <KpiCardSkeleton />
            <KpiCardSkeleton />
          </>
        ) : (
          <>
            <KpiCard
              label="Needs your attention"
              value={String(kpis.needsYourAttention)}
              icon={needsYourAttentionIcon}
              selected={metricFilter === 'needs_attention'}
              onSelect={() => toggleMetricFilter('needs_attention')}
              title="Tasks that need a landlord decision — escalations, missing vendors, and stuck assignments."
            />
            <KpiCard
              label="Waiting on others"
              value={String(kpis.waitingOnOthers)}
              icon={waitingOnOthersIcon}
              selected={metricFilter === 'waiting_on_others'}
              onSelect={() => toggleMetricFilter('waiting_on_others')}
              title="Open work Ulo is coordinating while waiting on a vendor or resident."
            />
            <KpiCard
              label="Scheduled today"
              value={String(kpis.scheduledToday)}
              icon={scheduledTodayIcon}
              selected={metricFilter === 'scheduled_today'}
              onSelect={() => toggleMetricFilter('scheduled_today')}
              title="Confirmed visit windows that fall on today’s calendar."
            />
            <KpiCard
              label="Overdue"
              value={String(kpis.overdue)}
              icon={overdueIcon}
              selected={metricFilter === 'overdue'}
              onSelect={() => toggleMetricFilter('overdue')}
              title="Open tasks past their response time or due date."
            />
          </>
        )}
      </div>

      <StartWorkflowChooser
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onPick={(workflow) => {
          setChooserOpen(false)
          setStartModalWorkflow(workflow)
        }}
      />

      <StartLifecycleWorkflowModal
        open={startModalWorkflow != null}
        workflow={startModalWorkflow ?? 'move_in'}
        onClose={() => setStartModalWorkflow(null)}
        onStarted={() => void load()}
      />

      <WorkflowPipelineDetailPanel
        open={selectedRunId != null}
        detail={pipelineDetail}
        loading={pipelineLoading}
        onClose={closeRun}
        onWorkflowUpdated={() => {
          void load()
          if (selectedRunId && data) {
            void fetchWorkflowPipelineDetail(selectedRunId, allRuns, data.runMetadata).then(
              setPipelineDetail,
            )
          }
        }}
      />

      {error ? (
        <div className="mb-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] text-[#b52a00]">
          {error}
        </div>
      ) : null}

      {/* Workflow Pipeline (kanban) — grow with content; AdminLayout owns vertical scroll */}
      <section className="sa-surface flex w-full min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#e5e7eb] px-6 py-3 sm:gap-4">
          <div className="relative min-w-0 w-full flex-1 sm:min-w-[220px] sm:max-w-md">
            <span className="pointer-events-none absolute left-3 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center">
              <img
                src={magnifyingGlassIcon}
                alt=""
                className="size-4 object-contain opacity-60"
                width={16}
                height={16}
                decoding="async"
                aria-hidden
              />
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search tasks by title, property, or work order…"
              className="sa-surface h-9 w-full rounded-lg border border-transparent bg-[#e8e9ed] py-1 pl-10 pr-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] shadow-none placeholder:text-[#717182] outline-none hover:border-black/10 hover:bg-[#dfe0e6] focus:border-[#0030b5]/45 focus:bg-white focus:ring-2 focus:ring-[#0030b5]/30"
              aria-label="Search active tasks"
            />
          </div>
          <FilterSelect
            label="All properties"
            options={propertyOptions}
            value={propertyFilter}
            onChange={(value) => writeDimensionFilter('property', value)}
          />
          <FilterSelect
            label="All task types"
            options={taskTypeOptions}
            value={taskTypeFilter}
            onChange={(value) => writeDimensionFilter('type', value)}
          />
          <FilterSelect
            label="All urgency"
            options={urgencyOptions}
            value={urgencyFilter}
            onChange={(value) => writeDimensionFilter('urgency', value)}
          />
          <FilterSelect
            label="All assignees"
            options={assigneeOptions}
            value={assigneeFilter}
            onChange={(value) => writeDimensionFilter('assignee', value)}
          />
          {metricFilter ? (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <ActiveTasksMetricFilterChip
                filter={metricFilter}
                onClear={() => writeMetricFilter(null)}
              />
            </div>
          ) : null}
        </div>

        <WorkflowKanbanBoardErrorBoundary onRetry={() => void load()}>
          <WorkflowKanbanBoard
            cards={cards}
            loading={loading}
            highlightRunId={highlightRunId}
            onSelect={openRun}
            onAdd={() => setChooserOpen(true)}
            onReload={load}
          />
        </WorkflowKanbanBoardErrorBoundary>
      </section>
    </main>
  )
}
