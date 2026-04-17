import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  fetchVendorTickets,
  updateJobStatus,
  vendorPortalListUrl,
  vendorPortalUpdateUrl,
  type VendorApiTicket,
} from '@/api/vendorPortalTickets'
import {
  columnToAction,
  isValidMove,
  type VendorDbWorkStatus,
} from '@/lib/statusColumns'

export type { VendorDbWorkStatus }

/** `k` may be available from the router before `window` is fully in sync on some navigations. */
function readVendorActionTokenFromUrl(
  routerSearch: string,
  deepLinkToken: string | null | undefined,
): string | null {
  const fromRouter = new URLSearchParams(routerSearch).get('k')?.trim()
  if (fromRouter) return fromRouter
  const k =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('k')?.trim()
      : null
  if (k) return k
  const fromProps = deepLinkToken?.trim()
  return fromProps || null
}

const VENDOR_COMPANY = 'ABC Maintenance Co.'
const VENDOR_ID = 'V-12345'

export type VendorColumn = 'assigned' | 'in_progress' | 'completed'

/** Matches resident maintenance form: `low` | `normal` | `urgent` (stored as `priority`). */
export type VendorWorkOrderPriority = 'low' | 'normal' | 'urgent'

export type VendorWorkOrder = {
  id: string
  displayId: string
  title: string
  location: string
  attachmentCount: number
  /** When set, shows red due row (omitted for normal/low when not used). */
  dueDisplay?: string
  priority: VendorWorkOrderPriority
  column: VendorColumn
  description?: string
  /** Richer copy for assigned detail rail; falls back to `description`. */
  issueDescription?: string
  residentName?: string
  unitNumber?: string
  roomLabel?: string
  createdDisplay?: string
  /** Shown in Due Date card (no “Due:” prefix). */
  dueRangeDisplay?: string
  /** ISO `due_at` when loaded from API (for overdue checks). */
  dueAtIso?: string
  /** True when `due_at` is in the past and work is not completed. */
  slaOverdue?: boolean
  /** Thumbnail URLs for assigned detail (demo). */
  attachmentPreviews?: string[]
  /** Present when row comes from Supabase vendor API. */
  vendorDbStatus?: VendorDbWorkStatus
  /** From `assigned_vendor_id`; required before accept / start work when using live API. */
  assignedVendorId?: string | null
}

/** Maps stored `priority` strings to vendor badges (`low` | `normal` | `urgent`). Handles casing and common variants. */
function mapUrgencyToPriority(u?: string | null): VendorWorkOrderPriority {
  const x = (u ?? '').toLowerCase()

  if (x.includes('low')) return 'low'
  if (x.includes('urgent') || x.includes('high') || x.includes('emergency')) return 'urgent'
  if (x.includes('normal') || x.includes('medium')) return 'normal'

  return 'normal'
}

function mapVendorStatusToColumn(s: string | null | undefined): VendorColumn {
  if (s === 'in_progress') return 'in_progress'
  if (s === 'completed') return 'completed'
  return 'assigned'
}

function formatCreatedDisplay(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return `Created: ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
  } catch {
    return ''
  }
}

/** Known room/area phrases (longest first). Returns display label or "" if none found. */
const ROOM_IN_UNIT_PHRASES = [
  'master bedroom',
  'guest bedroom',
  'living room',
  'dining room',
  'family room',
  'laundry room',
  'utility room',
  'master bathroom',
  'guest bathroom',
  'master bath',
  'guest bath',
  'powder room',
  'walk-in closet',
  'half bath',
  'full bath',
  'bathroom',
  'bedroom',
  'kitchen',
  'hallway',
  'basement',
  'attic',
  'garage',
  'balcony',
  'patio',
  'deck',
  'foyer',
  'entryway',
  'office',
  'den',
  'closet',
  'pantry',
  'laundry',
].sort((a, b) => b.length - a.length)

function titleCaseRoomPhrase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

/**
 * Best-effort room/area inside the unit from resident issue text only.
 * Returns "" when no clear room is mentioned.
 */
function extractRoomInUnitFromDescription(description: string): string {
  const t = description.trim()
  if (!t) return ''

  const structured = t.match(
    /(?:^|[\n\r])\s*(?:room|location|area)\s*:\s*([^\n\r.]+)/i,
  )
  if (structured?.[1]) {
    const v = structured[1].trim()
    const first = v.split(/[.;]/)[0]?.trim() ?? ''
    if (first.length > 0 && first.length < 120) {
      return titleCaseRoomPhrase(first)
    }
  }

  const lower = t.toLowerCase()
  for (const phrase of ROOM_IN_UNIT_PHRASES) {
    if (lower.includes(phrase)) {
      return titleCaseRoomPhrase(phrase)
    }
  }

  return ''
}

function mapApiTicketToWorkOrder(t: VendorApiTicket): VendorWorkOrder {
  if (t.id == null || String(t.id).trim() === '') {
    throw new Error('Missing ticket id')
  }
  const st = (t.vendor_work_status ?? 'pending_accept') as VendorDbWorkStatus
  const photos = t.photo_paths ?? []
  const signedPreviews = (t.photo_urls ?? []).filter((u): u is string => typeof u === 'string' && u.length > 0)
  const desc = (t.description ?? '').trim()
  const titleLine = desc.split(/\r?\n/)[0] ?? ''
  const pri = (t.urgency || t.priority || '').trim()
  const title =
    titleLine.length > 80 ? `${titleLine.slice(0, 77)}…` : titleLine || `${pri || '—'} — maintenance`
  const unitStr = t.unit ?? ''
  const roomFromDescription = extractRoomInUnitFromDescription(desc)
  const dueRaw = t.due_at
  let dueDisplay: string | undefined
  let dueRangeDisplay: string | undefined
  let dueAtIso: string | undefined
  let slaOverdue = false
  if (dueRaw && String(dueRaw).trim()) {
    const d = new Date(dueRaw)
    if (!Number.isNaN(d.getTime())) {
      dueAtIso = d.toISOString()
      const fmt = d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
      dueRangeDisplay = fmt
      if (st === 'completed') {
        dueDisplay = `Due: ${fmt}`
      } else if (d.getTime() < Date.now()) {
        slaOverdue = true
        dueDisplay = `Overdue · was due ${fmt}`
      } else {
        dueDisplay = `Due: ${fmt}`
      }
    }
  }
  return {
    id: t.id,
    displayId: `MR-${String(t.id).replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    title,
    location: unitStr,
    attachmentCount: Math.max(photos.length, signedPreviews.length),
    ...(signedPreviews.length > 0 ? { attachmentPreviews: signedPreviews } : {}),
    priority: mapUrgencyToPriority(t.urgency || t.priority),
    column: mapVendorStatusToColumn(t.vendor_work_status),
    description: desc,
    issueDescription: desc,
    residentName: t.resident_name ?? undefined,
    unitNumber: unitStr,
    roomLabel: roomFromDescription || undefined,
    createdDisplay: formatCreatedDisplay(t.created_at ?? ''),
    vendorDbStatus: st,
    assignedVendorId: t.assigned_vendor_id ?? null,
    ...(dueDisplay ? { dueDisplay } : {}),
    ...(dueRangeDisplay ? { dueRangeDisplay } : {}),
    ...(dueAtIso ? { dueAtIso } : {}),
    ...(slaOverdue ? { slaOverdue: true } : {}),
  }
}

