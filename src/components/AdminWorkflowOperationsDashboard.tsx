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
import { useSearchParams } from 'react-router-dom'
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
  WORKFLOW_PIPELINE_PAGE_SUBTITLE,
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
  type WorkflowKanbanCard,
} from '@/lib/adminWorkflowKanban'
import { fetchWorkflowPipelineDetail, type WorkflowPipelineDetail } from '@/lib/workflowPipelineDetail'
import { WorkflowPipelineDetailPanel } from '@/components/WorkflowPipelineDetailPanel'
import { WorkflowKanbanBoard } from '@/components/workflowKanban/WorkflowKanbanBoard'
import { AdminFilterToolbar } from '@/components/AdminFilterToolbar'
import { mutateSearchParams, readCsvSet, writeCsvSet } from '@/lib/adminListUrlState'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errorMessage'

type KanbanCard = WorkflowKanbanCard

type WorkflowFilterKey = 'maintenance' | 'lease' | 'critical'

const WORKFLOW_FILTER_KEYS = new Set<WorkflowFilterKey>(['maintenance', 'lease', 'critical'])

const WORKFLOW_FILTER_OPTIONS: { id: WorkflowFilterKey; label: string }[] = [
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'lease', label: 'Lease' },
  { id: 'critical', label: 'Critical' },
]

function readWorkflowFilters(params: URLSearchParams): Set<WorkflowFilterKey> {
  const next = new Set<WorkflowFilterKey>()
  for (const key of readCsvSet(params, 'filters')) {
    if (WORKFLOW_FILTER_KEYS.has(key as WorkflowFilterKey)) {
      next.add(key as WorkflowFilterKey)
    }
  }
  return next
}

const CATEGORY_FILTER_KEYS = new Set<WorkflowFilterKey>(['maintenance', 'lease'])

function cardMatchesWorkflowFilters(card: KanbanCard, filters: Set<WorkflowFilterKey>): boolean {
  if (filters.size === 0) return true

  const categoryFilters = WORKFLOW_FILTER_OPTIONS.filter(
    (option) => CATEGORY_FILTER_KEYS.has(option.id) && filters.has(option.id),
  ).map((option) => option.id as 'maintenance' | 'lease')

  const wantsCritical = filters.has('critical')
  const categoryOk =
    categoryFilters.length === 0 ||
    categoryFilters.includes(card.category as 'maintenance' | 'lease')
  const criticalOk = !wantsCritical || card.critical

  return categoryOk && criticalOk
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
  const [searchParams, setSearchParams] = useSearchParams()

  const selectedRunId = searchParams.get('run')?.trim() || null
  const activeFilters = useMemo(() => readWorkflowFilters(searchParams), [searchParams])
  const [data, setData] = useState<AdminWorkflowDashboardData | null>(null)
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

  const writeFilters = useCallback(
    (filters: Set<WorkflowFilterKey>) => {
      setSearchParams(
        mutateSearchParams(searchParams, (next) => {
          writeCsvSet(next, 'filters', filters)
        }),
        { replace: true },
      )
    },
    [searchParams, setSearchParams],
  )

  const allRuns = useMemo<AdminWorkflowRow[]>(() => {
    if (!data) return []
    return collectAdminWorkflowRuns(data)
  }, [data])

  const cards = useMemo<KanbanCard[]>(() => {
    const runMetadata = data?.runMetadata ?? {}
    const all = allRuns
      .filter((row) => !isCancelledOnActiveTasks(row))
      .map((row) => buildWorkflowKanbanCard(row, runMetadata[row.id]))
    return all.filter((card) => cardMatchesWorkflowFilters(card, activeFilters))
  }, [allRuns, activeFilters, data?.runMetadata])

  const load = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      setData(await fetchAdminWorkflowDashboard())
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

    void fetchWorkflowPipelineDetail(selectedRunId, allRuns, data.runMetadata).then((result) => {
      if (cancelled) return
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

  function toggleWorkflowFilter(key: WorkflowFilterKey) {
    const next = new Set(activeFilters)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    writeFilters(next)
  }

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
        <AdminFilterToolbar
          options={WORKFLOW_FILTER_OPTIONS}
          activeFilters={activeFilters}
          onToggle={toggleWorkflowFilter}
          onClear={() => writeFilters(new Set())}
        />

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
