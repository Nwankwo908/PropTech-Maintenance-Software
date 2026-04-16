import { useState } from 'react'
import broadcastIcon from '@/assets/Broadcast.svg'
import inspectionIcon from '@/assets/Inspection_3.svg'
import overrideIcon from '@/assets/Override.svg'
import retryIcon from '@/assets/Retry.svg'
import { ConfigureAiDataSourcesModal } from '@/components/ConfigureAiDataSourcesModal'
import {
  RetryFailedDeliveryModal,
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
  type MessageDetailsPayload,
  MessageDetailsModal,
} from '@/components/MessageDetailsModal'
import {
  OverrideAutomationModal,
  PGE_GAS_LEAK_ADVISORY_AUTOMATION_ID,
  type AutomationCategoryId,
  type OverrideAutomationContext,
  type OverrideAutomationPresentation,
  type SafetyOverrideTypeId,
} from '@/components/OverrideAutomationModal'
import {
  SendBroadcastMessageModal,
  type SendBroadcastPresentation,
} from '@/components/SendBroadcastMessageModal'
import { SendInspectionNoticeModal } from '@/components/SendInspectionNoticeModal'

const NOTIF_TABS = [
  { id: 'history', label: 'Message History' },
  { id: 'scheduled', label: 'Scheduled Automations' },
  { id: 'external', label: 'External Alerts' },
  { id: 'failed', label: 'Failed & Urgent' },
] as const

type TabId = (typeof NOTIF_TABS)[number]['id']

const STAT_CARDS = [
  {
    label: 'Active Notifications',
    value: '24',
    hint: 'Live broadcasts',
    valueClass: 'text-[#0a0a0a]',
    icon: 'bell' as const,
  },
  {
    label: 'Scheduled Messages',
    value: '12',
    hint: 'Pending automation',
    valueClass: 'text-[#0a0a0a]',
    icon: 'clock' as const,
  },
] as const

const STAT_RECENT_BROADCASTS = 156
const STAT_FAILED_DELIVERIES = 3
const STAT_BROADCAST_SUCCESS_PCT =
  STAT_RECENT_BROADCASTS + STAT_FAILED_DELIVERIES > 0
    ? Math.round(
        (STAT_RECENT_BROADCASTS / (STAT_RECENT_BROADCASTS + STAT_FAILED_DELIVERIES)) * 100,
      )
    : 0