function tryMapApiTicketToWorkOrder(t: VendorApiTicket): VendorWorkOrder | null {
  try {
    return mapApiTicketToWorkOrder(t)
  } catch (e) {
    console.error('Bad ticket:', t, e)
    return null
  }
}

const INITIAL_WORK_ORDERS: VendorWorkOrder[] = [
  {
    id: 'wo1',
    displayId: 'AS123-4',
    title: 'Leaking Kitchen Faucet',
    location: 'Unit 305',
    attachmentCount: 2,
    dueDisplay: 'Due: Aug 14 - 28, 2025',
    priority: 'urgent',
    column: 'assigned',
    description:
      'Tenant reports steady drip under the sink; shutoff valve may need tightening or washer replacement.',
    issueDescription:
      'The kitchen faucet has been dripping constantly for the past 3 days. Water is pooling under the sink.',
    residentName: 'Sarah Johnson',
    unitNumber: 'Unit 305',
    createdDisplay: 'Created: Jun 26 - 27, 2025',
    dueRangeDisplay: 'Aug 14 - 28, 2025',
    attachmentPreviews: [
      'https://www.figma.com/api/mcp/asset/5a7d4957-e7c2-49e2-ba57-395ae260c13b',
      'https://www.figma.com/api/mcp/asset/5d3f0904-c3e3-4e9d-a497-74dd7f60be13',
    ],
  },
  {
    id: 'wo2',
    displayId: 'AS123-5',
    title: 'HVAC Not Cooling',
    location: 'Unit 512',
    attachmentCount: 1,
    dueDisplay: 'Due: Aug 26 - 27, 2025',
    priority: 'urgent',
    column: 'assigned',
    description:
      'No cold air in the living room; thermostat set to 68°F, room temp 78°F. Photo of unit label attached.',
    residentName: 'Michael Chen',
    unitNumber: 'Unit 512',
    createdDisplay: 'Created: Jun 20 - 21, 2025',
    dueRangeDisplay: 'Aug 26 - 27, 2025',
    attachmentPreviews: [
      'https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=400&h=300&fit=crop',
    ],
  },
  {
    id: 'wo3',
    displayId: 'AS123-7',
    title: 'Broken Window Lock',
    location: 'Unit 210',
    attachmentCount: 0,
    priority: 'normal',
    column: 'assigned',
    description: 'Latch does not engage; security concern — replace lock mechanism.',
    residentName: 'Emily Rodriguez',
    unitNumber: 'Unit 210',
    createdDisplay: 'Created: Jul 1 - 2, 2025',
  },
]

function IconMapPin({ className = 'size-4 shrink-0 text-[#4a5565]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 21s7-4.55 7-10a7 7 0 10-14 0c0 5.45 7 10 7 10z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth={1.4} />
    </svg>
  )
}

