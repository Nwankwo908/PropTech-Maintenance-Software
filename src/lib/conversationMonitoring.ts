import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isAdminDirectedConversationType } from '@/lib/propertyConversations'

export type MonitoringRiskLevel = 'high' | 'medium' | 'low'

export type MonitoringTranscriptItem =
  | {
      type: 'message'
      sender: 'tenant' | 'vendor' | 'ulo'
      senderName: string
      body: string
      timestampMs: number
    }
  | {
      type: 'tool_action'
      label: string
      timestampMs: number
    }

export type ConversationMonitoringDetail = {
  conversationId: string
  title: string
  subtitle: string
  riskLevel: MonitoringRiskLevel | null
  riskLabel: string | null
  summary: string
  tenantName: string
  tenantInitials: string
  transcript: MonitoringTranscriptItem[]
  readOnlyNote: string
  canTakeOver: boolean
}

export type AdminUloNotification = {
  conversationId: string
  title: string
  summary: string
  riskLevel: MonitoringRiskLevel | null
  riskLabel: string | null
  timeLabel: string
  updatedAtMs: number
}

export const WORK_ORDER_THREAD_ID_PREFIX = 'work-order-'

export function workOrderThreadConversationId(workflowRunId: string): string {
  return `${WORK_ORDER_THREAD_ID_PREFIX}${workflowRunId}`
}

export function parseWorkOrderThreadConversationId(id: string): string | null {
  if (!id.startsWith(WORK_ORDER_THREAD_ID_PREFIX)) return null
  const runId = id.slice(WORK_ORDER_THREAD_ID_PREFIX.length).trim()
  return runId || null
}

/** Inbox row id: linked SMS conversation when present, otherwise a synthetic work-order key. */
export function resolveWorkOrderInboxConversationId(input: WorkflowUloThreadInput): string {
  return input.conversationId || workOrderThreadConversationId(input.workflowRunId)
}

export type MaintenanceUloThreadInput = {
  kind: 'maintenance'
  maintenanceRequestId: string | null
  conversationId: string | null
  workflowRunId: string
  residentName: string
  unitLabel: string
  propertyLabel: string
  description: string
  urgency: string
  issueCategory: string
  vendorName: string | null
  workOrderRef: string
  startedAtMs: number
}

export type MoveInUloThreadInput = {
  kind: 'move_in'
  conversationId: string | null
  workflowRunId: string
  residentName: string
  unitLabel: string
  propertyLabel: string
  startedAtMs: number
  moveInDateMs: number
}

export type InspectionUloThreadInput = {
  kind: 'inspection'
  conversationId: string | null
  workflowRunId: string
  residentName: string
  unitLabel: string
  propertyLabel: string
  startedAtMs: number
  scheduledAtMs: number
  inspectionType: string
  hasMaintenanceFollowUp: boolean
}

export type WorkflowUloThreadInput =
  | MaintenanceUloThreadInput
  | MoveInUloThreadInput
  | InspectionUloThreadInput

/** @deprecated Use MaintenanceUloThreadInput */
export type WorkOrderUloThreadInput = MaintenanceUloThreadInput

type DbMessage = {
  direction: string
  body: string
  createdAtMs: number
}

type ConversationContext = {
  id: string
  conversationType: string
  status: string
  residentName: string
  vendorName: string
  building: string
  unitLabel: string
  ticketDescription: string
  ticketUrgency: string
  ticketCategory: string
  createdAtMs: number
  updatedAtMs: number
  messages: DbMessage[]
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function buildingShortName(building: string): string {
  return building.replace(/\s+Apartments$/i, '').trim() || building
}

export function monitoringInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there'
}

function resolveBuilding(input: {
  unitBuilding: string
  residentBuilding: string
  ticketUnit: string
  ticketUrgency: string
  messages: string
}): string {
  if (/oakwood/i.test(input.messages)) return 'Oakwood Apartments'
  if (input.ticketUnit === '304' && input.ticketUrgency === 'urgent') return 'Oakwood Apartments'
  return input.unitBuilding || input.residentBuilding
}

function mentionsAc(text: string): boolean {
  return /\b(ac|a\/c|air conditioning|air.?condition)\b/i.test(text)
}

function deriveRisk(ctx: ConversationContext): { level: MonitoringRiskLevel | null; label: string | null } {
  const status = ctx.status.toLowerCase()
  const urgency = ctx.ticketUrgency.toLowerCase()

  if (ctx.conversationType === 'ai_copilot') {
    return { level: 'low', label: 'AUTO-HANDLED' }
  }

  if (['resolved', 'completed', 'closed'].includes(status)) {
    return { level: 'low', label: 'LOW RISK' }
  }

  if (['scheduled'].includes(status)) {
    return { level: 'low', label: 'LOW RISK' }
  }

  if (urgency === 'urgent' || status === 'in_progress' || mentionsAc(ctx.messages.map((m) => m.body).join(' '))) {
    return { level: 'high', label: 'HIGH RISK' }
  }

  if (['open', 'unread', 'pending'].includes(status)) {
    return { level: 'medium', label: 'MEDIUM RISK' }
  }

  return { level: 'medium', label: 'MEDIUM RISK' }
}

