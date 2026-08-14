import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  normalizeOpsAlertChannelPreference,
  opsAlertChannelsEnabled,
} from "./sms/tenantActivationFailure.ts"

export type EdgeNotificationChannel = "email" | "sms" | "activity_feed" | "push"

export type EdgeNotificationSettings = {
  delivery: {
    primaryChannel: EdgeNotificationChannel
    fallbackChannel: EdgeNotificationChannel
    autoFallback: boolean
    quietHoursStart: string
    quietHoursEnd: string
  }
  categories: Array<{
    id: string
    events: Array<{
      id: string
      critical?: boolean
      channels: Record<EdgeNotificationChannel, boolean>
    }>
  }>
}

export type EdgeOperationalSettings = {
  allowAiDispatch: boolean
  requirePhotoEvidence: boolean
  defaultResponseSla: string
  quietHoursEnabled: boolean
  timeZone: string
}

const DEFAULT_SETTINGS: EdgeNotificationSettings = {
  delivery: {
    primaryChannel: "email",
    fallbackChannel: "sms",
    autoFallback: true,
    quietHoursStart: "10:00 PM",
    quietHoursEnd: "8:00 AM",
  },
  categories: [],
}

export async function loadLandlordOperationalSettings(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<EdgeOperationalSettings> {
  const [{ data: landlord }, { data: onboarding }] = await Promise.all([
    supabase.from("landlords").select("time_zone").eq("id", landlordId).maybeSingle(),
    supabase
      .from("landlord_onboarding")
      .select("account_settings")
      .eq("landlord_id", landlordId)
      .maybeSingle(),
  ])

  const account = (onboarding?.account_settings ?? {}) as Record<string, unknown>
  const operational = (account.operational ?? {}) as Record<string, unknown>

  return {
    allowAiDispatch: operational.allowAiDispatch !== false,
    requirePhotoEvidence: operational.requirePhotoEvidence !== false,
    defaultResponseSla:
      typeof operational.defaultResponseSla === "string"
        ? operational.defaultResponseSla
        : "4 hours",
    quietHoursEnabled: operational.quietHoursEnabled !== false,
    timeZone:
      typeof landlord?.time_zone === "string" && landlord.time_zone.trim()
        ? landlord.time_zone.trim()
        : "America/Los_Angeles",
  }
}

export async function loadLandlordNotificationSettings(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<EdgeNotificationSettings> {
  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("notification_channel, account_settings")
    .eq("landlord_id", landlordId)
    .maybeSingle()

  const account = (onboarding?.account_settings ?? {}) as Record<string, unknown>
  const stored = account.notifications as EdgeNotificationSettings | undefined
  const base = stored?.delivery
    ? { ...DEFAULT_SETTINGS, ...stored, delivery: { ...DEFAULT_SETTINGS.delivery, ...stored.delivery } }
    : DEFAULT_SETTINGS

  const channel = normalizeOpsAlertChannelPreference(onboarding?.notification_channel)
  const enabled = opsAlertChannelsEnabled(channel)
  const primary: EdgeNotificationChannel = enabled.sms && !enabled.email
    ? "sms"
    : enabled.email
      ? "email"
      : enabled.activityFeed
        ? "activity_feed"
        : base.delivery.primaryChannel

  return {
    ...base,
    delivery: {
      ...base.delivery,
      primaryChannel: primary,
      fallbackChannel: primary === "sms" ? "email" : "sms",
    },
  }
}

function parseClockToMinutes(label: string): number | null {
  const trimmed = label.trim().toLowerCase()
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2] ?? "0")
  const meridiem = match[3]
  if (meridiem === "pm" && hours < 12) hours += 12
  if (meridiem === "am" && hours === 12) hours = 0
  return hours * 60 + minutes
}

export function isWithinQuietHours(input: {
  now: Date
  timeZone: string
  start: string
  end: string
}): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timeZone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  })
  const parts = formatter.formatToParts(input.now)
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0")
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0")
  const current = hour * 60 + minute
  const start = parseClockToMinutes(input.start)
  const end = parseClockToMinutes(input.end)
  if (start == null || end == null) return false
  if (start === end) return false
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

const ATTENTION_EVENT_MAP: Record<string, { categoryId: string; eventId: string }> = {
  invoice_ready: { categoryId: "workflows", eventId: "needs_your_attention" },
  assign_vendor: { categoryId: "workflows", eventId: "vendor_unassigned" },
  workflow_escalated: { categoryId: "workflows", eventId: "workflow_escalated" },
  late_rent: { categoryId: "rent", eventId: "rent_escalated" },
  lease_renewal: { categoryId: "leasing", eventId: "lease_expiring" },
  unknown_occupant: { categoryId: "workflows", eventId: "needs_your_attention" },
}

export function resolveLandlordNotificationDelivery(input: {
  settings: EdgeNotificationSettings
  attentionKind: string
  isCritical?: boolean
  now?: Date
  timeZone?: string
  quietHoursEnabled?: boolean
}): { allowed: boolean; channels: EdgeNotificationChannel[]; reason?: string } {
  const mapping = ATTENTION_EVENT_MAP[input.attentionKind] ?? ATTENTION_EVENT_MAP.invoice_ready
  const category = input.settings.categories.find((row) => row.id === mapping.categoryId)
  const event = category?.events.find((row) => row.id === mapping.eventId)
  const critical = input.isCritical === true || event?.critical === true

  if (event) {
    const any = Object.values(event.channels).some(Boolean)
    if (!any && !critical) return { allowed: false, channels: [], reason: "event_muted" }
  }

  const delivery = input.settings.delivery
  const channels: EdgeNotificationChannel[] = []
  const add = (channel: EdgeNotificationChannel) => {
    if (channel === "push") return
    if (event && event.channels[channel] === false) return
    if (!channels.includes(channel)) channels.push(channel)
  }
  add(delivery.primaryChannel)
  if (delivery.autoFallback && delivery.fallbackChannel !== delivery.primaryChannel) {
    add(delivery.fallbackChannel)
  }
  if (channels.length === 0 && critical) {
    if (!event || event.channels.email !== false) channels.push("email")
    if (!event || event.channels.sms !== false) channels.push("sms")
  }
  if (channels.length === 0) return { allowed: false, channels: [], reason: "no_channels" }

  if (
    input.quietHoursEnabled !== false &&
    input.timeZone &&
    isWithinQuietHours({
      now: input.now ?? new Date(),
      timeZone: input.timeZone,
      start: delivery.quietHoursStart,
      end: delivery.quietHoursEnd,
    }) &&
    !critical
  ) {
    return { allowed: false, channels: [], reason: "quiet_hours" }
  }

  return { allowed: true, channels }
}

export function defaultResponseSlaMinutes(slaLabel: string | null | undefined): number | null {
  const normalized = String(slaLabel ?? "").trim().toLowerCase()
  if (!normalized) return null
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(hour|hr|h|minute|min|m|day|d)/)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = match[2]
  if (unit.startsWith("h")) return Math.round(amount * 60)
  if (unit.startsWith("d")) return Math.round(amount * 24 * 60)
  return Math.round(amount)
}
