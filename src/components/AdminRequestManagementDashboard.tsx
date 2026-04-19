import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
} from 'react'
import { Link } from 'react-router-dom'
import { postAdminReassignVendor } from '@/api/adminReassignVendor'
import { ChangeAssignedVendorModal } from '@/components/ChangeAssignedVendorModal'
import { SparkleIcon } from '@/components/SparkleIcon'
import { supabase } from '@/lib/supabase'
import {
  getIssueCategorySlugForTicket,
  vendorMatchesTicketIssueCategory,
} from '@/lib/vendorIssueCategory'

type UrgencyUi = 'urgent' | 'normal' | 'low'

type StatusUi =
  | 'in_progress'
  | 'assigned'
  | 'under_review'
  | 'completed'

/** Content for the four-column Under Review accordion panel. */
export type UnderReviewPanelData = {
  recurringAlert: string
  recurringPrevious: string
  recommendedVendorOptions: string[]
  defaultRecommendedVendor?: string
  /** Shown on Vendors Delayed card; if omitted, `recommendedVendorOptions` is reused. */
  alternativeVendors?: string[]
  /** When true, the yellow Recurring Issue / Approve card is hidden for this row only. */
  omitRecurringIssueCard?: boolean
}

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
  /** Raw `maintenance_requests.issue_category` (e.g. plumbing); used to match vendors like User Management. */
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
  /** When true, shows overdue callout using `estimatedCompletion`. */
  isOverdue?: boolean
  /** SLA due from `maintenance_requests.due_at` (live data). */
  dueAtDisplay?: string
  /** True when `due_at` is past and ticket is not completed. */
  isSlaOverdue?: boolean
  /** Expanded accordion for `under_review` rows (fallbacks used if omitted). */
  underReviewPanel?: UnderReviewPanelData
  urgency: UrgencyUi
  photoAttached?: boolean
}

type StatSummaryIcon = 'house' | 'alert'

const STATUS_FILTER_OPTIONS: { value: StatusUi; label: string }[] = [
  { value: 'under_review', label: 'Under Review' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
]

const URGENCY_FILTER_OPTIONS: { value: UrgencyUi; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

const CATEGORY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'appliance', label: 'Appliance' },
  { value: 'door_window_noise', label: 'Door/Window Noise' },
]

/** Under Review accordion: hide purple Vendors Delayed card for these resident emails. */
const RESIDENT_EMAILS_WITHOUT_VENDORS_DELAYED = new Set([
  'david.park@email.com',
])

/**
 * Under Review accordion: Assigned Vendor blue card shows “No vendor assigned yet”
 * for these emails (main table row may still include a vendor for demo).
 */
const RESIDENT_EMAILS_ACCORDION_VENDOR_UNASSIGNED = new Set([
  'david.park@email.com',
])