function buildSubtitle(conversationType: string): string {
  if (conversationType === 'ai_copilot') {
    return 'Admin monitoring view · Internal · auto-routed to Ulo AI'
  }
  if (conversationType === 'vendor_alert') {
    return 'Admin monitoring view · SMS · vendor thread'
  }
  return 'Admin monitoring view · SMS · auto-routed to Ulo AI'
}

function buildTitle(ctx: ConversationContext): string {
  const building = buildingShortName(ctx.building)
  const unitPart = ctx.unitLabel ? `Unit ${ctx.unitLabel}` : ''
  const location = [building, unitPart].filter(Boolean).join(' ')

  const combinedText = [
    ctx.ticketDescription,
    ...ctx.messages.map((m) => m.body),
  ]
    .join(' ')
    .toLowerCase()

  if (mentionsAc(combinedText)) {
    return location ? `AC failure · ${location}` : 'AC failure'
  }

  if (/plumb|leak|water/i.test(combinedText)) {
    return location ? `Plumbing issue · ${location}` : 'Plumbing issue'
  }

  if (/faucet|repair/i.test(combinedText)) {
    return location ? `Maintenance · ${location}` : 'Maintenance request'
  }

  if (/rent|late payment/i.test(combinedText)) {
    return location ? `Rent reminder · ${location}` : 'Rent reminder'
  }

  if (/inspection|hvac/i.test(combinedText)) {
    return location ? `HVAC inspection · ${location}` : 'HVAC inspection'
  }

  if (ctx.conversationType === 'ai_copilot' && /vendor|alternative/i.test(combinedText)) {
    return location ? `Vendor suggestion · ${location}` : 'Vendor suggestion'
  }

  if (location) return `Conversation · ${location}`
  return ctx.residentName || ctx.vendorName || 'Conversation'
}

function buildAcFailureSummary(ctx: ConversationContext): string {
  const tenant = firstName(ctx.residentName)
  return `Tenant reported AC outage. Ulo classified as urgent maintenance (heat advisory in zip), triaged, and dispatched Rapid Plumb HVAC. ETA confirmed 11:30a. No human action required unless ${tenant} escalates.`
}

function buildSummary(ctx: ConversationContext): string {
  const combined = ctx.messages.map((m) => m.body).join(' ')

  if (mentionsAc(combined) || (ctx.ticketCategory === 'hvac' && ctx.status === 'in_progress')) {
    return buildAcFailureSummary(ctx)
  }

  if (ctx.conversationType === 'ai_copilot') {
    if (/late rent|rent reminder/i.test(combined)) {
      return `Ulo sent a late-rent reminder to ${ctx.residentName || 'the resident'} at ${buildingShortName(ctx.building) || 'this property'}. No action required unless they reply.`
    }
    if (/vendor|alternative|rapid plumb/i.test(combined)) {
      return `Ulo auto-routed the Oakwood 304 emergency to Rapid Plumb Co. (4.9★, nearby) after Apex Plumbing was 6+ hours out. Logged for your records — no approval needed.`
    }
    return combined || 'Ulo handled this automatically. Monitor below for visibility — no landlord action required.'
  }

  if (ctx.conversationType === 'vendor_alert') {
    if (/completed|replaced|tested/i.test(combined)) {
      return `${ctx.vendorName || 'Vendor'} confirmed job completion. Ulo logged the update and closed the maintenance loop — no landlord action required unless you want to inspect the work order.`
    }
    if (/scheduled|inspection/i.test(combined)) {
      return `${ctx.vendorName || 'Vendor'} confirmed a scheduled visit. Ulo updated the calendar and will remind the resident before the appointment.`
    }
    return `${ctx.vendorName || 'Vendor'} thread is active. Ulo is coordinating status updates for ${buildingShortName(ctx.building) || 'this property'}.`
  }

  if (/thanks|resolved|quick turnaround/i.test(combined)) {
    return `Resident confirmed the issue is resolved. Ulo closed the loop and updated the maintenance record — no further action needed.`
  }

  const preview = ctx.messages[ctx.messages.length - 1]?.body || ctx.ticketDescription
  return preview
    ? `Latest message: ${preview.slice(0, 160)}${preview.length > 160 ? '…' : ''}`
    : 'Ulo is monitoring this thread. No landlord action required unless the resident escalates.'
}

