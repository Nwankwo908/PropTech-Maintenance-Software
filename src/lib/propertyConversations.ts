import { getActiveLandlordId } from '@/lib/activeLandlord'
import { normalizeBuildingKey } from '@/lib/propertyHealth'
import { inboxPreviewForSmsMessage } from '@/lib/smsMedia'
import {
  buildVendorComplianceProfile,
  vendorServiceAreaCoversProperty,
  type PropertyLocationForVendorCoverage,
} from '@/lib/vendorComplianceProfile'
import { formatVendorLocationLabel } from '@/lib/vendorLocation'

export type { PropertyLocationForVendorCoverage }

export type PropertyConversationRow = {
  id: string
  headerLine: string
  preview: string
  metaLine: string
  timeLabel: string
  lastActivityMs: number
}

const ADMIN_DIRECTED_CONVERSATION_TYPES = new Set(['ai_copilot', 'landlord_update'])

/** Internal Ulo → admin threads; notification bell, not the tenant/vendor inbox. */
export function isAdminDirectedConversationType(conversationType: string): boolean {
  return ADMIN_DIRECTED_CONVERSATION_TYPES.has(conversationType)
}

export function isCommunicationInboxConversationType(conversationType: string): boolean {
  return !isAdminDirectedConversationType(conversationType)
}

/** Plain-language label for sms_conversations.conversation_type (UI only). */
export function conversationTypeLabel(conversationType: string): string {
  switch (conversationType.trim()) {
    case 'resident_intake':
      return 'Resident message'
    case 'vendor_alert':
      return 'Vendor message'
    case 'vendor_tenant_proxy':
      return 'Vendor–resident thread'
    case 'landlord_update':
      return 'Team update'
    case 'ai_copilot':
      return 'Ulo AI'
    default: {
      const raw = conversationType.trim()
      if (!raw) return 'Conversation'
      return raw
        .split(/[_-]/)
        .filter(Boolean)
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
        .join(' ')
    }
  }
}

/** Plain-language label for conversation status chips. */
export function conversationStatusLabel(status: string): string {
  const raw = status.trim()
  if (!raw) return 'Open'
  switch (raw.toLowerCase()) {
    case 'open':
      return 'Open'
    case 'unread':
      return 'Unread'
    case 'action_required':
      return 'Needs attention'
    case 'completed':
    case 'resolved':
    case 'closed':
      return 'Closed'
    case 'scheduled':
      return 'Scheduled'
    case 'cancelled':
      return 'Cancelled'
    default:
      return humanizeStatus(raw)
  }
}

type ParticipantKind = 'tenant' | 'vendor' | 'ai' | 'landlord'

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function buildingShortName(building: string): string {
  return building.replace(/\s+Apartments$/i, '').trim() || building
}

