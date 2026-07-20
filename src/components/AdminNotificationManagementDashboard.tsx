import { useEffect, useMemo, useRef, useState } from 'react'
import broadcastIcon from '@/assets/Broadcast.svg'
import calenderIcon from '@/assets/Calender.svg'
import deliveredIcon from '@/assets/Delivered.svg'
import emailIcon from '@/assets/Email.svg'
import failedDeliveryIcon from '@/assets/Failed Delivery.svg'
import smsIcon from '@/assets/SMS.svg'
import ticketIcon from '@/assets/Ticket2.svg'
import overrideIcon from '@/assets/Override.svg'
import { ConfigureAiDataSourcesModal } from '@/components/ConfigureAiDataSourcesModal'
import {
  RetryFailedDeliveryModal,
  type RetryFailedDeliveryPayload,
  type RetryFailedDeliveryPresentation,
} from '@/components/RetryFailedDeliveryModal'
import {
  ConfirmEmergencyAlertModal,
  type ConfirmEmergencyAlertPresentation,
} from '@/components/ConfirmEmergencyAlertModal'
import {
  EmergencyAlertDetailsModal,
  type EmergencyAlertDetailsPresentation,
} from '@/components/EmergencyAlertDetailsModal'
import {
  UpdateContactInformationModal,
  type UpdateContactInformationPresentation,
} from '@/components/UpdateContactInformationModal'
import {
  type EditMessageModalInitial,
  EditMessageModal,
} from '@/components/EditMessageModal'
import {
  type FailedMessageDetailsPayload,
  FailedMessageDetailsModal,
} from '@/components/FailedMessageDetailsModal'
import {
  OverrideAutomationModal,
  PGE_GAS_LEAK_ADVISORY_AUTOMATION_ID,
  type AutomationCategoryId,
  type OverrideAutomationContext,
  type OverrideAutomationScopeOption,
  type OverrideAutomationSubmission,
  type OverrideAutomationPresentation,
  type SafetyOverrideTypeId,
} from '@/components/OverrideAutomationModal'
import {
  SendBroadcastMessageModal,
  type SendBroadcastPresentation,
} from '@/components/SendBroadcastMessageModal'
import { SendInspectionNoticeModal } from '@/components/SendInspectionNoticeModal'
import { getActiveLandlordId, isDemoAccountActive } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

const NOTIF_TAB_IDS = ['history', 'scheduled', 'external'] as const
type TabId = (typeof NOTIF_TAB_IDS)[number]

/** Broadcast tables only (resident/vendor maintenance logs are separate). */
type BroadcastDashboardStats = {
  activeNotifications24h: number
  broadcastSuccess7d: number
  broadcastFailed7d: number
  scheduledDbCount: number
  successRate7d: number
}

const EMPTY_BROADCAST_DASHBOARD_STATS: BroadcastDashboardStats = {
  activeNotifications24h: 0,
  broadcastSuccess7d: 0,
  broadcastFailed7d: 0,
  scheduledDbCount: 0,
  successRate7d: 0,
}

