import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabase'
import { normIssueCategory } from '@/lib/vendorIssueCategory'
import { AddPropertyModal, type AddPropertyFormPayload } from '@/components/AddPropertyModal'
import { ALL_UNIT_OPTIONS } from '@/lib/propertyUnitOptions'
import {
  buildUnitOptionsFromPropertyPayload,
  customUnitPickKey,
  inventoryKeyForAssignedUnit,
  type UnitCell,
  unitOptionKeyToCell,
  unitOptionValueToCell,
} from '@/lib/residentUnitKeys'
import { AddResidentModal, type AddResidentSubmitPayload } from '@/components/AddResidentModal'
import { DataIssuesModal } from '@/components/DataIssuesModal'
import { AssignUnitModal, type AssignUnitModalRow } from '@/components/AssignUnitModal'
import {
  EditResidentModal,
  type EditResidentModalRow,
  type EditResidentSavePayload,
} from '@/components/EditResidentModal'
import maintenanceVendorButtonIcon from '@/assets/Maintenance_Vendor.svg'
import maintenanceVendorRailIcon from '@/assets/Maintenance_Vendor_2.svg'

type ResidentStatus = 'active' | 'pending' | 'past_resident' | 'suspended'

type IssueTag = 'incomplete' | 'duplicate'

type VendorNotificationChannel = 'email' | 'sms' | 'both'

type VendorManagementRow = {
  id: string
  name: string
  category: string | null
  email: string | null
  phone: string | null
  notification_channel: VendorNotificationChannel
  active: boolean
  portal_api_key: string | null
}

const USER_MGMT_TABS = [
  { id: 'users' as const, label: 'Residents' },
  { id: 'vendors' as const, label: 'Vendors' },
] as const

type DashboardTab = (typeof USER_MGMT_TABS)[number]['id']

type UserManagementRow = {
  id: string
  residentId: string
  name: string
  initials: string
  email: string
  phone?: string
  unit: UnitCell
  status: ResidentStatus
  /** Balance owed; positive = amount due (red in UI). */
  balanceDue: number
  issues: IssueTag[]
  showLinkAction?: boolean
  moveInDate?: string | null
  leaseEndDate?: string | null
  /** Raw `public.users.unit` / `building` — occupancy eligibility uses ticket-style unit matching on `unit`. */
  unitDb: string | null
  buildingDb: string | null
}

type ResidentUserRowDb = {
  id: string
  resident_id: string | null
  full_name: string
  email: string
  phone: string | null
  unit: string | null
  building: string | null
  status: ResidentStatus | null
  balance_due: number | null
  issues: string[] | null
  move_in_date: string | null
  lease_end_date: string | null
}

const DEMO_ROWS: UserManagementRow[] = [
  {
    id: '1',
    residentId: 'RES-001',
    name: 'Sarah Johnson',
    initials: 'SJ',
    email: 'sarah.johnson@email.com',
    phone: '(555) 123-4567',
    unit: { kind: 'assigned', unit: '2B', building: 'Building A' },
    unitDb: '2B',
    buildingDb: 'Building A',
    status: 'active',
    balanceDue: 0,
    issues: [],
  },
  {
    id: '2',
    residentId: 'RES-002',
    name: 'Michael Chen',
    initials: 'MC',
    email: 'michael.chen@email.com',
    phone: '(555) 234-5678',
    unit: { kind: 'assigned', unit: '5A', building: 'Building A' },
    unitDb: '5A',
    buildingDb: 'Building A',
    status: 'active',
    balanceDue: 0,
    issues: [],
  },
  {
    id: '3',
    residentId: 'RES-003',
    name: 'Emily Rodriguez',
    initials: 'ER',
    email: 'emily.r@email.com',
    unit: { kind: 'assigned', unit: '12C', building: 'Building C' },
    unitDb: '12C',
    buildingDb: 'Building C',
    status: 'active',
    balanceDue: 0,
    issues: ['incomplete'],
  },
  {
    id: '4',
    residentId: 'RES-004',
    name: 'David Thompson',
    initials: 'DT',
    email: 'david.t@email.com',
    phone: '(555) 456-7890',
    unit: { kind: 'assigned', unit: '8B', building: 'Building B' },
    unitDb: '8B',
    buildingDb: 'Building B',
    status: 'active',
    balanceDue: 0,
    issues: [],
  },
  {
    id: '5',
    residentId: 'RES-005',
    name: 'Jessica Martinez',
    initials: 'JM',
    email: 'jessica.m@email.com',
    phone: '(555) 567-8901',
    unit: { kind: 'assigned', unit: '3D', building: 'Building A' },
    unitDb: '3D',
    buildingDb: 'Building A',
    status: 'active',
    balanceDue: 0,
    issues: [],
  },
  {
    id: '6',
    residentId: 'RES-006',
    name: 'Robert Kim',
    initials: 'RK',
    email: 'robert.kim@email.com',
    phone: '(555) 678-9012',
    unit: { kind: 'unassigned' },
    unitDb: null,
    buildingDb: null,
    status: 'pending',
    balanceDue: 0,
    issues: ['incomplete'],
    showLinkAction: true,
  },
  {
    id: '7',
    residentId: 'RES-007',
    name: 'Amanda Foster',
    initials: 'AF',
    email: 'amanda.f@email.com',
    phone: '(555) 789-0123',
    unit: { kind: 'assigned', unit: '7C', building: 'Building B' },
    unitDb: '7C',
    buildingDb: 'Building B',
    status: 'past_resident',
    balanceDue: 250,
    issues: [],
  },
  {
    id: '8',
    residentId: 'RES-008',
    name: 'James Wilson',
    initials: 'JW',
    email: 'james.w@email.com',
    phone: '(555) 890-1234',
    unit: { kind: 'assigned', unit: '9A', building: 'Building B' },
    unitDb: '9A',
    buildingDb: 'Building B',
    status: 'active',
    balanceDue: 0,
    issues: [],
  },
  {
    id: '9',
    residentId: 'RES-009',
    name: 'Lisa Wang',
    initials: 'LW',
    email: 'lisa.wang@email.com',
    phone: '(555) 901-2345',
    unit: { kind: 'assigned', unit: '12A', building: 'Building C' },
    unitDb: '12A',
    buildingDb: 'Building C',
    status: 'active',
    balanceDue: 0,
    issues: ['duplicate'],
  },
  {
    id: '10',
    residentId: 'RES-010',
    name: 'Thomas Anderson',
    initials: 'TA',
    email: 'thomas.a@email.com',
    phone: '(555) 012-3456',
    unit: { kind: 'assigned', unit: '15B', building: 'Building C' },
    unitDb: '15B',
    buildingDb: 'Building C',
    status: 'suspended',
    balanceDue: 1500,
    issues: [],
  },
]

/** Survives leaving `/admin/users` (outlet unmount) so property-derived units stay in Add/Edit resident pickers. */
const REGISTERED_PROPERTY_UNITS_SESSION_KEY =
  'proptech.admin.registeredPropertyUnitOptions.v1'

function parseRegisteredPropertyUnitOptionsFromStorage(
  raw: string | null,
): { value: string; label: string }[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: { value: string; label: string }[] = []
    for (const x of parsed) {
      if (
        x &&
        typeof x === 'object' &&
        typeof (x as { value?: unknown }).value === 'string' &&
        typeof (x as { label?: unknown }).label === 'string'
      ) {
        out.push({
          value: (x as { value: string }).value,
          label: (x as { label: string }).label,
        })
      }
    }
    return out
  } catch {
    return []
  }
}

function readRegisteredPropertyUnitsSession(): { value: string; label: string }[] {
  if (typeof sessionStorage === 'undefined') return []
  return parseRegisteredPropertyUnitOptionsFromStorage(
    sessionStorage.getItem(REGISTERED_PROPERTY_UNITS_SESSION_KEY),
  )
}

function writeRegisteredPropertyUnitsSession(rows: { value: string; label: string }[]) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(REGISTERED_PROPERTY_UNITS_SESSION_KEY, JSON.stringify(rows))
  } catch {
    /* ignore quota / private mode */
  }
}

function toEditResidentRow(row: UserManagementRow): EditResidentModalRow {
  return {
    id: row.id,
    residentId: row.residentId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    unit: row.unit,
    status: row.status,
  }
}