function humanizeStatus(status: string): string {
  return status
    .split(/[_-]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function formatRelativeTime(ms: number): string {
  if (Number.isNaN(ms)) return ''
  const diff = Date.now() - ms
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function conversationKind(conversationType: string, hasVendor: boolean): ParticipantKind {
  switch (conversationType) {
    case 'ai_copilot':
      return 'ai'
    case 'vendor_alert':
      return 'vendor'
    case 'landlord_update':
      return 'landlord'
    case 'vendor_tenant_proxy':
      return hasVendor ? 'vendor' : 'tenant'
    case 'resident_intake':
    default:
      return 'tenant'
  }
}

function participantLabel(kind: ParticipantKind): string {
  switch (kind) {
    case 'ai':
      return 'AI'
    case 'vendor':
      return 'Vendor'
    case 'landlord':
      return 'Owner'
    default:
      return 'Tenant'
  }
}

function displayName(kind: ParticipantKind, residentName: string, vendorName: string, phone: string): string {
  if (kind === 'ai') return 'Ulo AI'
  if (kind === 'vendor') return vendorName || 'Vendor'
  return residentName || phone || 'Unknown'
}

function buildMetaLine(
  building: string,
  unitLabel: string | null,
  conversationType: string,
  status: string,
  hasMaintenanceRequest: boolean,
): string {
  const parts = [buildingShortName(building)]
  if (unitLabel?.trim()) parts.push(unitLabel.trim())

  if (hasMaintenanceRequest) {
    parts.push(`Maintenance · ${humanizeStatus(status)}`)
  } else if (conversationType === 'ai_copilot') {
    parts.push('Handled by Ulo')
  } else {
    parts.push(humanizeStatus(status))
  }

  return parts.join(' · ')
}

function truncatePreview(text: string, max = 72): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trim()}…`
}

/** Conversations scoped to a single property building (SMS threads + maintenance Ulo work-order threads). */
export async function fetchPropertyConversations(
  building: string,
  tickets: Array<{ id: string; unit: string; building: string | null; email?: string | null }> = [],
  residents: Array<{ email?: string | null; building?: string | null }> = [],
  propertyLocation: PropertyLocationForVendorCoverage | null = null,
): Promise<PropertyConversationRow[]> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const landlordId = getActiveLandlordId()
  const buildingKey = normalizeBuildingKey(building)

  const emailBuildingMap = new Map<string, string>()
  for (const resident of residents) {
    const email = resident.email?.trim().toLowerCase()
    if (email && resident.building?.trim()) {
      emailBuildingMap.set(email, normalizeBuildingKey(resident.building))
    }
  }

  const ticketsById = new Map(
    tickets.map((ticket) => [
      ticket.id,
      {
        unit: ticket.unit,
        building: ticket.building,
        email: ticket.email ?? null,
      },
    ]),
  )

  const { data: convRows, error: convError } = await supabase
    .from('sms_conversations')
    .select(
      'id, conversation_type, status, external_phone_number, unit_id, resident_id, vendor_id, maintenance_request_id, updated_at, created_at',
    )
    .eq('landlord_id', landlordId)
    .order('updated_at', { ascending: false })
    .limit(100)

  const rows = convError || !convRows?.length ? [] : (convRows as Record<string, unknown>[])
  const conversationIds = rows.map((row) => asString(row.id)).filter(Boolean)
  const residentIds = [...new Set(rows.map((row) => asString(row.resident_id)).filter(Boolean))]
  const vendorIds = [...new Set(rows.map((row) => asString(row.vendor_id)).filter(Boolean))]
  const unitIds = [...new Set(rows.map((row) => asString(row.unit_id)).filter(Boolean))]

  const [messagesResult, residentsResult, vendorsResult, unitsResult, verificationsResult] =
    await Promise.allSettled([
    conversationIds.length
      ? supabase
          .from('sms_messages')
          .select('conversation_id, body, media_urls, created_at')
          .eq('landlord_id', landlordId)
          .in('conversation_id', conversationIds)
          .order('created_at', { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    residentIds.length
      ? supabase.from('users').select('id, full_name, unit, building').in('id', residentIds)
      : Promise.resolve({ data: [], error: null }),
    vendorIds.length
      ? supabase.from('vendors').select('id, name, city, state, country').in('id', vendorIds)
      : Promise.resolve({ data: [], error: null }),
    unitIds.length
      ? supabase.from('units').select('id, unit_label, building').in('id', unitIds)
      : Promise.resolve({ data: [], error: null }),
    vendorIds.length
      ? supabase
          .from('vendor_verifications')
          .select('vendor_id, service_area, updated_at')
          .eq('landlord_id', landlordId)
          .in('vendor_id', vendorIds)
          .order('updated_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])

  const latestMessageByConversation = new Map<
    string,
    { body: string; createdAt: number; mediaUrls: unknown }
  >()
  if (messagesResult.status === 'fulfilled' && !messagesResult.value.error) {
    for (const message of (messagesResult.value.data ?? []) as Record<string, unknown>[]) {
      const conversationId = asString(message.conversation_id)
      if (!conversationId || latestMessageByConversation.has(conversationId)) continue
      latestMessageByConversation.set(conversationId, {
        body: asString(message.body),
        createdAt: new Date(asString(message.created_at)).getTime(),
        mediaUrls: message.media_urls,
      })
    }
  }

  const residentById = new Map<string, { name: string; unit: string; building: string }>()
  if (residentsResult.status === 'fulfilled' && !residentsResult.value.error) {
    for (const resident of (residentsResult.value.data ?? []) as Record<string, unknown>[]) {
      residentById.set(asString(resident.id), {
        name: asString(resident.full_name),
        unit: asString(resident.unit),
        building: asString(resident.building),
      })
    }
  }

  const vendorById = new Map<
    string,
    { name: string; coversProperty: boolean }
  >()
  const verificationByVendorId = new Map<string, { service_area?: unknown }>()
  if (verificationsResult.status === 'fulfilled' && !verificationsResult.value.error) {
    for (const row of (verificationsResult.value.data ?? []) as Record<string, unknown>[]) {
      const vendorId = asString(row.vendor_id)
      if (!vendorId || verificationByVendorId.has(vendorId)) continue
      verificationByVendorId.set(vendorId, { service_area: row.service_area })
    }
  }
  if (vendorsResult.status === 'fulfilled' && !vendorsResult.value.error) {
    for (const vendor of (vendorsResult.value.data ?? []) as Record<string, unknown>[]) {
      const id = asString(vendor.id)
      if (!id) continue
      const name = asString(vendor.name)
      const hq = formatVendorLocationLabel({
        city: asString(vendor.city) || null,
        state: asString(vendor.state) || null,
        country: asString(vendor.country) || null,
      })
      const profile = buildVendorComplianceProfile(
        { name: name || 'Vendor' },
        verificationByVendorId.get(id) ?? null,
      )
      vendorById.set(id, {
        name,
        coversProperty: propertyLocation
          ? vendorServiceAreaCoversProperty(profile.serviceArea, propertyLocation, hq)
          : false,
      })
    }
  }

  const unitById = new Map<string, { label: string; building: string }>()
  if (unitsResult.status === 'fulfilled' && !unitsResult.value.error) {
    for (const unit of (unitsResult.value.data ?? []) as Record<string, unknown>[]) {
      unitById.set(asString(unit.id), {
        label: asString(unit.unit_label),
        building: asString(unit.building),
      })
    }
  }

  const mapped: PropertyConversationRow[] = []
  const seenIds = new Set<string>()

  for (const row of rows) {
    const id = asString(row.id)
    const resident = residentById.get(asString(row.resident_id))
    const vendorId = asString(row.vendor_id)
    const vendor = vendorById.get(vendorId)
    const vendorName = vendor?.name ?? ''
    const unit = unitById.get(asString(row.unit_id))
    const ticket = ticketsById.get(asString(row.maintenance_request_id))
    const conversationType = asString(row.conversation_type)
    if (!isCommunicationInboxConversationType(conversationType)) continue
    const kind = conversationKind(conversationType, Boolean(vendorId))
    const status = asString(row.status) || 'open'
    const hasMaintenanceRequest = Boolean(asString(row.maintenance_request_id))

    const ticketEmail = ticket?.email?.trim().toLowerCase()
    const ticketBuildingFromEmail =
      ticketEmail && emailBuildingMap.has(ticketEmail) ? emailBuildingMap.get(ticketEmail)! : null

    const matchesBuilding =
      (unit?.building && normalizeBuildingKey(unit.building) === buildingKey) ||
      (ticket?.building && normalizeBuildingKey(ticket.building) === buildingKey) ||
      ticketBuildingFromEmail === buildingKey ||
      (resident?.building && normalizeBuildingKey(resident.building) === buildingKey)

    if (kind === 'vendor') {
      if (!matchesBuilding && !vendor?.coversProperty) continue
    } else if (!matchesBuilding) {
      continue
    }

    const resolvedUnit = unit?.label || resident?.unit || ticket?.unit || null

    const latest = latestMessageByConversation.get(id)
    const name = displayName(
      kind,
      resident?.name ?? '',
      vendorName,
      asString(row.external_phone_number),
    )

    mapped.push({
      id,
      headerLine: `${name} · ${participantLabel(kind)}`,
      preview: truncatePreview(
        inboxPreviewForSmsMessage(latest?.body ?? '', latest?.mediaUrls),
      ),
      metaLine: buildMetaLine(building, resolvedUnit, conversationType, status, hasMaintenanceRequest),
      timeLabel: formatRelativeTime(
        latest?.createdAt ?? new Date(asString(row.updated_at)).getTime(),
      ),
      lastActivityMs: latest?.createdAt ?? new Date(asString(row.updated_at)).getTime(),
    })
    seenIds.add(id)
  }

  const { fetchCommunicationWorkOrderInboxRows } = await import('@/lib/workflowPipelineDetail')
  const workOrderRows = await fetchCommunicationWorkOrderInboxRows().catch(() => [])
  for (const workOrder of workOrderRows) {
    if (normalizeBuildingKey(workOrder.uloThread.propertyLabel) !== buildingKey) continue
    if (seenIds.has(workOrder.id)) continue
    if (workOrder.uloThread.conversationId && seenIds.has(workOrder.uloThread.conversationId)) continue

    const vendorName =
      workOrder.uloThread.kind === 'maintenance' ? workOrder.uloThread.vendorName : null
    const preview =
      vendorName?.trim()
        ? `Assigned ${vendorName} — ${workOrder.preview}`
        : workOrder.preview

    mapped.push({
      id: workOrder.id,
      headerLine: `${workOrder.name} · Tenant`,
      preview: truncatePreview(preview),
      metaLine: [buildingShortName(building), workOrder.context, workOrder.status].filter(Boolean).join(' · '),
      timeLabel: formatRelativeTime(workOrder.lastActivity),
      lastActivityMs: workOrder.lastActivity,
    })
    seenIds.add(workOrder.id)
  }

  return mapped.sort((a, b) => b.lastActivityMs - a.lastActivityMs)
}