function StatGlyph({ name }: { name: 'bell' | 'clock' }) {
  const cls = 'size-5 shrink-0 text-[#6a7282]'
  if (name === 'bell') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M12 7v5l3 2"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}

function BroadcastsFailedDonut({
  recentBroadcasts,
  failedDeliveries,
}: {
  recentBroadcasts: number
  failedDeliveries: number
}) {
  const total = recentBroadcasts + failedDeliveries
  const r = 23
  const stroke = 6
  const c = 2 * Math.PI * r
  const lenOk = total > 0 ? (recentBroadcasts / total) * c : 0
  const lenFail = total > 0 ? (failedDeliveries / total) * c : 0
  const vb = 56
  const cx = vb / 2
  const successPct = total > 0 ? Math.round((recentBroadcasts / total) * 100) : 0

  return (
    <div className="flex min-h-[5.5rem] w-full items-center gap-4">
      <div
        className="relative h-20 w-20 shrink-0"
        role="img"
        aria-label={`${recentBroadcasts} recent broadcasts and ${failedDeliveries} failed deliveries, ${total} total. ${successPct} percent completed without failure.`}
      >
        <svg className="size-full -rotate-90" viewBox={`0 0 ${vb} ${vb}`} aria-hidden>
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="#A78896" strokeWidth={stroke} />
          {lenOk > 0 ? (
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke="#30b500"
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={`${lenOk} ${c}`}
            />
          ) : null}
          {lenFail > 0 ? (
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke="#b52a00"
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={`${lenFail} ${c}`}
              strokeDashoffset={-lenOk}
            />
          ) : null}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="text-[15px] font-bold tabular-nums leading-none text-extended-3">{total}</span>
          <span className="text-[10px] font-medium uppercase leading-none tracking-wide text-neutral">
            total
          </span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 list-none space-y-2 p-0">
        <li className="flex items-center gap-2 text-[12px] leading-4">
          <span className="size-2 shrink-0 rounded-full bg-[#30b500]" aria-hidden />
          <span className="min-w-0 text-neutral-variant">Recent broadcasts</span>
          <span className="ml-auto shrink-0 font-semibold tabular-nums text-extended-3">
            {recentBroadcasts}
          </span>
        </li>
        <li className="flex items-center gap-2 text-[12px] leading-4">
          <span className="size-2 shrink-0 rounded-full bg-[#b52a00]" aria-hidden />
          <span className="min-w-0 text-neutral-variant">Failed deliveries</span>
          <span className="ml-auto shrink-0 font-semibold tabular-nums text-extended-3">
            {failedDeliveries}
          </span>
        </li>
      </ul>
    </div>
  )
}

type Chip = { label: string; className: string }

type NotifRow = {
  id: string
  chips: Chip[]
  title: string
  description: string
  meta: string[]
  variant: 'default' | 'pending' | 'failed'
  footer?: 'pending' | 'failed'
}

type RetrySource = 'resident' | 'vendor' | 'broadcast'

type MessageHistoryStatusFilter = 'all' | 'sent' | 'failed'
type MessageHistoryTypeFilter = 'all' | 'resident' | 'vendor' | 'broadcast'

type ResidentNotificationTicketEmbed = {
  id: string
  resident_name: string | null
  unit: string | null
}

type ResidentNotificationLogRow = {
  id: string
  created_at: string
  ticket_id: string
  event_type: string
  channel: string
  error: string | null
  vendor_name?: string | null
  maintenance_requests?: ResidentNotificationTicketEmbed | ResidentNotificationTicketEmbed[] | null
}

type VendorNotificationLogRow = {
  id: string
  created_at: string
  ticket_id: string
  channel: string
  error: string | null
  vendors?: { id: string; name: string | null } | { id: string; name: string | null }[] | null
}

type BroadcastNotificationParent = {
  subject: string | null
  message: string | null
  audience: string | null
}

type BroadcastNotificationLogRow = {
  id: string
  created_at: string
  channel: string
  success: boolean
  error: string | null
  broadcast_id: string
  recipient_user_id?: string | null
  recipient_name?: string | null
  recipient_email?: string | null
  broadcast_notifications: BroadcastNotificationParent | BroadcastNotificationParent[] | null
}

function formatNotifTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function shortTicket(ticketId: string): string {
  const t = ticketId.trim().toUpperCase()
  return t.length > 12 ? t.slice(0, 12) : t
}

function residentEventLabel(eventType: string, vendorName?: string | null): string {
  const x = eventType.trim().toLowerCase()
  const v = (vendorName ?? '').trim()
  if (x === 'ticket_submitted') return 'Ticket Submitted'
  if (x === 'vendor_assigned') {
    return v ? `Vendor Assigned (${v})` : 'Vendor Assigned'
  }
  if (x === 'repair_in_progress') {
    return v ? `Repair In Progress (${v})` : 'Repair In Progress'
  }
  if (x === 'repair_completed') return 'Repair Completed'
  return 'Resident Update'
}

function channelLabelFromLog(channel: string): string {
  const x = channel.trim().toLowerCase()
  if (x === 'sms') return 'SMS'
  if (x === 'email') return 'Email'
  return channel
}

/** User-facing copy for delivery rows where SMS failed (e.g. Twilio trial / account limits). */
const SMS_FAILURE_DESCRIPTION =
  "You can't text that number because your account isn't fully unlocked yet."

function notifRowFromResidentLog(r: ResidentNotificationLogRow): NotifRow {
  const failed = Boolean(r.error && r.error.trim())
  const raw = r.maintenance_requests
  const ticket = Array.isArray(raw) ? raw[0] : raw

  const residentName = (ticket?.resident_name ?? '').trim() || 'Resident'
  const unitRaw = (ticket?.unit ?? '').trim()
  const unit = unitRaw ? ` (Unit ${unitRaw})` : ''
  const vendor = r.vendor_name ?? ''

  const ticketSubtitle = `Ticket ${shortTicket(r.ticket_id)}`
  const description = failed
    ? r.channel.trim().toLowerCase() === 'sms'
      ? `${ticketSubtitle}\n\n${SMS_FAILURE_DESCRIPTION}`
      : `${ticketSubtitle}\n\nDelivery failed via ${r.channel.toUpperCase()}: ${r.error}`
    : `${ticketSubtitle}\n\nResident notification delivered via ${r.channel.toUpperCase()}.`

  return {
    id: r.id,
    chips: [
      { label: 'Resident', className: 'bg-secondary text-primary' },
      {
        label: failed ? 'Failed' : 'Sent',
        className: failed
          ? 'bg-[#b52a00] text-white'
          : 'bg-extended-2 text-extended-3',
      },
    ],
    title: `${residentName}${unit} — ${residentEventLabel(r.event_type, vendor)}`,
    description,
    meta: [
      channelLabelFromLog(r.channel),
      failed ? 'Delivery failed' : 'Delivered',
      `Time ${formatNotifTimestamp(r.created_at)}`,
    ],
    variant: failed ? 'failed' : 'default',
    ...(failed ? { footer: 'failed' as const } : {}),
  }
}

function broadcastParentSubjectMessage(
  parent: BroadcastNotificationParent | BroadcastNotificationParent[] | null | undefined,
): { subject: string; message: string } {
  const p = Array.isArray(parent) ? parent[0] : parent
  return {
    subject: (p?.subject ?? '').trim() || 'Broadcast',
    message: (p?.message ?? '').trim(),
  }
}

function notifRowFromBroadcastLog(row: BroadcastNotificationLogRow): NotifRow {
  const { subject, message } = broadcastParentSubjectMessage(row.broadcast_notifications)
  const failed = !row.success
  const preview = message.length > 160 ? `${message.slice(0, 160)}…` : message || '—'
  const name =
    (row.recipient_name ?? '').trim() || (row.recipient_email ?? '').trim() || 'Resident'
  return {
    id: `bcl-${row.id}`,
    chips: [
      { label: 'Broadcast', className: 'bg-extended-1 text-white' },
      {
        label: failed ? 'Failed' : 'Sent',
        className: failed ? 'bg-error text-white' : 'bg-extended-2 text-extended-3',
      },
    ],
    title: `${name} — ${subject}`,
    description: failed
      ? row.channel.trim().toLowerCase() === 'sms'
        ? SMS_FAILURE_DESCRIPTION
        : `Delivery failed via ${row.channel.toUpperCase()}${row.error ? `: ${row.error}` : ''}`
      : preview,
    meta: [
      channelLabelFromLog(row.channel),
      'Broadcast',
      failed ? 'Delivery failed' : 'Delivered',
      `Time ${formatNotifTimestamp(row.created_at)}`,
    ],
    variant: failed ? 'failed' : 'default',
    ...(failed ? { footer: 'failed' as const } : {}),
  }
}

function notifRowFromVendorLog(row: VendorNotificationLogRow): NotifRow {
  const failed = Boolean(row.error && row.error.trim())
  const vendor = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors
  const vendorName = (vendor?.name ?? '').trim() || 'Vendor'
  return {
    id: row.id,
    chips: [
      { label: 'Vendor', className: 'bg-extended-1 text-white' },
      {
        label: failed ? 'Failed' : 'Sent',
        className: failed
          ? 'bg-error text-white'
          : 'bg-extended-2 text-extended-3',
      },
    ],
    title: `${vendorName} — Ticket ${shortTicket(row.ticket_id)}`,
    description: failed
      ? row.channel.trim().toLowerCase() === 'sms'
        ? SMS_FAILURE_DESCRIPTION
        : `Vendor delivery failed via ${row.channel.toUpperCase()}: ${row.error}`
      : `Vendor notification delivered via ${row.channel.toUpperCase()}.`,
    meta: [
      channelLabelFromLog(row.channel),
      `Ticket ${shortTicket(row.ticket_id)}`,
      failed ? 'Delivery failed' : 'Delivered',
      `Time ${formatNotifTimestamp(row.created_at)}`,
    ],
    variant: failed ? 'failed' : 'default',
    ...(failed ? { footer: 'failed' as const } : {}),
  }
}

const BOIL_WATER_EDIT_INITIAL: EditMessageModalInitial = {
  messageTitle: 'Boil Water Advisory - City of Oakland',
  messageContent:
    'The city has issued a boil water advisory for our area due to a water main break. AI detected this from city notices.',
  targetAudience: 'All Residents',
  channelEmail: true,
  channelSms: true,
  channelPush: false,
}

const EDIT_MESSAGE_BY_ID: Partial<Record<string, EditMessageModalInitial>> = {
  '3': BOIL_WATER_EDIT_INITIAL,
}

const ELEVATOR_FAILED_MESSAGE_DETAILS: FailedMessageDetailsPayload = {
  subtitleLine: 'Building A Emergency Notice - Mar 25, 2:15 PM',
  categoryBadge: { label: 'Alert - System', className: 'bg-error text-white' },
  messageTitle: 'Emergency: Elevator Out of Service - Building A',
  messageBody:
    'Elevator in Building A is temporarily out of service. Use stairs or Building B elevator.',
  delivered: 49,
  failed: 3,
  successRatePercent: 94,
  channels: ['📧 Email', '📱 SMS'],
  failedRecipients: [
    {
      initials: 'MW',
      name: 'Maria Williams',
      unit: 'Unit A-204',
      phone: '(555) 123-4567',
      errorTitle: 'Invalid Phone Number',
      errorDescription: 'Number format is incorrect or disconnected',
      errorVariant: 'warning',
    },
    {
      initials: 'JC',
      name: 'James Chen',
      unit: 'Unit A-310',
      phone: '(555) 987-6543',
      errorTitle: 'Carrier Blocked',
      errorDescription: 'Message blocked by carrier spam filter',
      errorVariant: 'blocked',
    },
    {
      initials: 'SK',
      name: 'Sarah Kim',
      unit: 'Unit A-115',
      phone: '(555) 246-8135',
      errorTitle: 'Network Timeout',
      errorDescription: 'Delivery attempt timed out - may be temporary',
      errorVariant: 'timeout',
    },
  ],
}

const FAILED_MESSAGE_DETAILS_BY_ID: Partial<Record<string, FailedMessageDetailsPayload>> = {
  '5': ELEVATOR_FAILED_MESSAGE_DETAILS,
}

const MESSAGE_HISTORY_ROWS: NotifRow[] = [
  {
    id: '1',
    chips: [
      { label: 'Rent', className: 'bg-extended-1 text-white' },
      { label: 'Sent', className: 'bg-extended-2 text-extended-3' },
    ],
    title: 'Rent Payment Reminder - Due March 31',
    description:
      'Your rent payment of $1,250 is due on March 31st. Pay online through the resident portal.',
    meta: [
      '📧 Email + SMS',
      '👥 All Residents (142 units)',
      '✅ 139 delivered, 3 failed',
      '🕐 Mar 24, 9:00 AM',
    ],
    variant: 'default',
  },
  {
    id: '2',
    chips: [
      { label: 'Resident', className: 'bg-secondary text-primary' },
      { label: 'Sent', className: 'bg-extended-2 text-extended-3' },
    ],
    title: 'Water Shut Off - Building B (Scheduled Maintenance)',
    description:
      'Water will be temporarily shut off in Building B on Mar 26 from 9 AM - 12 PM for pipe repairs.',
    meta: [
      '📧 Email + SMS',
      '👥 Building B Residents (38 units)',
      '✅ 38 delivered',
      '🕐 Mar 23, 3:00 PM',
    ],
    variant: 'default',
  },
  {
    id: '3',
    chips: [
      { label: 'Alert - City', className: 'bg-tertiary text-tertiary' },
      { label: 'Pending', className: 'bg-tertiary text-tertiary' },
    ],
    title: 'Boil Water Advisory - City of Oakland',
    description:
      'The city has issued a boil water advisory for our area due to a water main break. AI detected this from city notices.',
    meta: [
      '📧 Email + SMS',
      '👥 All Residents (142 units)',
      '⏳ Scheduled: Mar 26, 8:00 AM',
    ],
    variant: 'default',
    footer: 'pending',
  },
  {
    id: '4',
    chips: [
      { label: 'Inspection', className: 'bg-extended-1 text-primary' },
      { label: 'Sent', className: 'bg-extended-2 text-extended-3' },
    ],
    title: 'Annual Fire Safety Inspection - Unit 5A',
    description:
      'Your unit is scheduled for annual fire safety inspection on Apr 2 at 10:00 AM. Please ensure access.',
    meta: [
      '📧 Email + SMS',
      '👥 Michael Chan (Unit 5A)',
      'Delivered',
      '🕐 Mar 25, 11:30 AM',
    ],
    variant: 'default',
  },
  {
    id: '5',
    chips: [
      { label: 'Alert - System', className: 'bg-error text-white' },
      { label: 'Sent', className: 'bg-extended-2 text-extended-3' },
    ],
    title: 'Emergency: Elevator Out of Service - Building A',
    description:
      'Elevator in Building A is temporarily out of service. Use stairs or Building B elevator.',
    meta: [
      '📧 Email + SMS',
      '👥 Building A Residents (52 units)',
      '❌ 3 SMS failed delivery',
      '🕐 Mar 25, 2:15 PM',
    ],
    variant: 'default',
    footer: 'failed',
  },
]

function cardShellClasses(variant: NotifRow['variant']) {
  if (variant === 'pending') {
    return 'bg-tertiary border-tertiary'
  }
  // default + failed: same shell; failed state is shown only on the Failed chip.
  return 'bg-white border-secondary'
}

type AutomationPanelItem = {
  id: string
  title: string
  metaLine: string
  status: 'active' | 'paused' | 'scheduled_pending'
  /** When false, hide Override (e.g. one-off scheduled broadcasts from DB). */
  showOverride?: boolean
}

/** Demo scope id — pairs with DEMO_BILLING_AUTOMATIONS for Monthly Rent Reminder (Figma 112:5773). */
const MONTHLY_RENT_REMINDER_BILLING_SCOPE = 'bil-rent-rem'

/** Demo scope id — pairs with DEMO_INSPECTION_AUTOMATIONS for 72hr inspection reminder (Figma 121:12787). */
const INSPECTION_72HR_NOTICE_SCOPE = 'insp-72hr'

/** Demo ticket id — pairs with DEMO_TICKETS for Maintenance Request Updates automation (Figma 106:3458). */
const MAINTENANCE_REQUEST_UPDATES_SCOPE = 'MNT-AUTO-UPD'

type BroadcastScheduleRow = {
  id: string
  subject: string
  message?: string
  status: string
  created_at: string
  scheduled_for: string
  audience: string
  channels: unknown
  building: string | null
  payload: unknown
}

function formatBroadcastChannels(channels: unknown): string {
  const arr = Array.isArray(channels) ? channels : []
  const hasEmail = arr.includes('email')
  const hasSms = arr.includes('sms')
  if (hasEmail && hasSms) return 'Email + SMS'
  if (hasSms) return 'SMS'
  return 'Email'
}

function audienceSummaryBroadcast(audience: string, building: string | null): string {
  if (audience === 'all') return 'Audience: All residents'
  if (audience === 'building') {
    const b = (building ?? '').trim()
    return b ? `Audience: Building (${b})` : 'Audience: Building'
  }
  return 'Audience: Specific units'
}

/** DB `payload` is usually the automation object; some paths may nest it under `automation`. */
function automationPayloadRoot(payload: unknown): Record<string, unknown> | null {
  const raw =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null
  if (!raw) return null
  const inner = raw.automation
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as Record<string, unknown>
  }
  return raw
}