function toAssignUnitRow(row: UserManagementRow): AssignUnitModalRow {
  return { residentId: row.residentId, name: row.name }
}

const STATUS_FILTER = [
  { value: '', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'past_resident', label: 'Past Resident' },
  { value: 'suspended', label: 'Suspended' },
] as const

const UNIT_FILTER = [
  { value: '', label: 'All Units' },
  { value: 'a', label: 'Building A' },
  { value: 'b', label: 'Building B' },
  { value: 'c', label: 'Building C' },
  { value: 'unassigned', label: 'Unassigned' },
] as const

function statusPill(status: ResidentStatus) {
  switch (status) {
    case 'active':
      return (
        <span className="inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 bg-[#dcfce7] text-[#008236]">
          Active
        </span>
      )
    case 'pending':
      return (
        <span className="inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 bg-[#fef9c2] text-[#a65f00]">
          Pending
        </span>
      )
    case 'past_resident':
      return (
        <span className="inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 bg-[#f3f4f6] text-[#364153]">
          Past Resident
        </span>
      )
    case 'suspended':
      return (
        <span className="inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 bg-[#ffe2e2] text-[#c10007]">
          Suspended
        </span>
      )
    default:
      return null
  }
}

function issuePill(tag: IssueTag) {
  if (tag === 'incomplete') {
    return (
      <span
        key={tag}
        className="inline-flex rounded px-1.5 py-0.5 text-[12px] font-normal leading-4 bg-[#ffedd4] text-[#ca3500]"
      >
        Incomplete
      </span>
    )
  }
  return (
    <span
      key={tag}
      className="inline-flex rounded px-1.5 py-0.5 text-[12px] font-normal leading-4 bg-[#ffe2e2] text-[#c10007]"
    >
      Duplicate
    </span>
  )
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(n)
}

function rowMatchesFilters(
  row: UserManagementRow,
  q: string,
  status: string,
  unitFilter: string,
): boolean {
  const needle = q.trim().toLowerCase()
  if (needle) {
    const hay = [
      row.name,
      row.email,
      row.residentId,
      row.phone ?? '',
      row.unit.kind === 'assigned' ? `${row.unit.unit} ${row.unit.building}` : 'unassigned',
    ]
      .join(' ')
      .toLowerCase()
    if (!hay.includes(needle)) return false
  }
  if (status && row.status !== status) return false
  if (unitFilter) {
    if (unitFilter === 'unassigned') {
      if (row.unit.kind !== 'unassigned') return false
    } else {
      if (row.unit.kind !== 'assigned') return false
      const b = row.unit.building.toLowerCase()
      if (unitFilter === 'a' && !b.includes('building a')) return false
      if (unitFilter === 'b' && !b.includes('building b')) return false
      if (unitFilter === 'c' && !b.includes('building c')) return false
    }
  }
  return true
}