function IconAttachment({ className = 'size-4 shrink-0 text-[#4a5565]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconDueClock({ className = 'size-3 shrink-0 text-[#e7000b]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.5} />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

function IconClockSmall({ className = 'size-3 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.5} />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

function priorityBadge(p: VendorWorkOrderPriority) {
  switch (p) {
    case 'urgent':
      return (
        <span className="inline-flex h-[26px] items-center gap-1 rounded-full border border-[#ffc9c9] bg-[#ffe2e2] pl-2 pr-2 text-[12px] font-normal leading-4 text-[#9f0712]">
          <IconClockSmall className="size-3 text-[#9f0712]" />
          Urgent
        </span>
      )
    case 'normal':
      return (
        <span className="inline-flex h-[26px] items-center gap-1 rounded-full border border-[#fff085] bg-[#fef9c2] pl-2 pr-2 text-[12px] font-normal leading-4 text-[#894b00]">
          <IconClockSmall className="size-3 text-[#894b00]" />
          Normal Priority
        </span>
      )
    case 'low':
      return (
        <span className="inline-flex h-[26px] items-center rounded-full border border-[#e5e7eb] bg-[#f3f4f6] px-2 text-[12px] font-normal leading-4 text-[#364153]">
          Low Priority
        </span>
      )
    default:
      return (
        <span className="inline-flex h-[26px] items-center rounded-full border border-[#e5e7eb] bg-[#f3f4f6] px-2 text-[12px] font-normal leading-4 text-[#364153]">
          Low Priority
        </span>
      )
  }
}

function countInColumn(orders: VendorWorkOrder[], col: VendorColumn) {
  return orders.filter((o) => o.column === col).length
}

function parsedLocationParts(order: VendorWorkOrder): { unit: string; room: string } {
  const desc = (order.description ?? order.issueDescription ?? '').trim()
  const roomFromIssue = extractRoomInUnitFromDescription(desc)
  const room = roomFromIssue || (order.roomLabel?.trim() ?? '') || '—'

  if (order.unitNumber) {
    return { unit: order.unitNumber, room }
  }
  const loc = (order.location || '').trim()
  const dash = loc.indexOf(' - ')
  if (dash >= 0) {
    return {
      unit: loc.slice(0, dash).trim(),
      room: room !== '—' ? room : loc.slice(dash + 3).trim() || '—',
    }
  }
  return { unit: loc || '—', room }
}

function dueRangeForDetail(order: VendorWorkOrder): string | undefined {
  if (order.dueRangeDisplay) return order.dueRangeDisplay
  const d = order.dueDisplay
  if (!d) return undefined
  return (d || '').replace(/^\s*Due:\s*/i, '').trim()
}

function priorityHeaderBadge(p: VendorWorkOrderPriority) {
  switch (p) {
    case 'urgent':
      return (
        <span className="inline-flex h-[26px] items-center rounded-full border border-[#ffc9c9] bg-[#ffe2e2] px-[13px] py-[5px] text-[12px] font-medium leading-4 text-[#9f0712]">
          Urgent
        </span>
      )
    case 'normal':
      return (
        <span className="inline-flex h-[26px] items-center rounded-full border border-[#fff085] bg-[#fef9c2] px-[13px] py-[5px] text-[12px] font-medium leading-4 text-[#894b00]">
          Normal Priority
        </span>
      )
    case 'low':
      return (
        <span className="inline-flex h-[26px] items-center rounded-full border border-[#e5e7eb] bg-[#f3f4f6] px-[13px] py-[5px] text-[12px] font-medium leading-4 text-[#364153]">
          Low Priority
        </span>
      )
    default:
      return (
        <span className="inline-flex h-[26px] items-center rounded-full border border-[#e5e7eb] bg-[#f3f4f6] px-[13px] py-[5px] text-[12px] font-medium leading-4 text-[#364153]">
          Low Priority
        </span>
      )
  }
}

function IconDocumentSection({ className = 'size-5 text-[#101828]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  )
}

function IconCameraSection({ className = 'size-5 text-[#101828]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2v11z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth={1.6} />
    </svg>
  )
}

function IconMarkCompleteCircle({ className = 'size-5 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="white" strokeWidth={1.5} />
      <path d="M8 12l2.5 2.5L16 9" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function attachmentPreviewList(order: VendorWorkOrder): (string | null)[] {
  if (order.attachmentPreviews && order.attachmentPreviews.length > 0) {
    return order.attachmentPreviews
  }
  if (order.attachmentCount > 0) {
    return Array.from({ length: order.attachmentCount }, () => null as string | null)
  }
  return []
}

/** Heuristic for resident uploads served via signed URLs (path may include video extension). */
function isProbablyVideoAssetUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return /\.(mp4|webm|mov|m4v|mkv)(\?|$)/.test(path)
  } catch {
    return /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test((url.split('?')[0] ?? '').toLowerCase())
  }
}

function VendorWorkOrderWideHeader({
  order,
  titleId,
  onClose,
}: {
  order: VendorWorkOrder
  titleId: string
  onClose: () => void
}) {
  const createdLine = order.createdDisplay ?? '—'
  return (
    <header className="shrink-0 border-b border-[#e5e7eb] px-6 pb-6 pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-mono text-[14px] leading-5 text-[#6a7282]">{order.displayId}</p>
            {priorityHeaderBadge(order.priority)}
          </div>
          <h2 id={titleId} className="mt-4 text-[24px] font-bold leading-8 tracking-[0.0703px] text-[#101828]">
            {order.title}
          </h2>
          <p className="mt-1 text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]">{createdLine}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-6 shrink-0 items-center justify-center text-[#6a7282] outline-none hover:text-[#101828] focus-visible:ring-2 focus-visible:ring-[#2b7fff] focus-visible:ring-offset-2"
        >
          <svg className="size-6" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  )
}

function VendorWorkOrderWideScrollBody({ order }: { order: VendorWorkOrder }) {
  const { unit, room } = parsedLocationParts(order)
  const dueRange = dueRangeForDetail(order)
  const issueText = order.issueDescription ?? order.description ?? 'No additional details were provided.'
  const resident = order.residentName ?? '—'
  const previews = attachmentPreviewList(order)
  const [lightbox, setLightbox] = useState<{ src: string; isVideo: boolean } | null>(null)

  useEffect(() => {
    if (!lightbox) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-[10px] bg-[#f9fafb] px-4 pb-4 pt-4">
          <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]">Resident</p>
          <p className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">{resident}</p>
        </div>
        <div className="flex flex-col gap-1 rounded-[10px] bg-[#f9fafb] px-4 pb-4 pt-4">
          <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]">Unit Number</p>
          <p className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">{unit}</p>
        </div>
        <div className="flex flex-col gap-1 rounded-[10px] bg-[#f9fafb] px-4 pb-4 pt-4">
          <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]">Location</p>
          <div className="flex items-center gap-2">
            <IconMapPin className="size-4 text-[#101828]" />
            <p className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">{room}</p>
          </div>
        </div>
        {dueRange ? (
          <div className="flex flex-col gap-1 rounded-[10px] border border-[#ffc9c9] bg-[#fef2f2] px-[17px] pb-4 pt-[17px]">
            <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#e7000b]">Due Date</p>
            <div className="flex items-center gap-2">
              <IconDueClock className="size-4 shrink-0 text-[#c10007]" />
              <p className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#c10007]">{dueRange}</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1 rounded-[10px] bg-[#f9fafb] px-4 pb-4 pt-4">
            <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]">Due Date</p>
            <p className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#6a7282]">Not specified</p>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2">
          <IconDocumentSection />
          <h3 className="m-0 text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#101828]">
            Issue Description
          </h3>
        </div>
        <div className="mt-2 rounded-[10px] bg-[#f9fafb] px-4 py-4">
          <p className="m-0 text-[16px] font-normal leading-6 tracking-[-0.3125px] text-[#364153]">{issueText}</p>
        </div>
      </div>

      {previews.length > 0 ? (
        <div>
          <div className="flex items-center gap-2">
            <IconCameraSection />
            <h3 className="m-0 text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#101828]">
              Attachments ({order.attachmentCount})
            </h3>
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {previews.map((src, i) =>
              src ? (
                <button
                  key={`${order.id}-att-${i}`}
                  type="button"
                  onClick={() =>
                    setLightbox({
                      src,
                      isVideo: isProbablyVideoAssetUrl(src),
                    })
                  }
                  className="group relative h-32 w-[min(100%,270px)] shrink-0 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-black/5 text-left outline-none transition-[box-shadow,transform] hover:border-[#2b7fff]/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#2b7fff] focus-visible:ring-offset-2 active:scale-[0.99]"
                  aria-label={`Expand attachment ${i + 1}`}
                >
                  {isProbablyVideoAssetUrl(src) ? (
                    <video
                      src={src}
                      controls
                      playsInline
                      className="pointer-events-none size-full max-h-32 bg-black object-contain"
                      preload="metadata"
                      tabIndex={-1}
                      aria-hidden
                    />
                  ) : (
                    <img
                      src={src}
                      alt=""
                      className="size-full object-cover"
                    />
                  )}
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/10 group-hover:opacity-100">
                    <span className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-medium text-[#101828] shadow">
                      View larger
                    </span>
                  </span>
                </button>
              ) : (
                <div
                  key={`${order.id}-ph-${i}`}
                  className="flex h-32 w-[min(100%,270px)] shrink-0 items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-[#f3f4f6] text-[12px] text-[#6a7282]"
                >
                  Attachment {i + 1}
                </div>
              ),
            )}
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Attachment preview"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close preview"
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white outline-none ring-1 ring-white/30 transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
          >
            <svg className="size-6" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          </button>
          <div
            className="max-h-[min(90vh,900px)] max-w-[min(100vw-32px,1200px)]"
            onClick={(e) => e.stopPropagation()}
          >
            {lightbox.isVideo ? (
              <video
                src={lightbox.src}
                controls
                playsInline
                className="max-h-[min(90vh,900px)] w-full rounded-lg bg-black object-contain"
                preload="metadata"
              />
            ) : (
              <img
                src={lightbox.src}
                alt=""
                className="max-h-[min(90vh,900px)] w-full rounded-lg object-contain"
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}

function VendorWorkOrderStatusNoteFields({
  noteId,
  statusNote,
  setStatusNote,
  fileInputRef,
}: {
  noteId: string
  statusNote: string
  setStatusNote: (v: string) => void
  fileInputRef: RefObject<HTMLInputElement | null>
}) {
  return (
    <>
      <label htmlFor={noteId} className="sr-only">
        Optional status note
      </label>
      <textarea
        id={noteId}
        value={statusNote}
        onChange={(e) => setStatusNote(e.target.value)}
        placeholder="Add a note about this status update (optional)"
        className="mt-3 h-[250px] w-full resize-y rounded-[10px] border border-[#d1d5dc] px-3 py-2 text-[16px] leading-6 tracking-[-0.3125px] text-[#0a0a0a] outline-none placeholder:text-[rgba(10,10,10,0.5)] focus:border-[#2b7fff] focus:ring-1 focus:ring-[#2b7fff]"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={() => {
          if (fileInputRef.current) fileInputRef.current.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border-2 border-dashed border-[#d1d5dc] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#4a5565] outline-none hover:border-[#9ca3af] hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#2b7fff] focus-visible:ring-offset-2"
      >
        <IconCameraSection className="size-5 text-[#4a5565]" />
        Upload Photos/Videos
      </button>
    </>
  )
}

const WO_DRAG_MIME = 'application/vnd.vendor-work-order-id'

function WorkOrderCard({
  order,
  onSelect,
  onDragEnd,
}: {
  order: VendorWorkOrder
  onSelect: () => void
  onDragEnd: () => void
}) {
  const att = order.attachmentCount
  const attLabel = att === 1 ? '1 attachment' : `${att} attachments`
  const issueText = (order.description ?? order.issueDescription ?? '').trim()
  const roomInUnit = extractRoomInUnitFromDescription(issueText)

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.stopPropagation()
        e.dataTransfer.setData(WO_DRAG_MIME, order.id)
        e.dataTransfer.setData('text/plain', order.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className="w-full cursor-grab rounded-[10px] border border-[#e5e7eb] bg-white p-4 text-left outline-none transition-shadow active:cursor-grabbing hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[#2b7fff] focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[14px] leading-5 text-[#6a7282]">{order.displayId}</p>
        {priorityBadge(order.priority)}
      </div>
      <h3 className="mt-3 text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#101828]">
        {order.title}
      </h3>
      <div className="mt-2 flex flex-col gap-1">
        {roomInUnit ? (
          <div className="flex items-center gap-2">
            <IconMapPin />
            <span className="text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
              {roomInUnit}
            </span>
          </div>
        ) : null}
        {att > 0 ? (
          <div className="flex items-center gap-2">
            <IconAttachment />
            <span className="text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">{attLabel}</span>
          </div>
        ) : null}
      </div>
      {order.dueDisplay ? (
        <div className="mt-3 flex items-center gap-2">
          <IconDueClock />
          <span
            className={`text-[12px] font-normal leading-4 ${
              order.slaOverdue
                ? 'font-semibold text-[#b91c1c]'
                : 'text-[#e7000b]'
            }`}
          >
            {order.dueDisplay}
          </span>
        </div>
      ) : null}
    </button>
  )
}

function KanbanColumn({
  title,
  dotClass,
  count,
  children,
  emptyLabel = 'No work orders',
  column,
  isDropActive,
  onDragOverColumn,
  onDropOnColumn,
}: {
  title: string
  dotClass: string
  count: number
  children: ReactNode
  emptyLabel?: string
  column: VendorColumn
  isDropActive: boolean
  onDragOverColumn: (col: VendorColumn) => void
  onDropOnColumn: (col: VendorColumn, orderId: string) => void
}) {
  return (
    <div
      className={`flex min-h-[min(599px,70vh)] min-w-0 flex-1 flex-col rounded-[10px] bg-[#f9fafb] transition-[box-shadow,background-color] ${
        isDropActive ? 'bg-[#eff6ff] ring-2 ring-[#2b7fff] ring-offset-2' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOverColumn(column)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const orderId = e.dataTransfer.getData(WO_DRAG_MIME) || e.dataTransfer.getData('text/plain')
        if (orderId) onDropOnColumn(column, orderId)
      }}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex h-[30px] items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
            <h2 className="m-0 text-[20px] font-semibold leading-[30px] tracking-[-0.4492px] text-[#101828]">
              {title}
            </h2>
          </div>
          <span className="inline-flex min-w-[28px] items-center justify-center rounded-full bg-[#e5e7eb] px-2 py-1 text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#364153]">
            {count}
          </span>
        </div>
        <div className="flex flex-col gap-3">{children}</div>
        {count === 0 ? (
          <p className="py-6 text-center text-[16px] font-normal leading-6 tracking-[-0.3125px] text-[#99a1af]">
            {emptyLabel}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Assigned-column detail rail (Figma 137:21626). */
function VendorAssignedWorkOrderDetailRail({
  order,
  onClose,
  onStartWork,
  onDeclineJob,
}: {
  order: VendorWorkOrder
  onClose: () => void
  /** Accept + move to In progress: calls `in_progress` on the API (same as kanban drag to In progress). */
  onStartWork: () => void
  onDeclineJob: () => void
}) {
  const titleId = useId()
  const noteId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [statusNote, setStatusNote] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function decline() {
    if (typeof window !== 'undefined' && !window.confirm('Decline this job? The request will be removed from your board (demo).')) {
      return
    }
    onDeclineJob()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,900px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white pr-4 shadow-[inset_1px_0_0_0_#e5e7eb]"
      >
        <VendorWorkOrderWideHeader order={order} titleId={titleId} onClose={onClose} />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6">
            <div className="flex flex-col gap-6 pb-6">
              <VendorWorkOrderWideScrollBody order={order} />
              <div className="border-t border-[#e5e7eb] pt-6">
                <h3 className="m-0 text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#101828]">
                  Update Status
                </h3>
                <VendorWorkOrderStatusNoteFields
                  noteId={noteId}
                  statusNote={statusNote}
                  setStatusNote={setStatusNote}
                  fileInputRef={fileInputRef}
                />
              </div>
            </div>
          </div>
          <div className="shrink-0 border-t border-[#e5e7eb] bg-white px-6 py-6">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-4">
              <button
                type="button"
                onClick={onStartWork}
                className="flex h-[52px] min-h-0 flex-1 items-center justify-center rounded-[10px] bg-[#155dfc] text-[16px] font-medium leading-6 tracking-[-0.3125px] text-white outline-none hover:bg-[#1447e6] focus-visible:ring-2 focus-visible:ring-[#2b7fff] focus-visible:ring-offset-2"
              >
                Start work
              </button>
              <button
                type="button"
                onClick={decline}
                className="flex h-[52px] min-h-0 flex-1 items-center justify-center rounded-[10px] border-2 border-[#e7000b] bg-white text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#e7000b] outline-none hover:bg-[#fef2f2] focus-visible:ring-2 focus-visible:ring-[#2b7fff] focus-visible:ring-offset-2"
              >
                Decline Job
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** In-progress detail rail (Figma 136:20766). */
function VendorInProgressWorkOrderDetailRail({
  order,
  onClose,
  onMarkComplete,
  onCancelWork,
}: {
  order: VendorWorkOrder
  onClose: () => void
  onMarkComplete: () => void
  onCancelWork: () => void
}) {
  const titleId = useId()
  const noteId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [statusNote, setStatusNote] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function confirmCancelWork() {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Cancel this work order? You will no longer be assigned; the request may be offered to another vendor.',
      )
    ) {
      return
    }
    onCancelWork()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,900px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white pr-4 shadow-[inset_1px_0_0_0_#e5e7eb]"
      >
        <VendorWorkOrderWideHeader order={order} titleId={titleId} onClose={onClose} />
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
          <div className="flex flex-col gap-6">
            <VendorWorkOrderWideScrollBody order={order} />
            <div className="border-t border-[#e5e7eb] pt-6">
              <h3 className="m-0 text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#101828]">
                Update Status
              </h3>
              <VendorWorkOrderStatusNoteFields
                noteId={noteId}
                statusNote={statusNote}
                setStatusNote={setStatusNote}
                fileInputRef={fileInputRef}
              />
              <hr
                className="mt-6 w-full border-0 border-t border-[#e5e7eb]"
                aria-hidden
              />
              <button
                type="button"
                onClick={onMarkComplete}
                className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-[#00a63e] text-[16px] font-medium leading-6 tracking-[-0.3125px] text-white outline-none hover:bg-[#008a34] focus-visible:ring-2 focus-visible:ring-[#2b7fff] focus-visible:ring-offset-2"
              >
                <IconMarkCompleteCircle />
                Mark as Complete
              </button>
              <button
                type="button"
                onClick={confirmCancelWork}
                className="mt-3 flex h-10 w-full items-center justify-center rounded-[10px] border-2 border-[#e7000b] bg-white text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#e7000b] outline-none hover:bg-[#fef2f2] focus-visible:ring-2 focus-visible:ring-[#2b7fff] focus-visible:ring-offset-2"
              >
                Cancel work order
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Completed-column detail rail (Figma 136:21406): read-only summary, no status actions. */
function VendorCompletedWorkOrderDetailRail({
  order,
  onClose,
}: {
  order: VendorWorkOrder
  onClose: () => void
}) {
  const titleId = useId()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,900px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white pr-4 shadow-[inset_1px_0_0_0_#e5e7eb]"
      >
        <VendorWorkOrderWideHeader order={order} titleId={titleId} onClose={onClose} />
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
          <VendorWorkOrderWideScrollBody order={order} />
        </div>
      </div>
    </div>
  )
}

export function VendorPortalDashboard({
  deepLinkTicketId = null,
  deepLinkToken = null,
}: {
  deepLinkTicketId?: string | null
  deepLinkToken?: string | null
} = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const listUrl = vendorPortalListUrl()
  const updateUrl = vendorPortalUpdateUrl()

  const portalBearerFromLink = useMemo(
    () => readVendorActionTokenFromUrl(location.search, deepLinkToken),
    [location.search, deepLinkToken],
  )

  const useLiveVendorApi = Boolean(listUrl && updateUrl && Boolean(portalBearerFromLink))

  const resolveVendorRequestBearer = useCallback((): string | null => {
    const k =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('k')?.trim()
        : null
    return k ?? null
  }, [])

  const [orders, setOrders] = useState<VendorWorkOrder[]>(() =>
    useLiveVendorApi ? [] : INITIAL_WORK_ORDERS,
  )
  const [vendorHeaderName, setVendorHeaderName] = useState<string | null>(null)
  const [apiLoading, setApiLoading] = useState(useLiveVendorApi)
  const [apiError, setApiError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [vendorToast, setVendorToast] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dropTargetColumn, setDropTargetColumn] = useState<VendorColumn | null>(null)

  const loadTickets = useCallback(async () => {
    if (!useLiveVendorApi || !listUrl) return
    setApiLoading(true)
    setApiError(null)
    try {
      const bearer = resolveVendorRequestBearer()
      if (!bearer) {
        console.error('NO K TOKEN — STOPPING REQUEST')
        setApiError(
          'Missing vendor token (?k=). Open your assignment email link with the portal key.',
        )
        setOrders([])
        return
      }
      const res = await fetchVendorTickets(listUrl, bearer)
      setVendorHeaderName(res.vendor?.name ?? null)
      setOrders(
        res.tickets
          .map((ticket) => tryMapApiTicketToWorkOrder(ticket))
          .filter((o): o is VendorWorkOrder => o != null),
      )
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Failed to load tickets')
      setOrders([])
    } finally {
      setApiLoading(false)
    }
  }, [useLiveVendorApi, listUrl, resolveVendorRequestBearer])

  useEffect(() => {
    void loadTickets()
  }, [loadTickets])

  useEffect(() => {
    if (!useLiveVendorApi || apiLoading || apiError) return
    if (!deepLinkTicketId) return
    if (orders.length === 0) return
    const found = orders.some((o) => o.id === deepLinkTicketId)
    if (!found) {
      navigate('/vendor', { replace: true })
      setVendorToast('This ticket is not assigned to your vendor account.')
    }
  }, [useLiveVendorApi, apiLoading, apiError, deepLinkTicketId, orders, navigate])

  useEffect(() => {
    if (!deepLinkTicketId || apiLoading) return
    const found = orders.some((o) => o.id === deepLinkTicketId)
    if (found) setSelectedId(deepLinkTicketId)
  }, [deepLinkTicketId, orders, apiLoading])

  useEffect(() => {
    if (!vendorToast) return
    const t = window.setTimeout(() => setVendorToast(null), 4000)
    return () => window.clearTimeout(t)
  }, [vendorToast])

  function applyVendorStatusToOrder(ticketId: string, vendor_work_status: string) {
    const col = mapVendorStatusToColumn(vendor_work_status)
    const vs = vendor_work_status as VendorDbWorkStatus
    setOrders((prev) =>
      prev.map((o) => (o.id === ticketId ? { ...o, vendorDbStatus: vs, column: col } : o)),
    )
  }

  async function runStatusAction(
    ticketId: string,
    action: 'accept' | 'decline' | 'in_progress' | 'completed',
  ) {
    if (!updateUrl) return
    setActionError(null)
    if (
      useLiveVendorApi &&
      (action === 'accept' || action === 'in_progress')
    ) {
      const ord = orders.find((o) => o.id === ticketId)
      if (ord && (ord.assignedVendorId == null || ord.assignedVendorId === '')) {
        const msg = 'This job is not assigned to a vendor'
        setVendorToast(msg)
        setActionError(msg)
        return
      }
    }
    const token =
      deepLinkTicketId != null && ticketId === deepLinkTicketId
        ? deepLinkToken ?? undefined
        : undefined
    try {
      const bearer = resolveVendorRequestBearer()
      if (!bearer) {
        console.error('NO K TOKEN — STOPPING REQUEST')
        const msg =
          'Missing vendor token (?k=). Open your assignment email link with the portal key.'
        setActionError(msg)
        window.alert(msg)
        return
      }
      const res = await updateJobStatus({
        ticketId,
        action,
        updateUrl,
        token,
      })
      if (res.ok) applyVendorStatusToOrder(ticketId, res.vendor_work_status)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed'
      setActionError(msg)
      window.alert(msg)
    }
  }

  async function moveCardToColumn(targetColumn: VendorColumn, orderId: string) {
    setDropTargetColumn(null)
    const order = orders.find((o) => o.id === orderId)
    if (!order || order.column === targetColumn) return

    if (!useLiveVendorApi) {
      patchOrder(orderId, { column: targetColumn })
      return
    }

    if (!updateUrl) return
    const token =
      deepLinkTicketId != null && orderId === deepLinkTicketId
        ? deepLinkToken ?? undefined
        : undefined

    if (!isValidMove(order.vendorDbStatus, targetColumn)) {
      setVendorToast("You can't move this job to that stage yet.")
      return
    }

    const action = columnToAction[targetColumn]
    if (
      useLiveVendorApi &&
      (action === 'accept' || action === 'in_progress') &&
      (order.assignedVendorId == null || order.assignedVendorId === '')
    ) {
      setVendorToast('This job is not assigned to a vendor')
      return
    }
    setActionError(null)
    try {
      const bearer = resolveVendorRequestBearer()
      if (!bearer) {
        console.error('NO K TOKEN — STOPPING REQUEST')
        setVendorToast(
          'Missing vendor token (?k=). Open your assignment email link with the portal key.',
        )
        return
      }
      const res = await updateJobStatus({
        ticketId: orderId,
        action,
        updateUrl,
        token,
      })
      if (res?.ok) applyVendorStatusToOrder(orderId, res.vendor_work_status)
    } catch {
      setVendorToast("You can't move this job to that stage yet.")
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return orders
    return orders.filter(
      (o) =>
        (o.displayId || '').toLowerCase().includes(q) ||
        (o.title || '').toLowerCase().includes(q) ||
        (o.location || '').toLowerCase().includes(q),
    )
  }, [orders, query])

  const assigned = filtered.filter((o) => o.column === 'assigned')
  const inProgress = filtered.filter((o) => o.column === 'in_progress')
  const completed = filtered.filter((o) => o.column === 'completed')

  const emptyBoardMsg = query.trim() ? 'No matching work orders' : 'No work orders'

  const nAssigned = countInColumn(orders, 'assigned')
  const nProgress = countInColumn(orders, 'in_progress')
  const nCompleted = countInColumn(orders, 'completed')

  const selected = selectedId ? orders.find((o) => o.id === selectedId) ?? null : null

  function patchOrder(id: string, patch: Partial<VendorWorkOrder>) {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }

  function startWork(id: string) {
    if (useLiveVendorApi) {
      void runStatusAction(id, 'in_progress').then(() => setSelectedId(null))
      return
    }
    patchOrder(id, { column: 'in_progress' })
    setSelectedId(null)
  }

  function completeWork(id: string) {
    if (useLiveVendorApi) {
      void runStatusAction(id, 'completed').then(() => setSelectedId(null))
      return
    }
    patchOrder(id, { column: 'completed' })
    setSelectedId(null)
  }

  function declineJob(id: string) {
    if (useLiveVendorApi) {
      void runStatusAction(id, 'decline').then(() => setSelectedId(null))
      return
    }
    setOrders((prev) => prev.filter((o) => o.id !== id))
    setSelectedId(null)
  }

  return (
    <div className="min-h-dvh bg-[#f3f4f6]">
      <header className="border-b-4 border-[#fdc700] bg-white shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1),0px_1px_2px_0px_rgba(0,0,0,0.1)]">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[24px] font-bold leading-8 tracking-[0.0703px] text-[#101828]">Vendor Portal</h1>
            <p className="mt-0.5 text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
              Manage your assigned work orders
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
              {useLiveVendorApi && vendorHeaderName ? vendorHeaderName : VENDOR_COMPANY}
            </p>
            <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
              {useLiveVendorApi && vendorHeaderName
                ? 'Connected to live tickets'
                : `Vendor ID: ${VENDOR_ID}`}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-6 pb-10 pt-6">
        {apiLoading ? (
          <p className="mb-4 text-[14px] text-[#6a7282]">Loading work orders…</p>
        ) : null}
        {apiError ? (
          <p className="mb-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] text-[#991b1b]">
            {apiError}
          </p>
        ) : null}
        {actionError ? (
          <p className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[14px] text-[#92400e]">
            {actionError}
          </p>
        ) : null}
        {useLiveVendorApi ? (
          <p className="mb-4 text-[13px] leading-5 text-[#6a7282]">
            Status changes sync to the database. Drag a card to another column to update status (the server must accept
            the transition), or use the card detail actions.
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-[10px] border-l-4 border-[#2b7fff] bg-white py-4 pl-5 pr-4 shadow-sm">
            <p className="text-[24px] font-bold leading-8 tracking-[0.0703px] text-[#101828]">{nAssigned}</p>
            <p className="mt-0.5 text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">Assigned</p>
          </div>
          <div className="rounded-[10px] border-l-4 border-[#f0b100] bg-white py-4 pl-5 pr-4 shadow-sm">
            <p className="text-[24px] font-bold leading-8 tracking-[0.0703px] text-[#101828]">{nProgress}</p>
            <p className="mt-0.5 text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">In Progress</p>
          </div>
          <div className="rounded-[10px] border-l-4 border-[#00c950] bg-white py-4 pl-5 pr-4 shadow-sm">
            <p className="text-[24px] font-bold leading-8 tracking-[0.0703px] text-[#101828]">{nCompleted}</p>
            <p className="mt-0.5 text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">Completed</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            {useLiveVendorApi
              ? 'Drag cards between columns or open a card for Start work or Mark as Complete.'
              : 'Drag a card to In Progress or Completed (or back to Assigned), or open a card for details.'}
          </p>
          <label className="flex w-full max-w-md flex-col gap-1 sm:w-auto">
            <span className="sr-only">Search work orders</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by ID, title, or location…"
              className="h-10 w-full rounded-[10px] border border-[#e5e7eb] bg-white px-3 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none placeholder:text-[#99a1af] focus:border-[#2b7fff] focus:ring-1 focus:ring-[#2b7fff]"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start">
          <KanbanColumn
            title="Assigned"
            dotClass="bg-[#2b7fff]"
            count={assigned.length}
            emptyLabel={emptyBoardMsg}
            column="assigned"
            isDropActive={dropTargetColumn === 'assigned'}
            onDragOverColumn={setDropTargetColumn}
            onDropOnColumn={moveCardToColumn}
          >
            {assigned.map((o) => (
              <WorkOrderCard
                key={o.id}
                order={o}
                onSelect={() => setSelectedId(o.id)}
                onDragEnd={() => setDropTargetColumn(null)}
              />
            ))}
          </KanbanColumn>
          <KanbanColumn
            title="In Progress"
            dotClass="bg-[#f0b100]"
            count={inProgress.length}
            emptyLabel={emptyBoardMsg}
            column="in_progress"
            isDropActive={dropTargetColumn === 'in_progress'}
            onDragOverColumn={setDropTargetColumn}
            onDropOnColumn={moveCardToColumn}
          >
            {inProgress.map((o) => (
              <WorkOrderCard
                key={o.id}
                order={o}
                onSelect={() => setSelectedId(o.id)}
                onDragEnd={() => setDropTargetColumn(null)}
              />
            ))}
          </KanbanColumn>
          <KanbanColumn
            title="Completed"
            dotClass="bg-[#00c950]"
            count={completed.length}
            emptyLabel={emptyBoardMsg}
            column="completed"
            isDropActive={dropTargetColumn === 'completed'}
            onDragOverColumn={setDropTargetColumn}
            onDropOnColumn={moveCardToColumn}
          >
            {completed.map((o) => (
              <WorkOrderCard
                key={o.id}
                order={o}
                onSelect={() => setSelectedId(o.id)}
                onDragEnd={() => setDropTargetColumn(null)}
              />
            ))}
          </KanbanColumn>
        </div>
      </main>

      {selected && selected.column === 'assigned' ? (
        <VendorAssignedWorkOrderDetailRail
          key={selected.id}
          order={selected}
          onClose={() => setSelectedId(null)}
          onStartWork={() => startWork(selected.id)}
          onDeclineJob={() => declineJob(selected.id)}
        />
      ) : selected && selected.column === 'in_progress' ? (
        <VendorInProgressWorkOrderDetailRail
          key={selected.id}
          order={selected}
          onClose={() => setSelectedId(null)}
          onMarkComplete={() => completeWork(selected.id)}
          onCancelWork={() => declineJob(selected.id)}
        />
      ) : selected && selected.column === 'completed' ? (
        <VendorCompletedWorkOrderDetailRail
          key={selected.id}
          order={selected}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {vendorToast ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[100] max-w-[min(100vw-24px,28rem)] -translate-x-1/2 rounded-[10px] border border-[#334155] bg-[#101828] px-4 py-3 text-center text-[14px] leading-5 tracking-[-0.1504px] text-white shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.2)]"
        >
          {vendorToast}
        </div>
      ) : null}
    </div>
  )
}
