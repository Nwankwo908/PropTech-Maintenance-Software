/**
 * Landlord vs staff SMS recipient lists.
 *
 * landlordRecipients — only that landlord's own numbers (never shared staff list).
 * staffAlertRecipients — SMS_ADMIN_NOTIFY_PHONES / LANDLORD_OPS_PHONE only;
 *   compliance / performance / incident staff alerts.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { teamMemberContactFromOnboarding } from "../../../shared/landlordTeamContact.ts"
import { normalizePhoneFlexible } from "./resident_notify.ts"
import {
  filterVendorPhonesFromOpsRecipients,
  keepLandlordIdentityPhones,
} from "./sms/tenantActivationFailure.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"

export function staffAlertRecipients(): string[] {
  const raw =
    Deno.env.get("SMS_ADMIN_NOTIFY_PHONES")?.trim() ||
    Deno.env.get("LANDLORD_OPS_PHONE")?.trim() ||
    ""
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,;]+/)) {
    const n = normalizePhoneFlexible(part.trim())
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

async function loadVendorPhonesForLandlord(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<Set<string>> {
  const blocked = new Set<string>()
  const { data, error } = await supabase
    .from("vendors")
    .select("phone")
    .eq("landlord_id", landlordId)
    .not("phone", "is", null)
    .limit(2000)
  if (error) {
    console.warn("[landlord-recipients] vendor phone lookup", error.message)
    return blocked
  }
  for (const row of data ?? []) {
    const n = normalizePhoneFlexible(typeof row.phone === "string" ? row.phone : "")
    if (n) blocked.add(n)
  }
  return blocked
}

/**
 * Resolve phones that belong to this landlord / property team only.
 * Never seeds from SMS_ADMIN_NOTIFY_PHONES.
 */