function IconUser({ className = 'size-5 shrink-0 text-[#155dfc]' }: { className?: string }) {
  return (
    <svg className={['block', className].join(' ')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconBuilding({ className = 'size-5 shrink-0 text-[#00a63e]' }: { className?: string }) {
  return (
    <svg className={['block', className].join(' ')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 21h18M5 21V7l7-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconSearch({ className = 'size-4 text-[#717182]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth={1.8} />
      <path d="M20 20l-3-3" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

function IconChevronDown({ className = 'size-4 text-[#0a0a0a]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

function IconMail({ className = 'size-3 text-[#4a5565]' }: { className?: string }) {
  return (
    <svg className={['block', className].join(' ')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16v12H4V6zm0 0l8 6 8-6"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconPhone({ className = 'size-3 text-[#4a5565]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 4h4l2 5-2 1a12 12 0 006 6l1-2 5 2v4a2 2 0 01-2 2A18 18 0 013 7a2 2 0 012-3z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconPencil({ className = 'size-4 text-[#4a5565]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconLink({ className = 'size-4 text-[#155dfc]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10 13a5 5 0 007.07 0l2-2a5 5 0 00-7.07-7.07l-1.5 1.5M14 11a5 5 0 00-7.07 0l-2 2a5 5 0 007.07 7.07l1.5-1.5"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}

function ResidentsNonResidentDonut({
  residents,
  nonResidents,
}: {
  residents: number
  nonResidents: number
}) {
  const total = residents + nonResidents
  const r = 23
  const stroke = 6
  const c = 2 * Math.PI * r
  const lenRes = total > 0 ? (residents / total) * c : 0
  const lenNon = total > 0 ? (nonResidents / total) * c : 0
  const vb = 56
  const cx = vb / 2
  const residentSharePct = total > 0 ? Math.round((residents / total) * 100) : 0

  return (
    <div className="flex min-h-20 w-full items-center gap-4">
      <div
        className="relative h-20 w-20 shrink-0"
        role="img"
        aria-label={`${residents} residents and ${nonResidents} non-resident accounts, ${total} total. Residents are ${residentSharePct} percent.`}
      >
        <svg className="size-full -rotate-90" viewBox={`0 0 ${vb} ${vb}`} aria-hidden>
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
          {lenRes > 0 ? (
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke="#155dfc"
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={`${lenRes} ${c}`}
            />
          ) : null}
          {lenNon > 0 ? (
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke="#f97316"
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={`${lenNon} ${c}`}
              strokeDashoffset={-lenRes}
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
          <span className="size-2 shrink-0 rounded-full bg-[#155dfc]" aria-hidden />
          <span className="min-w-0 text-[#364153]">Residents</span>
          <span className="ml-auto shrink-0 font-semibold tabular-nums text-[#101828]">{residents}</span>
        </li>
        <li className="flex items-center gap-2 text-[12px] leading-4">
          <span className="size-2 shrink-0 rounded-full bg-[#f97316]" aria-hidden />
          <span className="min-w-0 text-[#364153]">Non-resident</span>
          <span className="ml-auto shrink-0 font-semibold tabular-nums text-[#101828]">
            {nonResidents}
          </span>
        </li>
      </ul>
    </div>
  )
}

function OccupiedUnitsDonut({ occupied, total }: { occupied: number; total: number }) {
  const pct = total > 0 ? occupied / total : 0
  const r = 23
  const stroke = 6
  const c = 2 * Math.PI * r
  const dash = pct * c
  const vb = 56
  const cx = vb / 2
  const label = `${occupied}/${total}`

  return (
    <div
      className="relative h-20 w-20 shrink-0"
      role="img"
      aria-label={`${occupied} of ${total} units occupied`}
    >
      <svg className="size-full -rotate-90" viewBox={`0 0 ${vb} ${vb}`} aria-hidden>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="#00a63e"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="text-[15px] font-bold tabular-nums leading-none tracking-[-0.02em] text-[#101828]">
          {label}
        </span>
      </div>
    </div>
  )
}

const VENDOR_CHANNEL_OPTIONS: { value: VendorNotificationChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'both', label: 'Email & SMS' },
]

/**
 * Postgres stores trade slugs or null (generalist); see `normalize_vendor_categories` migration
 * and `vendors_category_check` (appliance | plumbing | electrical | null).
 */
const VENDOR_SPECIALTY_OPTIONS: { formValue: string; label: string; dbCategory: string | null }[] =
  [
    { formValue: 'appliance', label: 'Appliances', dbCategory: 'appliance' },
    { formValue: 'plumbing', label: 'Plumbing', dbCategory: 'plumbing' },
    { formValue: 'electrical', label: 'Electrical', dbCategory: 'electrical' },
    { formValue: 'household', label: 'Household', dbCategory: null },
    { formValue: 'pest', label: 'Pest Control', dbCategory: null },
    { formValue: 'exterior', label: 'Outside/Exterior House', dbCategory: null },
    { formValue: 'other', label: 'Other', dbCategory: null },
  ]

const VENDOR_FORM_VALUE_TO_DB = new Map(
  VENDOR_SPECIALTY_OPTIONS.map((o) => [o.formValue, o.dbCategory] as const),
)

const VENDOR_FORM_VALUE_SET = new Set(VENDOR_SPECIALTY_OPTIONS.map((o) => o.formValue))

/** Filter row: trade slugs + one bucket for null category. */
const VENDOR_CATEGORY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'appliance', label: 'Appliances' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: '__generalist__', label: 'Generalist' },
]

/** Legacy labels that were sent to DB before slugs; map to current form values. */
const VENDOR_SPECIALTY_LEGACY_LABEL_TO_FORM: Record<string, string> = {
  Appliances: 'appliance',
  Plumbing: 'plumbing',
  Electrical: 'electrical',
  Household: 'household',
  'Pest Control': 'pest',
  'Outside/Exterior House': 'exterior',
  Other: 'other',
  'Outside/Exterior House Other': 'other',
}

function displayVendorCategoryLabel(category: string | null | undefined): string {
  if (category == null || String(category).trim() === '') return ''
  const lower = String(category).trim().toLowerCase()
  if (lower === 'appliance') return 'Appliances'
  if (lower === 'plumbing') return 'Plumbing'
  if (lower === 'electrical') return 'Electrical'
  return String(category).trim()
}

function normalizeVendorCategoryForForm(raw: string | null | undefined): string {
  if (raw == null || raw === '') return 'other'
  const t = raw.trim()
  if (VENDOR_FORM_VALUE_SET.has(t)) return t
  const legacy = VENDOR_SPECIALTY_LEGACY_LABEL_TO_FORM[t]
  if (legacy && VENDOR_FORM_VALUE_SET.has(legacy)) return legacy
  const lower = t.toLowerCase()
  if (lower === 'appliance' || lower === 'appliances') return 'appliance'
  if (lower === 'plumbing') return 'plumbing'
  if (lower === 'electrical') return 'electrical'
  const n = normIssueCategory(t)
  if (n === 'appliance') return 'appliance'
  if (n === 'plumbing') return 'plumbing'
  if (n === 'electrical') return 'electrical'
  return t
}

function resolveVendorCategoryPayload(categorySelect: string):
  | { ok: true; payload: string | null }
  | { ok: false; message: string } {
  const catRaw = categorySelect.trim()
  if (!catRaw) return { ok: false, message: 'Specialty is required.' }
  let formKey = VENDOR_SPECIALTY_LEGACY_LABEL_TO_FORM[catRaw] ?? catRaw
  if (!VENDOR_FORM_VALUE_SET.has(formKey)) {
    const n = normIssueCategory(catRaw)
    if (n === 'appliance' || n === 'plumbing' || n === 'electrical') {
      formKey = n
    } else {
      return { ok: false, message: 'Please select a valid specialty from the list.' }
    }
  }
  return { ok: true, payload: VENDOR_FORM_VALUE_TO_DB.get(formKey) ?? null }
}

function normalizeVendorChannel(raw: unknown): VendorNotificationChannel {
  if (raw === 'sms' || raw === 'both' || raw === 'email') return raw
  return 'email'
}

function vendorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function residentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function toUnitCell(unit: string | null, building: string | null): UnitCell {
  if (!unit || !building) return { kind: 'unassigned' }
  return { kind: 'assigned', unit, building }
}

/** Past residents stay in the roster for history but do not count as occupying a unit for vacancy. */
function rowCurrentlyOccupiesAssignedUnit(
  row: UserManagementRow,
): row is UserManagementRow & { unit: { kind: 'assigned'; unit: string; building: string } } {
  if (row.status === 'past_resident') return false
  return row.unit.kind === 'assigned'
}

function sanitizeIssues(raw: string[] | null): IssueTag[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is IssueTag => x === 'incomplete' || x === 'duplicate')
}

function mapResidentDbRow(row: ResidentUserRowDb): UserManagementRow {
  return {
    id: row.id,
    residentId: row.resident_id ?? `RES-${row.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    name: row.full_name,
    initials: residentInitials(row.full_name),
    email: row.email,
    phone: row.phone ?? undefined,
    unit: toUnitCell(row.unit, row.building),
    status: row.status ?? 'active',
    balanceDue: row.balance_due ?? 0,
    issues: sanitizeIssues(row.issues),
    moveInDate: row.move_in_date ?? null,
    leaseEndDate: row.lease_end_date ?? null,
    unitDb: row.unit,
    buildingDb: row.building,
  }
}

const vendorFormInputClass =
  'h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30'

const vendorFormSelectClass =
  'h-9 w-full cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus-visible:border-[#944c73]/45 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-[#944c73]/30'

function VendorFormModal({
  open,
  mode,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean
  mode: 'add' | 'edit'
  initial: VendorManagementRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const titleId = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notificationChannel, setNotificationChannel] =
    useState<VendorNotificationChannel>('email')
  const [category, setCategory] = useState('')
  const [active, setActive] = useState(true)
  const [contactName, setContactName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (initial) {
      setName(initial.name)
      setCategory(normalizeVendorCategoryForForm(initial.category))
      setEmail(initial.email ?? '')
      setPhone(initial.phone ?? '')
      setNotificationChannel(mode === 'edit' && initial.notification_channel === 'both' ? 'email' : initial.notification_channel)
      setActive(initial.active)
      setContactName('')
    } else {
      setName('')
      setCategory('')
      setEmail('')
      setPhone('')
      setNotificationChannel('email')
      setActive(true)
      setContactName('')
    }
    setSaveError(null)
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function submit() {
    const n = name.trim()
    if (!n) {
      setSaveError('Name is required.')
      return
    }
    const categoryResolved = resolveVendorCategoryPayload(category)
    if (!categoryResolved.ok) {
      setSaveError(categoryResolved.message)
      return
    }
    const categoryPayload = categoryResolved.payload
    if (!supabase) {
      setSaveError('Supabase is not configured.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const emailPayload = email.trim() || null
      const phonePayload = phone.trim() || null
      if (mode === 'add') {
        console.log('[vendor-form] submit (add)', {
          name: n,
          category: categoryPayload,
          email: emailPayload,
          phone: phonePayload,
          notification_channel: notificationChannel,
          active,
        })
        const { error } = await supabase.from('vendors').insert({
          name: n,
          category: categoryPayload,
          email: emailPayload,
          phone: phonePayload,
          notification_channel: notificationChannel,
          active,
        })
        if (error) throw error
      } else if (initial) {
        console.log('[vendor-form] submit (update)', {
          id: initial.id,
          name: n,
          category: categoryPayload,
          email: emailPayload,
          phone: phonePayload,
          notification_channel: notificationChannel,
          active,
        })
        const { error } = await supabase
          .from('vendors')
          .update({
            name: n,
            category: categoryPayload,
            email: emailPayload,
            phone: phonePayload,
            notification_channel: notificationChannel,
            active,
          })
          .eq('id', initial.id)
        if (error) throw error
      }
      onSaved()
    } catch (e) {
      setSaveError(getErrorMessage(e, 'Save failed.'))
    } finally {
      setSaving(false)
    }
  }

  const emailSelected = notificationChannel === 'email' || notificationChannel === 'both'
  const smsSelected = notificationChannel === 'sms' || notificationChannel === 'both'

  function toggleEmailChannel() {
    if (emailSelected && smsSelected) {
      setNotificationChannel('sms')
      return
    }
    if (emailSelected) return
    setNotificationChannel(smsSelected ? 'both' : 'email')
  }

  function toggleSmsChannel() {
    if (smsSelected && emailSelected) {
      setNotificationChannel('email')
      return
    }
    if (smsSelected) return
    setNotificationChannel(emailSelected ? 'both' : 'sms')
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,672px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-[#e5e7eb] px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#dbeafe]">
              <img src={maintenanceVendorRailIcon} alt="" aria-hidden className="size-5 shrink-0" />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#101828]"
              >
                {mode === 'add' ? 'Add New Vendor' : 'Edit Vendor'}
              </h2>
              <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                {mode === 'add' ? 'Register a new service provider' : initial?.name ?? 'Update vendor details'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-[#6a7282] outline-none hover:bg-black/5 hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-6">
          <div className="flex flex-col gap-4 pb-6">
            {saveError ? (
              <p className="rounded-lg border border-[#ffc9c9] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
                {saveError}
              </p>
            ) : null}
            <div className="space-y-2">
              <label htmlFor="vendor-form-name" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Company Name <span className="text-[#c10007]">*</span>
              </label>
              <input
                id="vendor-form-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={vendorFormInputClass}
                autoComplete="organization"
                placeholder="e.g., QuickFix Plumbing"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="vendor-form-contact-name" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Contact Name <span className="text-[#c10007]">*</span>
              </label>
              <input
                id="vendor-form-contact-name"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className={vendorFormInputClass}
                placeholder="e.g., John Smith"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="vendor-form-email" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                  Email Address <span className="text-[#c10007]">*</span>
                </label>
                <input
                  id="vendor-form-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={vendorFormInputClass}
                  placeholder="e.g., contact@company.com"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="vendor-form-phone" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                  Phone Number <span className="text-[#c10007]">*</span>
                </label>
                <input
                  id="vendor-form-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={vendorFormInputClass}
                  placeholder="e.g., (555) 123-4567"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="vendor-form-category" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Specialty <span className="text-[#c10007]">*</span>
              </label>
              <div className="relative">
                <select
                  id="vendor-form-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={vendorFormSelectClass}
                >
                  <option value="">Select a specialty</option>
                  {VENDOR_SPECIALTY_OPTIONS.map((option) => (
                    <option key={option.formValue} value={option.formValue}>
                      {option.label}
                    </option>
                  ))}
                  {category &&
                  !VENDOR_FORM_VALUE_SET.has(category) &&
                  !VENDOR_SPECIALTY_LEGACY_LABEL_TO_FORM[category] ? (
                    <option value={category}>{category} (invalid — choose a listed specialty)</option>
                  ) : null}
                </select>
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                  <IconChevronDown />
                </span>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                Delivery Channel <span className="text-[#c10007]">*</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={toggleEmailChannel}
                    className={[
                      'rounded-[10px] border-2 px-[18px] pb-[10px] pt-[12px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                      emailSelected
                        ? 'border-[#2b7fff] bg-[#eff6ff]'
                        : 'border-[#e5e7eb] bg-white hover:bg-[#f9fafb]',
                    ].join(' ')}
                    aria-pressed={emailSelected}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={[
                          'inline-flex size-4 items-center justify-center rounded-[4px] border text-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]',
                          emailSelected
                            ? 'border-[#030213] bg-[#030213]'
                            : 'border-black/10 bg-[#f3f3f5]',
                        ].join(' ')}
                        aria-hidden
                      >
                        {emailSelected ? (
                          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="m5 12 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <span>
                        <span className="block text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">Email</span>
                        <span className="block text-[12px] leading-4 text-[#6a7282]">Standard delivery, can be combined</span>
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={toggleSmsChannel}
                    className={[
                      'rounded-[10px] border-2 px-[18px] pb-[10px] pt-[12px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                      smsSelected
                        ? 'border-[#2b7fff] bg-[#eff6ff]'
                        : 'border-[#e5e7eb] bg-white hover:bg-[#f9fafb]',
                    ].join(' ')}
                    aria-pressed={smsSelected}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={[
                          'inline-flex size-4 items-center justify-center rounded-[4px] border text-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]',
                          smsSelected
                            ? 'border-[#030213] bg-[#030213]'
                            : 'border-black/10 bg-[#f3f3f5]',
                        ].join(' ')}
                        aria-hidden
                      >
                        {smsSelected ? (
                          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="m5 12 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <span>
                        <span className="block text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">SMS</span>
                        <span className="block text-[12px] leading-4 text-[#6a7282]">Immediate delivery</span>
                      </span>
                    </div>
                  </button>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                Status
              </p>
              <div className="flex w-full rounded-[10px] border border-[#e5e7eb] bg-[#f3f3f5] p-1">
                <button
                  type="button"
                  onClick={() => setActive(true)}
                  className={[
                    'h-8 flex-1 rounded-[8px] px-4 text-[14px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-1',
                    active ? 'bg-white text-[#0a0a0a] shadow-sm' : 'text-[#6a7282] hover:text-[#0a0a0a]',
                  ].join(' ')}
                  aria-pressed={active}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setActive(false)}
                  className={[
                    'h-8 flex-1 rounded-[8px] px-4 text-[14px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-1',
                    !active ? 'bg-white text-[#0a0a0a] shadow-sm' : 'text-[#6a7282] hover:text-[#0a0a0a]',
                  ].join(' ')}
                  aria-pressed={!active}
                >
                  Inactive
                </button>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 py-4">
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={() => void submit()}
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-[#155dfc] px-4 text-[14px] font-medium text-white outline-none transition-colors hover:bg-[#1447e6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
       
            {saving ? 'Saving…' : mode === 'add' ? 'Add Vendor' : 'Save Changes'}
          </button>
       
        </footer>
      </div>
    </div>
  )
}

function channelLabel(c: VendorNotificationChannel): string {
  return VENDOR_CHANNEL_OPTIONS.find((o) => o.value === c)?.label ?? c
}

function isActiveJobStatus(rawStatus: unknown): boolean {
  const normalized = String(rawStatus ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
  return normalized !== 'completed' && normalized !== 'done' && normalized !== 'closed'
}

function VendorManagementTabContent({
  vendorSearch,
  vendorCategoryFilter,
  vendorStatusFilter,
  openRailRequest,
  initialOpenVendorId,
  onConsumedInitialOpenVendorId,
}: {
  vendorSearch: string
  vendorCategoryFilter: string
  vendorStatusFilter: string
  openRailRequest: { id: number; mode: 'add' } | null
  /** From `/admin/users?vendorId=…` — open edit modal once the vendor list has loaded. */
  initialOpenVendorId: string | null
  onConsumedInitialOpenVendorId: () => void
}) {
  const [vendors, setVendors] = useState<VendorManagementRow[]>([])
  const [activeJobCountsByVendor, setActiveJobCountsByVendor] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [vendorModal, setVendorModal] = useState<
    { mode: 'add' } | { mode: 'edit'; vendor: VendorManagementRow } | null
  >(null)
  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<string>>(() => new Set())
  const [deleteVendorsSaving, setDeleteVendorsSaving] = useState(false)
  const [deleteVendorsError, setDeleteVendorsError] = useState<string | null>(null)
  const lastHandledOpenRailRequestIdRef = useRef(0)
  const handledDeepLinkVendorIdRef = useRef<string | null>(null)

  useEffect(() => {
    handledDeepLinkVendorIdRef.current = null
  }, [initialOpenVendorId])

  useEffect(() => {
    const id = initialOpenVendorId?.trim() ?? ''
    if (!id || loading) return
    if (handledDeepLinkVendorIdRef.current === id) return
    const match = vendors.find((v) => v.id === id)
    if (match) {
      setVendorModal({ mode: 'edit', vendor: match })
    }
    handledDeepLinkVendorIdRef.current = id
    onConsumedInitialOpenVendorId()
  }, [
    initialOpenVendorId,
    loading,
    vendors,
    onConsumedInitialOpenVendorId,
  ])

  const loadVendors = useCallback(async () => {
    if (!supabase) {
      setLoadError(null)
      setVendors([])
      setActiveJobCountsByVendor({})
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('vendors')
      .select('id, name, category, email, phone, notification_channel, active, portal_api_key')
      .order('name')
    const { data: ticketRows, error: ticketError } = await supabase
      .from('maintenance_requests')
      .select('assigned_vendor_id, status')
      .not('assigned_vendor_id', 'is', null)
    if (error) {
      setLoadError(error.message)
      setVendors([])
      setActiveJobCountsByVendor({})
    } else if (ticketError) {
      setLoadError(ticketError.message)
      setVendors([])
      setActiveJobCountsByVendor({})
    } else {
      setVendors(
        (data ?? []).map((row) => ({
          ...row,
          notification_channel: normalizeVendorChannel(row.notification_channel),
        })),
      )
      const activeCounts: Record<string, number> = {}
      for (const row of ticketRows ?? []) {
        const _vendorId = row.assigned_vendor_id
        if (typeof _vendorId !== 'string' || !_vendorId) continue
        if (!isActiveJobStatus(row.status)) continue
        activeCounts[_vendorId] = (activeCounts[_vendorId] ?? 0) + 1
      }
      setActiveJobCountsByVendor(activeCounts)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadVendors()
  }, [loadVendors])

  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase()
    return vendors.filter((v) => {
      const matchesSearch =
        !q ||
        v.name.toLowerCase().includes(q) ||
        (v.category?.toLowerCase().includes(q) ?? false) ||
        (v.email?.toLowerCase().includes(q) ?? false) ||
        (v.phone?.toLowerCase().includes(q) ?? false)
      if (!matchesSearch) return false

      const matchesCategory =
        !vendorCategoryFilter ||
        (vendorCategoryFilter === '__generalist__'
          ? v.category == null || String(v.category).trim() === ''
          : (v.category?.toLowerCase() ?? '') === vendorCategoryFilter.toLowerCase())
      if (!matchesCategory) return false

      if (!vendorStatusFilter) return true
      if (vendorStatusFilter === 'active') return v.active
      if (vendorStatusFilter === 'inactive') return !v.active
      return true
    })
  }, [vendors, vendorSearch, vendorCategoryFilter, vendorStatusFilter])
  const selectedVendorCount = selectedVendorIds.size
  const allFilteredVendorsSelected =
    filteredVendors.length > 0 && filteredVendors.every((v) => selectedVendorIds.has(v.id))

  function toggleVendorSelected(id: string) {
    setSelectedVendorIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFilteredVendorsSelected() {
    setSelectedVendorIds((prev) => {
      const next = new Set(prev)
      if (allFilteredVendorsSelected) {
        for (const row of filteredVendors) next.delete(row.id)
      } else {
        for (const row of filteredVendors) next.add(row.id)
      }
      return next
    })
  }

  async function deleteSelectedVendors() {
    if (selectedVendorIds.size === 0) return
    setDeleteVendorsError(null)
    const idsToDelete = Array.from(selectedVendorIds)
    if (supabase) {
      setDeleteVendorsSaving(true)
      const { error } = await supabase.from('vendors').delete().in('id', idsToDelete)
      if (error) {
        setDeleteVendorsError(error.message)
        setDeleteVendorsSaving(false)
        return
      }
      setDeleteVendorsSaving(false)
    }
    setVendors((prev) => prev.filter((row) => !selectedVendorIds.has(row.id)))
    setSelectedVendorIds(new Set())
  }

  useEffect(() => {
    if (!openRailRequest) return
    if (openRailRequest.id <= lastHandledOpenRailRequestIdRef.current) return
    if (vendorModal) return
    lastHandledOpenRailRequestIdRef.current = openRailRequest.id
    if (openRailRequest.mode === 'add') {
      setVendorModal({ mode: 'add' })
    }
  }, [openRailRequest, vendorModal])

  return (
    <div>
      {!supabase ? (
        <div className="rounded-[10px] border border-[#fed7aa] bg-[#fffbeb] px-[17px] py-4 text-[14px] text-[#9a3412] shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          Supabase is not configured. Add <code className="font-mono text-[13px]">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono text-[13px]">VITE_SUPABASE_ANON_KEY</code> to your environment and restart the dev
          server.
        </div>
      ) : null}
      {selectedVendorCount > 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
            <span className="font-medium">{selectedVendorCount}</span>
            {selectedVendorCount === 1 ? ' vendor selected' : ' vendors selected'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedVendorIds(new Set())}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
            >
              Clear selection
            </button>
            <button
              type="button"
              disabled={deleteVendorsSaving}
              onClick={() => void deleteSelectedVendors()}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 text-[14px] font-medium text-[#c10007] outline-none hover:bg-[#fee2e2] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {deleteVendorsSaving ? 'Deleting…' : 'Delete selected'}
            </button>
          </div>
        </div>
      ) : null}
      {deleteVendorsError ? (
        <p className="mb-3 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] leading-5 text-[#b91c1c]">
          Could not delete selected vendors: {deleteVendorsError}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        {loading ? (
          <p className="px-4 py-10 text-center text-[14px] text-[#6a7282]">Loading vendors…</p>
        ) : loadError ? (
          <p className="px-4 py-10 text-center text-[14px] text-[#b91c1c]">{loadError}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[#e5e7eb] bg-[#f9fafb]">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all vendors"
                      checked={allFilteredVendorsSelected}
                      onChange={toggleAllFilteredVendorsSelected}
                      className="size-4 rounded border-black/10"
                    />
                  </th>
                  {['Vendor', 'Category', 'Contact', 'Notifications', 'Status', 'Active jobs', 'Actions'].map((h) => (
                    <th
                      key={h}
                      className={[
                        'px-4 py-3 text-[12px] font-medium leading-4 text-[#4a5565]',
                        h === 'Actions' ? 'text-right' : '',
                      ].join(' ')}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredVendors.map((row) => (
                  <tr key={row.id} className="border-b border-[#e5e7eb] last:border-b-0">
                    <td className="px-4 py-3 align-middle">
                      <input
                        type="checkbox"
                        aria-label={`Select vendor ${row.name}`}
                        checked={selectedVendorIds.has(row.id)}
                        onChange={() => toggleVendorSelected(row.id)}
                        className="size-4 rounded border-black/10"
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dcfce7] text-[14px] font-medium tracking-[-0.1504px] text-[#00a63e]">
                          {vendorInitials(row.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                            {row.name}
                          </p>
                          <p className="text-[12px] leading-4 text-[#6a7282]">Vendor</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      {row.category ? (
                        <span className="text-[12px] leading-4 text-[#4a5565]">
                          {displayVendorCategoryLabel(row.category)}
                        </span>
                      ) : (
                        <span className="text-[12px] text-[#6a7282]">Generalist</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex flex-col gap-1">
                        {row.email ? (
                          <div className="flex items-center gap-2">
                            <IconMail />
                            <span className="text-[12px] leading-4 text-[#4a5565]">{row.email}</span>
                          </div>
                        ) : (
                          <span className="text-[12px] text-[#6a7282]">—</span>
                        )}
                        {row.phone ? (
                          <div className="flex items-center gap-2">
                            <IconPhone />
                            <span className="text-[12px] leading-4 text-[#4a5565]">{row.phone}</span>
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="inline-flex rounded-full bg-[#f3f4f6] px-2.5 py-0.5 text-[12px] font-medium text-[#364153]">
                        {channelLabel(row.notification_channel)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      {row.active ? (
                        <span className="text-[12px] font-medium text-[#00a63e]">Active</span>
                      ) : (
                        <span className="text-[12px] font-medium text-[#6a7282]">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="text-[12px] font-medium text-[#4a5565]">{activeJobCountsByVendor[row.id] ?? 0}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          aria-label={`Edit ${row.name}`}
                          onClick={() => setVendorModal({ mode: 'edit', vendor: row })}
                          disabled={!supabase}
                          className="flex size-7 items-center justify-center rounded outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                        >
                          <IconPencil />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredVendors.length === 0 ? (
              <p className="px-4 py-10 text-center text-[14px] text-[#6a7282]">
                {vendors.length === 0 ? 'No vendors yet. Add one to get started.' : 'No vendors match your search.'}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {vendorModal ? (
        <VendorFormModal
          open
          mode={vendorModal.mode}
          initial={vendorModal.mode === 'edit' ? vendorModal.vendor : null}
          onClose={() => setVendorModal(null)}
          onSaved={() => {
            setVendorModal(null)
            void loadVendors()
          }}
        />
      ) : null}
    </div>
  )
}

export function AdminUserManagementDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const _vendorIdFromUrl = searchParams.get('vendorId')
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('users')
  const [residents, setResidents] = useState<UserManagementRow[]>([])
  const [selectedResidentIds, setSelectedResidentIds] = useState<Set<string>>(() => new Set())
  const [residentOpError, setResidentOpError] = useState<string | null>(null)
  /** Set when Supabase is configured but loading `public.users` fails — we do not fall back to demo rows (fake ids). */
  const [residentsFetchError, setResidentsFetchError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [addResidentOpen, setAddResidentOpen] = useState(false)
  const [addPropertyOpen, setAddPropertyOpen] = useState(false)
  const [propertyRegisterNotice, setPropertyRegisterNotice] = useState<string | null>(null)
  const [dataIssuesOpen, setDataIssuesOpen] = useState(false)
  const [editResidentRow, setEditResidentRow] = useState<EditResidentModalRow | null>(null)
  const [assignUnitRow, setAssignUnitRow] = useState<AssignUnitModalRow | null>(null)
  const [vendorSearch, setVendorSearch] = useState('')
  const [vendorCategoryFilter, setVendorCategoryFilter] = useState('')
  const [vendorStatusFilter, setVendorStatusFilter] = useState('')
  const [openVendorRailRequest, setOpenVendorRailRequest] = useState<{ id: number; mode: 'add' } | null>(null)
  /** Unit rows when admin registers a property (local until a properties API exists); persisted for this tab session. */
  const [registeredPropertyUnitOptions, setRegisteredPropertyUnitOptions] = useState<
    { value: string; label: string }[]
  >(() => readRegisteredPropertyUnitsSession())

  const filteredRows = useMemo(
    () => residents.filter((r) => rowMatchesFilters(r, search, statusFilter, unitFilter)),
    [residents, search, statusFilter, unitFilter],
  )

  const vacantUnitOptions = useMemo(() => {
    return ALL_UNIT_OPTIONS.filter((opt) => {
      const cell = unitOptionValueToCell(opt.value)
      if (cell.kind !== 'assigned') return false
      return !residents.some((r) => {
        if (!rowCurrentlyOccupiesAssignedUnit(r)) return false
        return r.unit.unit === cell.unit && r.unit.building === cell.building
      })
    })
  }, [residents])

  const vacantPropertyUnitOptions = useMemo(() => {
    return registeredPropertyUnitOptions.filter((opt) => {
      const cell = unitOptionKeyToCell(opt.value)
      if (cell.kind !== 'assigned') return false
      return !residents.some((r) => {
        if (!rowCurrentlyOccupiesAssignedUnit(r)) return false
        return r.unit.unit === cell.unit && r.unit.building === cell.building
      })
    })
  }, [registeredPropertyUnitOptions, residents])

  const combinedVacantUnitOptions = useMemo((): { value: string; label: string }[] => {
    const seen = new Set<string>()
    const out: { value: string; label: string }[] = []
    for (const o of [...vacantUnitOptions, ...vacantPropertyUnitOptions]) {
      if (seen.has(o.value)) continue
      seen.add(o.value)
      out.push(o)
    }
    return out
  }, [vacantUnitOptions, vacantPropertyUnitOptions])

  const editResidentUnitOptions = useMemo((): { value: string; label: string }[] => {
    const opts: { value: string; label: string }[] = [...combinedVacantUnitOptions]
    if (!editResidentRow || editResidentRow.unit.kind === 'unassigned') return opts

    const { unit, building } = editResidentRow.unit
    const inv = inventoryKeyForAssignedUnit(unit, building)
    if (inv) {
      if (!opts.some((o) => o.value === inv)) {
        const def = ALL_UNIT_OPTIONS.find((o) => o.value === inv)
        if (def) opts.unshift({ value: def.value, label: def.label })
      }
    } else {
      const ck = customUnitPickKey(unit, building)
      if (!opts.some((o) => o.value === ck)) {
        opts.unshift({ value: ck, label: `${unit} — ${building} (current)` })
      }
    }
    return opts
  }, [combinedVacantUnitOptions, editResidentRow])

  const editResidentInitialUnitKey = useMemo(() => {
    if (!editResidentRow || editResidentRow.unit.kind === 'unassigned') return ''
    const { unit, building } = editResidentRow.unit
    const inv = inventoryKeyForAssignedUnit(unit, building)
    if (inv) return inv
    return customUnitPickKey(unit, building)
  }, [editResidentRow])

  /**
   * Inventory units (`ALL_UNIT_OPTIONS`) plus units from registered properties; occupied = roster match.
   * `rowCurrentlyOccupiesAssignedUnit` excludes `past_resident`, so they count as vacant for this rate.
   */
  const occupancyUnitStats = useMemo(() => {
    const inventoryTotal = ALL_UNIT_OPTIONS.filter(
      (opt) => unitOptionValueToCell(opt.value).kind === 'assigned',
    ).length
    const extraTotal = registeredPropertyUnitOptions.length
    const totalUnits = inventoryTotal + extraTotal
    const inventoryOccupied = inventoryTotal - vacantUnitOptions.length
    const propertyOccupied = extraTotal - vacantPropertyUnitOptions.length
    const occupied = Math.max(0, inventoryOccupied + propertyOccupied)
    const pct = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0
    return { occupied, totalUnits, pct }
  }, [vacantUnitOptions, vacantPropertyUnitOptions, registeredPropertyUnitOptions])

  /**
   * Residents vs non-residents by **status only**: `past_resident` counts as non-resident; whether a unit is
   * assigned does not change this split (active / pending / suspended always count as residents).
   */
  const residentStatusStats = useMemo(() => {
    let asResidents = 0
    let asNonResidents = 0
    for (const r of residents) {
      if (r.status === 'past_resident') asNonResidents += 1
      else asResidents += 1
    }
    const total = asResidents + asNonResidents
    const sharePct =
      total > 0 ? Math.round((asResidents / total) * 100) : 0
    return { asResidents, asNonResidents, sharePct }
  }, [residents])

  const loadResidents = useCallback(async () => {
    if (!supabase) {
      setResidentsFetchError(null)
      setResidents(DEMO_ROWS)
      return
    }
    const { data, error } = await supabase
      .from('users')
      .select(
        'id, resident_id, full_name, email, phone, unit, building, status, balance_due, issues, move_in_date, lease_end_date',
      )
    if (error) {
      console.error('[user-management] users fetch failed', error.message)
      setResidentsFetchError(error.message)
      setResidents([])
      return
    }
    setResidentsFetchError(null)
    setResidents(((data ?? []) as ResidentUserRowDb[]).map(mapResidentDbRow))
  }, [])

  useEffect(() => {
    void loadResidents()
  }, [loadResidents])

  useLayoutEffect(() => {
    if (_vendorIdFromUrl?.trim()) {
      setDashboardTab('vendors')
    }
  }, [_vendorIdFromUrl])

  const handleConsumedVendorDeepLink = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('vendorId')
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  const handleResidentSave = useCallback(
    async (payload: EditResidentSavePayload) => {
      setResidentOpError(null)
      const unitCell = unitOptionKeyToCell(payload.unitOptionKey)
      if (supabase) {
        const { data, error } = await supabase
          .from('users')
          .update({
            full_name: payload.fullName,
            email: payload.email,
            phone: payload.phone ?? null,
            status: payload.status,
            unit: unitCell.kind === 'assigned' ? unitCell.unit : null,
            building: unitCell.kind === 'assigned' ? unitCell.building : null,
          })
          .eq('id', payload.id)
          .select('id')
          .maybeSingle()
        if (error) {
          setResidentOpError(error.message)
          throw new Error(error.message)
        }
        if (!data) {
          const msg =
            'No row was updated. Check that this resident exists in the database and your id matches public.users.id.'
          setResidentOpError(msg)
          throw new Error(msg)
        }
        await loadResidents()
        return
      }
      setResidents((prev) =>
        prev.map((r) =>
          r.id === payload.id
            ? {
                ...r,
                name: payload.fullName,
                initials: residentInitials(payload.fullName),
                email: payload.email,
                phone: payload.phone,
                status: payload.status,
                unit: unitCell,
                unitDb: unitCell.kind === 'assigned' ? unitCell.unit : null,
                buildingDb: unitCell.kind === 'assigned' ? unitCell.building : null,
              }
            : r,
        ),
      )
    },
    [loadResidents],
  )
  const selectedResidentCount = selectedResidentIds.size
  const allFilteredResidentsSelected =
    filteredRows.length > 0 && filteredRows.every((row) => selectedResidentIds.has(row.id))

  function toggleResidentSelected(id: string) {
    setSelectedResidentIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFilteredResidentsSelected() {
    setSelectedResidentIds((prev) => {
      const next = new Set(prev)
      if (allFilteredResidentsSelected) {
        for (const row of filteredRows) next.delete(row.id)
      } else {
        for (const row of filteredRows) next.add(row.id)
      }
      return next
    })
  }

  async function deleteSelectedResidents() {
    if (selectedResidentIds.size === 0) return
    setResidentOpError(null)
    const idsToDelete = Array.from(selectedResidentIds)
    if (supabase) {
      const { error } = await supabase.from('users').delete().in('id', idsToDelete)
      if (error) {
        setResidentOpError(error.message)
        return
      }
    }
    setResidents((prev) => prev.filter((row) => !selectedResidentIds.has(row.id)))
    setSelectedResidentIds(new Set())
  }

  async function addResidentFromModal(payload: AddResidentSubmitPayload) {
    setResidentOpError(null)
    const currentMaxResidentNumber = residents.reduce((max, row) => {
      const n = Number.parseInt(row.residentId.replace(/^RES-/, ''), 10)
      return Number.isFinite(n) ? Math.max(max, n) : max
    }, 0)
    const nextResidentNumber = currentMaxResidentNumber + 1
    const residentId = `RES-${String(nextResidentNumber).padStart(3, '0')}`
    const unitCell: UnitCell = payload.unit ? unitOptionKeyToCell(payload.unit) : { kind: 'unassigned' }

    if (supabase) {
      const { data, error } = await supabase
        .from('users')
        .insert({
          resident_id: residentId,
          full_name: payload.fullName,
          email: payload.email,
          phone: payload.phone || null,
          unit: unitCell.kind === 'assigned' ? unitCell.unit : null,
          building: unitCell.kind === 'assigned' ? unitCell.building : null,
          status: payload.status,
          balance_due: 0,
          issues: [],
        })
        .select(
          'id, resident_id, full_name, email, phone, unit, building, status, balance_due, issues, move_in_date, lease_end_date',
        )
        .single()
      if (error) {
        setResidentOpError(error.message)
        return
      }
      setResidents((prev) => [mapResidentDbRow(data as ResidentUserRowDb), ...prev])
      return
    }

    setResidents((prev) => [
      {
        id: `${Date.now()}-${residentId}`,
        residentId,
        name: payload.fullName,
        initials: residentInitials(payload.fullName),
        email: payload.email,
        phone: payload.phone || undefined,
        unit: unitCell,
        unitDb: unitCell.kind === 'assigned' ? unitCell.unit : null,
        buildingDb: unitCell.kind === 'assigned' ? unitCell.building : null,
        status: payload.status,
        balanceDue: 0,
        issues: [],
      },
      ...prev,
    ])
  }

  function addPropertyFromModal(payload: AddPropertyFormPayload) {
    setResidentOpError(null)
    setRegisteredPropertyUnitOptions((prev) => {
      const next = buildUnitOptionsFromPropertyPayload(payload)
      const seen = new Set(prev.map((o) => o.value))
      const merged = [...prev]
      for (const o of next) {
        if (seen.has(o.value)) continue
        seen.add(o.value)
        merged.push(o)
      }
      writeRegisteredPropertyUnitsSession(merged)
      return merged
    })
    setPropertyRegisterNotice(
      `Property “${payload.propertyName}” saved locally (${payload.totalUnits} units). Add a properties table + API to persist.`,
    )
  }

  return (
    <>
      <header className="border-b border-[#e5e7eb] bg-white px-[32px] py-8">
        <div>
          <h1 className="text-[22px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a] sm:text-[24px]">
            User Management
          </h1>
          <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            Manage residents, staff, and vendor accounts.
          </p>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto bg-[#f9fafb] px-[32px] py-8">
        <div className="w-full space-y-6">
          <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="flex h-full min-h-0 flex-col gap-y-3 rounded-[10px] border border-[#e5e7eb] bg-white p-4 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-[#6a7282]">
                    Residents
                  </span>
                  <span className="text-[20px] font-semibold leading-7 tracking-[0.02em] tabular-nums text-[#155dfc]">
                    {residentStatusStats.sharePct}%
                  </span>
                </div>
                <IconUser />
              </div>
              <div className="flex min-h-20 flex-1 items-center">
                <ResidentsNonResidentDonut
                  residents={residentStatusStats.asResidents}
                  nonResidents={residentStatusStats.asNonResidents}
                />
              </div>
              <p className="shrink-0 text-[12px] leading-4 text-[#6a7282]">
                Non-residents are accounts with Past Resident status only; unit assignment is not used for this chart.
              </p>
            </div>
            <div className="flex h-full min-h-0 flex-col gap-y-3 rounded-[10px] border border-[#e5e7eb] bg-white p-4 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-[#6a7282]">
                    Occupancy rate
                  </span>
                  <span className="text-[20px] font-semibold leading-7 tracking-[0.02em] tabular-nums text-[#00a63e]">
                    {occupancyUnitStats.pct}%
                  </span>
                </div>
                <IconBuilding />
              </div>
              <div className="flex min-h-20 flex-1 items-center">
                <OccupiedUnitsDonut
                  occupied={occupancyUnitStats.occupied}
                  total={occupancyUnitStats.totalUnits}
                />
              </div>
              <p className="shrink-0 text-[12px] leading-4 text-[#6a7282]">
                Occupancy uses units in the property list; past residents are treated as vacant.
              </p>
            </div>
            <div className="flex h-full min-h-0 flex-col gap-y-3 rounded-[10px] border border-[#e5e7eb] bg-white p-4 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-[#6a7282]">
                    Past residents
                  </span>
                </div>
                <IconUser />
              </div>
              <div className="flex min-h-20 flex-1 items-center">
                <p className="text-[70px] font-light leading-none tracking-[0.0703px] text-[#4a5565] tabular-nums">
                  {residentStatusStats.asNonResidents}
                </p>
              </div>
              <p className="shrink-0 text-[12px] leading-4 text-[#6a7282]">
                Accounts marked with Past Resident status.
              </p>
            </div>
          </div>

          <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-[17px] shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            {propertyRegisterNotice ? (
              <p className="mb-3 rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-[13px] leading-5 text-[#166534]">
                {propertyRegisterNotice}
              </p>
            ) : null}
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 lg:gap-3">
              <button
                type="button"
                onClick={() => setAddResidentOpen(true)}
                className="flex h-10 w-full min-w-0 flex-row items-center justify-center gap-2 rounded-[10px] border border-black/10 bg-transparent px-3 text-[14px] font-medium leading-none tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
              >
                <span
                  aria-hidden
                  className="inline-flex size-5 shrink-0 items-center justify-center text-[16px] font-normal leading-none text-[#364153]"
                >
                  +
                </span>
                <span className="leading-none">Add Resident</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPropertyRegisterNotice(null)
                  setAddPropertyOpen(true)
                }}
                className="flex h-10 w-full min-w-0 flex-row items-center justify-center gap-2 rounded-[10px] border border-black/10 bg-transparent px-3 text-[14px] font-medium leading-none tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
              >
                <span
                  aria-hidden
                  className="inline-flex size-5 shrink-0 items-center justify-center text-[16px] font-normal leading-none text-[#364153]"
                >
                  +
                </span>
                <span className="leading-none">Add Property</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDashboardTab('vendors')
                  setOpenVendorRailRequest((prev) => ({
                    id: (prev?.id ?? 0) + 1,
                    mode: 'add',
                  }))
                }}
                className="flex h-10 w-full min-w-0 flex-row items-center justify-center gap-2 rounded-[10px] border border-black/10 bg-transparent px-3 text-[14px] font-medium leading-none tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
              >
                <span className="inline-flex size-5 shrink-0 items-center justify-center">
                  <img src={maintenanceVendorButtonIcon} alt="" aria-hidden className="size-4 object-contain" />
                </span>
                <span className="leading-none">Manage Vendors</span>
              </button>
            </div>
          </div>

          <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-[17px] shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            {dashboardTab === 'users' ? (
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative min-h-[36px] min-w-0 flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                    <IconSearch />
                  </span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name, email, unit..."
                    className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-10 pr-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#e5e7eb] focus:ring-1 focus:ring-[#e5e7eb]"
                  />
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 lg:gap-3">
                  <label className="sr-only" htmlFor="user-mgmt-status">
                    Status
                  </label>
                  <div className="relative">
                    <select
                      id="user-mgmt-status"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="h-9 w-[160px] cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                    >
                      {STATUS_FILTER.map((o) => (
                        <option key={o.value || 'all'} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                      <IconChevronDown />
                    </span>
                  </div>
                  <label className="sr-only" htmlFor="user-mgmt-units">
                    Units
                  </label>
                  <div className="relative">
                    <select
                      id="user-mgmt-units"
                      value={unitFilter}
                      onChange={(e) => setUnitFilter(e.target.value)}
                      className="h-9 w-[160px] cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                    >
                      {UNIT_FILTER.map((o) => (
                        <option key={o.value || 'all-units'} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                      <IconChevronDown />
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative min-h-[36px] min-w-0 flex-1">
                  <label className="sr-only" htmlFor="user-mgmt-vendor-search">
                    Search vendors
                  </label>
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                    <IconSearch />
                  </span>
                  <input
                    id="user-mgmt-vendor-search"
                    type="search"
                    value={vendorSearch}
                    onChange={(e) => setVendorSearch(e.target.value)}
                    placeholder="Search vendors by name, email, phone…"
                    className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-10 pr-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#e5e7eb] focus:ring-1 focus:ring-[#e5e7eb]"
                  />
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 lg:gap-3">
                  <label className="sr-only" htmlFor="user-mgmt-vendor-category">
                    Vendor category
                  </label>
                  <div className="relative">
                    <select
                      id="user-mgmt-vendor-category"
                      value={vendorCategoryFilter}
                      onChange={(e) => setVendorCategoryFilter(e.target.value)}
                      className="h-9 w-[170px] cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                    >
                      <option value="">All Categories</option>
                      {VENDOR_CATEGORY_FILTER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                      <IconChevronDown />
                    </span>
                  </div>
                  <label className="sr-only" htmlFor="user-mgmt-vendor-status">
                    Vendor status
                  </label>
                  <div className="relative">
                    <select
                      id="user-mgmt-vendor-status"
                      value={vendorStatusFilter}
                      onChange={(e) => setVendorStatusFilter(e.target.value)}
                      className="h-9 w-[150px] cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                    >
                      <option value="">All Status</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                      <IconChevronDown />
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div
              className="flex flex-wrap gap-x-6 gap-y-2 border-b border-[#e5e7eb] px-6 pt-3"
              role="tablist"
              aria-label="User and vendor views"
            >
              {USER_MGMT_TABS.map((t) => {
                const isActive = dashboardTab === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setDashboardTab(t.id)}
                    className={[
                      '-mb-px border-b-2 pb-3 text-[14px] font-medium tracking-[-0.1504px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
                      isActive
                        ? 'border-[#155dfc] text-[#155dfc]'
                        : 'border-transparent text-[#6a7282] hover:text-[#0a0a0a]',
                    ].join(' ')}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>

            <div className="space-y-6 p-6" role="tabpanel">
          {dashboardTab === 'users' ? (
          <div className="space-y-3">
            {selectedResidentCount > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                  <span className="font-medium">{selectedResidentCount}</span>
                  {selectedResidentCount === 1 ? ' resident selected' : ' residents selected'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedResidentIds(new Set())}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                  >
                    Clear selection
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSelectedResidents()}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 text-[14px] font-medium text-[#c10007] outline-none hover:bg-[#fee2e2] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                  >
                    Delete selected
                  </button>
                </div>
              </div>
            ) : null}
            {residentOpError ? (
              <p className="rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] leading-5 text-[#b91c1c]">
                Resident action failed: {residentOpError}
              </p>
            ) : null}
            {residentsFetchError ? (
              <div className="flex flex-col gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] leading-5 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
                <p>
                  Could not load residents from Supabase: {residentsFetchError}. Demo rows are not
                  used when the database is configured — fix RLS/credentials and retry.
                </p>
                <button
                  type="button"
                  onClick={() => void loadResidents()}
                  className="h-9 shrink-0 rounded-lg border border-amber-300 bg-white px-3 text-[14px] font-medium text-amber-950 hover:bg-amber-100"
                >
                  Retry
                </button>
              </div>
            ) : null}
            {!supabase ? (
              <p className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-2 text-[13px] leading-5 text-[#6a7282]">
                Supabase is not configured — showing sample residents only (non-UUID ids). Add{' '}
                <code className="rounded bg-[#e5e7eb] px-1 font-mono text-[12px]">VITE_SUPABASE_URL</code>{' '}
                and <code className="rounded bg-[#e5e7eb] px-1 font-mono text-[12px]">VITE_SUPABASE_ANON_KEY</code>{' '}
                to load real residents.
              </p>
            ) : null}
          <div className="overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div className="overflow-x-auto">
              <table className="min-w-[1140px] w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#e5e7eb] bg-[#f9fafb]">
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all residents"
                        checked={allFilteredResidentsSelected}
                        onChange={toggleAllFilteredResidentsSelected}
                        className="size-4 rounded border-black/10"
                      />
                    </th>
                    {['Resident', 'Contact', 'Unit', 'Status', 'Balance', 'Issues', 'Actions'].map(
                      (h) => (
                        <th
                          key={h}
                          className={[
                            'px-4 py-3 text-[12px] font-medium leading-4 text-[#4a5565]',
                            h === 'Actions' ? 'text-right' : '',
                          ].join(' ')}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-b border-[#e5e7eb] last:border-b-0">
                      <td className="px-4 py-3 align-middle">
                        <input
                          type="checkbox"
                          aria-label={`Select resident ${row.name}`}
                          checked={selectedResidentIds.has(row.id)}
                          onChange={() => toggleResidentSelected(row.id)}
                          className="size-4 rounded border-black/10"
                        />
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dbeafe] text-[14px] font-medium tracking-[-0.1504px] text-[#155dfc]">
                            {row.initials}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                              {row.name}
                            </p>
                            <p className="text-[12px] leading-4 text-[#6a7282]">{row.residentId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <IconMail />
                            <span className="text-[12px] leading-4 text-[#4a5565]">{row.email}</span>
                          </div>
                          {row.phone ? (
                            <div className="flex items-center gap-2">
                              <IconPhone />
                              <span className="text-[12px] leading-4 text-[#4a5565]">{row.phone}</span>
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        {row.unit.kind === 'unassigned' ? (
                          <p className="text-[12px] font-medium leading-4 text-[#f54900]">Unassigned</p>
                        ) : (
                          <div>
                            <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                              {row.unit.unit}
                            </p>
                            <p className="text-[12px] leading-4 text-[#6a7282]">{row.unit.building}</p>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-middle">{statusPill(row.status)}</td>
                      <td className="px-4 py-3 align-middle">
                        <span
                          className={
                            row.balanceDue > 0
                              ? 'text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#e7000b]'
                              : 'text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#00a63e]'
                          }
                        >
                          {formatMoney(row.balanceDue)}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex flex-wrap gap-1">
                          {row.issues.map(issuePill)}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center justify-end gap-2">
                          {row.showLinkAction ? (
                            <button
                              type="button"
                              aria-label={`Link record for ${row.name}`}
                              onClick={() => setAssignUnitRow(toAssignUnitRow(row))}
                              className="flex h-7 items-center gap-1.5 rounded px-2 text-[12px] font-medium leading-4 text-[#155dfc] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                            >
                              <IconLink />
                              Link
                            </button>
                          ) : null}
                          <button
                            type="button"
                            aria-label={`Edit ${row.name}`}
                            onClick={() => setEditResidentRow(toEditResidentRow(row))}
                            className="flex size-7 items-center justify-center rounded outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                          >
                            <IconPencil />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredRows.length === 0 ? (
              <p className="px-4 py-10 text-center text-[14px] text-[#6a7282]">No residents match your filters.</p>
            ) : null}
          </div>
          </div>
          ) : (
            <VendorManagementTabContent
              vendorSearch={vendorSearch}
              vendorCategoryFilter={vendorCategoryFilter}
              vendorStatusFilter={vendorStatusFilter}
              openRailRequest={openVendorRailRequest}
              initialOpenVendorId={_vendorIdFromUrl}
              onConsumedInitialOpenVendorId={handleConsumedVendorDeepLink}
            />
          )}
            </div>
          </div>
        </div>
      </main>

      <AddResidentModal
        open={addResidentOpen}
        extraUnitOptions={registeredPropertyUnitOptions}
        onClose={() => setAddResidentOpen(false)}
        onSubmit={addResidentFromModal}
      />
      <AddPropertyModal
        open={addPropertyOpen}
        onClose={() => setAddPropertyOpen(false)}
        onSubmit={addPropertyFromModal}
      />
      <DataIssuesModal open={dataIssuesOpen} onClose={() => setDataIssuesOpen(false)} />
      <AssignUnitModal row={assignUnitRow} onClose={() => setAssignUnitRow(null)} />
      <EditResidentModal
        row={editResidentRow}
        unitOptions={editResidentUnitOptions}
        initialUnitOptionKey={editResidentInitialUnitKey}
        onClose={() => setEditResidentRow(null)}
        onSave={handleResidentSave}
      />
    </>
  )
}