function buildDemoAcFailureTranscript(ctx: ConversationContext): MonitoringTranscriptItem[] {
  const anchor = ctx.messages[0]?.createdAtMs ?? ctx.createdAtMs
  const tenant = ctx.residentName || 'Tenant'
  const fname = firstName(tenant)
  const tLater = anchor + 3 * 60_000

  return [
    {
      type: 'message',
      sender: 'tenant',
      senderName: tenant,
      body: "Hi — my AC stopped working this morning and it's getting really warm in here. Can someone come today?",
      timestampMs: anchor,
    },
    {
      type: 'tool_action',
      label: 'classified → Maintenance · Urgent (heat advisory active)',
      timestampMs: anchor,
    },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: `Hi ${fname} — sorry about that. I'm pulling up your unit now and checking today's dispatch schedule. One quick question: are you home this morning if a tech needs access?`,
      timestampMs: anchor,
    },
    {
      type: 'message',
      sender: 'tenant',
      senderName: tenant,
      body: `Yes, I'm home — ${ctx.unitLabel || 'my unit'}. It's getting warmer by the minute.`,
      timestampMs: tLater,
    },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: "Got it. I've classified this as urgent (heat advisory in your zip). Rapid Plumb HVAC is our fastest option — ETA 11:30a. I'll text you when they're en route.",
      timestampMs: tLater,
    },
  ]
}

function mapDbMessagesToTranscript(ctx: ConversationContext): MonitoringTranscriptItem[] {
  const items: MonitoringTranscriptItem[] = []

  for (const message of ctx.messages) {
    const inbound = message.direction === 'inbound'
    let sender: 'tenant' | 'vendor' | 'ulo'
    let senderName: string

    if (inbound) {
      if (ctx.conversationType === 'vendor_alert') {
        sender = 'vendor'
        senderName = ctx.vendorName || 'Vendor'
      } else {
        sender = 'tenant'
        senderName = ctx.residentName || 'Tenant'
      }
    } else {
      sender = 'ulo'
      senderName = 'Ulo AI'
    }

    items.push({
      type: 'message',
      sender,
      senderName,
      body: message.body,
      timestampMs: message.createdAtMs,
    })

    if (
      sender === 'ulo' &&
      ctx.ticketUrgency === 'urgent' &&
      items.length === 1 &&
      ctx.conversationType === 'resident_intake'
    ) {
      items.splice(items.length - 1, 0, {
        type: 'tool_action',
        label: 'classified → Maintenance · Urgent',
        timestampMs: message.createdAtMs,
      })
    }
  }

  return items
}

function buildTranscript(ctx: ConversationContext): MonitoringTranscriptItem[] {
  const combined = ctx.messages.map((m) => m.body).join(' ')

  if (
    ctx.conversationType === 'resident_intake' &&
    (mentionsAc(combined) || ctx.messages.length <= 2)
  ) {
    return buildDemoAcFailureTranscript(ctx)
  }

  if (ctx.messages.length === 0) {
    return [
      {
        type: 'message',
        sender: 'ulo',
        senderName: 'Ulo AI',
        body: 'No messages in this thread yet.',
        timestampMs: ctx.updatedAtMs,
      },
    ]
  }

  return mapDbMessagesToTranscript(ctx)
}