function automationSummaryFromPayload(payload: unknown): string {
  const p = automationPayloadRoot(payload)
  if (!p) return 'Automation: none'

  const lines: string[] = []
  const rr = p.rentReminder
  if (rr && typeof rr === 'object') {
    const o = rr as Record<string, unknown>
    const due = typeof o.dueDate === 'string' ? o.dueDate.trim() : ''
    const amt = typeof o.amount === 'string' ? o.amount.trim() : ''
    if (due || amt) {
      const bits: string[] = []
      if (amt) bits.push(`rent ${amt}`)
      if (due) bits.push(`due ${due}`)
      lines.push(`Rent: ${bits.join(' · ')}`)
    }
  }

  const insp = p.inspection
  if (insp && typeof insp === 'object') {
    const o = insp as Record<string, unknown>
    const typ = typeof o.inspectionType === 'string' ? o.inspectionType.trim() : ''
    const dt = typeof o.inspectionDate === 'string' ? o.inspectionDate.trim() : ''
    if (typ || dt) {
      lines.push(`Inspection: ${typ || 'notice'}${dt ? ` · ${dt}` : ''}`)
    }
  }

  const enabled = p.enabled
  if (enabled === false) {
    if (lines.length === 0) return 'Automation: disabled'
    return `Automation: ${lines.join(' · ')}`
  }
  if (p.autoRetryFailed === true) {
    const attempts =
      typeof p.retryMaxAttempts === 'number' && Number.isFinite(p.retryMaxAttempts)
        ? String(p.retryMaxAttempts)
        : '3'
    const delay = typeof p.retryDelay === 'string' && p.retryDelay.trim() ? p.retryDelay : '30m'
    lines.push(`Auto-retry ${attempts}x (${delay})`)
  }
  if (p.recurringSchedule === true) {
    const freq =
      typeof p.recurringFrequency === 'string' && p.recurringFrequency.trim()
        ? p.recurringFrequency
        : 'weekly'
    const time =
      typeof p.recurringTime === 'string' && p.recurringTime.trim() ? p.recurringTime : '09:00'
    lines.push(`Recurring ${freq} @ ${time}`)
  }
  if (p.autoFollowUp === true) {
    const after =
      typeof p.followUpAfter === 'string' && p.followUpAfter.trim() ? p.followUpAfter : '24h'
    lines.push(`Follow-up after ${after}`)
  }

  if (lines.length === 0) {
    return 'Automation: none selected'
  }
  return `Automation: ${lines.join(' · ')}`
}

function hasSelectedBroadcastAutomation(payload: unknown): boolean {
  const p = automationPayloadRoot(payload)
  if (!p) return false
  const rr = p.rentReminder
  if (rr && typeof rr === 'object') {
    const o = rr as Record<string, unknown>
    const due = typeof o.dueDate === 'string' ? o.dueDate.trim() : ''
    const amt = typeof o.amount === 'string' ? o.amount.trim() : ''
    if (due || amt) return true
  }
  const insp = p.inspection
  if (insp && typeof insp === 'object') {
    const o = insp as Record<string, unknown>
    const typ = typeof o.inspectionType === 'string' ? o.inspectionType.trim() : ''
    const dt = typeof o.inspectionDate === 'string' ? o.inspectionDate.trim() : ''
    if (typ || dt) return true
  }
  if (p.enabled === true) return true
  if (p.enabled === false) return false
  return p.autoRetryFailed === true || p.recurringSchedule === true || p.autoFollowUp === true
}

function hasInspectionAutomationFallback(row: BroadcastScheduleRow): boolean {
  const subject = (row.subject ?? '').trim().toLowerCase()
  const message = (row.message ?? '').trim().toLowerCase()
  if (!subject && !message) return false
  const hasInspectionWord = subject.includes('inspection') || message.includes('inspection')
  const hasInspectionScheduleDetails =
    message.includes('scheduled date:') ||
    message.includes('advance notice:') ||
    message.includes('inspection type:')
  return hasInspectionWord && hasInspectionScheduleDetails
}

function broadcastRowToAutomationItem(row: BroadcastScheduleRow): AutomationPanelItem {
  const when =
    row.status === 'scheduled'
      ? row.scheduled_for
        ? new Date(row.scheduled_for).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        : '—'
      : row.created_at
        ? new Date(row.created_at).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        : '—'

  const whenLine =
    row.status === 'scheduled'
      ? `Sends ${when}`
      : row.status === 'processing'
        ? `Processing · ${when}`
        : `Configured from Send Now · ${when}`
  return {
    id: `bc-${row.id}`,
    title: row.subject.trim() || 'Scheduled broadcast',
    metaLine: `${audienceSummaryBroadcast(row.audience, row.building)} · ${formatBroadcastChannels(row.channels)} · ${whenLine} · ${automationSummaryFromPayload(row.payload)}`,
    status: row.status === 'scheduled' ? 'scheduled_pending' : 'active',
  }
}

/** External alert rows for AI-Aggregated panel (Figma 83:1281). */
type ExternalAlertCardKind = 'action_required' | 'info' | 'processed'

type ExternalAlertCard = {
  id: string
  kind: ExternalAlertCardKind
  title: string
  description: string
  sourceLine: string
  badgeLabel: string
  /** When false, card matches “Processed” state (no Notify / Dismiss). */
  showActions: boolean
  /** Neutral white card shell; kind still drives badge colors. */
  whiteBackground?: boolean
}

