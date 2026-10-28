import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import magnifyingGlassIcon from '@/assets/Magnifying glass.svg'
import { AdminBreadcrumb } from '@/components/AdminBreadcrumb'
import { TableCheckbox } from '@/components/TableCheckbox'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { formatWorkOrderRefFromTicketId } from '@/lib/vendorCallFlow'
import { findPropertyById } from '@/lib/properties'
import { workOrdersBreadcrumbItems } from '@/lib/workOrdersBreadcrumb'
import { supabase } from '@/lib/supabase'
import {
  formatVendorTradeLabel,
  issueCategoryToVendorTrade,
  VENDOR_TRADE_OPTIONS,
} from '@/lib/vendorTrades'
import { homeCheckFollowUpCategory } from '@shared/maintenance/homeCheckRepairCategory'
import { adminRequestStatusFromDb } from '@/lib/adminRequestStatus'
import { isHomeCheckObservation } from '@/lib/landlordWorkOrders'
type UrgencyUi = 'urgent' | 'normal' | 'low'

type StatusUi =
  | 'in_progress'
  | 'assigned'
  | 'under_review'
  | 'completed'
  | 'cancelled'

export type AdminTicketRow = {
  id: string
  /** When the row maps to `maintenance_requests`, set this (or use a UUID `id`) so vendor changes persist via Edge. */
  backendTicketId?: string
  requestId: string
  submittedLabel: string
  /** Absolute-style date/time for expanded row (e.g. "Mar 25, 8:30 AM"). */
  submittedAtDisplay?: string
  residentName: string
  residentEmail: string
  /** From `maintenance_requests.resident_phone` when loaded from Supabase. */
  residentPhone?: string
  unit: string
  category: string
  /** Raw `maintenance_requests.issue_category` (e.g. plumbing); used to match vendors like Vendors. */
  issueCategoryRaw?: string | null
  descriptionPreview: string
  /** Longer description in accordion; falls back to `descriptionPreview`. */
  detailDescription?: string
  status: StatusUi
  vendor?: string
  /** `maintenance_requests.assigned_vendor_id` when loaded from Supabase. */
  assignedVendorId?: string
  /** Shown on assigned-vendor card, e.g. "Mar 25, 2:00 PM". */
  estimatedCompletion?: string
  /** `maintenance_requests.vendor_work_status` when loaded from Supabase. */
  vendorWorkStatus?: string | null
  /** `maintenance_requests.assigned_at` (ISO) for vendor delay + auto-reassign UI. */
  assignedAtIso?: string | null
  /** When true, shows overdue callout using `estimatedCompletion`. */
  isOverdue?: boolean
  /** SLA due from `maintenance_requests.due_at` (live data). */
  dueAtDisplay?: string
  /** Raw ISO for `maintenance_requests.due_at`, used for inline editing. */
  dueAtIso?: string
  /** True when `due_at` is past and ticket is not completed. */
  isSlaOverdue?: boolean
  urgency: UrgencyUi
  photoAttached?: boolean
}