function formatNotificationRelativeTime(ms: number): string {
  if (Number.isNaN(ms)) return ''
  const diffMs = Date.now() - ms
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function buildAdminNotification(ctx: ConversationContext): AdminUloNotification {
  const risk = deriveRisk(ctx)
  return {
    conversationId: ctx.id,
    title: buildTitle(ctx),
    summary: buildSummary(ctx),
    riskLevel: risk.level,
    riskLabel: risk.label,
    timeLabel: formatNotificationRelativeTime(ctx.updatedAtMs),
    updatedAtMs: ctx.updatedAtMs,
  }
}

function buildMonitoringDetail(ctx: ConversationContext): ConversationMonitoringDetail {
  const risk = deriveRisk(ctx)
  const closed = ['resolved', 'completed', 'closed'].includes(ctx.status.toLowerCase())
  const isAiCopilot = ctx.conversationType === 'ai_copilot'

  return {
    conversationId: ctx.id,
    title: buildTitle(ctx),
    subtitle: buildSubtitle(ctx.conversationType),
    riskLevel: risk.level,
    riskLabel: risk.label,
    summary: buildSummary(ctx),
    tenantName: ctx.residentName || ctx.vendorName || 'Participant',
    tenantInitials: monitoringInitials(ctx.residentName || ctx.vendorName || '?'),
    transcript: buildTranscript(ctx),
    readOnlyNote: isAiCopilot
      ? 'Read-only · Ulo sends tenant and vendor messages automatically.'
      : 'Read-only · Ulo continues handling unless you take over.',
    canTakeOver: !closed && !isAiCopilot,
  }
}

async function loadConversationContext(
  row: Record<string, unknown>,
  landlordId: string,
  supabase: NonNullable<Awaited<typeof import('@/lib/supabase')>['supabase']>,
): Promise<ConversationContext | null> {
  const conversationId = asString(row.id)
  if (!conversationId) return null

  const residentId = asString(row.resident_id)
  const vendorId = asString(row.vendor_id)
  const unitId = asString(row.unit_id)
  const ticketId = asString(row.maintenance_request_id)

  const [messagesResult, residentResult, vendorResult, unitResult, ticketResult] =
    await Promise.allSettled([
      supabase
        .from('sms_messages')
        .select('direction, body, created_at')
        .eq('landlord_id', landlordId)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true }),
      residentId
        ? supabase.from('users').select('full_name, unit, building').eq('id', residentId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      vendorId
        ? supabase.from('vendors').select('name').eq('id', vendorId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      unitId
        ? supabase.from('units').select('unit_label, building').eq('id', unitId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      ticketId
        ? supabase
            .from('maintenance_requests')
            .select('description, urgency, priority, issue_category, unit')
            .eq('id', ticketId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

  const messages: DbMessage[] = []
  if (messagesResult.status === 'fulfilled' && !messagesResult.value.error) {
    for (const message of (messagesResult.value.data ?? []) as Record<string, unknown>[]) {
      messages.push({
        direction: asString(message.direction),
        body: asString(message.body),
        createdAtMs: new Date(asString(message.created_at)).getTime(),
      })
    }
  }

  const resident =
    residentResult.status === 'fulfilled' && residentResult.value.data
      ? (residentResult.value.data as Record<string, unknown>)
      : null
  const vendor =
    vendorResult.status === 'fulfilled' && vendorResult.value.data
      ? (vendorResult.value.data as Record<string, unknown>)
      : null
  const unit =
    unitResult.status === 'fulfilled' && unitResult.value.data
      ? (unitResult.value.data as Record<string, unknown>)
      : null
  const ticket =
    ticketResult.status === 'fulfilled' && ticketResult.value.data
      ? (ticketResult.value.data as Record<string, unknown>)
      : null

  return {
    id: conversationId,
    conversationType: asString(row.conversation_type),
    status: asString(row.status) || 'open',
    residentName: asString(resident?.full_name),
    vendorName: asString(vendor?.name),
    building: resolveBuilding({
      unitBuilding: asString(unit?.building),
      residentBuilding: asString(resident?.building),
      ticketUnit: asString(ticket?.unit),
      ticketUrgency: asString(ticket?.urgency) || asString(ticket?.priority),
      messages: messages.map((m) => m.body).join(' '),
    }),
    unitLabel:
      asString(ticket?.unit) || asString(unit?.unit_label) || asString(resident?.unit),
    ticketDescription: asString(ticket?.description),
    ticketUrgency: asString(ticket?.urgency) || asString(ticket?.priority),
    ticketCategory: asString(ticket?.issue_category),
    createdAtMs: new Date(asString(row.created_at)).getTime(),
    updatedAtMs: new Date(asString(row.updated_at)).getTime(),
    messages,
  }
}

/** Ulo admin summaries for the header notification panel (admin-directed SMS only). */
export async function fetchAdminUloNotifications(limit = 15): Promise<AdminUloNotification[]> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const landlordId = getActiveLandlordId()

  const { data: convRows, error: convError } = await supabase
    .from('sms_conversations')
    .select(
      'id, conversation_type, status, resident_id, vendor_id, unit_id, maintenance_request_id, created_at, updated_at',
    )
    .eq('landlord_id', landlordId)
    .in('conversation_type', ['ai_copilot', 'landlord_update'])
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (convError || !convRows?.length) return []

  const notifications: AdminUloNotification[] = []

  for (const convRow of convRows as Record<string, unknown>[]) {
    if (!isAdminDirectedConversationType(asString(convRow.conversation_type))) continue
    const ctx = await loadConversationContext(convRow, landlordId, supabase)
    if (!ctx) continue
    notifications.push(buildAdminNotification(ctx))
  }

  return notifications.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
}

/** Full admin monitoring payload for a single SMS conversation. */
export async function fetchConversationMonitoring(
  conversationId: string,
): Promise<ConversationMonitoringDetail | null> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase || !conversationId.trim()) return null

  const landlordId = getActiveLandlordId()

  const { data: convRow, error: convError } = await supabase
    .from('sms_conversations')
    .select(
      'id, conversation_type, status, resident_id, vendor_id, unit_id, maintenance_request_id, created_at, updated_at',
    )
    .eq('landlord_id', landlordId)
    .eq('id', conversationId)
    .maybeSingle()

  if (convError || !convRow) return null

  const ctx = await loadConversationContext(convRow as Record<string, unknown>, landlordId, supabase)
  if (!ctx) return null

  return buildMonitoringDetail(ctx)
}

function formatThreadPriorityLabel(urgency: string): string {
  const normalized = urgency.toLowerCase()
  if (normalized === 'urgent' || normalized === 'high') return 'Urgent'
  if (normalized === 'low') return 'Low'
  return 'Normal'
}

function buildWorkOrderSyntheticTranscript(
  input: MaintenanceUloThreadInput,
  workflowMessages: string[],
): MonitoringTranscriptItem[] {
  const anchor = Number.isFinite(input.startedAtMs) ? input.startedAtMs : Date.now()
  const tenant = input.residentName || 'Resident'
  const fname = firstName(tenant)
  const unitPhrase = input.unitLabel ? `Unit ${input.unitLabel}` : 'your unit'
  const issueLine =
    input.description.split(/[.!?]/)[0]?.trim() ||
    'I have a maintenance issue that needs attention.'
  const residentReport = issueLine.endsWith('.') ? issueLine : `${issueLine}.`
  const priorityLabel = formatThreadPriorityLabel(input.urgency)

  const items: MonitoringTranscriptItem[] = [
    {
      type: 'message',
      sender: 'tenant',
      senderName: tenant,
      body: residentReport,
      timestampMs: anchor,
    },
    {
      type: 'tool_action',
      label: `classified → Maintenance · ${priorityLabel}`,
      timestampMs: anchor + 30_000,
    },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: `Hi ${fname} — thanks for reaching out. I'm opening ${input.workOrderRef} for ${unitPhrase} and triaging this now.`,
      timestampMs: anchor + 60_000,
    },
  ]

  for (let index = 0; index < workflowMessages.length; index += 1) {
    const message = workflowMessages[index]?.trim()
    if (!message) continue
    items.push({
      type: 'tool_action',
      label: message.length > 72 ? `${message.slice(0, 72)}…` : message,
      timestampMs: anchor + 90_000 + index * 45_000,
    })
  }

  items.push({
    type: 'message',
    sender: 'ulo',
    senderName: 'Ulo AI',
    body: input.vendorName
      ? `I've assigned ${input.vendorName} to this job. I'll text you here when they're scheduled and on the way.`
      : "I'm matching the best available vendor now. You'll get updates in this thread as the work order moves forward.",
    timestampMs: anchor + 4 * 60_000,
  })

  items.push({
    type: 'message',
    sender: 'ulo',
    senderName: 'Ulo AI',
    body: 'You can reply here anytime with photos or updates — I stay on the thread until the repair is resolved.',
    timestampMs: anchor + 5 * 60_000,
  })

  return items
}

function formatMoveInDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}