export async function landlordRecipients(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<{ phones: string[]; blocked: string[] }> {
  const id = landlordId.trim()
  if (!id) return { phones: [], blocked: [] }

  const candidates = new Set<string>()
  const identityPhones = new Set<string>()

  const { data: landlord } = await supabase
    .from("landlords")
    .select("phone, email")
    .eq("id", id)
    .maybeSingle()
  if (typeof landlord?.phone === "string") {
    const n = normalizePhoneFlexible(landlord.phone)
    if (n) {
      candidates.add(n)
      identityPhones.add(n)
    }
  }

  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("draft_state, account_settings, properties, onboarding_status")
    .eq("landlord_id", id)
    .maybeSingle()

  const draft = (onboarding?.draft_state ?? {}) as Record<string, unknown>
  const account = (draft.accountSetup ?? {}) as Record<string, unknown>
  for (const key of ["phone", "backupContactPhone", "backup_contact_phone"]) {
    const n = normalizePhoneFlexible(
      typeof account[key] === "string" ? (account[key] as string) : "",
    )
    if (n) {
      candidates.add(n)
      identityPhones.add(n)
    }
  }
  const team = teamMemberContactFromOnboarding(onboarding)
  const teamPhone = normalizePhoneFlexible(team.phone)
  if (teamPhone) {
    candidates.add(teamPhone)
    identityPhones.add(teamPhone)
  }

  const { data: propertyRows } = await supabase
    .from("properties")
    .select("manager_phone")
    .eq("landlord_id", id)
    .limit(200)

  for (const row of propertyRows ?? []) {
    const n = normalizePhoneFlexible(
      typeof row.manager_phone === "string" ? row.manager_phone : "",
    )
    if (n) {
      candidates.add(n)
      // Property manager phone is landlord-team identity for this portfolio.
      identityPhones.add(n)
    }
  }

  const onboardingCompleted = onboarding?.onboarding_status === "completed"
  const hasCanonicalProperties = (propertyRows?.length ?? 0) > 0
  if (!onboardingCompleted && !hasCanonicalProperties) {
    const properties = Array.isArray(onboarding?.properties)
      ? onboarding.properties
      : Array.isArray(draft.properties)
        ? draft.properties
        : []
    for (const raw of properties) {
      if (!raw || typeof raw !== "object") continue
      const row = raw as Record<string, unknown>
      const n = normalizePhoneFlexible(
        typeof row.propertyManagerPhone === "string"
          ? row.propertyManagerPhone
          : typeof row.property_manager_phone === "string"
            ? row.property_manager_phone
            : "",
      )
      if (n) {
        candidates.add(n)
        identityPhones.add(n)
      }
    }
  }

  const vendorPhones = await loadVendorPhonesForLandlord(supabase, id)
  const filtered = filterVendorPhonesFromOpsRecipients(candidates, vendorPhones)
  // Identity-only: do not append non-identity numbers that survived the filter.
  const { allowed, blocked } = keepLandlordIdentityPhones(identityPhones, {
    allowed: [],
    blocked: filtered.blocked,
  })
  // Prefer identity order, then any remaining landlord-owned candidates that
  // are not vendor phones (property manager already in identity).
  const seen = new Set(allowed)
  for (const p of filtered.allowed) {
    if (seen.has(p)) continue
    if (!identityPhones.has(p)) continue
    seen.add(p)
    allowed.push(p)
  }
  return { phones: allowed, blocked }
}

/** @deprecated Prefer landlordRecipients — same landlord-only resolution. */
export async function resolveLandlordOpsPhones(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<{ phones: string[]; blocked: string[] }> {
  return landlordRecipients(supabase, landlordId)
}

export type SmsNoRecipientsParams = {
  supabase: SupabaseClient
  landlordId: string
  caller: string
  messageType: string
  maintenanceRequestId?: string | null
  workflowRunId?: string | null
  dryRun?: boolean
}

/**
 * When a landlord-facing SMS resolves to zero recipients: log sms.no_recipients
 * (Needs Attention / Overview can load open rows). Never fall back to staff list.
 * Does not call notifyLandlordNeedsAttention (would recurse / re-resolve phones).
 */
export async function recordSmsNoRecipients(
  params: SmsNoRecipientsParams,
): Promise<void> {
  const landlordId = params.landlordId.trim()
  if (!landlordId) return

  const message =
    `Ulo could not text you about ${params.messageType.replace(/_/g, " ")} — no phone number is on file for your account. Add a phone in Account settings so you get these updates.`

  try {
    await recordActivityLog(params.supabase, {
      landlordId,
      eventType: "sms.no_recipients",
      source: "automation",
      actorType: "system",
      maintenanceRequestId: params.maintenanceRequestId ?? null,
      workflowRunId: params.workflowRunId ?? null,
      metadata: {
        message,
        caller: params.caller,
        message_type: params.messageType,
        landlord_id: landlordId,
        notification_status: "open",
        in_app: true,
        title: "SMS could not be delivered",
        needs_attention: true,
      },
    })
  } catch (e) {
    console.error("[sms.no_recipients] activity log", e)
  }
}

/**
 * Startup warning when a shared staff number also appears on a landlord,
 * resident, or vendor record (misdirection risk).
 */
export async function warnSharedListOverlapAtStartup(
  supabase: SupabaseClient,
): Promise<{ overlaps: Array<{ phone: string; kind: string; id: string }> }> {
  const staff = staffAlertRecipients()
  if (staff.length === 0) return { overlaps: [] }

  const overlaps: Array<{ phone: string; kind: string; id: string }> = []
  for (const phone of staff) {
    const last10 = phone.replace(/\D/g, "").slice(-10)
    if (last10.length < 10) continue

    const checks: Array<{ table: string; kind: string; col: string }> = [
      { table: "landlords", kind: "landlord", col: "phone" },
      { table: "users", kind: "resident", col: "phone" },
      { table: "vendors", kind: "vendor", col: "phone" },
    ]
    for (const check of checks) {
      const { data, error } = await supabase
        .from(check.table)
        .select("id, phone")
        .not("phone", "is", null)
        .limit(5000)
      if (error) {
        console.warn(`[staff-alert-overlap] ${check.table}`, error.message)
        continue
      }
      for (const row of data ?? []) {
        const raw = (row as { id?: unknown; phone?: unknown }).phone
        const n = normalizePhoneFlexible(typeof raw === "string" ? raw : "")
        if (!n) continue
        if (n === phone || n.replace(/\D/g, "").endsWith(last10)) {
          overlaps.push({
            phone,
            kind: check.kind,
            id: String((row as { id?: unknown }).id ?? ""),
          })
        }
      }
    }
  }

  if (overlaps.length > 0) {
    console.warn(
      JSON.stringify({
        event: "staff_alert_phone_overlaps_domain_record",
        count: overlaps.length,
        overlaps: overlaps.map((o) => ({
          phone_last4: o.phone.slice(-4),
          kind: o.kind,
          id: o.id,
        })),
        at: new Date().toISOString(),
      }),
    )
  }

  return { overlaps }
}

/** Staff SMS body must not include tenant names, units, or dollar amounts. */
export function assertStaffAlertBodySafe(body: string): boolean {
  const text = body ?? ""
  if (/\$\s*\d/.test(text) || /\bUSD\b/i.test(text)) return false
  if (/\bunit\s+\d/i.test(text) || /\bUnit\s+[A-Za-z0-9-]+/.test(text)) return false
  // Heuristic: "Tenant"/"resident" name patterns are caller-enforced; this
  // checks common dollar/unit leaks only.
  return true
}