const EXTERNAL_ALERT_CARDS: ExternalAlertCard[] = [
  {
    id: 'ext-oakland-street',
    kind: 'action_required',
    title: 'City Notice: Street Cleaning - Block 2400 Broadway',
    description:
      'Street cleaning scheduled for Mar 28, 7 AM - 11 AM. Vehicles must be moved.',
    sourceLine: 'Source: City of Oakland Email Alert | Detected: Mar 25, 4:30 PM',
    badgeLabel: 'Requires Action',
    showActions: true,
    whiteBackground: true,
  },
  {
    id: 'ext-pge-planned',
    kind: 'info',
    title: 'PG&E: Planned Power Outage - Service Area Update',
    description:
      'Planned power outage on Apr 5, 12 AM - 4 AM for maintenance work in your service area.',
    sourceLine: 'Source: PG&E SMS Alert | Detected: Mar 25, 3:15 PM',
    badgeLabel: 'Info',
    showActions: true,
    whiteBackground: true,
  },
  {
    id: 'ext-noaa-rain',
    kind: 'processed',
    title: 'Weather Alert: Heavy Rain Expected',
    description:
      'Heavy rain forecasted for Mar 26-27. Reminder sent to residents about closing windows.',
    sourceLine: 'Source: NOAA Weather Alert | Notified: Mar 24, 6:00 PM',
    badgeLabel: 'Processed',
    showActions: false,
  },
]

function automationStatusPill(status: AutomationPanelItem['status']) {
  if (status === 'paused') {
    return 'bg-tertiary text-tertiary'
  }
  if (status === 'scheduled_pending') {
    return 'bg-extended-1 text-white'
  }
  return 'bg-extended-2 text-extended-3'
}

function externalAlertCardShell(card: ExternalAlertCard) {
  if (card.whiteBackground) {
    return 'bg-white border-secondary'
  }
  if (card.kind === 'action_required') {
    return 'bg-tertiary border-tertiary'
  }
  if (card.kind === 'info') {
    return 'bg-extended-1 border-extended-1'
  }
  return 'bg-white border-secondary'
}

function externalAlertStatusBadgeClasses(kind: ExternalAlertCardKind) {
  if (kind === 'action_required') {
    return 'bg-tertiary text-tertiary'
  }
  if (kind === 'info') {
    return 'bg-extended-1 text-white'
  }
  return 'bg-secondary text-neutral-variant'
}