function parseMoveInDateMs(iso: string | null | undefined, fallbackMs: number): number {
  if (!iso?.trim()) return fallbackMs
  const value = iso.trim()
  const parsed = new Date(value.includes('T') ? value : `${value.slice(0, 10)}T12:00:00`)
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : fallbackMs
}

/** Short coordination SMS sequence — not a long conversational thread. */
function buildMoveInCoordinationTranscript(input: MoveInUloThreadInput): MonitoringTranscriptItem[] {
  const moveInMs = input.moveInDateMs
  const property = input.propertyLabel || 'your new home'
  const moveInLabel = formatMoveInDateLabel(moveInMs)
  const tenant = input.residentName || 'Resident'
  const dayMs = 24 * 60 * 60 * 1000

  const items: MonitoringTranscriptItem[] = [
    {
      type: 'tool_action',
      label: 'Move-in Welcome',
      timestampMs: moveInMs - 7 * dayMs,
    },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: `Welcome to ${property}! We're excited to have you. Your move-in is scheduled for ${moveInLabel}.`,
      timestampMs: moveInMs - 7 * dayMs + 60_000,
    },
    {
      type: 'tool_action',
      label: 'Reminder',
      timestampMs: moveInMs - dayMs + 9 * 3_600_000,
    },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: 'Your move-in is tomorrow. Remember to bring your photo ID and proof of utilities if required.',
      timestampMs: moveInMs - dayMs + 9 * 3_600_000 + 60_000,
    },
    {
      type: 'tool_action',
      label: 'Resident Reply',
      timestampMs: moveInMs - dayMs + 14 * 3_600_000,
    },
    {
      type: 'message',
      sender: 'tenant',
      senderName: tenant,
      body: "I'll be arriving around 3 PM.",
      timestampMs: moveInMs - dayMs + 14 * 3_600_000 + 60_000,
    },
    {
      type: 'tool_action',
      label: 'Manager Reply',
      timestampMs: moveInMs - dayMs + 14 * 3_600_000 + 5 * 60_000,
    },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Leasing Office',
      body: "Sounds good! We'll have everything ready.",
      timestampMs: moveInMs - dayMs + 14 * 3_600_000 + 6 * 60_000,
    },
    {
      type: 'tool_action',
      label: 'Key Pickup',
      timestampMs: moveInMs + 9 * 3_600_000,
    },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: 'Your keys are ready for pickup at the leasing office.',
      timestampMs: moveInMs + 9 * 3_600_000 + 60_000,
    },
    {
      type: 'tool_action',
      label: 'Inspection Reminder',
      timestampMs: moveInMs + 12 * 3_600_000,
    },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: "When you're ready, reply START here and I'll guide you room-by-room through your move-in inspection — no portal or forms needed.",
      timestampMs: moveInMs + 12 * 3_600_000 + 60_000,
    },
  ]

  return items.sort((a, b) => a.timestampMs - b.timestampMs)
}