function rowMatchesSearch(row: AdminTicketRow, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [
    row.requestId,
    row.residentName,
    row.residentEmail,
    row.residentPhone ?? '',
    row.unit,
    row.descriptionPreview,
    row.dueAtDisplay ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(needle)
}

function resolveBackendTicketId(row: AdminTicketRow): string | null {
  return row.backendTicketId ?? null
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

/** Maps `maintenance_requests.status` (and legacy vendor workflow strings) to dashboard filters. */
function mapDbStatusToUi(raw: string): StatusUi {
  const x = raw.trim().toLowerCase().replace(/\s+/g, '_')
  if (x === 'completed' || x === 'done' || x === 'closed') return 'completed'
  if (x === 'in_progress' || x === 'inprogress') return 'in_progress'
  if (
    x === 'under_review' ||
    x === 'review' ||
    x === 'pending_review'
  ) {
    return 'under_review'
  }
  if (x === 'pending_accept' || x === 'accepted') return 'assigned'
  if (
    x === 'assigned' ||
    x === 'open' ||
    x === 'new' ||
    x === 'pending' ||
    x === 'submitted'
  ) {
    return 'assigned'
  }
  return 'assigned'
}

/** Maps `maintenance_requests.vendor_work_status` (vendor portal / Edge) to admin pipeline status. */
function mapVendorWorkStatusToUi(raw: string): StatusUi {
  const x = raw.trim().toLowerCase()
  if (x === 'completed') return 'completed'
  if (x === 'in_progress') return 'in_progress'
  if (x === 'declined' || x === 'unassigned') return 'assigned'
  if (x === 'pending_accept' || x === 'accepted') return 'assigned'
  return 'assigned'
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
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatIssueCategoryLabel(raw: string | null | undefined): string {
  const t = (raw ?? '').trim()
  if (!t) return 'Maintenance'
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

function resolveAdminStatusFromDb(dbRow: MaintenanceRequestRowDb): StatusUi {
  const extended = dbRow as MaintenanceRequestRowDb & Record<string, unknown>
  const vws = readVendorWorkStatusFromRow(extended)
  if (vws != null) return mapVendorWorkStatusToUi(vws)
  return mapDbStatusToUi(dbRow.status ?? '')
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
    category: formatIssueCategoryLabel(dbRow.issue_category),
    issueCategoryRaw:
      dbRow.issue_category == null || String(dbRow.issue_category).trim() === ''
        ? undefined
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
    ...(dueAtDisplay ? { dueAtDisplay } : {}),
    ...(isSlaOverdue ? { isSlaOverdue: true } : {}),
  }
}

function rowMatchesCategoryFilter(
  row: AdminTicketRow,
  filterValue: string,
): boolean {
  if (!filterValue) return true
  const cat = row.category.trim().toLowerCase()
  switch (filterValue) {
    case 'plumbing':
      return cat.includes('plumb')
    case 'hvac':
      return cat === 'hvac' || cat.includes('hvac')
    case 'electrical':
      return cat.includes('electrical')
    case 'appliance':
      return cat.includes('appliance')
    case 'door_window_noise':
      return (
        cat.includes('door') ||
        cat.includes('window') ||
        cat.includes('noise')
      )
    default:
      return true
  }
}

/** Stable fake UUID for demo rows so Assigned Vendor card is not stuck in warning state offline. */
const DEMO_ASSIGNED_VENDOR_ID = '00000000-0000-4000-8000-000000000001'

const DEMO_TICKETS: AdminTicketRow[] = [
  {
    id: '1',
    assignedVendorId: DEMO_ASSIGNED_VENDOR_ID,
    requestId: 'MNT-482156-A4F2',
    submittedLabel: '9 hours ago',
    submittedAtDisplay: 'Mar 25, 8:30 AM',
    residentName: 'Sarah Johnson',
    residentEmail: 'sarah.johnson@email.com',
    unit: 'Unit 2B',
    category: 'Plumbing',
    descriptionPreview:
      'Kitchen sink is leaking under the cabinet. Water dripping constantly.',
    status: 'in_progress',
    vendor: 'QuickFix Plumbing',
    estimatedCompletion: 'Mar 25, 2:00 PM',
    dueAtDisplay: 'Mar 25, 2:00 PM',
    isSlaOverdue: true,
    isOverdue: true,
    urgency: 'urgent',
    photoAttached: true,
  },
  {
    id: '2',
    assignedVendorId: DEMO_ASSIGNED_VENDOR_ID,
    requestId: 'MNT-481923-B7C1',
    submittedLabel: '10 hours ago',
    submittedAtDisplay: 'Mar 25, 6:45 AM',
    residentName: 'Michael Chen',
    residentEmail: 'michael.chen@email.com',
    unit: 'Unit 5A',
    category: 'HVAC',
    descriptionPreview:
      'Air conditioning not working. Temperature in unit is 82°F.',
    status: 'assigned',
    vendor: 'CoolAir Solutions',
    estimatedCompletion: 'Mar 26, 5:00 PM',
    urgency: 'urgent',
  },
  {
    id: '3',
    requestId: 'MNT-481745-D3E8',
    submittedLabel: '12 hours ago',
    submittedAtDisplay: 'Mar 25, 8:30 AM',
    residentName: 'David Park',
    residentEmail: 'david.park@email.com',
    unit: 'Unit 9C',
    category: 'Electrical',
    descriptionPreview:
      'Bedroom outlet not working. Tried resetting circuit breaker.',
    status: 'under_review',
    vendor: 'QuickFix Plumbing',
    estimatedCompletion: 'Mar 25, 2:00 PM',
    underReviewPanel: {
      recurringAlert:
        'This resident has submitted 3 similar requests in the past 30 days.',
      recurringPrevious: 'Electrical problems on Mar 10, Mar 15',
      recommendedVendorOptions: [
        'Bright Electric',
        'PowerUp Electricians',
        'Volt Electrical Services',
      ],
      defaultRecommendedVendor: 'Bright Electric',
    },
    urgency: 'normal',
  },
  {
    id: '4',
    assignedVendorId: DEMO_ASSIGNED_VENDOR_ID,
    requestId: 'MNT-480956-H1J4',
    submittedLabel: 'Mar 24, 4:45 PM',
    submittedAtDisplay: 'Mar 24, 4:45 PM',
    residentName: 'Jessica Martinez',
    residentEmail: 'jessica.m@email.com',
    unit: 'Unit 3D',
    category: 'Door/Window',
    descriptionPreview:
      'Front door lock is stuck. Cannot lock or unlock properly.',
    status: 'in_progress',
    vendor: 'SecureLock Services',
    estimatedCompletion: 'Mar 27, 11:00 AM',
    urgency: 'urgent',
    photoAttached: true,
  },
  {
    id: '5',
    assignedVendorId: DEMO_ASSIGNED_VENDOR_ID,
    requestId: 'MNT-480721-K5L7',
    submittedLabel: 'Mar 24, 2:20 PM',
    submittedAtDisplay: 'Mar 24, 2:20 PM',
    residentName: 'Robert Kim',
    residentEmail: 'robert.kim@email.com',
    unit: 'Unit 15A',
    category: 'Noise',
    descriptionPreview:
      'Strange banging noise coming from pipes late at night.',
    status: 'under_review',
    vendor: 'Building Maintenance Co.',
    estimatedCompletion: 'Mar 28, 3:00 PM',
    underReviewPanel: {
      recurringAlert:
        'Similar noise complaints were logged for this stack in the past 30 days.',
      recurringPrevious: 'Pipe noise reports on Mar 12, Mar 19',
      recommendedVendorOptions: [
        'QuietLine Acoustics',
        'City Plumbing Noise',
        'StackSound Inspectors',
      ],
      defaultRecommendedVendor: 'QuietLine Acoustics',
      alternativeVendors: [
        'QuietLine Acoustics',
        'City Plumbing Noise',
        'StackSound Inspectors',
      ],
      omitRecurringIssueCard: true,
    },
    urgency: 'low',
  },
  {
    id: '6',
    assignedVendorId: DEMO_ASSIGNED_VENDOR_ID,
    requestId: 'MNT-480445-M8N3',
    submittedLabel: 'Mar 23, 10:00 AM',
    submittedAtDisplay: 'Mar 23, 10:00 AM',
    residentName: 'Amanda Foster',
    residentEmail: 'amanda.f@email.com',
    unit: 'Unit 7C',
    category: 'Plumbing',
    descriptionPreview: 'Toilet running continuously. Water bill concern.',
    status: 'completed',
    vendor: 'QuickFix Plumbing',
    estimatedCompletion: 'Mar 22, 4:00 PM',
    urgency: 'normal',
  },
]

function StatIcon({ name }: { name: StatSummaryIcon }) {
  const cls = 'size-5 shrink-0'
  if (name === 'house') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z"
          stroke="#155dfc"
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 9v4m0 4h.01M10.3 4.8 2.2 16A2 2 0 004 17.8h16a2 2 0 001.8-1.8l-8.1-12a2 2 0 00-3.4 0z"
        stroke="#e7000b"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconProgressCompletedPair() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="#d08700" strokeWidth={1.8} />
      <path
        d="M12 7v5l3 2"
        stroke="#d08700"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}

function InProgressCompletedDonut({
  inProgress,
  completed,
}: {
  inProgress: number
  completed: number
}) {
  const total = inProgress + completed
  const r = 23
  const stroke = 6
  const c = 2 * Math.PI * r
  const lenProgress = total > 0 ? (inProgress / total) * c : 0
  const lenCompleted = total > 0 ? (completed / total) * c : 0
  const vb = 56
  const cx = vb / 2
  const completedPct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="flex min-h-[5.5rem] w-full items-center gap-4">
      <div
        className="relative h-20 w-20 shrink-0"
        role="img"
        aria-label={`${inProgress} in progress and ${completed} completed maintenance requests, ${total} total. ${completedPct} percent completed.`}
      >
        <svg className="size-full -rotate-90" viewBox={`0 0 ${vb} ${vb}`} aria-hidden>
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
          {lenProgress > 0 ? (
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke="#d08700"
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={`${lenProgress} ${c}`}
            />
          ) : null}
          {lenCompleted > 0 ? (
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke="#00a63e"
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={`${lenCompleted} ${c}`}
              strokeDashoffset={-lenProgress}
            />
          ) : null}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="text-[15px] font-bold tabular-nums leading-none text-[#101828]">{total}</span>
          <span className="text-[10px] font-medium uppercase leading-none tracking-wide text-[#6a7282]">
            total
          </span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 list-none space-y-2 p-0">
        <li className="flex items-center gap-2 text-[12px] leading-4">
          <span className="size-2 shrink-0 rounded-full bg-[#d08700]" aria-hidden />
          <span className="min-w-0 text-[#364153]">In progress</span>
          <span className="ml-auto shrink-0 font-semibold tabular-nums text-[#101828]">{inProgress}</span>
        </li>
        <li className="flex items-center gap-2 text-[12px] leading-4">
          <span className="size-2 shrink-0 rounded-full bg-[#00a63e]" aria-hidden />
          <span className="min-w-0 text-[#364153]">Completed</span>
          <span className="ml-auto shrink-0 font-semibold tabular-nums text-[#101828]">{completed}</span>
        </li>
      </ul>
    </div>
  )
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
        pill: 'bg-[#f3e8ff] border border-[#e9d4ff]',
        text: 'text-[#8200db]',
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
      className: 'bg-[#ffe2e2] text-[#c10007]',
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

const accordionColumnWrap =
  'flex min-h-0 min-w-0 flex-1 basis-0 xl:min-w-[200px]'

/** Unified Figma-style Assigned Vendor card (all ticket statuses). */
function AssignedVendorCard({
  vendorName,
  assignedVendorId,
  emptyMessage = 'No vendor assigned yet.',
  editLabel,
  onEditVendor,
  dueAtDisplay,
  estimatedCompletion,
}: {
  vendorName?: string | null
  /** When set, the vendor name links to User Management (vendor profile). */
  assignedVendorId?: string | null
  emptyMessage?: string
  editLabel: string
  onEditVendor: () => void
  dueAtDisplay?: string | null
  estimatedCompletion?: string | null
}) {
  const due = dueAtDisplay?.trim()
  const est = estimatedCompletion?.trim()
  const hasVendor = Boolean(vendorName?.trim())
  const _vendorIdTrim = assignedVendorId?.trim() ?? ''
  const warnNoVendorId = _vendorIdTrim === ''
  const vendorProfileTo =
    _vendorIdTrim !== ''
      ? `/admin/users?vendorId=${encodeURIComponent(_vendorIdTrim)}`
      : null

  const shellClass = warnNoVendorId
    ? 'border-amber-300 bg-amber-50'
    : 'border-[#bedbff] bg-[#eff6ff]'
  const headerTextClass = warnNoVendorId ? 'text-amber-950' : 'text-[#1c398e]'
  const editBtnClass = warnNoVendorId
    ? 'text-amber-950 focus-visible:ring-offset-amber-50'
    : 'text-[#1c398e] focus-visible:ring-offset-[#eff6ff]'

  const nameBlock = hasVendor ? (
    <p
      className={`text-[16px] font-semibold leading-6 tracking-[-0.3125px] ${warnNoVendorId ? 'text-amber-950' : 'text-[#1447e6]'}`}
    >
      {vendorProfileTo ? (
        <Link
          to={vendorProfileTo}
          className="text-inherit underline decoration-[#1447e6]/40 underline-offset-2 transition-colors hover:text-[#1d4ed8] hover:decoration-[#1d4ed8]/60 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155dfc]"
        >
          {vendorName}
        </Link>
      ) : (
        vendorName
      )}
    </p>
  ) : warnNoVendorId ? (
    <p className="text-[12px] font-medium leading-4 text-amber-900">
      ⚠️ No vendor assigned
    </p>
  ) : (
    <p
      className={`text-[14px] leading-5 ${warnNoVendorId ? 'text-amber-950' : 'text-[#1447e6]'}`}
    >
      {emptyMessage}
    </p>
  )

  return (
    <div
      className={`flex h-full w-full flex-col gap-[10px] rounded-[10px] border p-[13px] ${shellClass}`}
    >
      <div className="flex w-full items-start gap-[10px]">
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <p
            className={`text-[14px] font-medium leading-5 tracking-[-0.1504px] ${headerTextClass}`}
          >
            Assigned Vendor
          </p>
          {nameBlock}
        </div>
        <button
          type="button"
          className={`flex size-4 shrink-0 items-center justify-center outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[#155dfc] focus-visible:ring-offset-2 ${editBtnClass}`}
          aria-label={editLabel}
          onClick={onEditVendor}
        >
          <svg
            className="size-4"
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
      </div>
      {hasVendor && (due || est) ? (
        due ? (
          <p className="text-[12px] font-normal leading-4 text-[#155dfc]">
            Due: {due}
          </p>
        ) : (
          <p className="text-[12px] font-normal leading-4 text-[#155dfc]">
            Est. completion: {est}
          </p>
        )
      ) : null}
    </div>
  )
}

function RequestRowOverdueCard({
  slaDue,
  est,
}: {
  slaDue?: string
  est?: string
}) {
  return (
    <div className="flex w-full flex-col rounded-lg border border-[#fecaca] bg-[#fef2f2] p-4 shadow-sm">
      <div className="flex flex-1 gap-3">
        <span className="mt-0.5 shrink-0 text-[#c10007]" aria-hidden>
          <svg
            className="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-medium leading-5 text-[#991b1b]">
            Overdue Request
          </p>
          <p className="mt-1 text-[14px] leading-5 text-[#b91c1c]">
            Expected completion was {slaDue ?? est}
          </p>
        </div>
      </div>
    </div>
  )
}

function RequestRowAccordionPanel({
  row,
  st,
  onEditVendor,
}: {
  row: AdminTicketRow
  st: ReturnType<typeof statusUi>
  onEditVendor: () => void
}) {
  const detail =
    row.detailDescription?.trim() || row.descriptionPreview
  const submitted =
    row.submittedAtDisplay?.trim() || row.submittedLabel
  const est = row.estimatedCompletion?.trim()
  const slaDue = row.dueAtDisplay?.trim()
  const showOverdue = Boolean(
    (row.isOverdue && est) || (row.isSlaOverdue && slaDue),
  )

  const vendorEditLabel =
    row.vendor != null && row.vendor !== ''
      ? `Edit vendor (${row.vendor})`
      : 'Edit vendor assignment'

  return (
    <div className="border-t border-[#e5e7eb] bg-[#fafafa] px-4 py-5 sm:px-5">
      <div className="flex min-w-[min(100%,1280px)] flex-col gap-4 xl:min-w-0 xl:flex-row xl:items-stretch xl:gap-4">
        <div className={accordionColumnWrap}>
          <div className="flex h-full w-full flex-col rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] leading-4 text-[#6a7282]">
                  Request ID
                </p>
                <p className="mt-0.5 font-mono text-[15px] font-semibold leading-6 tracking-[-0.2px] text-[#0a0a0a]">
                  {row.requestId}
                </p>
              </div>
              <span
                className={`inline-flex shrink-0 rounded px-3 py-1 text-[12px] font-medium ${st.pill} ${st.text}`}
              >
                {st.label}
              </span>
            </div>
            <div className="mt-4 flex min-h-0 flex-1 flex-col">
              <p className="text-[12px] leading-4 text-[#6a7282]">
                Full Issue Description
              </p>
              <div className="mt-2 min-h-[72px] flex-1 rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-3 py-3 text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                {detail}
              </div>
              <div className="mt-4">
                <p className="text-[12px] leading-4 text-[#6a7282]">
                  Submitted
                </p>
                <p className="mt-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                  {submitted}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div
          className={`${accordionColumnWrap} flex flex-col gap-4`}
        >
          <AssignedVendorCard
            vendorName={row.vendor}
            assignedVendorId={row.assignedVendorId}
            editLabel={vendorEditLabel}
            onEditVendor={onEditVendor}
            dueAtDisplay={slaDue}
            estimatedCompletion={est}
          />
          {showOverdue ? (
            <RequestRowOverdueCard slaDue={slaDue} est={est} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function resolveUnderReviewPanel(row: AdminTicketRow): UnderReviewPanelData {
  if (row.underReviewPanel) return row.underReviewPanel
  const fallbackVendors = row.vendor ? [row.vendor] : ['Select a vendor']
  return {
    recurringAlert:
      'Review resident history and routing rules before approving this request.',
    recurringPrevious: 'No prior linked requests in the dashboard demo.',
    recommendedVendorOptions: fallbackVendors,
    defaultRecommendedVendor: row.vendor,
  }
}

function uniqueVendorStrings(values: (string | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const v = raw?.trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

type VendorPickerRow = { name: string; category: string | null }

/** Vendors offered in the change-vendor modal: active vendors from the DB whose specialty matches this ticket’s category (same as User Management → Vendors). */
function buildVendorOptionsForRow(
  row: AdminTicketRow,
  activeVendorsFromDb: VendorPickerRow[],
): string[] {
  const slug = getIssueCategorySlugForTicket(row)
  const fromDb =
    slug != null
      ? activeVendorsFromDb
          .filter((v) =>
            vendorMatchesTicketIssueCategory(v.category, slug),
          )
          .map((v) => v.name.trim())
          .filter(Boolean)
      : []

  return uniqueVendorStrings(fromDb)
}

/**
 * When the accordion shows “no vendor” for demo rows, the modal should treat assignment as empty
 * even if `row.vendor` is populated for table preview.
 */
function currentVendorForChangeModal(row: AdminTicketRow): string {
  const v = row.vendor?.trim() ?? ''
  if (!v) return ''
  if (row.status === 'under_review') {
    const email = row.residentEmail.trim().toLowerCase()
    if (RESIDENT_EMAILS_ACCORDION_VENDOR_UNASSIGNED.has(email)) return ''
  }
  return v
}

function UnderReviewAccordionPanel({
  row,
  st,
  onEditVendor,
}: {
  row: AdminTicketRow
  st: ReturnType<typeof statusUi>
  onEditVendor: () => void
}) {
  const panel = resolveUnderReviewPanel(row)
  const detail =
    row.detailDescription?.trim() || row.descriptionPreview
  const submitted =
    row.submittedAtDisplay?.trim() || row.submittedLabel
  const est = row.estimatedCompletion?.trim()
  const slaDue = row.dueAtDisplay?.trim()
  const residentEmailNorm = row.residentEmail.trim().toLowerCase()
  const showVendorDetailsInAccordion =
    Boolean(row.vendor) &&
    !RESIDENT_EMAILS_ACCORDION_VENDOR_UNASSIGNED.has(residentEmailNorm)

  const vendorEditLabel =
    showVendorDetailsInAccordion && row.vendor
      ? `Edit vendor (${row.vendor})`
      : 'Edit vendor assignment'

  const defaultRec =
    panel.defaultRecommendedVendor &&
    panel.recommendedVendorOptions.includes(
      panel.defaultRecommendedVendor,
    )
      ? panel.defaultRecommendedVendor
      : (panel.recommendedVendorOptions[0] ?? '')

  const [recommendedPick, setRecommendedPick] = useState(defaultRec)

  const delayedVendors =
    panel.alternativeVendors != null && panel.alternativeVendors.length > 0
      ? panel.alternativeVendors
      : panel.recommendedVendorOptions

  const showRecurringCard = !panel.omitRecurringIssueCard
  const showVendorsDelayed =
    !RESIDENT_EMAILS_WITHOUT_VENDORS_DELAYED.has(residentEmailNorm)

  return (
    <div className="border-t border-[#e5e7eb] bg-[#fafafa] px-4 py-5 sm:px-5">
      <div className="flex min-w-[min(100%,1280px)] flex-col gap-4 xl:min-w-0 xl:flex-row xl:items-stretch xl:gap-4">
        <div className={accordionColumnWrap}>
          <div className="flex h-full w-full flex-col rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] leading-4 text-[#6a7282]">
                  Request ID
                </p>
                <p className="mt-0.5 font-mono text-[15px] font-semibold leading-6 tracking-[-0.2px] text-[#0a0a0a]">
                  {row.requestId}
                </p>
              </div>
              <span
                className={`inline-flex shrink-0 rounded px-3 py-1 text-[12px] font-medium ${st.pill} ${st.text}`}
              >
                {st.label}
              </span>
            </div>
            <div className="mt-4 flex min-h-0 flex-1 flex-col">
              <p className="text-[12px] leading-4 text-[#6a7282]">
                Full Issue Description
              </p>
              <div className="mt-2 min-h-[72px] flex-1 rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-3 py-3 text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                {detail}
              </div>
              <div className="mt-4">
                <p className="text-[12px] leading-4 text-[#6a7282]">
                  Submitted
                </p>
                <p className="mt-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                  {submitted}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className={accordionColumnWrap}>
          <AssignedVendorCard
            vendorName={
              showVendorDetailsInAccordion ? row.vendor : null
            }
            assignedVendorId={
              showVendorDetailsInAccordion ? row.assignedVendorId : undefined
            }
            editLabel={vendorEditLabel}
            onEditVendor={onEditVendor}
            dueAtDisplay={slaDue}
            estimatedCompletion={est}
          />
        </div>

        {showRecurringCard ? (
          <div className={accordionColumnWrap}>
            <div className="group flex h-full w-full flex-col rounded-lg border border-[#fcd34d] bg-[#fffbeb] p-4 shadow-sm transition-[border-color,background-color,box-shadow] duration-150 hover:border-[#fbbf24] hover:bg-[#fef3c7] hover:shadow-md">
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 shrink-0 text-[#d97706] transition-transform duration-150 group-hover:scale-110"
                  aria-hidden
                >
                  <svg
                    className="size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      d="M12 9v4m0 4h.01M10.3 4.8 2.2 16A2 2 0 004 17.8h16a2 2 0 001.8-1.8l-8.1-12a2 2 0 00-3.4 0z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <p className="min-w-0 text-[14px] font-semibold leading-5 text-[#b45309] transition-colors duration-150 group-hover:text-[#92400e]">
                  Recurring Issue - Approval Required
                </p>
              </div>
              <div className="mt-3 rounded-lg border border-[#fde68a] bg-white px-3 py-3 text-[13px] leading-5 transition-[border-color,background-color,box-shadow] duration-150 group-hover:border-[#fcd34d] group-hover:bg-[#fffefb] group-hover:shadow-sm">
                <p className="font-medium text-[#c2410c] transition-colors duration-150 group-hover:text-[#9a3412]">
                  <span className="font-semibold">Alert:</span>{' '}
                  {panel.recurringAlert}
                </p>
                <p className="mt-2 text-[#9a3412] transition-colors duration-150 group-hover:text-[#7c2d12]">
                  Previous issues: {panel.recurringPrevious}
                </p>
              </div>
              <div className="mt-4">
                <label
                  htmlFor={`recommended-vendor-${row.id}`}
                  className="text-[12px] font-medium leading-4 text-[#92400e] transition-colors duration-150 group-hover:text-[#78350f]"
                >
                  Recommended Vendors
                </label>
                <div className="relative mt-1.5">
                  <select
                    id={`recommended-vendor-${row.id}`}
                    value={recommendedPick}
                    onChange={(e) => setRecommendedPick(e.target.value)}
                    className="peer h-10 w-full cursor-pointer appearance-none rounded-lg border border-[#fcd34d] bg-white py-0 pl-3 pr-10 text-[14px] font-medium text-[#0a0a0a] outline-none transition-[border-color,background-color,box-shadow] duration-150 hover:border-[#f59e0b] hover:bg-[#fffbeb] hover:shadow-sm focus:border-[#d97706] focus:ring-2 focus:ring-[#fbbf24]/40"
                  >
                    {panel.recommendedVendorOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <span
                    className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-[#6a7282] transition-colors duration-150 peer-hover:text-[#92400e]"
                    aria-hidden
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </div>
              </div>
              <div className="mt-auto flex w-full gap-2 pt-5">
                <button
                  type="button"
                  disabled={!row.assignedVendorId}
                  title={
                    !row.assignedVendorId
                      ? 'Assign a vendor before updating status'
                      : undefined
                  }
                  className="inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-lg bg-[#00a63e] px-3 text-[14px] font-medium text-white outline-none transition-[background-color,transform,box-shadow] duration-150 hover:enabled:bg-[#008236] hover:enabled:shadow-sm active:enabled:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#00a63e] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={!row.assignedVendorId}
                  title={
                    !row.assignedVendorId
                      ? 'Assign a vendor before updating status'
                      : undefined
                  }
                  className="inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-lg bg-[#e5e7eb] px-3 text-[14px] font-medium text-[#0a0a0a] outline-none transition-[background-color,transform,box-shadow] duration-150 hover:enabled:bg-[#d1d5dc] hover:enabled:shadow-sm active:enabled:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Request Review
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showVendorsDelayed ? (
          <div className={accordionColumnWrap}>
            <div className="group flex h-full w-full flex-col rounded-lg border border-[#c4b5fd] bg-[#f5f3ff] p-4 shadow-sm transition-[border-color,background-color,box-shadow] duration-150 hover:border-[#a78bfa] hover:bg-[#ede9fe] hover:shadow-md">
              <div className="flex items-start gap-2">
                <SparkleIcon className="mt-0.5 size-5 shrink-0 text-[#7c3aed] transition-transform duration-150 group-hover:scale-110" />
                <p className="min-w-0 text-[14px] font-semibold leading-5 text-[#5b21b6] transition-colors duration-150 group-hover:text-[#4c1d95]">
                  Vendors Delayed - Alternative Recommendations
                </p>
              </div>
              <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
                {delayedVendors.length > 0 ? (
                  delayedVendors.map((name) => (
                    <div
                      key={name}
                      className="rounded-lg border border-[#ddd6fe] bg-white px-3 py-2.5 text-[14px] font-medium text-[#6d28d9] transition-[background-color,border-color,box-shadow] duration-150 hover:border-[#c4b5fd] hover:bg-[#faf5ff] hover:shadow-sm"
                    >
                      {name}
                    </div>
                  ))
                ) : (
                  <p className="rounded-lg border border-[#ddd6fe] bg-white px-3 py-2.5 text-[13px] text-[#6d28d9] transition-[background-color,border-color] duration-150 hover:border-[#c4b5fd] hover:bg-[#faf5ff]">
                    No alternative vendors suggested for this request.
                  </p>
                )}
              </div>
              <p className="mt-4 flex items-start gap-2 text-[11px] leading-4 text-[#7c3aed] transition-colors duration-150 group-hover:text-[#6d28d9]">
                <svg
                  className="mt-0.5 size-3 shrink-0 text-[#7c3aed] transition-colors duration-150 group-hover:text-[#6d28d9]"
                  viewBox="0 0 8 8"
                  aria-hidden
                >
                  <path fill="currentColor" d="M4 0 8 4 4 8 0 4z" />
                </svg>
                <span>
                  AI will automatically select an alternative vendor if no
                  selection is made within 48 hours.
                </span>
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function TableCheckbox({
  'aria-label': ariaLabel,
  disabled = false,
  className = '',
  checked,
  onChange,
  indeterminate = false,
}: {
  'aria-label': string
  disabled?: boolean
  className?: string
  checked?: boolean
  onChange?: ChangeEventHandler<HTMLInputElement>
  indeterminate?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = inputRef.current
    if (el) el.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      ref={inputRef}
      type="checkbox"
      disabled={disabled}
      aria-label={ariaLabel}
      checked={checked}
      onChange={onChange}
      className={`size-4 shrink-0 rounded border border-black/10 bg-[#f3f3f5] shadow-sm accent-[#944c73] transition-[background-color,border-color,box-shadow,opacity] duration-150 outline-none enabled:cursor-pointer hover:enabled:border-black/15 hover:enabled:bg-[#e8eaee] active:enabled:border-black/20 active:enabled:bg-[#dcdde3] focus:border-[#944c73]/45 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#944c73]/30 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-black/10 disabled:hover:bg-[#f3f3f5] disabled:focus:ring-0 disabled:active:bg-[#f3f3f5] ${className}`}
    />
  )
}

function ChipEditButton({ ariaLabel }: { ariaLabel: string }) {
  return (
    <button
      type="button"
      className="shrink-0 rounded p-0.5 text-[#6a7282] opacity-0 transition-opacity duration-150 hover:bg-black/10 hover:text-[#0a0a0a] group-hover/chip:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-1"
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
  const [tickets, setTickets] = useState<AdminTicketRow[]>(() =>
    DEMO_TICKETS.slice(),
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [urgencyFilter, setUrgencyFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [vendorModal, setVendorModal] = useState<{
    rowId: string
    currentVendor: string
    vendorOptions: string[]
  } | null>(null)
  const [vendorSaving, setVendorSaving] = useState(false)
  const [vendorSaveError, setVendorSaveError] = useState<string | null>(null)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const deleteConfirmTitleId = useId()
  const liveTicketsLoadedRef = useRef(false)

  const [activeVendorPickList, setActiveVendorPickList] = useState<
    VendorPickerRow[]
  >([])

  useEffect(() => {
    if (!supabase) {
      setActiveVendorPickList([])
      return
    }
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase
        .from('vendors')
        .select('name, category')
        .eq('active', true)
        .order('name')
      if (cancelled) return
      if (error) {
        console.error('[admin] vendors picker list failed', error.message)
        setActiveVendorPickList([])
        return
      }
      setActiveVendorPickList(
        (data ?? []).map((r) => ({
          name: typeof r.name === 'string' ? r.name : String(r.name ?? ''),
          category: r.category == null ? null : String(r.category),
        })),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadTickets() {
      if (!supabase) {
        setTickets(DEMO_TICKETS.slice())
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
        .order('created_at', { ascending: false })

      if (embedded.error) {
        console.warn(
          '[admin] maintenance_requests embed select failed; retrying without embed',
          embedded.error.message,
        )
        const plain = await supabase
          .from('maintenance_requests')
          .select('*')
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
          setTickets(DEMO_TICKETS.slice())
        }
        return
      }

      const rawList = rowsPayload ?? []
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

  const statSummaryItems = useMemo(
    () => [
      {
        label: 'Open Requests',
        value: String(tickets.length),
        hint: 'Total maintenance requests',
        valueClass: 'text-[#0a0a0a]',
        icon: 'house' as const,
      },
      {
        label: 'Urgent',
        value: String(
          tickets.filter((r) => r.urgency === 'urgent').length,
        ),
        hint: 'Requires immediate action',
        valueClass: 'text-[#e7000b]',
        icon: 'alert' as const,
      },
    ],
    [tickets],
  )

  const pipelineStats = useMemo(() => {
    const inProgress = tickets.filter((r) => r.status === 'in_progress').length
    const completed = tickets.filter((r) => r.status === 'completed').length
    const pipelineTotal = inProgress + completed
    const completedPct =
      pipelineTotal > 0
        ? Math.round((completed / pipelineTotal) * 100)
        : 0
    return { inProgress, completed, completedPct }
  }, [tickets])

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
                  <p className="text-[13px] leading-4 text-[#c10007]" role="alert">
                    {deleteError}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-3 pt-1">
                  <button
                    type="button"
                    disabled={deleteSaving || selectedCount === 0}
                    className="inline-flex h-9 min-w-0 flex-1 items-center justify-center rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#c10007] outline-none transition-colors hover:bg-[#fee2e2] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 sm:flex-initial"
                    onClick={() => void deleteSelectedTickets()}
                  >
                    {deleteSaving ? 'Deleting…' : 'Yes, delete permanently'}
                  </button>
                  <button
                    type="button"
                    disabled={deleteSaving}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
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
        <ChangeAssignedVendorModal
          open={vendorModal != null}
          currentVendor={vendorModal?.currentVendor ?? ''}
          vendorOptions={vendorModal?.vendorOptions ?? []}
          saving={vendorSaving}
          saveError={vendorSaveError}
          onClose={() => {
            if (vendorSaving) return
            setVendorSaveError(null)
            setVendorModal(null)
          }}
          onSave={async (nextVendor) => {
            if (!vendorModal) return
            setVendorSaveError(null)
            const row = tickets.find((r) => r.id === vendorModal.rowId)
            if (!row) {
              setVendorModal(null)
              return
            }
            const ticketUuid = resolveBackendTicketId(row)
            const reassignUrl = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
            const reassignSecret =
              import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim()
            if (ticketUuid && reassignUrl && reassignSecret) {
              setVendorSaving(true)
              try {
                const reassignResult = await postAdminReassignVendor({
                  url: reassignUrl,
                  secret: reassignSecret,
                  ticketId: ticketUuid,
                  vendorName: nextVendor,
                })
                setTickets((prev) =>
                  prev.map((r) =>
                    r.id === vendorModal.rowId
                      ? {
                          ...r,
                          vendor: nextVendor,
                          assignedVendorId: reassignResult.assigned_vendor_id,
                        }
                      : r,
                  ),
                )
              } catch (e) {
                setVendorSaveError(
                  e instanceof Error
                    ? e.message
                    : 'Could not save vendor assignment',
                )
                setVendorSaving(false)
                return
              }
              setVendorSaving(false)
            } else {
              setTickets((prev) =>
                prev.map((r) =>
                  r.id === vendorModal.rowId ? { ...r, vendor: nextVendor } : r,
                ),
              )
            }
            setVendorModal(null)
          }}
        />
        <header className="border-b border-[#e5e7eb] bg-white px-8 py-8">
          <h1 className="text-[22px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a] sm:text-[24px]">
            Request Management Dashboard
          </h1>
          <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            Maintenance Request Overview
          </p>
        </header>

        <main className="min-h-0 flex-1 overflow-auto px-8 py-8">
          <div className="w-full space-y-6">
            <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {statSummaryItems.map((s) => (
                <div
                  key={s.label}
                  className="flex h-full min-h-0 flex-col gap-y-3 rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]"
                >
                  <div className="flex shrink-0 items-start justify-between gap-2">
                    <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]">
                      {s.label}
                    </p>
                    <StatIcon name={s.icon} />
                  </div>
                  <div className="flex min-h-20 w-full min-w-0 flex-1 items-center">
                    <p
                      className={`text-[70px] font-light leading-none tracking-[0.0703px] tabular-nums ${s.valueClass}`}
                    >
                      {s.value}
                    </p>
                  </div>
                  <p className="shrink-0 text-[12px] leading-4 text-[#6a7282]">
                    {s.hint}
                  </p>
                </div>
              ))}
              <div className="flex h-full min-h-0 flex-col gap-y-3 rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                <div className="flex shrink-0 items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-[#6a7282]">
                      Completion rate
                    </span>
                    <span className="text-[20px] font-semibold leading-7 tracking-[0.02em] tabular-nums text-[#00a63e]">
                      {pipelineStats.completedPct}%
                    </span>
                  </div>
                  <IconProgressCompletedPair />
                </div>
                <div className="flex min-h-20 w-full min-w-0 flex-1 items-center">
                  <InProgressCompletedDonut
                    inProgress={pipelineStats.inProgress}
                    completed={pipelineStats.completed}
                  />
                </div>
                <p className="shrink-0 text-[12px] leading-4 text-[#6a7282]">
                  In progress and completed tickets in the active pipeline.
                </p>
              </div>
            </div>

            <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
              <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
                <div className="relative min-w-0 flex-1 lg:min-w-[240px]">
                  <span className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="size-4">
                      <path d="M7 12A5 5 0 107 2a5 5 0 000 10zm6 6l-3-3" strokeWidth={1.5} />
                    </svg>
                  </span>
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by resident, unit, or request ID..."
                    className="h-9 w-full rounded-lg border border-transparent bg-[#e8e9ed] py-1 pl-10 pr-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] shadow-none placeholder:text-[#717182] outline-none transition-[background-color,border-color,box-shadow] duration-150 hover:border-black/10 hover:bg-[#dfe0e6] active:border-black/15 active:bg-[#cfd0d6] focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
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
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors duration-150 hover:bg-[#e5e7eb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Clear selection
                  </button>
                  <button
                    type="button"
                    disabled={deleteSaving}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#c10007] outline-none transition-colors duration-150 hover:bg-[#fee2e2] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
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
              <p className="rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] leading-5 text-[#b91c1c]">
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
                        Request ID
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
                        Due (SLA)
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
                          No requests match your search or filters.
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
                              aria-label={`Select request ${row.requestId}`}
                              className="mt-1"
                              checked={selectedIds.has(row.id)}
                              onChange={() => toggleRowSelected(row.id)}
                            />
                          </td>
                          <td className="align-top px-3 py-4">
                            <p className="font-mono text-[14px] leading-5 text-[#0a0a0a]">
                              {row.requestId}
                            </p>
                            <p className="text-[12px] leading-4 text-[#6a7282]">
                              {row.submittedLabel}
                            </p>
                          </td>
                          <td className="align-top px-3 py-4">
                            <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                              {row.residentName}
                            </p>
                            <p className="text-[12px] leading-4 text-[#6a7282]">
                              {row.residentEmail}
                            </p>
                            {row.residentPhone ? (
                              <p className="text-[12px] leading-4 text-[#6a7282]">
                                {row.residentPhone}
                              </p>
                            ) : null}
                            <p className="text-[12px] leading-4 text-[#6a7282]">
                              {row.unit}
                            </p>
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
                            <p className="mt-2 max-w-[280px] text-[12px] leading-4 text-[#4a5565]">
                              {row.descriptionPreview}
                            </p>
                          </td>
                          <td className="align-top px-3 py-4">
                            <span
                              className={`inline-flex rounded px-3 py-1 text-[12px] font-medium ${st.pill} ${st.text}`}
                            >
                              {st.label}
                            </span>
                            {row.vendor ? (
                              <div className="mt-1">
                                <span className="inline-flex max-w-[min(100%,280px)] truncate rounded-lg border border-black/10 bg-[#fafafa] px-2.5 py-0.5 text-[12px] font-medium leading-4 text-[#4a5565]">
                                  {row.vendor}
                                </span>
                              </div>
                            ) : null}
                            {row.status === 'under_review' ? (
                              <p className="mt-1 flex items-center gap-1 text-[12px] text-[#9810fa]">
                                <SparkleIcon className="size-3 shrink-0" />
                                AI suggestions available
                              </p>
                            ) : null}
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
                            {row.dueAtDisplay ? (
                              <div className="flex flex-col gap-1.5">
                                <span
                                  className={`text-[14px] leading-5 ${
                                    row.isSlaOverdue
                                      ? 'font-medium text-[#b91c1c]'
                                      : 'text-[#0a0a0a]'
                                  }`}
                                >
                                  {row.dueAtDisplay}
                                </span>
                                {row.isSlaOverdue ? (
                                  <span className="inline-flex w-fit rounded-full bg-[#fee2e2] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#991b1b]">
                                    Overdue
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-[14px] text-[#99a1af]">—</span>
                            )}
                          </td>
                          <td className="align-top px-3 py-4">
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={`request-detail-${row.id}`}
                              id={`request-view-${row.id}`}
                              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[14px] font-medium tracking-[-0.1504px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 ${
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
                                {row.status === 'under_review' ? (
                                  <UnderReviewAccordionPanel
                                    key={row.id}
                                    row={row}
                                    st={st}
                                    onEditVendor={() => {
                                      setVendorSaveError(null)
                                      setVendorSaving(false)
                                      setVendorModal({
                                        rowId: row.id,
                                        currentVendor:
                                          currentVendorForChangeModal(row),
                                        vendorOptions: buildVendorOptionsForRow(
                                          row,
                                          activeVendorPickList,
                                        ),
                                      })
                                    }}
                                  />
                                ) : (
                                  <RequestRowAccordionPanel
                                    row={row}
                                    st={st}
                                    onEditVendor={() => {
                                      setVendorSaveError(null)
                                      setVendorSaving(false)
                                      setVendorModal({
                                        rowId: row.id,
                                        currentVendor:
                                          row.vendor?.trim() ?? '',
                                        vendorOptions: buildVendorOptionsForRow(
                                          row,
                                          activeVendorPickList,
                                        ),
                                      })
                                    }}
                                  />
                                )}
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
        className="peer h-9 min-w-[140px] appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] shadow-none outline-none transition-[background-color,border-color,box-shadow,opacity,color] duration-150 enabled:cursor-pointer hover:enabled:border-black/10 hover:enabled:bg-[#e8eaee] active:enabled:border-black/15 active:enabled:bg-[#dcdde3] focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-transparent disabled:hover:bg-[#f3f3f5] disabled:focus:ring-0 disabled:active:bg-[#f3f3f5]"
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