function IconBroadcast({ className = 'size-5 shrink-0 text-[#00a63e]' }: { className?: string }) {
  return (
    <svg className={['block', className].join(' ')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8.5z"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StatGlyph({ name }: { name: (typeof STAT_CARDS)[number]['icon'] }) {
  const cls = 'size-5 shrink-0'
  if (name === 'bell') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
          stroke="#155dfc"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="#9810fa" strokeWidth={1.8} />
      <path
        d="M12 7v5l3 2"
        stroke="#9810fa"
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
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
          {lenOk > 0 ? (
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke="#00a63e"
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
              stroke="#e7000b"
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={`${lenFail} ${c}`}
              strokeDashoffset={-lenOk}
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
          <span className="size-2 shrink-0 rounded-full bg-[#00a63e]" aria-hidden />
          <span className="min-w-0 text-[#364153]">Recent broadcasts</span>
          <span className="ml-auto shrink-0 font-semibold tabular-nums text-[#101828]">
            {recentBroadcasts}
          </span>
        </li>
        <li className="flex items-center gap-2 text-[12px] leading-4">
          <span className="size-2 shrink-0 rounded-full bg-[#e7000b]" aria-hidden />
          <span className="min-w-0 text-[#364153]">Failed deliveries</span>
          <span className="ml-auto shrink-0 font-semibold tabular-nums text-[#101828]">
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

const RENT_PAYMENT_MESSAGE_DETAILS: MessageDetailsPayload = {
  sentAtLabel: 'Sent Mar 24, 2026, 9:00 AM',
  statusBadge: {
    label: 'Sent',
    className: 'border border-[#b9f8cf] bg-[#dcfce7] text-[#008236]',
  },
  categoryBadge: { label: 'Rent', className: 'bg-[#dbeafe] text-[#1447e6]' },
  messageTitle: 'Rent Payment Reminder - Due March 31',
  messageBody:
    'Your rent payment of $1,250 is due on March 31st. Pay online through the resident portal.',
  totalRecipients: 142,
  delivered: 139,
  failed: 3,
  failedDeliveries: [
    { unit: 'Unit 8C', name: 'John Davis', reason: 'Invalid email address' },
    { unit: 'Unit 12A', name: 'Lisa Wang', reason: 'Phone number disconnected' },
    { unit: 'Unit 15B', name: 'Tom Martinez', reason: 'Email bounced' },
  ],
  channels: ['📧 Email', '📱 SMS'],
}

const MESSAGE_DETAILS_BY_ID: Partial<Record<string, MessageDetailsPayload>> = {
  '1': RENT_PAYMENT_MESSAGE_DETAILS,
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
  categoryBadge: { label: 'Alert - System', className: 'bg-[#ffe2e2] text-[#c10007]' },
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

function messageDetailsForRow(row: NotifRow): MessageDetailsPayload {
  const preset = MESSAGE_DETAILS_BY_ID[row.id]
  if (preset) return preset

  const STATUS = new Set(['Sent', 'Pending', 'Failed'])
  const statusChip = row.chips.find((c) => STATUS.has(c.label))
  const categoryChip = row.chips.find(
    (c) =>
      !STATUS.has(c.label) &&
      c.label !== '🤖 Automated' &&
      !c.label.startsWith('🤖'),
  )

  const metaBlob = row.meta.join(' ')
  const timeLine = row.meta.find((m) => m.startsWith('🕐'))
  const sentAtLabel = timeLine ? `Sent ${timeLine.replace(/^🕐\s*/, '')}` : '—'

  const deliveredMatch = metaBlob.match(/(\d+)\s+delivered/)
  const failedMatch = metaBlob.match(/(\d+)\s+failed/)
  const unitsMatch = metaBlob.match(/\((\d+)\s+units?\)/)
  const delivered = deliveredMatch ? parseInt(deliveredMatch[1], 10) : 0
  const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0
  const fromUnits = unitsMatch ? parseInt(unitsMatch[1], 10) : 0
  const totalRecipients =
    fromUnits > 0 ? fromUnits : delivered + failed > 0 ? delivered + failed : 0

  const channelLine = row.meta.find((m) => m.includes('📧') || m.includes('SMS'))
  const channels: string[] = []
  if (channelLine?.includes('Email')) channels.push('📧 Email')
  if (channelLine?.includes('SMS')) channels.push('📱 SMS')
  if (channels.length === 0) channels.push('📧 Email')

  return {
    sentAtLabel,
    statusBadge: statusChip ?? {
      label: '—',
      className: 'border border-[#e5e7eb] bg-[#f3f4f6] text-[#364153]',
    },
    categoryBadge: categoryChip ?? {
      label: 'Message',
      className: 'border border-[#e5e7eb] bg-[#f3f4f6] text-[#364153]',
    },
    messageTitle: row.title,
    messageBody: row.description,
    totalRecipients,
    delivered: delivered || (failed === 0 && totalRecipients > 0 ? totalRecipients : delivered),
    failed,
    failedDeliveries: [],
    channels,
  }
}

const MESSAGE_HISTORY_ROWS: NotifRow[] = [
  {
    id: '1',
    chips: [
      { label: 'Rent', className: 'bg-[#dbeafe] text-[#1447e6]' },
      { label: 'Sent', className: 'bg-[#dcfce7] text-[#008236]' },
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
      { label: 'Maintenance', className: 'bg-[#f3e8ff] text-[#8200db]' },
      { label: 'Sent', className: 'bg-[#dcfce7] text-[#008236]' },
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
      { label: 'Alert - City', className: 'bg-[#fef3c6] text-[#bb4d00]' },
      { label: 'Pending', className: 'bg-[#fef9c2] text-[#a65f00]' },
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
      { label: 'Inspection', className: 'bg-[#e0e7ff] text-[#432dd7]' },
      { label: 'Sent', className: 'bg-[#dcfce7] text-[#008236]' },
    ],
    title: 'Annual Fire Safety Inspection - Unit 5A',
    description:
      'Your unit is scheduled for annual fire safety inspection on Apr 2 at 10:00 AM. Please ensure access.',
    meta: [
      '📧 Email + SMS',
      '👥 Michael Chan (Unit 5A)',
      '✅ Delivered',
      '🕐 Mar 25, 11:30 AM',
    ],
    variant: 'default',
  },
  {
    id: '5',
    chips: [
      { label: 'Alert - System', className: 'bg-[#ffe2e2] text-[#c10007]' },
      { label: 'Sent', className: 'bg-[#dcfce7] text-[#008236]' },
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
    return 'bg-[#fffbeb] border-[#ffd230]'
  }
  if (variant === 'failed') {
    return 'bg-[#fef2f2] border-[#ffa2a2]'
  }
  return 'bg-white border-[#e5e7eb]'
}

type AutomationPanelItem = {
  id: string
  title: string
  metaLine: string
  status: 'active' | 'paused'
}

/** Demo scope id — pairs with DEMO_BILLING_AUTOMATIONS for Monthly Rent Reminder (Figma 112:5773). */
const MONTHLY_RENT_REMINDER_BILLING_SCOPE = 'bil-rent-rem'

/** Demo scope id — pairs with DEMO_INSPECTION_AUTOMATIONS for 72hr inspection reminder (Figma 121:12787). */
const INSPECTION_72HR_NOTICE_SCOPE = 'insp-72hr'

/** Demo ticket id — pairs with DEMO_TICKETS for Maintenance Request Updates automation (Figma 106:3458). */
const MAINTENANCE_REQUEST_UPDATES_SCOPE = 'MNT-AUTO-UPD'

const SCHEDULED_AUTOMATION_ITEMS: AutomationPanelItem[] = [
  {
    id: 'sa-1',
    title: 'Monthly Rent Reminder',
    metaLine:
      'Trigger: 7 days before rent due | Audience: All residents | Channel: Email + SMS',
    status: 'active',
  },
  {
    id: 'sa-2',
    title: 'Inspection Reminder (72hr notice)',
    metaLine:
      'Trigger: 72 hours before inspection | Audience: Affected unit | Channel: Email + SMS',
    status: 'active',
  },
  {
    id: 'sa-3',
    title: 'Maintenance Request Updates',
    metaLine:
      'Trigger: Status change on request | Audience: Request submitter | Channel: Email + SMS',
    status: 'active',
  },
]

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
    return 'bg-[#fef9c2] text-[#a65f00]'
  }
  return 'bg-[#dcfce7] text-[#008236]'
}

function externalAlertCardShell(card: ExternalAlertCard) {
  if (card.whiteBackground) {
    return 'bg-white border-[#e5e7eb]'
  }
  if (card.kind === 'action_required') {
    return 'bg-[#fffbeb] border-[#ffd230]'
  }
  if (card.kind === 'info') {
    return 'bg-[#eff6ff] border-[#8ec5ff]'
  }
  return 'bg-white border-[#e5e7eb]'
}

function externalAlertStatusBadgeClasses(kind: ExternalAlertCardKind) {
  if (kind === 'action_required') {
    return 'bg-[#fef3c6] text-[#bb4d00]'
  }
  if (kind === 'info') {
    return 'bg-[#dbeafe] text-[#1447e6]'
  }
  return 'bg-[#f3f4f6] text-[#364153]'
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
    <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-white px-[25px] pb-px pt-[25px]">
      <div className="flex h-8 w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h3 className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]">
            AI-Aggregated External Alerts
          </h3>
          {newCount > 0 ? (
            <span className="inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 bg-[#dbeafe] text-[#1447e6]">
              {newCount} New
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onConfigureSources}
          className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white px-[13px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
        >
          Configure Sources
        </button>
      </div>

      <div className="flex flex-col gap-3 pb-6">
        {visibleCards.length === 0 ? (
          <p className="py-8 text-center text-[14px] leading-5 text-[#6a7282]">
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
                  <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                    {card.title}
                  </span>
                  <span
                    className={`inline-flex rounded px-2 py-0.5 text-[12px] font-normal leading-4 ${externalAlertStatusBadgeClasses(card.kind)}`}
                  >
                    {card.badgeLabel}
                  </span>
                </div>
                <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#364153]">
                  {card.description}
                </p>
                <p className="text-[12px] leading-4 text-[#6a7282]">{card.sourceLine}</p>
                {card.showActions ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={onNotifyResidents}
                      className="inline-flex h-8 items-center justify-center rounded-lg bg-[#5f2167] px-3 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#4a1a52] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                    >
                      Notify Residents
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismiss(card.id)}
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-black/10 bg-white px-[13px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
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
}: {
  title: string
  items: AutomationPanelItem[]
  onOverride: (item: AutomationPanelItem) => void
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-white px-[25px] pb-6 pt-[25px]">
      <h3 className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]">
        {title}
      </h3>
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex flex-col gap-3 rounded-[10px] border border-[#e5e7eb] px-[13px] py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
                  {item.title}
                </span>
                <span
                  className={`inline-flex rounded px-2 py-0.5 text-[12px] font-normal leading-4 ${automationStatusPill(item.status)}`}
                >
                  {item.status === 'active' ? 'Active' : 'Paused'}
                </span>
              </div>
              <p className="text-[12px] leading-4 text-[#4a5565]">{item.metaLine}</p>
            </div>
            <button
              type="button"
              onClick={() => onOverride(item)}
              className="inline-flex h-8 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-[13px] text-[14px] font-medium tracking-[-0.1504px] text-[#e17100] outline-none hover:bg-[#fffbeb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 sm:w-auto"
            >
              <img src={overrideIcon} alt="" className="size-4 shrink-0 object-contain" />
              Override
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Failed & Urgent queue (Figma 83:1928). */
function FailedUrgentNotificationsPanel({
  onRetryAlternativeChannel,
  onUpdateContactInfo,
  onSendScheduledRentNow,
  onSendEmergencyGasAlert,
  onReviewGasAlertDetails,
}: {
  onRetryAlternativeChannel: () => void
  onUpdateContactInfo: () => void
  onSendScheduledRentNow: () => void
  onSendEmergencyGasAlert: () => void
  onReviewGasAlertDetails: () => void
}) {
  const issueCount = 3

  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-[#e5e7eb] bg-white px-[25px] pb-6 pt-[25px]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#82181a]">
          Failed &amp; Urgent Notifications
        </h3>
        <span className="inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 bg-[#ffe2e2] text-[#c10007]">
          {issueCount} Issues
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-[17px]">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                Failed SMS Delivery (3 recipients)
              </span>
            </div>
            <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#364153]">
              Emergency elevator notice failed to deliver to 3 residents via SMS. Email delivered
              successfully.
            </p>
            <p className="text-[12px] leading-4 text-[#6a7282]">
              Recipients: Unit 3A, 8B, 12C | Failure reason: Invalid phone numbers
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={onRetryAlternativeChannel}
                className="inline-flex h-8 items-center justify-center rounded-lg bg-[#5f2167] px-3 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#4a1a52] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
              >
                Retry via Alternative Channel
              </button>
              <button
                type="button"
                onClick={onUpdateContactInfo}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-black/10 bg-white px-[13px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
              >
                Update Contact Info
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-[17px]">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                Unsent Scheduled Message
              </span>
            </div>
            <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#364153]">
              Rent reminder scheduled for Mar 25, 9:00 AM was not sent due to system maintenance
              window.
            </p>
            <p className="text-[12px] leading-4 text-[#6a7282]">
              Audience: All residents (142 units) | Type: Automated rent reminder
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <a
                href="#broadcast-rent-reminder"
                onClick={(e) => {
                  e.preventDefault()
                  onSendScheduledRentNow()
                }}
                className="inline-flex h-8 items-center justify-center rounded-lg bg-[#5f2167] px-3 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#4a1a52] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
              >
                Send Now
              </a>
            </div>
          </div>
        </div>

        <div className="rounded-[10px] border border-[#e5e7eb] bg-white p-[17px]">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                High Priority: Urgent City Alert Not Sent
              </span>
              <span className="inline-flex rounded px-2 py-0.5 text-[12px] font-medium leading-4 bg-[#e7000b] text-white">
                URGENT
              </span>
            </div>
            <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#364153]">
              AI detected urgent gas leak advisory from PG&amp;E 2 hours ago. No notification has been
              sent to residents yet.
            </p>
            <p className="text-[12px] leading-4 text-[#6a7282]">
              Source: PG&amp;E Emergency Alert | Detected: Mar 25, 2:00 PM | Status: Awaiting approval
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={onSendEmergencyGasAlert}
                className="inline-flex h-8 items-center justify-center rounded-lg bg-[#5f2167] px-3 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#4a1a52] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
              >
                Send Emergency Alert Now
              </button>
              <button
                type="button"
                onClick={onReviewGasAlertDetails}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-black/10 bg-white px-[13px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
              >
                Review Details
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AdminNotificationManagementDashboard() {
  const [tab, setTab] = useState<TabId>('history')
  const [broadcastModalOpen, setBroadcastModalOpen] = useState(false)
  const [broadcastPresentation, setBroadcastPresentation] =
    useState<SendBroadcastPresentation>('modal')

  function openBroadcast(presentation: SendBroadcastPresentation) {
    setBroadcastPresentation(presentation)
    setBroadcastModalOpen(true)
  }

  function closeBroadcast() {
    setBroadcastModalOpen(false)
    setBroadcastPresentation('modal')
  }

  function closeRetryFailedDelivery() {
    setRetryFailedDeliveryOpen(false)
    setRetryFailedDeliveryPresentation('modal')
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
  const [messageDetailsOpen, setMessageDetailsOpen] = useState(false)
  const [messageDetailsPayload, setMessageDetailsPayload] =
    useState<MessageDetailsPayload | null>(null)
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

  return (
    <>
      <header className="border-b border-[#e5e7eb] bg-white px-8 py-8">
        <div>
          <h1 className="text-[22px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a] sm:text-[24px]">
            Notification Management
          </h1>
          <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
            Manage system notifications.
          </p>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-8 py-8">
        <div className="w-full space-y-6">
          <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {STAT_CARDS.map((s) => (
              <div
                key={s.label}
                className="flex h-full min-h-0 flex-col gap-y-3 rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]"
              >
                <div className="flex shrink-0 items-start justify-between gap-2">
                  <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]">
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
                <p className="shrink-0 text-[12px] leading-4 text-[#6a7282]">{s.hint}</p>
              </div>
            ))}
            <div className="flex h-full min-h-0 flex-col gap-y-3 rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
              <div className="flex shrink-0 items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-[#6a7282]">
                    Broadcast Success rate
                  </span>
                  <span className="text-[20px] font-semibold leading-7 tracking-[0.02em] tabular-nums text-[#00a63e]">
                    {STAT_BROADCAST_SUCCESS_PCT}%
                  </span>
                </div>
                <IconBroadcast />
              </div>
              <div className="flex min-h-20 w-full min-w-0 flex-1 items-center">
                <BroadcastsFailedDonut
                  recentBroadcasts={STAT_RECENT_BROADCASTS}
                  failedDeliveries={STAT_FAILED_DELIVERIES}
                />
              </div>
              <p className="shrink-0 text-[12px] leading-4 text-[#6a7282]">
                Last 7 days · failures require attention
              </p>
            </div>
          </div>

          <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-6 pb-6 pt-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <h2 className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]">
              Quick Actions
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => openBroadcast('modal')}
                className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-black/10 bg-transparent px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors duration-150 hover:bg-[#f3f4f6] hover:border-black/12 active:bg-[#d1d5dc] active:border-black/15 focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <img
                  src={broadcastIcon}
                  alt=""
                  className="size-4 shrink-0 object-contain"
                />
                Broadcast Message
              </button>
              <button
                type="button"
                onClick={() => setInspectionModalOpen(true)}
                className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-black/10 bg-transparent px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors duration-150 hover:bg-[#f3f4f6] hover:border-black/12 active:bg-[#d1d5dc] active:border-black/15 focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <img
                  src={inspectionIcon}
                  alt=""
                  className="size-4 shrink-0 object-contain"
                />
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
                className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-black/10 bg-transparent px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors duration-150 hover:bg-[#f3f4f6] hover:border-black/12 active:bg-[#d1d5dc] active:border-black/15 focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                <img
                  src={overrideIcon}
                  alt=""
                  className="size-4 shrink-0 object-contain"
                />
                Override Automation
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div
              className="flex flex-wrap gap-x-6 gap-y-2 border-b border-[#e5e7eb] px-6 pt-3"
              role="tablist"
              aria-label="Notification views"
            >
              {NOTIF_TABS.map((t) => {
                const isActive = tab === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setTab(t.id)}
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

            <div className="space-y-4 p-6" role="tabpanel">
              {tab === 'scheduled' ? (
                <AutomationsPanel
                  title="Scheduled Automations"
                  items={SCHEDULED_AUTOMATION_ITEMS}
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
                MESSAGE_HISTORY_ROWS.map((row) => (
                  <article
                    key={row.id}
                    className={`rounded-[10px] border p-4 sm:p-[17px] ${cardShellClasses(row.variant)}`}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
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
                        <h3 className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">
                          {row.title}
                        </h3>
                        <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
                          {row.description}
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-4 text-[#6a7282]">
                          {row.meta.map((m, i) => (
                            <span key={`${row.id}-meta-${i}`}>{m}</span>
                          ))}
                        </div>
                        {row.footer === 'pending' ? (
                          <div className="flex flex-wrap gap-2 pt-2">
                            <button
                              type="button"
                              disabled
                              className="inline-flex h-8 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none opacity-50 focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                            >
                              <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => openBroadcast('rail')}
                              className="inline-flex h-8 items-center justify-center rounded-lg bg-[#5f2167] px-3 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#4a1a52] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                            >
                              Send Now
                            </button>
                          </div>
                        ) : null}
                        {row.footer === 'failed' ? (
                          <div className="flex flex-wrap gap-2 pt-2">
                            <button
                              type="button"
                              className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-[#5f2167] px-3 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#4a1a52] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
                            >
                              <img
                                src={retryIcon}
                                alt=""
                                className="size-4 shrink-0 object-contain brightness-0 invert"
                              />
                              Retry Failed Deliveries
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
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
                            return
                          }
                          setMessageDetailsPayload(messageDetailsForRow(row))
                          setMessageDetailsOpen(true)
                        }}
                        className="inline-flex h-8 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-black/10 bg-white px-2.5 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 sm:px-3"
                      >
                        <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        View
                        <svg
                          className="size-4 shrink-0 opacity-60"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          aria-hidden
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                  </article>
                ))
              ) : tab === 'failed' ? (
                <FailedUrgentNotificationsPanel
                  onRetryAlternativeChannel={() => {
                    setRetryFailedDeliveryPresentation('rail')
                    setRetryFailedDeliveryOpen(true)
                  }}
                  onUpdateContactInfo={() => {
                    setUpdateContactInfoPresentation('rail')
                    setUpdateContactInfoOpen(true)
                  }}
                  onSendScheduledRentNow={() => openBroadcast('rail')}
                  onSendEmergencyGasAlert={() => {
                    setConfirmEmergencyAlertPresentation('rail')
                    setConfirmEmergencyAlertOpen(true)
                  }}
                  onReviewGasAlertDetails={() => {
                    setEmergencyAlertDetailsPresentation('rail')
                    setEmergencyAlertDetailsOpen(true)
                  }}
                />
              ) : (
                <p className="py-10 text-center text-[14px] leading-5 text-[#6a7282]">
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
      />
      <SendInspectionNoticeModal
        open={inspectionModalOpen}
        onClose={() => setInspectionModalOpen(false)}
      />
      <OverrideAutomationModal
        open={overrideModalOpen}
        onClose={closeOverrideModal}
        context={overrideModalContext}
        initialAutomationCategory={overrideModalInitialCategory}
        initialTicketId={overrideModalInitialTicketId}
        initialSafetyOverrideType={overrideModalInitialSafetyOverrideType}
        presentation={overrideModalPresentation}
      />
      <MessageDetailsModal
        open={messageDetailsOpen}
        onClose={() => {
          setMessageDetailsOpen(false)
          setMessageDetailsPayload(null)
        }}
        data={messageDetailsPayload}
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