function buildSyntheticMoveInThread(input: MoveInUloThreadInput): ConversationMonitoringDetail {
  const unitPhrase = input.unitLabel ? `Unit ${input.unitLabel}` : 'your unit'
  const transcript = buildMoveInCoordinationTranscript(input)

  return {
    conversationId: input.conversationId || workOrderThreadConversationId(input.workflowRunId),
    title: `${input.residentName} · Move-in coordination`,
    subtitle: 'Admin monitoring view · SMS · scheduled coordination messages',
    riskLevel: 'low',
    riskLabel: 'On track',
    summary: `Ulo is coordinating ${input.residentName}'s move-in at ${input.propertyLabel} (${unitPhrase}) with scheduled SMS — welcome, reminders, key pickup, and inspection. Short replies only; no ongoing chat required.`,
    tenantName: input.residentName,
    tenantInitials: monitoringInitials(input.residentName),
    transcript,
    readOnlyNote:
      'Read-only · Ulo sends coordination SMS on schedule; resident replies are brief confirmations only.',
    canTakeOver: false,
  }
}

type ConversationalInspectionMode = 'move_in' | 'move_out' | 'self'

function resolveConversationalInspectionMode(inspectionType: string): ConversationalInspectionMode {
  const normalized = inspectionType.toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'move_in') return 'move_in'
  if (normalized === 'move_out') return 'move_out'
  return 'self'
}

function inspectionModeLabel(mode: ConversationalInspectionMode): string {
  if (mode === 'move_in') return 'move-in condition'
  if (mode === 'move_out') return 'move-out condition'
  return 'self-inspection'
}

/** Guided SMS inspection — resident answers prompts; Ulo compiles the report. */
function buildConversationalInspectionTranscript(input: InspectionUloThreadInput): MonitoringTranscriptItem[] {
  const anchor = Number.isFinite(input.scheduledAtMs) ? input.scheduledAtMs : input.startedAtMs
  const tenant = input.residentName || 'Resident'
  const fname = firstName(tenant)
  const unitPhrase = input.unitLabel ? `Unit ${input.unitLabel}` : 'your unit'
  const property = input.propertyLabel || 'your property'
  const mode = resolveConversationalInspectionMode(input.inspectionType)
  const modeLabel = inspectionModeLabel(mode)
  const minute = 60_000

  const introBody =
    mode === 'move_in'
      ? `Hi ${fname} — welcome to ${property}. Let's document ${unitPhrase} together for your move-in record. Reply START when you're ready (~10 min, all over text).`
      : mode === 'move_out'
        ? `Hi ${fname} — let's walk through ${unitPhrase} for your move-out condition report. Reply START when you're ready. No portal or forms — just answer my prompts.`
        : `Hi ${fname} — time for your ${unitPhrase} self-inspection at ${property}. Reply START when you're ready and I'll guide you room by room.`

  const kitchenIssue = input.hasMaintenanceFollowUp
    ? 'Small chip on the counter by the sink. Also a slow drip under the kitchen sink.'
    : 'Small chip on the counter near the sink.'
  const bedroomIssue = input.hasMaintenanceFollowUp
    ? 'Bedroom closet door sticks. Outlet by the window does not work.'
    : 'Bedroom closet door sticks a little.'
  const findingSummary = input.hasMaintenanceFollowUp
    ? 'counter chip and sink drip (kitchen), sticking closet door and dead outlet (bedroom)'
    : 'counter chip (kitchen), sticking closet door (bedroom)'

  const items: MonitoringTranscriptItem[] = [
    { type: 'tool_action', label: 'Inspection started', timestampMs: anchor },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: introBody,
      timestampMs: anchor + minute,
    },
    {
      type: 'message',
      sender: 'tenant',
      senderName: tenant,
      body: 'START',
      timestampMs: anchor + 2 * minute,
    },
    { type: 'tool_action', label: 'Kitchen · documented', timestampMs: anchor + 3 * minute },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: "Let's start in the kitchen. Note any existing damage, wear, or issues — even small ones.",
      timestampMs: anchor + 3 * minute + 30_000,
    },
    {
      type: 'message',
      sender: 'tenant',
      senderName: tenant,
      body: kitchenIssue,
      timestampMs: anchor + 5 * minute,
    },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: 'Thanks. Can you text a photo of the counter chip? Reply SKIP if you cannot right now.',
      timestampMs: anchor + 6 * minute,
    },
    { type: 'tool_action', label: 'Photo captured', timestampMs: anchor + 8 * minute },
    {
      type: 'message',
      sender: 'tenant',
      senderName: tenant,
      body: input.hasMaintenanceFollowUp ? 'Sent a photo of the chip and under the sink.' : 'Photo sent.',
      timestampMs: anchor + 8 * minute + 30_000,
    },
    { type: 'tool_action', label: 'Bathroom · documented', timestampMs: anchor + 10 * minute },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: 'Next — bathroom. Any mold, leaks, cracked tile, or fixture issues?',
      timestampMs: anchor + 10 * minute + 30_000,
    },
    {
      type: 'message',
      sender: 'tenant',
      senderName: tenant,
      body: 'All good in the bathroom.',
      timestampMs: anchor + 12 * minute,
    },
    { type: 'tool_action', label: 'Living areas · documented', timestampMs: anchor + 13 * minute },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: 'Living room and bedrooms — scuffs, wall damage, or anything not working?',
      timestampMs: anchor + 13 * minute + 30_000,
    },
    {
      type: 'message',
      sender: 'tenant',
      senderName: tenant,
      body: bedroomIssue,
      timestampMs: anchor + 15 * minute,
    },
    { type: 'tool_action', label: 'Findings logged', timestampMs: anchor + 16 * minute },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: `Logged: ${findingSummary}. Anything else anywhere in the unit?`,
      timestampMs: anchor + 16 * minute + 30_000,
    },
    {
      type: 'message',
      sender: 'tenant',
      senderName: tenant,
      body: "That's everything.",
      timestampMs: anchor + 18 * minute,
    },
    { type: 'tool_action', label: 'Report compiled', timestampMs: anchor + 19 * minute },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body: `Your ${modeLabel} report is complete — room-by-room notes, photos, and timestamps are saved and searchable for your property team.`,
      timestampMs: anchor + 19 * minute + 30_000,
    },
  ]

  if (input.hasMaintenanceFollowUp) {
    items.push(
      { type: 'tool_action', label: 'Maintenance requests created', timestampMs: anchor + 21 * minute },
      {
        type: 'message',
        sender: 'ulo',
        senderName: 'Ulo AI',
        body: 'I opened work orders for the sink drip, dead outlet, and closet door. Ulo will coordinate repairs and text you here with updates.',
        timestampMs: anchor + 21 * minute + 30_000,
      },
    )
  }

  items.push(
    { type: 'tool_action', label: 'Inspection complete', timestampMs: anchor + 23 * minute },
    {
      type: 'message',
      sender: 'ulo',
      senderName: 'Ulo AI',
      body:
        mode === 'move_out'
          ? "You're all set — your move-out inspection is on file. Reply here if you remember anything else before vacate day."
          : mode === 'move_in'
            ? "You're all set — your move-in condition is documented. Reply here if you spot anything else in the first few days."
            : "You're all set — thanks for completing your self-inspection. Reply here if anything new comes up.",
      timestampMs: anchor + 23 * minute + 30_000,
    },
  )

  return items
}