function ExternalAlertsAggregatedPanel({
  visibleCards,
  onDismiss,
  onNotifyResidents,
  onConfigureSources,
}: {
  visibleCards: ExternalAlertCard[]
  onDismiss: (id: string) => void
  onNotifyResidents: () => void
  onConfigureSources: () => void
}) {
  const newCount = visibleCards.filter((c) => c.showActions).length

  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-secondary bg-white px-[25px] pb-px pt-[25px]">
      <div className="flex h-8 w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h3 className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-extended-3">
            AI-Aggregated External Alerts
          </h3>
          {newCount > 0 ? (
            <span className="inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 bg-extended-1 text-white">
              {newCount} New
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onConfigureSources}
          className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white px-[13px] text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
        >
          Configure Sources
        </button>
      </div>

      <div className="flex flex-col gap-3 pb-6">
        {visibleCards.length === 0 ? (
          <p className="py-8 text-center text-[14px] leading-5 text-neutral">
            No external alerts right now.
          </p>
        ) : (
          visibleCards.map((card) => (
            <div
              key={card.id}
              className={[
                'flex flex-col gap-0 rounded-[10px] border p-[17px]',
                externalAlertCardShell(card),
              ].join(' ')}
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-extended-3">
                    {card.title}
                  </span>
                  <span
                    className={`inline-flex rounded px-2 py-0.5 text-[12px] font-normal leading-4 ${externalAlertStatusBadgeClasses(card.kind)}`}
                  >
                    {card.badgeLabel}
                  </span>
                </div>
                <p className="text-[14px] leading-5 tracking-[-0.1504px] text-neutral-variant">
                  {card.description}
                </p>
                <p className="text-[12px] leading-4 text-neutral">{card.sourceLine}</p>
                {card.showActions ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={onNotifyResidents}
                      className="inline-flex h-8 items-center justify-center rounded-lg bg-[#ffee6c] px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#101828] outline-none hover:bg-[#f5e35e] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                    >
                      Notify Residents
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismiss(card.id)}
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-black/10 bg-white px-[13px] text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function AutomationsPanel({
  title,
  items,
  onOverride,
  scheduledInDatabaseCount,
}: {
  title: string
  items: AutomationPanelItem[]
  onOverride: (item: AutomationPanelItem) => void
  /** From stats: rows with status `scheduled` (may differ from this list when filters differ). */
  scheduledInDatabaseCount?: number
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-secondary bg-white px-[25px] pb-6 pt-[25px]">
      <h3 className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-extended-3">
        {title}
      </h3>
      {items.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-secondary bg-secondary/40 px-4 py-6 text-center">
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-neutral-variant">
            No scheduled automations yet. Rows appear here when a broadcast is{' '}
            <span className="font-medium text-extended-3">scheduled</span>,{' '}
            <span className="font-medium text-extended-3">processing</span>, or completed with
            automation options stored on the record.
          </p>
          {typeof scheduledInDatabaseCount === 'number' && scheduledInDatabaseCount > 0 ? (
            <p className="mt-3 text-[13px] leading-5 text-neutral">
              The database currently reports{' '}
              <span className="font-semibold tabular-nums text-extended-3">
                {scheduledInDatabaseCount}
              </span>{' '}
              scheduled broadcast
              {scheduledInDatabaseCount === 1 ? '' : 's'}. If this panel stays empty, check the
              browser console for load errors or table access (RLS).
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-[10px] border border-secondary px-[13px] py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-extended-3">
                    {item.title}
                  </span>
                  <span
                    className={`inline-flex rounded px-2 py-0.5 text-[12px] font-normal leading-4 ${automationStatusPill(item.status)}`}
                  >
                    {item.status === 'scheduled_pending'
                      ? 'Scheduled'
                      : item.status === 'active'
                        ? 'Active'
                        : 'Paused'}
                  </span>
                </div>
                <p className="text-[12px] leading-4 text-neutral-variant">{item.metaLine}</p>
              </div>
              {item.showOverride !== false ? (
                <button
                  type="button"
                  onClick={() => onOverride(item)}
                  className="inline-flex h-8 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-[13px] text-[14px] font-medium tracking-[-0.1504px] text-tertiary outline-none hover:bg-tertiary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:w-auto"
                >
                  <img src={overrideIcon} alt="" className="size-4 shrink-0 object-contain" />
                  Override
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AdminNotificationManagementDashboard() {
  const [broadcastDashboardStats, setBroadcastDashboardStats] =
    useState<BroadcastDashboardStats>(EMPTY_BROADCAST_DASHBOARD_STATS)
  const [messageHistoryRows, setMessageHistoryRows] =
    useState<NotifRow[]>(() => (isDemoAccountActive() ? MESSAGE_HISTORY_ROWS : []))
  const [scheduledBroadcastAutomations, setScheduledBroadcastAutomations] = useState<
    AutomationPanelItem[]
  >([])
  const [tab, setTab] = useState<TabId>('history')
  const [messageHistorySearch, setMessageHistorySearch] = useState('')
  const [messageHistoryStatusFilter, setMessageHistoryStatusFilter] =
    useState<MessageHistoryStatusFilter>('all')
  const [messageHistoryTypeFilter, setMessageHistoryTypeFilter] =
    useState<MessageHistoryTypeFilter>('all')
  const [broadcastModalOpen, setBroadcastModalOpen] = useState(false)
  const [broadcastPresentation, setBroadcastPresentation] =
    useState<SendBroadcastPresentation>('modal')

  function openBroadcast(presentation: SendBroadcastPresentation) {
    setBroadcastPresentation(presentation)
    setBroadcastModalOpen(true)
  }

  function openHistoryRowEditOrFailedDetails(row: NotifRow) {
    const editPayload = EDIT_MESSAGE_BY_ID[row.id]
    if (editPayload) {
      setEditMessageInitial(editPayload)
      setEditMessageOpen(true)
      return
    }
    const failedPayload = FAILED_MESSAGE_DETAILS_BY_ID[row.id]
    if (failedPayload) {
      setFailedMessageDetailsPayload(failedPayload)
      setFailedMessageDetailsOpen(true)
    }
  }

  function historyRowHasEditOrFailedDetails(row: NotifRow) {
    return Boolean(EDIT_MESSAGE_BY_ID[row.id] || FAILED_MESSAGE_DETAILS_BY_ID[row.id])
  }

  function closeBroadcast() {
    setBroadcastModalOpen(false)
    setBroadcastPresentation('modal')
  }

  function closeRetryFailedDelivery() {
    setRetryFailedDeliveryOpen(false)
    setRetryFailedDeliveryData(null)
    setRetryFailedDeliveryPresentation('modal')
  }

  function rowDeliveryChannel(row: NotifRow): 'sms' | 'email' {
    const metaLabels = row.meta.map((m) => m.trim().toLowerCase())
    if (metaLabels.includes('sms')) return 'sms'
    return 'email'
  }

  function rowRetrySource(row: NotifRow): RetrySource {
    const firstChip = row.chips[0]?.label?.trim().toLowerCase()
    if (firstChip === 'broadcast') return 'broadcast'
    if (firstChip === 'vendor') return 'vendor'
    return 'resident'
  }

  function rowRetryLogId(row: NotifRow, source: RetrySource): string {
    if (source === 'broadcast' && row.id.startsWith('bcl-')) return row.id.slice(4)
    return row.id
  }

  async function retryRowWithExistingChannel(row: NotifRow): Promise<void> {
    const source = rowRetrySource(row)
    const channel = rowDeliveryChannel(row)
    const logId = rowRetryLogId(row, source)
    const explicitRetryUrl = import.meta.env.VITE_RETRY_FAILED_DELIVERY_URL?.trim()
    const baseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '') ?? ''
    const retryUrl =
      explicitRetryUrl || (baseUrl ? `${baseUrl}/functions/v1/retry-failed-delivery` : '')
    if (!retryUrl) {
      throw new Error('Missing VITE_SUPABASE_URL for retry-failed-delivery')
    }
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (anonKey) {
      headers.apikey = anonKey
      headers.Authorization = `Bearer ${anonKey}`
    }
    const res = await fetch(retryUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source, logId, channel }),
    })
    if (!res.ok) {
      let msg = `Retry failed (${res.status})`
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error?.trim()) msg = body.error.trim()
      } catch {
        // ignore parse errors
      }
      throw new Error(msg)
    }
    console.info('[notifications] retry-failed-delivery success', { source, logId, channel })
  }

  function closeUpdateContactInfo() {
    setUpdateContactInfoOpen(false)
    setUpdateContactInfoPresentation('modal')
  }

  function closeOverrideModal() {
    setOverrideModalOpen(false)
    setOverrideModalInitialCategory(undefined)
    setOverrideModalInitialTicketId(undefined)
    setOverrideModalInitialSafetyOverrideType(undefined)
    setOverrideModalPresentation('modal')
  }

  async function handleOverrideApply(submission: OverrideAutomationSubmission) {
    const ts = new Date(submission.appliedAtIso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    const scopeId = submission.ticketId.trim()
    if (scopeId) {
      setScheduledBroadcastAutomations((prev) =>
        prev.map((item) =>
          item.id === scopeId
            ? {
                ...item,
                status: 'active',
                metaLine: `${item.metaLine} · Override applied ${ts}`,
              }
            : item,
        ),
      )
    }
  }
  const [inspectionModalOpen, setInspectionModalOpen] = useState(false)
  const [overrideModalOpen, setOverrideModalOpen] = useState(false)
  const [overrideModalPresentation, setOverrideModalPresentation] =
    useState<OverrideAutomationPresentation>('modal')
  const [overrideModalContext, setOverrideModalContext] =
    useState<OverrideAutomationContext>('default')
  const [overrideModalInitialCategory, setOverrideModalInitialCategory] = useState<
    AutomationCategoryId | undefined
  >(undefined)
  const [overrideModalInitialTicketId, setOverrideModalInitialTicketId] = useState<
    string | undefined
  >(undefined)
  const [overrideModalInitialSafetyOverrideType, setOverrideModalInitialSafetyOverrideType] =
    useState<SafetyOverrideTypeId | undefined>(undefined)
  const [editMessageOpen, setEditMessageOpen] = useState(false)
  const [editMessageInitial, setEditMessageInitial] =
    useState<EditMessageModalInitial | null>(null)
  const [failedMessageDetailsOpen, setFailedMessageDetailsOpen] = useState(false)
  const [failedMessageDetailsPayload, setFailedMessageDetailsPayload] =
    useState<FailedMessageDetailsPayload | null>(null)
  const [dismissedExternalAlertIds, setDismissedExternalAlertIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [configureAiSourcesOpen, setConfigureAiSourcesOpen] = useState(false)
  const [retryFailedDeliveryOpen, setRetryFailedDeliveryOpen] = useState(false)
  const [retryFailedDeliveryData, setRetryFailedDeliveryData] =
    useState<RetryFailedDeliveryPayload | null>(null)
  const [retryingRowId, setRetryingRowId] = useState<string | null>(null)
  const [retryFailedDeliveryPresentation, setRetryFailedDeliveryPresentation] =
    useState<RetryFailedDeliveryPresentation>('modal')
  const [updateContactInfoOpen, setUpdateContactInfoOpen] = useState(false)
  const [updateContactInfoPresentation, setUpdateContactInfoPresentation] =
    useState<UpdateContactInformationPresentation>('modal')
  const [confirmEmergencyAlertOpen, setConfirmEmergencyAlertOpen] = useState(false)
  const [confirmEmergencyAlertPresentation, setConfirmEmergencyAlertPresentation] =
    useState<ConfirmEmergencyAlertPresentation>('modal')
  const [emergencyAlertDetailsOpen, setEmergencyAlertDetailsOpen] = useState(false)
  const [emergencyAlertDetailsPresentation, setEmergencyAlertDetailsPresentation] =
    useState<EmergencyAlertDetailsPresentation>('modal')

  const invalidateBroadcastMetricsRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!supabase) {
      setBroadcastDashboardStats(EMPTY_BROADCAST_DASHBOARD_STATS)
      setMessageHistoryRows(isDemoAccountActive() ? MESSAGE_HISTORY_ROWS : [])
      setScheduledBroadcastAutomations([])
      return
    }
    const sb = supabase
    let cancelled = false

    async function loadBroadcastDashboardStats() {
      let activeNotifications = 0

      try {
        const baseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '') ?? ''
        const statsUrl = baseUrl ? `${baseUrl}/functions/v1/get-broadcast-stats` : ''
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
        if (!statsUrl) {
          throw new Error('get-broadcast-stats: missing VITE_SUPABASE_URL')
        }
        const res = await fetch(statsUrl, {
          headers: anonKey
            ? {
                apikey: anonKey,
                Authorization: `Bearer ${anonKey}`,
              }
            : {},
        })
        if (!res.ok) {
          throw new Error(`get-broadcast-stats failed (${res.status})`)
        }
        const stats = (await res.json()) as {
          activeNotifications?: unknown
        }
        activeNotifications =
          typeof stats.activeNotifications === 'number' && Number.isFinite(stats.activeNotifications)
            ? stats.activeNotifications
            : 0
      } catch (error) {
        console.error(
          '[notifications] get-broadcast-stats failed',
          error instanceof Error ? error.message : String(error),
        )
      }

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const [
        { count: scheduledCount, error: schedResErr },
        { count: broadcastOk7, error: ok7Err },
        { count: broadcastFail7, error: fail7Err },
      ] = await Promise.all([
        sb
          .from('broadcast_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('landlord_id', getActiveLandlordId())
          .eq('status', 'scheduled'),
        sb
          .from('broadcast_notification_log')
          .select('*', { count: 'exact', head: true })
          .eq('landlord_id', getActiveLandlordId())
          .gte('created_at', sevenDaysAgo)
          .eq('success', true),
        sb
          .from('broadcast_notification_log')
          .select('*', { count: 'exact', head: true })
          .eq('landlord_id', getActiveLandlordId())
          .gte('created_at', sevenDaysAgo)
          .eq('success', false),
      ])

      if (cancelled) return
      if (schedResErr) {
        console.error('[notifications] scheduled broadcast count failed', schedResErr.message)
      }
      if (ok7Err) {
        console.error('[notifications] broadcast 7d success count failed', ok7Err.message)
      }
      if (fail7Err) {
        console.error('[notifications] broadcast 7d failure count failed', fail7Err.message)
      }

      const broadcastSuccess7d = broadcastOk7 ?? 0
      const broadcastFailed7d = broadcastFail7 ?? 0
      const broadcastAttempts7d = broadcastSuccess7d + broadcastFailed7d
      const successRate7d =
        broadcastAttempts7d > 0
          ? Math.max(0, Math.min(100, Math.round((broadcastSuccess7d / broadcastAttempts7d) * 100)))
          : 0

      setBroadcastDashboardStats({
        activeNotifications24h: activeNotifications,
        broadcastSuccess7d,
        broadcastFailed7d,
        scheduledDbCount: scheduledCount ?? 0,
        successRate7d,
      })
    }

    async function loadScheduledBroadcastRows() {
      let data: BroadcastScheduleRow[] | null = null
      let error: { message?: string } | null = null

      const withPayload = await sb
        .from('broadcast_notifications')
        .select('id, subject, message, status, created_at, scheduled_for, audience, channels, building, payload')
        .eq('landlord_id', getActiveLandlordId())
        .in('status', ['scheduled', 'processing', 'completed', 'partial'])
        .order('created_at', { ascending: false })

      if (withPayload.error) {
        const msg = (withPayload.error.message ?? '').toLowerCase()
        if (msg.includes('payload') && msg.includes('column')) {
          const fallback = await sb
            .from('broadcast_notifications')
            .select('id, subject, message, status, created_at, scheduled_for, audience, channels, building')
            .eq('landlord_id', getActiveLandlordId())
            .in('status', ['scheduled', 'processing', 'completed', 'partial'])
            .order('created_at', { ascending: false })
          data = (fallback.data ?? null) as BroadcastScheduleRow[] | null
          error = fallback.error
        } else {
          data = (withPayload.data ?? null) as BroadcastScheduleRow[] | null
          error = withPayload.error
        }
      } else {
        data = (withPayload.data ?? null) as BroadcastScheduleRow[] | null
        error = null
      }

      if (cancelled) return
      if (error) {
        console.error('[notifications] scheduled broadcasts load failed', error.message)
        setScheduledBroadcastAutomations([])
        return
      }
      const rows = (data ?? []) as BroadcastScheduleRow[]
      const automationRows = rows.filter(
        (row) =>
          row.status === 'scheduled' ||
          row.status === 'processing' ||
          hasSelectedBroadcastAutomation(row.payload) ||
          hasInspectionAutomationFallback(row),
      )
      setScheduledBroadcastAutomations(automationRows.map(broadcastRowToAutomationItem))
    }

    async function loadMessageHistoryRows() {
      const [resident, vendor] = await Promise.all([
        sb
          .from('resident_notification_log')
          .select(
            `
            id,
            created_at,
            ticket_id,
            event_type,
            channel,
            error,
            vendor_name,
            maintenance_requests (
              id,
              resident_name,
              unit
            )
          `,
          )
          .eq('landlord_id', getActiveLandlordId())
          .order('created_at', { ascending: false })
          .limit(40),
        sb
          .from('vendor_notification_log')
          .select(
            `
            id,
            created_at,
            ticket_id,
            channel,
            error,
            vendors (
              id,
              name
            )
          `,
          )
          .eq('landlord_id', getActiveLandlordId())
          .order('created_at', { ascending: false })
          .limit(40),
      ])

      let broadcastData: unknown[] | null = null
      let broadcastError: { message?: string } | null = null

      const broadcastWithRecipients = await sb
        .from('broadcast_notification_log')
        .select(
          `
          id,
          created_at,
          channel,
          success,
          error,
          broadcast_id,
          recipient_user_id,
          recipient_name,
          recipient_email,
          broadcast_notifications (
            subject,
            message,
            audience
          )
        `,
        )
        .eq('landlord_id', getActiveLandlordId())
        .order('created_at', { ascending: false })
        .limit(40)

      if (broadcastWithRecipients.error) {
        const msg = (broadcastWithRecipients.error.message ?? '').toLowerCase()
        const missingRecipientCols =
          msg.includes('recipient_name') || msg.includes('recipient_email')
        if (missingRecipientCols) {
          const broadcastFallback = await sb
            .from('broadcast_notification_log')
            .select(
              `
              id,
              created_at,
              channel,
              success,
              error,
              broadcast_id,
              recipient_user_id,
              broadcast_notifications (
                subject,
                message,
                audience
              )
            `,
            )
            .eq('landlord_id', getActiveLandlordId())
            .order('created_at', { ascending: false })
            .limit(40)
          broadcastData = broadcastFallback.data
          broadcastError = broadcastFallback.error
        } else {
          broadcastData = broadcastWithRecipients.data
          broadcastError = broadcastWithRecipients.error
        }
      } else {
        broadcastData = broadcastWithRecipients.data
        broadcastError = null
      }

      if (cancelled) return
      if (resident.error || vendor.error) {
        console.error(
          '[notifications] message history load failed',
          resident.error?.message ?? vendor.error?.message,
        )
        return
      }
      if (broadcastError) {
        console.error('[notifications] broadcast log history failed', broadcastError.message)
      }

      const residentRows = (resident.data ?? []) as ResidentNotificationLogRow[]
      const vendorRows = (vendor.data ?? []) as VendorNotificationLogRow[]
      const broadcastRows = (broadcastData ?? []) as BroadcastNotificationLogRow[]
      const recipientUserIds = Array.from(
        new Set(
          broadcastRows
            .map((r) => (r.recipient_user_id ?? '').trim())
            .filter((id): id is string => id.length > 0),
        ),
      )
      const broadcastRecipientByUserId = new Map<string, { name: string | null; email: string | null }>()
      if (recipientUserIds.length > 0) {
        const { data: usersData, error: usersErr } = await sb
          .from('users')
          .select('id, full_name, email')
          .in('id', recipientUserIds)
        if (usersErr) {
          console.error('[notifications] broadcast recipient users lookup failed', usersErr.message)
        } else {
          for (const u of
            (usersData ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
            broadcastRecipientByUserId.set(u.id, {
              name: u.full_name ?? null,
              email: u.email ?? null,
            })
          }
        }
      }
      const enrichedBroadcastRows = broadcastRows.map((row) => {
        const uid = (row.recipient_user_id ?? '').trim()
        const recipientFromUsers = uid ? broadcastRecipientByUserId.get(uid) : undefined
        return {
          ...row,
          recipient_name:
            (row.recipient_name ?? '').trim() ||
            (recipientFromUsers?.name ?? '').trim() ||
            null,
          recipient_email:
            (row.recipient_email ?? '').trim() ||
            (recipientFromUsers?.email ?? '').trim() ||
            null,
        }
      })
      const merged = [
        ...residentRows.map((r) => ({
          createdAt: r.created_at,
          row: notifRowFromResidentLog(r),
        })),
        ...vendorRows.map((r) => ({
          createdAt: r.created_at,
          row: notifRowFromVendorLog(r),
        })),
        ...enrichedBroadcastRows.map((r) => ({
          createdAt: r.created_at,
          row: notifRowFromBroadcastLog(r),
        })),
      ]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .map((x) => x.row)
        .slice(0, 50)
      setMessageHistoryRows(merged)
    }

    invalidateBroadcastMetricsRef.current = () => {
      void loadBroadcastDashboardStats()
      void loadMessageHistoryRows()
      void loadScheduledBroadcastRows()
    }

    void loadBroadcastDashboardStats()
    void loadMessageHistoryRows()
    void loadScheduledBroadcastRows()

    const pollId = window.setInterval(() => {
      if (!cancelled) {
        void loadBroadcastDashboardStats()
        void loadMessageHistoryRows()
        void loadScheduledBroadcastRows()
      }
    }, 20_000)

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        void loadBroadcastDashboardStats()
        void loadMessageHistoryRows()
        void loadScheduledBroadcastRows()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const channel = sb
      .channel('notification-log-metrics')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resident_notification_log' },
        () => {
          void loadMessageHistoryRows()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vendor_notification_log' },
        () => {
          void loadMessageHistoryRows()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'broadcast_notification_log' },
        () => {
          void loadBroadcastDashboardStats()
          void loadMessageHistoryRows()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'broadcast_notifications' },
        () => {
          void loadBroadcastDashboardStats()
          void loadScheduledBroadcastRows()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      invalidateBroadcastMetricsRef.current = null
      window.clearInterval(pollId)
      document.removeEventListener('visibilitychange', onVisibility)
      void sb.removeChannel(channel)
    }
  }, [])

  const computedRecentBroadcasts = broadcastDashboardStats.broadcastSuccess7d
  const computedFailedDeliveries = broadcastDashboardStats.broadcastFailed7d
  const computedScheduledDbCount = broadcastDashboardStats.scheduledDbCount
  const computedScheduledTabTotal = scheduledBroadcastAutomations.length
  const computedActiveNotifications = broadcastDashboardStats.activeNotifications24h
  const computedBroadcastSuccessPct = broadcastDashboardStats.successRate7d
  const overrideScopeOptionsFromScheduled = useMemo<OverrideAutomationScopeOption[]>(
    () =>
      scheduledBroadcastAutomations.map((item) => ({
        value: item.id,
        label: `${item.title} — ${item.metaLine}`,
      })),
    [scheduledBroadcastAutomations],
  )

  const statCards = useMemo(
    () => [
      {
        label: 'Active Notifications',
        value: String(computedActiveNotifications),
        hint: 'Live broadcasts',
        valueClass: 'text-extended-3',
        icon: 'bell' as const,
      },
      {
        label: 'Scheduled Messages',
        value: String(computedScheduledDbCount),
        hint: 'Broadcasts queued in database',
        valueClass: 'text-extended-3',
        icon: 'clock' as const,
      },
    ],
    [computedActiveNotifications, computedScheduledDbCount],
  )
  function closeEmergencyAlertDetails() {
    setEmergencyAlertDetailsOpen(false)
    setEmergencyAlertDetailsPresentation('modal')
  }

  function closeConfirmEmergencyAlert() {
    setConfirmEmergencyAlertOpen(false)
    setConfirmEmergencyAlertPresentation('modal')
  }

  const visibleExternalAlerts = EXTERNAL_ALERT_CARDS.filter(
    (c) => !dismissedExternalAlertIds.has(c.id),
  )
  const filteredMessageHistoryRows = useMemo(() => {
    const q = messageHistorySearch.trim().toLowerCase()
    return messageHistoryRows.filter((row) => {
      const typeLabel = row.chips[0]?.label?.trim().toLowerCase() ?? ''
      const typePass =
        messageHistoryTypeFilter === 'all' || typeLabel === messageHistoryTypeFilter

      const statusPass =
        messageHistoryStatusFilter === 'all' ||
        (messageHistoryStatusFilter === 'failed'
          ? row.variant === 'failed'
          : row.variant !== 'failed')

      if (!typePass || !statusPass) return false
      if (!q) return true

      const haystack = [row.title, row.description, ...row.meta, ...row.chips.map((c) => c.label)]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [messageHistoryRows, messageHistorySearch, messageHistoryStatusFilter, messageHistoryTypeFilter])
  const notifTabs = useMemo(
    () => [
      {
        id: 'history' as const,
        label: `Message History (${messageHistoryRows.length})`,
      },
      {
        id: 'scheduled' as const,
        label: `Scheduled Automations (${computedScheduledTabTotal})`,
      },
      {
        id: 'external' as const,
        label: `External Alerts (${visibleExternalAlerts.length})`,
      },
    ],
    [
      computedScheduledTabTotal,
      messageHistoryRows.length,
      visibleExternalAlerts.length,
    ],
  )

  return (
    <>
      <header className="border-b border-secondary bg-white px-8 py-8">
        <div>
          <h1 className="text-[22px] font-semibold leading-8 tracking-[0.0703px] text-extended-3 sm:text-[24px]">
            Notification Management
          </h1>
          <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-neutral">
            Manage system notifications.
          </p>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-8 py-8">
        <div className="w-full space-y-6">
          <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {statCards.map((s) => (
              <div
                key={s.label}
                className="flex h-full min-h-0 flex-col gap-y-3 rounded-[10px] border border-secondary bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]"
              >
                <div className="flex shrink-0 items-start justify-between gap-2">
                  <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-neutral">
                    {s.label}
                  </p>
                  <StatGlyph name={s.icon} />
                </div>
                <div className="flex min-h-20 w-full min-w-0 flex-1 items-center">
                  <p
                    className={`text-[70px] font-light leading-none tracking-[0.0703px] tabular-nums ${s.valueClass}`}
                  >
                    {s.value}
                  </p>
                </div>
                <p className="shrink-0 text-[12px] leading-4 text-neutral">{s.hint}</p>
              </div>
            ))}
            <div className="flex h-full min-h-0 flex-col gap-y-3 rounded-[10px] border border-secondary bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-neutral">
                    Broadcast Success rate
                  </span>
                  <span className="text-[20px] font-semibold leading-7 tracking-[0.02em] tabular-nums text-[#0a0a0a]">
                    {computedBroadcastSuccessPct}%
                  </span>
                </div>
                <img
                  src={broadcastIcon}
                  alt=""
                  className="size-5 shrink-0 object-contain opacity-55"
                  aria-hidden
                />
              </div>
              <div className="flex min-h-20 w-full min-w-0 flex-1 items-center">
                <BroadcastsFailedDonut
                  recentBroadcasts={computedRecentBroadcasts}
                  failedDeliveries={computedFailedDeliveries}
                />
              </div>
              <p className="shrink-0 text-[12px] leading-4 text-neutral">
                Last 7 days · failures require attention
              </p>
            </div>
          </div>

          <div className="rounded-[10px] border border-secondary bg-white px-6 pb-6 pt-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => openBroadcast('modal')}
                className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-black/10 bg-transparent px-3 text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none transition-colors duration-150 hover:bg-secondary hover:border-black/12 active:bg-secondary active:border-black/15 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                Broadcast Message
              </button>
              <button
                type="button"
                onClick={() => setInspectionModalOpen(true)}
                className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-black/10 bg-transparent px-3 text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none transition-colors duration-150 hover:bg-secondary hover:border-black/12 active:bg-secondary active:border-black/15 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                Inspection Notice
              </button>
              <button
                type="button"
                onClick={() => {
                  setOverrideModalInitialCategory(undefined)
                  setOverrideModalInitialTicketId(undefined)
                  setOverrideModalContext('default')
                  setOverrideModalPresentation('modal')
                  setOverrideModalOpen(true)
                }}
                className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-black/10 bg-transparent px-3 text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none transition-colors duration-150 hover:bg-secondary hover:border-black/12 active:bg-secondary active:border-black/15 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                Override Automation
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-[10px] border border-secondary bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div
              className="flex flex-wrap gap-x-6 gap-y-2 border-b border-secondary px-6 pt-3"
              role="tablist"
              aria-label="Notification views"
            >
              {notifTabs.map((t) => {
                const isActive = tab === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setTab(t.id)}
                    className={[
                      '-mb-px border-b-2 pb-3 text-[14px] font-medium tracking-[-0.1504px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2',
                      isActive
                        ? 'border-extended-1 text-extended-1'
                        : 'border-transparent text-neutral hover:text-extended-3',
                    ].join(' ')}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>

            <div className="space-y-4 p-6" role="tabpanel">
              {tab === 'scheduled' ? (
                <AutomationsPanel
                  title="Scheduled Automations"
                  items={scheduledBroadcastAutomations}
                  scheduledInDatabaseCount={broadcastDashboardStats.scheduledDbCount}
                  onOverride={(item) => {
                    if (item.id === 'sa-1') {
                      setOverrideModalContext('default')
                      setOverrideModalInitialCategory('billing')
                      setOverrideModalInitialTicketId(MONTHLY_RENT_REMINDER_BILLING_SCOPE)
                    } else if (item.id === 'sa-2') {
                      setOverrideModalContext('default')
                      setOverrideModalInitialCategory('inspection')
                      setOverrideModalInitialTicketId(INSPECTION_72HR_NOTICE_SCOPE)
                    } else if (item.id === 'sa-3') {
                      setOverrideModalContext('default')
                      setOverrideModalInitialCategory('maintenance')
                      setOverrideModalInitialTicketId(MAINTENANCE_REQUEST_UPDATES_SCOPE)
                    } else {
                      setOverrideModalContext('default')
                      setOverrideModalInitialCategory(undefined)
                      setOverrideModalInitialTicketId(undefined)
                    }
                    setOverrideModalPresentation('rail')
                    setOverrideModalOpen(true)
                  }}
                />
              ) : tab === 'external' ? (
                <ExternalAlertsAggregatedPanel
                  visibleCards={visibleExternalAlerts}
                  onDismiss={(id) => {
                    setDismissedExternalAlertIds((prev) => new Set(prev).add(id))
                  }}
                  onNotifyResidents={() => openBroadcast('rail')}
                  onConfigureSources={() => setConfigureAiSourcesOpen(true)}
                />
              ) : tab === 'history' ? (
                <>
                  <div className="mb-1 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <label className="flex min-w-0 items-center gap-2 rounded-lg border border-secondary bg-white px-3 py-2 focus-within:border-black/20">
                      <svg
                        className="size-4 shrink-0 text-neutral"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden
                      >
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                      </svg>
                      <input
                        type="search"
                        value={messageHistorySearch}
                        onChange={(e) => setMessageHistorySearch(e.target.value)}
                        placeholder="Search message history"
                        className="w-full min-w-0 border-0 bg-transparent p-0 text-[14px] leading-5 text-extended-3 outline-none placeholder:text-neutral"
                      />
                    </label>
                    <div className="relative">
                      <select
                        value={messageHistoryStatusFilter}
                        onChange={(e) =>
                          setMessageHistoryStatusFilter(e.target.value as MessageHistoryStatusFilter)
                        }
                        className="h-10 appearance-none rounded-lg border border-black/10 bg-white pl-3 pr-9 text-[14px] text-extended-3 outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5]"
                        aria-label="Filter message history by status"
                      >
                        <option value="all">All statuses</option>
                        <option value="sent">Sent</option>
                        <option value="failed">Failed</option>
                      </select>
                      <svg
                        className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-neutral"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </div>
                    <div className="relative">
                      <select
                        value={messageHistoryTypeFilter}
                        onChange={(e) =>
                          setMessageHistoryTypeFilter(e.target.value as MessageHistoryTypeFilter)
                        }
                        className="h-10 appearance-none rounded-lg border border-black/10 bg-white pl-3 pr-9 text-[14px] text-extended-3 outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5]"
                        aria-label="Filter message history by notification type"
                      >
                        <option value="all">All types</option>
                        <option value="resident">Resident</option>
                        <option value="vendor">Vendor</option>
                        <option value="broadcast">Broadcast</option>
                      </select>
                      <svg
                        className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-neutral"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </div>
                  </div>
                  {filteredMessageHistoryRows.length === 0 ? (
                    <p className="py-10 text-center text-[14px] leading-5 text-neutral">
                      {messageHistoryRows.length === 0
                        ? 'No message history yet. Maintenance and broadcast deliveries will appear here.'
                        : 'No messages match your current search and filters.'}
                    </p>
                  ) : (
                    filteredMessageHistoryRows.map((row) => {
                      const rowOpensEditOrFailed = historyRowHasEditOrFailedDetails(row)
                      return (
                  <article
                    key={row.id}
                    role={rowOpensEditOrFailed ? 'button' : undefined}
                    tabIndex={rowOpensEditOrFailed ? 0 : undefined}
                    onClick={
                      rowOpensEditOrFailed
                        ? () => openHistoryRowEditOrFailedDetails(row)
                        : undefined
                    }
                    onKeyDown={
                      rowOpensEditOrFailed
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              openHistoryRowEditOrFailedDetails(row)
                            }
                          }
                        : undefined
                    }
                    className={`rounded-[10px] border p-4 sm:p-[17px] ${cardShellClasses(row.variant)}${
                      rowOpensEditOrFailed
                        ? ' cursor-pointer outline-none transition-shadow hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2'
                        : ''
                    }${row.footer === 'failed' ? ' relative' : ''}`}
                  >
                      {row.footer === 'failed' ? (
                        <button
                          type="button"
                          disabled={retryingRowId === row.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            setRetryingRowId(row.id)
                            void retryRowWithExistingChannel(row)
                              .then(() => {
                                window.alert('Retry sent using existing channel.')
                              })
                              .catch((err) => {
                                window.alert(err instanceof Error ? err.message : 'Retry failed')
                              })
                              .finally(() => {
                                setRetryingRowId((prev) => (prev === row.id ? null : prev))
                              })
                          }}
                          className="absolute right-4 top-4 z-10 inline-flex h-8 max-w-[calc(100%-2rem)] items-center justify-center gap-1.5 rounded-lg border border-[#0030b5] bg-[#0030b5] px-2.5 text-[13px] font-medium leading-none tracking-[-0.1504px] text-[#ffffff] outline-none hover:bg-[#9da8ec] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:right-[17px] sm:top-[17px] sm:gap-2 sm:px-3 sm:text-[14px]"
                        >
                          <span className="truncate">
                            {retryingRowId === row.id ? 'Sending…' : 'Send Again'}
                          </span>
                        </button>
                      ) : null}
                      <div
                        className={`min-w-0 space-y-2${row.footer === 'failed' ? ' pr-36 sm:pr-52' : ''}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {row.chips.map((c, i) => (
                            <span
                              key={`${row.id}-chip-${i}`}
                              className={`inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 ${c.className}`}
                            >
                              {c.label}
                            </span>
                          ))}
                        </div>
                        <h3 className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-extended-3">
                          {row.title}
                        </h3>
                        <p className="text-[14px] leading-5 tracking-[-0.1504px] text-neutral-variant">
                          {row.description}
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-4 text-neutral">
                          {row.meta.map((m, i) => (
                            <span key={`${row.id}-meta-${i}`} className="inline-flex items-center gap-1.5">
                              {m === 'SMS' ? (
                                <img
                                  src={smsIcon}
                                  alt=""
                                  className="size-3.5 shrink-0 object-contain opacity-70"
                                  aria-hidden
                                />
                              ) : m === 'Email' ? (
                                <img
                                  src={emailIcon}
                                  alt=""
                                  className="size-3.5 shrink-0 object-contain opacity-70"
                                  aria-hidden
                                />
                              ) : m === 'Broadcast' ? (
                                <img
                                  src={broadcastIcon}
                                  alt=""
                                  className="size-3.5 shrink-0 object-contain opacity-70"
                                  aria-hidden
                                />
                              ) : m === 'Delivery failed' ? (
                                <img
                                  src={failedDeliveryIcon}
                                  alt=""
                                  className="size-3.5 shrink-0 object-contain opacity-70"
                                  aria-hidden
                                />
                              ) : m === 'Delivered' ? (
                                <img
                                  src={deliveredIcon}
                                  alt=""
                                  className="size-3.5 shrink-0 object-contain opacity-70"
                                  aria-hidden
                                />
                              ) : m.startsWith('Ticket ') ? (
                                <img
                                  src={ticketIcon}
                                  alt=""
                                  className="size-3.5 shrink-0 object-contain opacity-70"
                                  aria-hidden
                                />
                              ) : m.startsWith('Time ') ? (
                                <img
                                  src={calenderIcon}
                                  alt=""
                                  className="size-3.5 shrink-0 object-contain opacity-70"
                                  aria-hidden
                                />
                              ) : null}
                              {m.startsWith('Time ') ? m.slice(5) : m}
                            </span>
                          ))}
                        </div>
                        {row.footer === 'pending' ? (
                          <div className="flex flex-wrap gap-2 pt-2">
                            <button
                              type="button"
                              disabled
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex h-8 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none opacity-50 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                            >
                              <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                openBroadcast('rail')
                              }}
                              className="inline-flex h-8 items-center justify-center rounded-lg bg-[#ffee6c] px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#101828] outline-none hover:bg-[#f5e35e] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                            >
                              Send Now
                            </button>
                          </div>
                        ) : null}
                      </div>
                  </article>
                      )
                    })
                  )}
                </>
              ) : (
                <p className="py-10 text-center text-[14px] leading-5 text-neutral">
                  No items in this view yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </main>

      <EmergencyAlertDetailsModal
        open={emergencyAlertDetailsOpen}
        onClose={closeEmergencyAlertDetails}
        presentation={emergencyAlertDetailsPresentation}
        onSendNow={() => {
          setConfirmEmergencyAlertPresentation('modal')
          setConfirmEmergencyAlertOpen(true)
        }}
        onSchedule={() => {
          closeEmergencyAlertDetails()
          setOverrideModalInitialCategory('safety')
          setOverrideModalInitialTicketId(PGE_GAS_LEAK_ADVISORY_AUTOMATION_ID)
          setOverrideModalInitialSafetyOverrideType('notification-rules')
          setOverrideModalPresentation('modal')
          setOverrideModalOpen(true)
        }}
      />
      <ConfirmEmergencyAlertModal
        open={confirmEmergencyAlertOpen}
        onClose={closeConfirmEmergencyAlert}
        presentation={confirmEmergencyAlertPresentation}
        onConfirmSend={() => openBroadcast('modal')}
      />
      <RetryFailedDeliveryModal
        open={retryFailedDeliveryOpen}
        onClose={closeRetryFailedDelivery}
        presentation={retryFailedDeliveryPresentation}
        data={retryFailedDeliveryData}
      />
      <UpdateContactInformationModal
        open={updateContactInfoOpen}
        onClose={closeUpdateContactInfo}
        presentation={updateContactInfoPresentation}
      />
      <ConfigureAiDataSourcesModal
        open={configureAiSourcesOpen}
        onClose={() => setConfigureAiSourcesOpen(false)}
      />
      <SendBroadcastMessageModal
        open={broadcastModalOpen}
        onClose={closeBroadcast}
        presentation={broadcastPresentation}
        onBroadcastStatsInvalidate={() => {
          invalidateBroadcastMetricsRef.current?.()
        }}
      />
      <SendInspectionNoticeModal
        open={inspectionModalOpen}
        onClose={() => setInspectionModalOpen(false)}
        onBroadcastStatsInvalidate={() => {
          invalidateBroadcastMetricsRef.current?.()
        }}
      />
      <OverrideAutomationModal
        open={overrideModalOpen}
        onClose={closeOverrideModal}
        onApply={handleOverrideApply}
        scopeOptionsOverride={overrideScopeOptionsFromScheduled}
        context={overrideModalContext}
        initialAutomationCategory={overrideModalInitialCategory}
        initialTicketId={overrideModalInitialTicketId}
        initialSafetyOverrideType={overrideModalInitialSafetyOverrideType}
        presentation={overrideModalPresentation}
      />
      <EditMessageModal
        open={editMessageOpen}
        onClose={() => {
          setEditMessageOpen(false)
          setEditMessageInitial(null)
        }}
        initial={editMessageInitial}
      />
      <FailedMessageDetailsModal
        open={failedMessageDetailsOpen}
        onClose={() => {
          setFailedMessageDetailsOpen(false)
          setFailedMessageDetailsPayload(null)
        }}
        data={failedMessageDetailsPayload}
      />
    </>
  )
}