const STATUS_FILTER_OPTIONS: { value: StatusUi; label: string }[] = [
  { value: 'under_review', label: 'Under Review' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Closed' },
]

const URGENCY_FILTER_OPTIONS: { value: UrgencyUi; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

const CATEGORY_FILTER_OPTIONS: { value: string; label: string }[] = [
  ...VENDOR_TRADE_OPTIONS.map((trade) => ({
    value: trade.value,
    label: trade.label,
  })),
]

function rowMatchesSearch(row: AdminTicketRow, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [
    row.requestId,
    formatWorkOrderRefFromTicketId(row.id),
    row.residentName,
    row.residentEmail,
    row.residentPhone ?? '',
    row.unit,
    row.descriptionPreview,
    row.submittedAtDisplay ?? '',
    row.submittedLabel,
    row.dueAtDisplay ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(needle)
}

type MaintenanceRequestRowDb = {
  id: string
  created_at: string
  resident_name: string
  email: string
  resident_phone: string | null
  priority: string
  description: string
  /** Legacy / optional column; vendor workflow uses `vendor_work_status`. */
  status?: string | null
  vendor_work_status?: string | null
  unit?: string | null
  due_at?: string | null
  estimated_minutes?: number | null
  severity?: string | null
  issue_category?: string | null
  assigned_at?: string | null
  assigned_vendor_id?: string | null
  /** Denormalized `maintenance_requests.vendor` text (legacy / backfill); not the vendors FK row. */
  vendorDenormalized?: string | null
  /** From `select(..., assigned_vendor_join:vendors!fk(...))` when FK is set. */
  embeddedAssignedVendorName?: string | null
}

function shortRelativeLabel(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const d = Date.now() - t
  const m = Math.floor(d / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} hours ago`
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function mapDbUrgency(u: string): UrgencyUi {
  const x = u.trim().toLowerCase()
  if (x === 'urgent' || x === 'high') return 'urgent'
  if (x === 'low') return 'low'
  return 'normal'
}

/** Optional text column `maintenance_requests.vendor` (not PostgREST embedded `vendors`). */
function readDenormalizedVendorText(
  raw: Record<string, unknown>,
): string | null {
  const v = raw.vendor
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function nameFromVendorEmbedShape(
  j: unknown,
): string | null {
  if (j == null) return null
  if (Array.isArray(j)) {
    const first = j[0]
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const n = (first as Record<string, unknown>).name
      if (typeof n === 'string' && n.trim()) return n.trim()
    }
    return null
  }
  if (typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  const n = o.name
  if (typeof n !== 'string') return null
  const t = n.trim()
  return t.length > 0 ? t : null
}

/**
 * Nested `vendors` row from admin list query embed.
 * PostgREST may expose the FK embed as our alias, as `vendors`, or as an array.
 */
function extractEmbeddedAssignedVendorName(
  raw: Record<string, unknown>,
): string | null {
  const keys = ['assigned_vendor_join', 'vendors'] as const
  for (const k of keys) {
    const got = nameFromVendorEmbedShape(raw[k])
    if (got) return got
  }
  return null
}

/** Supabase returns snake_case; tolerate camelCase if a proxy ever transforms rows. */
function readVendorWorkStatusFromRow(
  dbRow: MaintenanceRequestRowDb & Record<string, unknown>,
): string | null {
  const a = dbRow.vendor_work_status
  const b = dbRow.vendorWorkStatus
  const raw = (typeof a === 'string' ? a : typeof b === 'string' ? b : '') ?? ''
  const t = raw.trim()
  return t.length > 0 ? t : null
}

function formatDueAtDisplay(iso: string | null | undefined): string | undefined {
  if (iso == null || String(iso).trim() === '') return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatIssueCategoryLabel(
  raw: string | null | undefined,
  description?: string | null,
): string {
  const category =
    raw?.trim().toLowerCase() === 'home_check_warning'
      ? homeCheckFollowUpCategory(description)
      : raw
  return formatVendorTradeLabel(category, { emptyLabel: 'Maintenance' })
}

function resolveAdminStatusFromDb(dbRow: MaintenanceRequestRowDb): StatusUi {
  const extended = dbRow as MaintenanceRequestRowDb & Record<string, unknown>
  return adminRequestStatusFromDb({
    status: dbRow.status,
    vendorWorkStatus: readVendorWorkStatusFromRow(extended),
  })
}

/** Normalize a PostgREST row (e.g. from `select('*')`) into our typed shape. */
function normalizeMaintenanceRequestRow(
  raw: Record<string, unknown>,
): MaintenanceRequestRowDb {
  const vendorWork =
    raw.vendor_work_status != null
      ? String(raw.vendor_work_status)
      : raw.vendorWorkStatus != null
        ? String(raw.vendorWorkStatus)
        : null
  return {
    id: String(raw.id ?? ''),
    created_at: String(raw.created_at ?? ''),
    resident_name: String(raw.resident_name ?? ''),
    email: String(raw.email ?? ''),
    resident_phone:
      raw.resident_phone == null ? null : String(raw.resident_phone),
    priority: String(raw.priority ?? ''),
    description: String(raw.description ?? ''),
    status: raw.status == null ? null : String(raw.status),
    vendor_work_status: vendorWork,
    unit: raw.unit == null ? null : String(raw.unit),
    due_at: raw.due_at == null ? null : String(raw.due_at),
    estimated_minutes:
      raw.estimated_minutes == null || raw.estimated_minutes === ''
        ? null
        : Number(raw.estimated_minutes),
    severity: raw.severity == null ? null : String(raw.severity),
    issue_category:
      raw.issue_category == null ? null : String(raw.issue_category),
    assigned_at:
      raw.assigned_at == null || String(raw.assigned_at).trim() === ''
        ? null
        : String(raw.assigned_at),
    assigned_vendor_id:
      raw.assigned_vendor_id != null && String(raw.assigned_vendor_id).trim() !== ''
        ? String(raw.assigned_vendor_id)
        : raw.assignedVendorId != null &&
            String(raw.assignedVendorId).trim() !== ''
          ? String(raw.assignedVendorId)
          : null,
    vendorDenormalized: readDenormalizedVendorText(raw),
    embeddedAssignedVendorName: extractEmbeddedAssignedVendorName(raw),
  }
}

function mapMaintenanceRequestToAdminRow(
  dbRow: MaintenanceRequestRowDb,
  vendorNameById: Record<string, string> = {},
): AdminTicketRow {
  const idStr = dbRow.id
  const description = dbRow.description ?? ''
  const status = resolveAdminStatusFromDb(dbRow)
  const dueAtDisplay = formatDueAtDisplay(dbRow.due_at)
  const isSlaOverdue = Boolean(
    dbRow.due_at &&
      dueAtDisplay &&
      status !== 'completed' &&
      new Date(dbRow.due_at).getTime() < Date.now(),
  )
  const vid = (dbRow.assigned_vendor_id ?? '').trim()
  const fromEmbed = (dbRow.embeddedAssignedVendorName ?? '').trim()
  const vidLower = vid.toLowerCase()
  const fromBatch = vid
    ? (
        vendorNameById[vid] ??
        vendorNameById[vidLower] ??
        ''
      ).trim()
    : ''
  const fromTicketColumn = (dbRow.vendorDenormalized ?? '').trim()
  /** Embed → batch lookup → denormalized `maintenance_requests.vendor` text. */
  const vendorDisplay = (
    fromEmbed ||
    fromBatch ||
    fromTicketColumn ||
    (vid ? 'Unknown vendor' : '')
  ).trim()
  const vendorWork = dbRow.vendor_work_status ?? null

  return {
    id: idStr,
    backendTicketId: idStr,
    requestId: `MNT-${idStr.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    submittedLabel: shortRelativeLabel(dbRow.created_at),
    submittedAtDisplay: new Date(dbRow.created_at).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
    residentName: dbRow.resident_name ?? '',
    residentEmail: dbRow.email ?? '',
    residentPhone: dbRow.resident_phone?.trim() || undefined,
    unit: (dbRow.unit ?? '').trim(),
    category: formatIssueCategoryLabel(dbRow.issue_category, dbRow.description),
    issueCategoryRaw:
      dbRow.issue_category == null || String(dbRow.issue_category).trim() === ''
        ? undefined
        : dbRow.issue_category.trim().toLowerCase() === 'home_check_warning'
          ? homeCheckFollowUpCategory(dbRow.description)
          : String(dbRow.issue_category).trim(),
    descriptionPreview:
      description.length > 120
        ? `${description.slice(0, 117)}…`
        : description,
    detailDescription: description,
    status,
    ...(vendorDisplay.trim() ? { vendor: vendorDisplay.trim() } : {}),
    ...(vid ? { assignedVendorId: vid } : {}),
    urgency: mapDbUrgency(dbRow.priority ?? ''),
    photoAttached: false,
    ...(vendorWork != null && String(vendorWork).trim() !== ''
      ? { vendorWorkStatus: String(vendorWork).trim() }
      : {}),
    ...(dbRow.assigned_at != null && String(dbRow.assigned_at).trim() !== ''
      ? { assignedAtIso: String(dbRow.assigned_at).trim() }
      : {}),
    ...(dbRow.due_at != null && String(dbRow.due_at).trim() !== ''
      ? { dueAtIso: String(dbRow.due_at).trim() }
      : {}),
    ...(dueAtDisplay ? { dueAtDisplay } : {}),
    ...(isSlaOverdue ? { isSlaOverdue: true } : {}),
  }
}

function rowMatchesCategoryFilter(
  row: AdminTicketRow,
  filterValue: string,
): boolean {
  if (!filterValue) return true
  const trade = issueCategoryToVendorTrade(row.category)
  if (filterValue === 'door_window_noise') {
    return trade === 'windows' || trade === 'other'
  }
  if (filterValue === 'appliance') {
    return trade === 'appliance_repair'
  }
  return trade === filterValue || trade === issueCategoryToVendorTrade(filterValue)
}

function statusUi(s: StatusUi): {
  label: string
  pill: string
  text: string
  border?: string
} {
  switch (s) {
    case 'in_progress':
      return {
        label: 'In Progress',
        pill: 'bg-[#fef9c2] border border-[#fff085]',
        text: 'text-[#a65f00]',
      }
    case 'assigned':
      return {
        label: 'Assigned',
        pill: 'bg-[#eaf0ff] border border-[#c9d7ff]',
        text: 'text-[#0030b5]',
      }
    case 'under_review':
      return {
        label: 'Under Review',
        pill: 'bg-[#dbeafe] border border-[#bedbff]',
        text: 'text-[#1447e6]',
      }
    case 'completed':
      return {
        label: 'Completed',
        pill: 'bg-[#dcfce7] border border-[#b9f8cf]',
        text: 'text-[#008236]',
      }
    case 'cancelled':
      return {
        label: 'Closed',
        pill: 'bg-[#f3f4f6] border border-[#e5e7eb]',
        text: 'text-[#4b5563]',
      }
    default:
      return {
        label: s,
        pill: 'bg-[#f3f3f5]',
        text: 'text-[#364153]',
      }
  }
}

function urgencyUi(u: UrgencyUi): { label: string; className: string } {
  if (u === 'urgent')
    return {
      label: 'Urgent',
      className: 'bg-[#fff4f0] text-[#b52a00]',
    }
  if (u === 'normal')
    return {
      label: 'Normal',
      className: 'bg-[#fef9c2] text-[#a65f00]',
    }
  return {
    label: 'Low',
    className: 'bg-[#dcfce7] text-[#008236]',
  }
}

function RequestIssueDescription({ row }: { row: AdminTicketRow }) {
  const detail = row.detailDescription?.trim() || row.descriptionPreview
  return (
    <div className="border-t border-[#e5e7eb] bg-[#fafafa] px-4 py-5 sm:px-5">
      <div className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
        <p className="text-[12px] leading-4 text-[#6a7282]">Full Issue Description</p>
        <div className="mt-2 min-h-[72px] whitespace-pre-wrap rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-3 py-3 text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
          {detail}
        </div>
      </div>
    </div>
  )
}

function ChipEditButton({ ariaLabel }: { ariaLabel: string }) {
  return (
    <button
      type="button"
      className="shrink-0 rounded p-0.5 text-[#6a7282] opacity-0 transition-opacity duration-150 hover:bg-black/10 hover:text-[#0a0a0a] group-hover/chip:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1"
      aria-label={ariaLabel}
    >
      <svg
        className="size-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    </button>
  )
}

export function AdminRequestManagementDashboard() {
  const [tickets, setTickets] = useState<AdminTicketRow[]>(() => [])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [searchParams] = useSearchParams()
  const globalSearchQuery = searchParams.get('q')
  const propertyFilterId = searchParams.get('property')?.trim() || null
  const [searchQuery, setSearchQuery] = useState(() => globalSearchQuery ?? '')
  const [propertyAddress, setPropertyAddress] = useState<string | null>(null)

  useEffect(() => {
    setSearchQuery(globalSearchQuery ?? '')
  }, [globalSearchQuery])

  useEffect(() => {
    if (!propertyFilterId) {
      setPropertyAddress(null)
      return
    }
    let cancelled = false
    void findPropertyById(getActiveLandlordId(), propertyFilterId).then((result) => {
      if (cancelled) return
      const record = result.ok ? result.property : null
      const street = record?.streetAddress?.trim() || record?.name.trim() || ''
      setPropertyAddress(street || null)
    })
    return () => {
      cancelled = true
    }
  }, [propertyFilterId])
  const [statusFilter, setStatusFilter] = useState('')
  const [urgencyFilter, setUrgencyFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const requestedTicketId = searchParams.get('request')?.trim() || null

  useEffect(() => {
    if (!requestedTicketId) return
    if (!tickets.some((row) => row.id === requestedTicketId)) return
    setExpandedRowId(requestedTicketId)
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`request-view-${requestedTicketId}`)?.scrollIntoView({
        block: 'center',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [requestedTicketId, tickets])

  const workOrdersBreadcrumb = useMemo(() => {
    const open = expandedRowId ? tickets.find((row) => row.id === expandedRowId) : null
    return workOrdersBreadcrumbItems({
      property:
        propertyFilterId && propertyAddress
          ? { id: propertyFilterId, address: propertyAddress }
          : null,
      searchQuery: globalSearchQuery,
      openWorkOrder: open
        ? {
            requestId: open.requestId,
            description: open.detailDescription?.trim() || open.descriptionPreview,
          }
        : null,
      onCloseDetail: () => setExpandedRowId(null),
      onClearSearch: () => setSearchQuery(''),
    })
  }, [expandedRowId, tickets, propertyFilterId, propertyAddress, globalSearchQuery])

  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const deleteConfirmTitleId = useId()
  const liveTicketsLoadedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function loadTickets() {
      if (!supabase) {
        setTickets([])
        return
      }

      const ticketListSelectEmbedded = `
        *,
        assigned_vendor_join:vendors!assigned_vendor_id (
          id,
          name
        )
      `
      let rowsPayload: Record<string, unknown>[] | null = null
      let err: { message: string } | null = null

      const embedded = await supabase
        .from('maintenance_requests')
        .select(ticketListSelectEmbedded)
        .eq('landlord_id', getActiveLandlordId())
        .order('created_at', { ascending: false })

      if (embedded.error) {
        console.warn(
          '[admin] maintenance_requests embed select failed; retrying without embed',
          embedded.error.message,
        )
        const plain = await supabase
          .from('maintenance_requests')
          .select('*')
          .eq('landlord_id', getActiveLandlordId())
          .order('created_at', { ascending: false })
        rowsPayload = (plain.data ?? []) as Record<string, unknown>[]
        err = plain.error
      } else {
        rowsPayload = (embedded.data ?? []) as Record<string, unknown>[]
        err = embedded.error
      }

      if (cancelled) return

      if (err) {
        console.error('[admin] maintenance_requests fetch failed', err.message)
        if (!liveTicketsLoadedRef.current) {
          setTickets([])
        }
        return
      }

      const rawList = (rowsPayload ?? []).filter((raw) => !isHomeCheckObservation(raw))
      const rows = rawList.map(normalizeMaintenanceRequestRow)
      liveTicketsLoadedRef.current = true
      if (rows.length === 0) {
        setTickets([])
        return
      }
      const _vendorIds = [
        ...new Set(
          rows
            .map((r) => r.assigned_vendor_id?.trim())
            .filter((id): id is string => Boolean(id)),
        ),
      ]
      const vendorNameById: Record<string, string> = {}
      if (_vendorIds.length > 0) {
        const { data: vendorRows, error: vendorErr } = await supabase
          .from('vendors')
          .select('id, name')
          .in('id', _vendorIds)
        if (vendorErr) {
          console.error('[admin] vendors batch lookup failed', vendorErr.message)
        } else if (vendorRows) {
          for (const v of vendorRows) {
            const id = typeof v.id === 'string' ? v.id : String(v.id ?? '')
            const name = typeof v.name === 'string' ? v.name.trim() : ''
            if (id && name) {
              vendorNameById[id] = name
              vendorNameById[id.toLowerCase()] = name
            }
          }
        }
      }
      setTickets(rows.map((r) => mapMaintenanceRequestToAdminRow(r, vendorNameById)))
    }

    void loadTickets()

    const pollMs = 20_000
    const pollId =
      supabase != null
        ? window.setInterval(() => {
            if (!cancelled) void loadTickets()
          }, pollMs)
        : null

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled) void loadTickets()
    }
    document.addEventListener('visibilitychange', onVisibility)

    if (!supabase) {
      return () => {
        cancelled = true
        if (pollId != null) window.clearInterval(pollId)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }

    const sb = supabase
    const channel = sb
      .channel('admin-maintenance-requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'maintenance_requests' },
        () => {
          void loadTickets()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      if (pollId != null) window.clearInterval(pollId)
      document.removeEventListener('visibilitychange', onVisibility)
      void sb.removeChannel(channel)
    }
  }, [])

  const filteredTickets = useMemo(() => {
    return tickets.filter((row) => {
      if (!rowMatchesSearch(row, searchQuery)) return false
      if (statusFilter && row.status !== statusFilter) return false
      if (urgencyFilter && row.urgency !== urgencyFilter) return false
      if (!rowMatchesCategoryFilter(row, categoryFilter)) return false
      return true
    })
  }, [tickets, searchQuery, statusFilter, urgencyFilter, categoryFilter])

  const selectedCount = selectedIds.size
  const allFilteredSelected =
    filteredTickets.length > 0 &&
    filteredTickets.every((r) => selectedIds.has(r.id))
  const someFilteredSelected =
    filteredTickets.some((r) => selectedIds.has(r.id)) && !allFilteredSelected

  function toggleRowSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allOn =
        filteredTickets.length > 0 &&
        filteredTickets.every((r) => next.has(r.id))
      if (allOn) {
        for (const r of filteredTickets) next.delete(r.id)
      } else {
        for (const r of filteredTickets) next.add(r.id)
      }
      return next
    })
  }

  async function deleteSelectedTickets() {
    if (selectedIds.size === 0) {
      setDeleteConfirmOpen(false)
      return
    }
    setDeleteError(null)
    if (supabase) {
      setDeleteSaving(true)
      const idsToDelete = Array.from(selectedIds)
      const { error } = await supabase
        .from('maintenance_requests')
        .delete()
        .in('id', idsToDelete)
      if (error) {
        setDeleteError(error.message)
        setDeleteSaving(false)
        return
      }
      setDeleteSaving(false)
    }
    const remove = new Set(selectedIds)
    setTickets((prev) => prev.filter((r) => !remove.has(r.id)))
    setExpandedRowId((cur) => (cur && remove.has(cur) ? null : cur))
    setSelectedIds(new Set())
    setDeleteConfirmOpen(false)
  }

  useEffect(() => {
    if (!deleteConfirmOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !deleteSaving) setDeleteConfirmOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteConfirmOpen, deleteSaving])

  useEffect(() => {
    if (deleteConfirmOpen && selectedIds.size === 0) {
      setDeleteConfirmOpen(false)
    }
  }, [deleteConfirmOpen, selectedIds.size])

  return (
    <>
        {deleteConfirmOpen ? (
          <div className="fixed inset-0 z-[81] flex items-center justify-center bg-black/40 p-4">
            <div
              role="presentation"
              className="absolute inset-0"
              aria-hidden
              onClick={() => {
                if (!deleteSaving) setDeleteConfirmOpen(false)
              }}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={deleteConfirmTitleId}
              className="relative flex w-full max-w-[440px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-[#e5e7eb] px-6 py-4">
                <h2
                  id={deleteConfirmTitleId}
                  className="text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#0a0a0a]"
                >
                  Delete maintenance requests?
                </h2>
              </div>
              <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
                <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
                  This action cannot be undone.{' '}
                  <span className="font-medium text-[#0a0a0a]">
                    {selectedCount === 1
                      ? 'One request'
                      : `${selectedCount} requests`}
                  </span>{' '}
                  will be permanently removed from the system.
                </p>
                <p className="text-[13px] leading-5 text-[#6a7282]">
                  Only continue if you intend to delete these records.
                </p>
                {deleteError ? (
                  <p className="text-[13px] leading-4 text-[#b52a00]" role="alert">
                    {deleteError}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-3 pt-1">
                  <button
                    type="button"
                    disabled={deleteSaving || selectedCount === 0}
                    className="inline-flex h-9 min-w-0 flex-1 items-center justify-center rounded-lg border border-[#b52a00]/30 bg-[#fff4f0] px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#b52a00] outline-none transition-colors hover:bg-[#ffe9e1] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 sm:flex-initial"
                    onClick={() => void deleteSelectedTickets()}
                  >
                    {deleteSaving ? 'Deleting…' : 'Yes, delete permanently'}
                  </button>
                  <button
                    type="button"
                    disabled={deleteSaving}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                    onClick={() => {
                      if (!deleteSaving) {
                        setDeleteError(null)
                        setDeleteConfirmOpen(false)
                      }
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <header className="border-b border-[#e5e7eb] bg-white px-8 py-8">
          <AdminBreadcrumb className="mb-4" collapseOnMobile items={workOrdersBreadcrumb} />
          <h1 className="text-[22px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a] sm:text-[24px]">
            Work Orders
          </h1>
          <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            Full maintenance request list — open and completed. For tasks Ulo is actively coordinating,
            see Active Tasks.
          </p>
        </header>

        <main className="min-h-0 flex-1 overflow-auto px-8 py-8">
          <div className="w-full space-y-6">
            <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
              <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
                <div className="relative min-w-0 flex-1 lg:min-w-[240px]">
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
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by resident, unit, or request ID..."
                    className="h-9 w-full rounded-lg border border-transparent bg-[#e8e9ed] py-1 pl-10 pr-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] shadow-none placeholder:text-[#717182] outline-none transition-[background-color,border-color,box-shadow] duration-150 hover:border-black/10 hover:bg-[#dfe0e6] active:border-black/15 active:bg-[#cfd0d6] focus:border-[#0030b5]/45 focus:bg-white focus:ring-2 focus:ring-[#0030b5]/30"
                    aria-label="Search requests"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <FilterSelect
                    label="All Status"
                    options={STATUS_FILTER_OPTIONS}
                    value={statusFilter}
                    onChange={setStatusFilter}
                  />
                  <FilterSelect
                    label="All Urgency"
                    options={URGENCY_FILTER_OPTIONS}
                    value={urgencyFilter}
                    onChange={setUrgencyFilter}
                  />
                  <FilterSelect
                    label="All Categories"
                    options={CATEGORY_FILTER_OPTIONS}
                    value={categoryFilter}
                    onChange={setCategoryFilter}
                  />
                </div>
              </div>
            </div>

            {selectedCount > 0 ? (
              <div
                className="flex flex-col gap-3 rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] sm:flex-row sm:items-center sm:justify-between"
                role="region"
                aria-label="Bulk actions for selected requests"
              >
                <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                  <span className="font-medium">{selectedCount}</span>
                  {selectedCount === 1 ? ' request' : ' requests'} selected
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors duration-150 hover:bg-[#e5e7eb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Clear selection
                  </button>
                  <button
                    type="button"
                    disabled={deleteSaving}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-[#b52a00]/30 bg-[#fff4f0] px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#b52a00] outline-none transition-colors duration-150 hover:bg-[#ffe9e1] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                    onClick={() => {
                      setDeleteError(null)
                      setDeleteConfirmOpen(true)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : null}
            {deleteError && !deleteConfirmOpen ? (
              <p className="rounded-[10px] border border-[#b52a00]/30 bg-[#fff4f0] px-4 py-3 text-[14px] leading-5 text-[#b52a00]">
                Could not delete selected requests: {deleteError}
              </p>
            ) : null}

            <div className="overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
              <div className="overflow-x-auto">
                <table className="min-w-[1040px] w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#e5e7eb] bg-[#f3f4f6]">
                      <th className="w-10 px-4 py-3">
                        <TableCheckbox
                          aria-label="Select all requests"
                          checked={
                            filteredTickets.length > 0 && allFilteredSelected
                          }
                          indeterminate={someFilteredSelected}
                          disabled={filteredTickets.length === 0}
                          onChange={toggleSelectAllFiltered}
                        />
                      </th>
                      <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wide text-[#6a7282]">
                        Work Order ID
                      </th>
                      <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wide text-[#6a7282]">
                        Resident Info
                      </th>
                      <th className="min-w-[200px] px-3 py-3 text-[12px] font-medium uppercase tracking-wide text-[#6a7282]">
                        Category
                      </th>
                      <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wide text-[#6a7282]">
                        Status
                      </th>
                      <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wide text-[#6a7282]">
                        Urgency
                      </th>
                      <th className="min-w-[140px] px-3 py-3 text-[12px] font-medium uppercase tracking-wide text-[#6a7282]">
                        Date submitted
                      </th>
                      <th className="px-3 py-3 text-[12px] font-medium uppercase tracking-wide text-[#6a7282]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTickets.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-12 text-center text-[14px] leading-5 text-[#6a7282]"
                        >
                          {tickets.length === 0
                            ? 'No maintenance requests yet. Requests submitted by residents (web or SMS) will appear here.'
                            : 'No requests match your search or filters.'}
                        </td>
                      </tr>
                    ) : (
                      filteredTickets.map((row) => {
                      const st = statusUi(row.status)
                      const ur = urgencyUi(row.urgency)
                      const isExpanded = expandedRowId === row.id
                      return (
                        <Fragment key={row.id}>
                        <tr
                          className={`border-b border-[#e5e7eb] ${isExpanded ? 'bg-[#fafafa]' : ''} last:border-b-0`}
                        >
                          <td className="align-top px-4 py-4">
                            <TableCheckbox
                              aria-label={`Select ${formatWorkOrderRefFromTicketId(row.id)}`}
                              className="mt-1"
                              checked={selectedIds.has(row.id)}
                              onChange={() => toggleRowSelected(row.id)}
                            />
                          </td>
                          <td className="align-top px-3 py-4">
                            <p className="font-mono text-[14px] leading-5 text-[#0a0a0a]">
                              {formatWorkOrderRefFromTicketId(row.id)}
                            </p>
                          </td>
                          <td className="align-top px-3 py-4">
                            <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                              {row.residentName}
                            </p>
                            {row.residentPhone ? (
                              <p className="text-[12px] leading-4 text-[#6a7282]">
                                {row.residentPhone}
                              </p>
                            ) : null}
                          </td>
                          <td className="align-top px-3 py-4">
                            <span className="group/chip inline-flex items-center gap-0.5">
                              <span className="inline-flex rounded-lg border border-black/10 px-2.5 py-0.5 text-[12px] font-medium text-[#0a0a0a]">
                                {row.category}
                              </span>
                              <ChipEditButton
                                ariaLabel={`Edit category (${row.category})`}
                              />
                            </span>
                          </td>
                          <td className="align-top px-3 py-4">
                            <span
                              className={`inline-flex rounded px-3 py-1 text-[12px] font-medium ${st.pill} ${st.text}`}
                            >
                              {st.label}
                            </span>
                          </td>
                          <td className="align-top px-3 py-4">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-[12px] font-medium ${ur.className}`}
                            >
                              {ur.label}
                            </span>
                            {row.photoAttached ? (
                              <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">
                                📷 Photo attached
                              </p>
                            ) : null}
                          </td>
                          <td className="align-top px-3 py-4">
                            <span className="text-[14px] leading-5 text-[#0a0a0a]">
                              {row.submittedAtDisplay?.trim() || row.submittedLabel}
                            </span>
                          </td>
                          <td className="align-top px-3 py-4">
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={`request-detail-${row.id}`}
                              id={`request-view-${row.id}`}
                              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[14px] font-medium tracking-[-0.1504px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 ${
                                isExpanded
                                  ? 'border-black/12 bg-white text-[#0a0a0a] shadow-sm'
                                  : 'border-black/10 bg-white text-[#0a0a0a] hover:bg-[#e5e7eb]'
                              }`}
                              onClick={() =>
                                setExpandedRowId((id) =>
                                  id === row.id ? null : row.id,
                                )
                              }
                            >
                              <svg
                                className="size-4 shrink-0"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                aria-hidden
                              >
                                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                              View
                              <svg
                                className={`size-4 shrink-0 opacity-60 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                aria-hidden
                              >
                                <path d="M6 9l6 6 6-6" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="border-b border-[#e5e7eb] bg-[#fafafa] last:border-b-0">
                            <td colSpan={8} className="bg-[#fafafa] p-0">
                              <div
                                id={`request-detail-${row.id}`}
                                role="region"
                                aria-labelledby={`request-view-${row.id}`}
                              >
                                <RequestIssueDescription row={row} />
                              </div>
                            </td>
                          </tr>
                        ) : null}
                        </Fragment>
                      )
                    })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
    </>
  )
}

function FilterSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string
  options?: readonly { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="peer h-9 min-w-[140px] appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] shadow-none outline-none transition-[background-color,border-color,box-shadow,opacity,color] duration-150 enabled:cursor-pointer hover:enabled:border-black/10 hover:enabled:bg-[#e8eaee] active:enabled:border-black/15 active:enabled:bg-[#dcdde3] focus:border-[#0030b5]/45 focus:bg-white focus:ring-2 focus:ring-[#0030b5]/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-transparent disabled:hover:bg-[#f3f3f5] disabled:focus:ring-0 disabled:active:bg-[#f3f3f5]"
      >
        <option value="">{label}</option>
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282] transition-opacity peer-disabled:opacity-40">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </div>
  )
}