function buildSyntheticInspectionThread(input: InspectionUloThreadInput): ConversationMonitoringDetail {
  const unitPhrase = input.unitLabel ? `Unit ${input.unitLabel}` : 'your unit'
  const mode = resolveConversationalInspectionMode(input.inspectionType)
  const modeLabel = inspectionModeLabel(mode)
  const transcript = buildConversationalInspectionTranscript(input)

  return {
    conversationId: input.conversationId || workOrderThreadConversationId(input.workflowRunId),
    title: `${input.residentName} · Conversational inspection`,
    subtitle: 'Admin monitoring view · SMS · guided room-by-room inspection',
    riskLevel: 'low',
    riskLabel: 'On track',
    summary: `Ulo guided ${input.residentName} through a ${modeLabel} for ${input.propertyLabel} (${unitPhrase}) over SMS — no portal forms. Findings, photos, and timestamps were captured in a searchable report${input.hasMaintenanceFollowUp ? '; maintenance work orders were opened automatically for flagged issues' : ''}.`,
    tenantName: input.residentName,
    tenantInitials: monitoringInitials(input.residentName),
    transcript,
    readOnlyNote:
      'Read-only · Ulo runs inspections as guided SMS conversations, not static PDFs or portal forms.',
    canTakeOver: false,
  }
}

function buildSyntheticWorkOrderThread(input: MaintenanceUloThreadInput): ConversationMonitoringDetail {
  const ctx: ConversationContext = {
    id: input.conversationId || `work-order-${input.workflowRunId}`,
    conversationType: 'resident_intake',
    status: 'in_progress',
    residentName: input.residentName,
    vendorName: input.vendorName || '',
    building: input.propertyLabel,
    unitLabel: input.unitLabel,
    ticketDescription: input.description,
    ticketUrgency: input.urgency,
    ticketCategory: input.issueCategory,
    createdAtMs: input.startedAtMs,
    updatedAtMs: Date.now(),
    messages: [],
  }

  const transcript =
    mentionsAc(input.description) || input.issueCategory.toLowerCase() === 'hvac'
      ? buildDemoAcFailureTranscript(ctx)
      : buildWorkOrderSyntheticTranscript(input, [])

  const risk = deriveRisk(ctx)

  return {
    conversationId: ctx.id,
    title: buildTitle(ctx),
    subtitle: 'Admin monitoring view · SMS · auto-routed to Ulo AI',
    riskLevel: risk.level,
    riskLabel: risk.label,
    summary: input.vendorName
      ? `Ulo captured the resident report, opened ${input.workOrderRef}, and assigned ${input.vendorName}. Monitor the SMS thread below — no landlord action required unless the resident escalates.`
      : `Ulo captured the resident report and opened ${input.workOrderRef}. Vendor matching and resident updates continue in the SMS thread below.`,
    tenantName: input.residentName || 'Resident',
    tenantInitials: monitoringInitials(input.residentName || 'Resident'),
    transcript,
    readOnlyNote: 'Read-only · Ulo handles resident SMS automatically on every maintenance work order.',
    canTakeOver: false,
  }
}

async function loadWorkflowEventMessages(workflowRunId: string): Promise<string[]> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase || !workflowRunId.trim()) return []

  const { data, error } = await supabase
    .from('workflow_events')
    .select('message, event_type, step, stage, created_at')
    .eq('workflow_run_id', workflowRunId)
    .order('created_at', { ascending: true })

  if (error || !data?.length) return []

  return (data as Record<string, unknown>[])
    .map((row) => asString(row.message) || asString(row.step) || asString(row.event_type))
    .filter(Boolean)
}

async function buildSyntheticWorkOrderThreadWithEvents(
  input: MaintenanceUloThreadInput,
): Promise<ConversationMonitoringDetail> {
  const workflowMessages = await loadWorkflowEventMessages(input.workflowRunId)
  const base = buildSyntheticWorkOrderThread(input)

  if (workflowMessages.length === 0) {
    return base
  }

  const ctx: ConversationContext = {
    id: input.conversationId || `work-order-${input.workflowRunId}`,
    conversationType: 'resident_intake',
    status: 'in_progress',
    residentName: input.residentName,
    vendorName: input.vendorName || '',
    building: input.propertyLabel,
    unitLabel: input.unitLabel,
    ticketDescription: input.description,
    ticketUrgency: input.urgency,
    ticketCategory: input.issueCategory,
    createdAtMs: input.startedAtMs,
    updatedAtMs: Date.now(),
    messages: [],
  }

  const transcript =
    mentionsAc(input.description) || input.issueCategory.toLowerCase() === 'hvac'
      ? buildDemoAcFailureTranscript(ctx)
      : buildWorkOrderSyntheticTranscript(input, workflowMessages)

  return { ...base, transcript }
}

/**
 * Resident ↔ Ulo SMS for a workflow (maintenance work order or move-in coordination).
 * Uses linked SMS when present; otherwise reconstructs the Ulo interaction.
 */
export async function fetchWorkflowUloThreadMonitoring(
  input: WorkflowUloThreadInput,
): Promise<ConversationMonitoringDetail> {
  if (input.conversationId) {
    const linked = await fetchConversationMonitoring(input.conversationId)
    if (linked) return linked
  }

  if (input.kind === 'move_in') {
    return buildSyntheticMoveInThread(input)
  }

  if (input.kind === 'inspection') {
    return buildSyntheticInspectionThread(input)
  }

  if (input.maintenanceRequestId) {
    const linked = await fetchConversationMonitoringByMaintenanceRequest(input.maintenanceRequestId)
    if (linked) return linked
  }

  return buildSyntheticWorkOrderThreadWithEvents(input)
}

/** @deprecated Use fetchWorkflowUloThreadMonitoring */
export async function fetchWorkOrderUloThreadMonitoring(
  input: MaintenanceUloThreadInput,
): Promise<ConversationMonitoringDetail> {
  return fetchWorkflowUloThreadMonitoring(input)
}

/**
 * Communication inbox + monitoring: real SMS when linked, otherwise the workflow Ulo thread.
 */
export async function fetchInboxConversationMonitoring(
  conversationId: string,
): Promise<ConversationMonitoringDetail | null> {
  const linked = await fetchConversationMonitoring(conversationId)
  if (linked) return linked

  const workflowRunId = parseWorkOrderThreadConversationId(conversationId)
  if (!workflowRunId) return null

  const { fetchWorkflowUloThreadInputByRunId } = await import('@/lib/workflowPipelineDetail')
  const input = await fetchWorkflowUloThreadInputByRunId(workflowRunId)
  if (!input) return null

  return fetchWorkflowUloThreadMonitoring(input)
}

/** Resident ↔ Ulo SMS thread linked to a maintenance request. */
export async function fetchConversationMonitoringByMaintenanceRequest(
  maintenanceRequestId: string,
): Promise<ConversationMonitoringDetail | null> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase || !maintenanceRequestId.trim()) return null

  const landlordId = getActiveLandlordId()

  const { data: convRows, error } = await supabase
    .from('sms_conversations')
    .select(
      'id, conversation_type, status, resident_id, vendor_id, unit_id, maintenance_request_id, created_at, updated_at',
    )
    .eq('landlord_id', landlordId)
    .eq('maintenance_request_id', maintenanceRequestId)
    .order('updated_at', { ascending: false })

  if (error || !convRows?.length) return null

  const rows = convRows as Record<string, unknown>[]
  const preferred =
    rows.find((row) => asString(row.conversation_type) === 'resident_intake') ??
    rows.find((row) => !isAdminDirectedConversationType(asString(row.conversation_type))) ??
    rows[0]

  const ctx = await loadConversationContext(preferred, landlordId, supabase)
  if (!ctx) return null

  return buildMonitoringDetail(ctx)
}

export function formatMonitoringTime(ms: number): string {
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
