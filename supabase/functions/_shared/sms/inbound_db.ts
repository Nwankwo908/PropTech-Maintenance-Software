import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  DEMO_LANDLORD_ID,
  isDemoLandlord,
  landlordMayUseSharedSmsLine,
} from "../../../../shared/landlordCapabilities.ts"
import { teamMemberContactFromOnboarding } from "../landlordTeamContact.ts"
import { isBareSharedLineAction, normalizeSharedLineAddress, sharedLineAddressReply, sharedLineWorkOrderSelector } from "./sharedLineSelector.ts"
import { normalizePhoneFlexible } from "../resident_notify.ts"
import { smsIdentityAllowsTypePatch } from "./smsIdentityUpgrade.ts"
import { resolveUnitIdForLandlord } from "./resolveUnitId.ts"

/** Normalize to E.164 when possible; fall back to trimmed raw for lookup. */
export function normalizeSmsPhone(input: string): string {
  return normalizePhoneFlexible(input) ?? input.trim()
}

/** Candidate strings for DB phone equality (E.164 + digits-only). */
export function phoneLookupVariants(input: string): string[] {
  const trimmed = input.trim()
  const e164 = normalizePhoneFlexible(trimmed)
  const digits = trimmed.replace(/\D/g, "")
  const set = new Set<string>()
  if (trimmed) set.add(trimmed)
  if (e164) set.add(e164)
  if (digits) {
    set.add(digits)
    if (digits.length === 11 && digits.startsWith("1")) set.add(`+${digits}`)
    if (digits.length === 10) set.add(`+1${digits}`)
  }
  return [...set]
}

export type SmsNumberRow = {
  id: string
  landlord_id: string | null
  vendor_id: string | null
  phone_number: string
  provider: string
  purpose: string
  status: string
  release_auto_reply?: string | null
}

export async function lookupSmsNumberByTo(
  supabase: SupabaseClient,
  toNumber: string,
): Promise<SmsNumberRow | null> {
  const variants = phoneLookupVariants(toNumber)
  if (variants.length === 0) return null

  const { data, error } = await supabase
    .from("sms_numbers")
    .select(
      "id, landlord_id, vendor_id, phone_number, provider, purpose, status, release_auto_reply",
    )
    .in("phone_number", variants)
    .eq("status", "active")
    .in("purpose", ["landlord_main", "vendor_main"])
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[sms-inbound] sms_numbers lookup", error.message)
    throw new Error("Failed to look up SMS number")
  }

  return (data as SmsNumberRow | null) ?? null
}

/**
 * Resolve the Ulo line for an inbound SMS.
 * Read existing active lines only; inbound traffic never assigns a pool row.
 */
export async function resolveInboundSmsNumber(
  supabase: SupabaseClient,
  toNumber: string,
): Promise<SmsNumberRow | null> {
  return await lookupSmsNumberByTo(supabase, toNumber)
}

/** Numbers in churn — inbound gets auto-reply only, no workflow routing. */
export async function lookupReleasedPendingSmsNumber(
  supabase: SupabaseClient,
  toNumber: string,
): Promise<SmsNumberRow | null> {
  const variants = phoneLookupVariants(toNumber)
  if (variants.length === 0) return null

  const { data, error } = await supabase
    .from("sms_numbers")
    .select(
      "id, landlord_id, vendor_id, phone_number, provider, purpose, status, release_auto_reply",
    )
    .in("phone_number", variants)
    .eq("status", "released_pending")
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[sms-inbound] released_pending lookup", error.message)
    return null
  }

  return (data as SmsNumberRow | null) ?? null
}

export type SmsIdentityRow = {
  id: string
  landlord_id: string | null
  resident_id: string | null
  vendor_id: string | null
  unit_id: string | null
  phone_number: string
  identity_type: string
  verified: boolean
}

const smsIdentitySelect =
  "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified"

/** All identity rows matching phone format variants for a landlord (may be >1 if stored inconsistently). */
export async function findSmsIdentitiesByPhone(
  supabase: SupabaseClient,
  fromNumber: string,
  landlordId: string,
): Promise<SmsIdentityRow[]> {
  const variants = phoneLookupVariants(fromNumber)
  if (variants.length === 0) return []

  const { data, error } = await supabase
    .from("sms_identities")
    .select(smsIdentitySelect)
    .eq("landlord_id", landlordId)
    .in("phone_number", variants)

  if (error) {
    console.error("[sms-inbound] sms_identities lookup", error.message)
    throw new Error("Failed to look up SMS identity")
  }

  return (data as SmsIdentityRow[] | null) ?? []
}

/** Collapse landlord ids to a single id when exactly one distinct value exists. */
export function uniqueLandlordIdFromRows(
  rows: Array<{ landlord_id?: string | null } | null | undefined>,
): string | null {
  const unique = [
    ...new Set(
      rows
        .map((row) => String(row?.landlord_id ?? "").trim())
        .filter(Boolean),
    ),
  ]
  return unique.length === 1 ? unique[0] : null
}

/** Open / mid-intake conversation statuses that can own an inbound reply. */
export const SHARED_DID_OPEN_CONVERSATION_STATUSES = [
  "open",
  "awaiting_unit_number",
  "unresolved",
  "intake_collecting",
  "intake_confirm",
  "intake_edit",
] as const

/**
 * Prefer the landlord that last texted this phone (trusted outbound context).
 * Pure helper for tests — pass already-sorted newest-first rows.
 */
export function pickLandlordIdFromRecentOutboundRows(
  rows: Array<{ landlord_id?: string | null; created_at?: string | null }>,
): string | null {
  for (const row of rows) {
    const id = String(row?.landlord_id ?? "").trim()
    if (id) return id
  }
  return null
}

/**
 * Prefer the most recently updated open conversation for this phone.
 * Pure helper — pass already-sorted newest-first rows.
 */
export function pickLandlordIdFromRecentConversationRows(
  rows: Array<{ landlord_id?: string | null; updated_at?: string | null }>,
): string | null {
  for (const row of rows) {
    const id = String(row?.landlord_id ?? "").trim()
    if (id) return id
  }
  return null
}

/** True when any row is a non-Demo landlord account. */
export function rowsIncludeNonDemoLandlord(
  rows: Array<{ landlord_id?: string | null } | null | undefined>,
): boolean {
  return rows.some((row) => {
    const id = String(row?.landlord_id ?? "").trim()
    return Boolean(id) && !isDemoLandlord(id)
  })
}

/**
 * When a phone is on Demo and at least one other portfolio, Demo must not win
 * unless Demo is the only recent trusted context. Pure helper for ranking.
 */
export function preferNonDemoWhenChoosingUnique(
  landlordIds: readonly string[],
): string | null {
  const unique = [...new Set(landlordIds.map((id) => id.trim()).filter(Boolean))]
  if (unique.length === 1) return unique[0]
  const nonDemo = unique.filter((id) => !isDemoLandlord(id))
  if (nonDemo.length === 1) return nonDemo[0]
  return null
}

/**
 * True when this phone is bound to a non-Demo resident or vendor roster row.
 * Used to block Try Demo from hijacking legitimate portfolio traffic.
 */
export async function phoneHasNonDemoRosterBinding(
  supabase: SupabaseClient,
  fromNumber: string,
): Promise<boolean> {
  const variants = phoneLookupVariants(fromNumber)
  if (variants.length === 0) return false

  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("landlord_id")
    .in("phone", variants)
    .not("landlord_id", "is", null)
    .neq("landlord_id", DEMO_LANDLORD_ID)
    .limit(8)

  if (usersErr) {
    console.error(
      "[sms-inbound] shared Twilio non-demo user lookup",
      usersErr.message,
    )
  } else if ((users ?? []).length > 0) {
    return true
  }

  const { data: vendors, error: vendorErr } = await supabase
    .from("vendors")
    .select("landlord_id")
    .in("phone", variants)
    .not("landlord_id", "is", null)
    .neq("landlord_id", DEMO_LANDLORD_ID)
    .limit(8)

  if (vendorErr) {
    console.error(
      "[sms-inbound] shared Twilio non-demo vendor lookup",
      vendorErr.message,
    )
    return false
  }

  return (vendors ?? []).length > 0
}

function landlordIdsFromRows(
  rows: Array<{ landlord_id?: string | null }> | null | undefined,
): string[] {
  return (rows ?? [])
    .map((row) => String(row.landlord_id ?? "").trim())
    .filter(Boolean)
}

/**
 * Shared Ulo line: only current sender links grant account eligibility.
 * Selectors and short-lived explicit context may narrow those links. Neither
 * message history nor the receiving line owner grants access to an account.
 */
export type SharedLineAccountResolution = {
  landlordId: string | null
  reason:
    | "explicit"
    | "selected"
    | "context"
    | "ambiguous"
    | "unmatched"
    | "selector_not_found"
    | "unavailable"
  selectorOnly?: boolean
  ticketId?: string
  workOrderRef?: string
}

const SHARED_ACCOUNT_MATCH_LIMIT = 200
export const SHARED_ACCOUNT_SELECTION_MS = 10 * 60 * 1000

/** Current sender links first; addresses/refs and saved choices can only narrow them. */
export async function resolveSharedLineInboundAccount(
  supabase: SupabaseClient,
  input: {
    from: string
    body: string
    smsNumberId: string
    homeCheckLandlordId?: string | null
  },
): Promise<SharedLineAccountResolution> {
  const variants = phoneLookupVariants(input.from)
  if (!variants.length) return { landlordId: null, reason: "unmatched" }
  // Every discovery query is bounded with an overflow sentinel. Never choose
  // a single account from truncated or partially failed membership evidence.
  const checked = <T>(result: { data: T[] | null; error: unknown }): T[] => {
    if (
      result.error || !Array.isArray(result.data) ||
      result.data.length > SHARED_ACCOUNT_MATCH_LIMIT
    ) {
      throw new Error("Shared account lookup unavailable")
    }
    return result.data
  }
  try {
    const safePhones = variants.filter((v) => /^\+?[0-9]{7,15}$/.test(v))
    const phoneColumns = [
      "draft_state->accountSetup->>phone",
      "draft_state->accountSetup->>backupContactPhone",
      "draft_state->accountSetup->>backup_contact_phone",
      "draft_state->organizationSettings->>backupContactPhone",
      "draft_state->organizationSettings->>backup_contact_phone",
      "account_settings->organization->>backupContactPhone",
      "account_settings->organization->>backup_contact_phone",
    ]
    const results = await Promise.all([
      supabase.from("users").select("id, landlord_id, status").in("phone", variants)
        .not("landlord_id", "is", null).limit(SHARED_ACCOUNT_MATCH_LIMIT + 1),
      supabase.from("vendors").select("id, landlord_id, active").in(
        "phone",
        variants,
      ).not("landlord_id", "is", null).limit(SHARED_ACCOUNT_MATCH_LIMIT + 1),
      supabase.from("sms_identities").select("landlord_id, identity_type, resident_id, vendor_id").in(
        "phone_number",
        variants,
      ).not("landlord_id", "is", null).limit(SHARED_ACCOUNT_MATCH_LIMIT + 1),
      supabase.from("landlords").select("id").in("phone", variants).limit(
        SHARED_ACCOUNT_MATCH_LIMIT + 1,
      ),
      supabase.from("properties").select("landlord_id").in(
        "manager_phone",
        variants,
      ).not("landlord_id", "is", null).limit(SHARED_ACCOUNT_MATCH_LIMIT + 1),
      safePhones.length
        ? supabase.from("landlord_onboarding").select(
          "landlord_id, draft_state, account_settings",
        )
          .or(
            phoneColumns.flatMap((col) =>
              safePhones.map((phone) => `${col}.eq.${phone}`)
            ).join(","),
          )
          .not("landlord_id", "is", null).limit(SHARED_ACCOUNT_MATCH_LIMIT + 1)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("sms_phone_account_disconnects").select("landlord_id").in(
        "phone_number",
        variants,
      ).limit(SHARED_ACCOUNT_MATCH_LIMIT + 1),
    ])
    type LinkRow = {
      id?: string
      landlord_id?: string | null
      status?: string
      active?: boolean
      identity_type?: string
      resident_id?: string | null
      vendor_id?: string | null
      draft_state?: unknown
      account_settings?: unknown
    }
    const [
      users,
      vendors,
      identities,
      owners,
      managers,
      onboarding,
      disconnects,
    ] = results.map((result) => checked<LinkRow>(result))
    const disconnected = new Set(landlordIdsFromRows(disconnects))
    const currentUsers = users.filter(row => !["inactive", "archived", "deleted"].includes(String(row.status)))
    const currentVendors = vendors.filter(row => row.active !== false)
    const teamLinks = onboarding.filter(row => {
      const draft = row.draft_state as Record<string, unknown> | null
      const account = draft?.accountSetup as Record<string, unknown> | null
      const phones = [account?.phone, account?.backupContactPhone, account?.backup_contact_phone, teamMemberContactFromOnboarding(row).phone]
      return phones.some(phone => typeof phone === "string" && normalizeSmsPhone(phone) === normalizeSmsPhone(input.from))
    })
    const teamAccounts = new Set([
      ...owners.map(row => String(row.id)), ...landlordIdsFromRows(managers), ...landlordIdsFromRows(teamLinks),
      ...landlordIdsFromRows(identities.filter(row => row.identity_type === "landlord")),
    ])
    const allLinks = [
      ...landlordIdsFromRows(currentUsers), ...landlordIdsFromRows(currentVendors), ...teamAccounts,
      ...landlordIdsFromRows(identities.filter(row => ["resident", "vendor"].includes(String(row.identity_type)))),
    ].filter(id => landlordMayUseSharedSmsLine(id))
    const ticketLinkedToSender = (ticket: { landlord_id?: unknown; resident_id?: unknown; assigned_vendor_id?: unknown }): boolean => {
      const accountId = String(ticket.landlord_id)
      if (!ids.has(accountId)) return false
      if (teamAccounts.has(accountId)) return true
      return currentUsers.some(row => row.landlord_id === accountId && row.id && row.id === ticket.resident_id) ||
        currentVendors.some(row => row.landlord_id === accountId && row.id && row.id === ticket.assigned_vendor_id) ||
        identities.some(row => row.landlord_id === accountId && (
          (row.identity_type === "resident" && row.resident_id && row.resident_id === ticket.resident_id) ||
          (row.identity_type === "vendor" && row.vendor_id && row.vendor_id === ticket.assigned_vendor_id)
        ))
    }

    const ids = new Set(allLinks.filter((id) => !disconnected.has(id)))
    const linked = [...ids]
    if (input.homeCheckLandlordId) {
      return ids.has(input.homeCheckLandlordId)
        ? { landlordId: input.homeCheckLandlordId, reason: "explicit" }
        : { landlordId: null, reason: "selector_not_found" }
    }

    const wo = sharedLineWorkOrderSelector(input.body)
    if (!linked.length) {
      return {
        landlordId: null,
        reason:
          wo.kind !== "none" || /^\d/.test(sharedLineAddressReply(input.body))
            ? "selector_not_found"
            : "unmatched",
      }
    }
    if (wo.kind === "invalid") {
      return { landlordId: null, reason: "selector_not_found" }
    }
    if (wo.kind === "work_order") {
      const low = wo.prefix.padEnd(8, "0") + "-0000-0000-0000-000000000000"
      const high = wo.prefix.padEnd(8, "f") + "-ffff-ffff-ffff-ffffffffffff"
      const tickets = checked(
        await supabase.from("maintenance_requests").select("id, landlord_id, resident_id, assigned_vendor_id")
          .in("landlord_id", linked).gte("id", low).lte("id", high).limit(2),
      )
      // Reference collisions, including within one account, must not pick a job.
      if (tickets.length !== 1 || !ticketLinkedToSender(tickets[0])) {
        return { landlordId: null, reason: "selector_not_found" }
      }
      return {
        landlordId: String(tickets[0].landlord_id),
        reason: "selected",
        selectorOnly: wo.selectorOnly,
        ticketId: String(tickets[0].id),
        workOrderRef: `WO-${wo.prefix.slice(0, 4).toUpperCase()}`,
      }
    }
    const address = sharedLineAddressReply(input.body)
    if (/^\d/.test(address)) {
      const properties = checked(
        await supabase.from("properties")
          .select(
            "id, landlord_id, name, street_address, city, state, zip_code",
          )
          .in("landlord_id", linked).limit(SHARED_ACCOUNT_MATCH_LIMIT + 1),
      )
      const matches = new Set(
        properties.filter((row) => {
          const streets = [row.street_address, row.name]
            .filter((v): v is string =>
              typeof v === "string" && /^\d/.test(v.trim())
            )
          return streets.some((street) => {
            const locality = [row.city, row.state, row.zip_code].filter((v) =>
              typeof v === "string" && v.trim()
            ).join(" ")
            return [street, `${street} ${locality}`].some((candidate) =>
              normalizeSharedLineAddress(candidate) === address
            )
          })
        }).map((row) => String(row.landlord_id)),
      )
      if (matches.size !== 1) {
        return { landlordId: null, reason: "selector_not_found" }
      }
      return {
        landlordId: [...matches][0],
        reason: "selected",
        selectorOnly: true,
      }
    }

    // A prior explicit selection is short-lived context, never new membership.
    const conversations = checked(
      await supabase.from("sms_conversations")
        .select("landlord_id, intake_state, status").in("landlord_id", linked)
        .eq("sms_number_id", input.smsNumberId).in(
          "external_phone_number",
          variants,
        )
        .in("status", [...SHARED_DID_OPEN_CONVERSATION_STATUSES]).limit(
          SHARED_ACCOUNT_MATCH_LIMIT + 1,
        ),
    )
    const selections = conversations.map((row) => {
      const state = row.intake_state as Record<string, unknown> | null
      const selection = state?.shared_line_selection as
        | Record<string, unknown>
        | null
      return {
        id: String(row.landlord_id),
        at: Date.parse(String(selection?.selectedAt ?? "")),
        expires: Date.parse(String(selection?.expiresAt ?? "")),
        ticketId: typeof selection?.ticketId === "string"
          ? selection.ticketId
          : undefined,
      }
    }).filter((row) =>
      Number.isFinite(row.at) && Number.isFinite(row.expires) &&
      row.at <= Date.now() && row.expires > Date.now() &&
      row.expires - row.at <= SHARED_ACCOUNT_SELECTION_MS
    )
    const latest = Math.max(...selections.map((row) => row.at))
    const chosen = new Set(
      selections.filter((row) => row.at === latest).map((row) => row.id),
    )
    if (chosen.size !== 1) {
      return linked.length === 1 && !selections.length &&
          !allLinks.some((id) => disconnected.has(id))
        ? { landlordId: linked[0], reason: "explicit" }
        : { landlordId: null, reason: "ambiguous" }
    }
    const chosenId = [...chosen][0]
    const selectedTickets = new Set(
      selections.filter((row) => row.at === latest && row.id === chosenId).map(
        (row) => row.ticketId ?? "",
      ),
    )
    if (selectedTickets.size !== 1) {
      return { landlordId: null, reason: "ambiguous" }
    }
    const ticketId = [...selectedTickets][0]
    if (ticketId && isBareSharedLineAction(input.body)) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(ticketId)
      ) return { landlordId: null, reason: "selector_not_found" }
      const prefix = ticketId.slice(0, 4).toLowerCase()
      const current = checked(
        await supabase.from("maintenance_requests").select("id, landlord_id, resident_id, assigned_vendor_id")
          .eq("landlord_id", chosenId).gte(
            "id",
            prefix.padEnd(8, "0") + "-0000-0000-0000-000000000000",
          )
          .lte("id", prefix.padEnd(8, "f") + "-ffff-ffff-ffff-ffffffffffff")
          .limit(2),
      )
      if (current.length !== 1 || current[0].id !== ticketId || !ticketLinkedToSender(current[0])) {
        return { landlordId: null, reason: "selector_not_found" }
      }
      return {
        landlordId: chosenId,
        reason: "context",
        workOrderRef: `WO-${prefix.toUpperCase()}`,
      }
    }
    return { landlordId: chosenId, reason: "context" }
  } catch {
    console.error("[sms-inbound] shared-line account lookup unavailable")
    return { landlordId: null, reason: "unavailable" }
  }
}

/** Compatibility wrapper; history never grants an account association. */
export async function resolveLandlordIdForSharedTwilioInbound(
  supabase: SupabaseClient,
  fromNumber: string,
  _lineOwnerLandlordId?: string | null,
): Promise<string | null> {
  return (await resolveSharedLineInboundAccount(supabase, {
    from: fromNumber,
    body: "",
    smsNumberId: "",
  })).landlordId
}

function pickCanonicalSmsIdentity(
  rows: SmsIdentityRow[],
  e164: string,
): SmsIdentityRow | null {
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]

  const ranked = [...rows].sort((a, b) => {
    const aE164 = a.phone_number === e164 ? 0 : 1
    const bE164 = b.phone_number === e164 ? 0 : 1
    if (aE164 !== bE164) return aE164 - bE164

    const aKnown = a.identity_type !== "unknown" ? 0 : 1
    const bKnown = b.identity_type !== "unknown" ? 0 : 1
    if (aKnown !== bKnown) return aKnown - bKnown

    return a.id.localeCompare(b.id)
  })

  return ranked[0] ?? null
}

export async function lookupSmsIdentity(
  supabase: SupabaseClient,
  fromNumber: string,
  landlordId: string,
): Promise<SmsIdentityRow | null> {
  const e164 = normalizePhoneFlexible(fromNumber)
  const rows = await findSmsIdentitiesByPhone(supabase, fromNumber, landlordId)
  return pickCanonicalSmsIdentity(rows, e164 ?? normalizeSmsPhone(fromNumber))
}

export type UpsertSmsIdentityForPhoneParams = {
  landlordId: string
  phone: string
  identityType: "resident" | "vendor" | "landlord"
  residentId?: string | null
  vendorId?: string | null
  unitId?: string | null
}

/**
 * Create or upgrade an sms_identities row for a landlord-scoped phone.
 * Normalizes to E.164 before match/insert, upgrades unknown identities, preserves first_seen_at.
 */
export async function upsertSmsIdentityForPhone(
  supabase: SupabaseClient,
  params: UpsertSmsIdentityForPhoneParams,
): Promise<SmsIdentityRow | null> {
  const e164 = normalizePhoneFlexible(params.phone)
  if (!e164) {
    console.warn("[sms] upsertSmsIdentityForPhone: invalid phone", params.phone)
    return null
  }

  const landlordId = params.landlordId.trim()
  const now = new Date().toISOString()
  const matches = await findSmsIdentitiesByPhone(supabase, params.phone, landlordId)
  const existing = pickCanonicalSmsIdentity(matches, e164)
  const duplicateIds = matches
    .filter((row) => row.id !== existing?.id)
    .map((row) => row.id)

  const identityPatch =
    params.identityType === "resident"
      ? {
          identity_type: "resident" as const,
          resident_id: params.residentId?.trim() || null,
          vendor_id: null,
          unit_id: params.unitId?.trim() || null,
          verified: false,
        }
      : params.identityType === "landlord"
        ? {
            identity_type: "landlord" as const,
            resident_id: null,
            vendor_id: null,
            unit_id: null,
            verified: true,
          }
        : {
            identity_type: "vendor" as const,
            vendor_id: params.vendorId?.trim() || null,
            resident_id: null,
            unit_id: null,
            verified: false,
          }

  let result: SmsIdentityRow

  if (existing) {
    const canApplyType =
    smsIdentityAllowsTypePatch(existing, params.identityType) ||
    // Welcome / activation must re-bind a phone that was previously a vendor or
    // blank row — otherwise YES lands on a non-tenant thread and is ignored.
    (params.identityType === "resident" && Boolean(params.residentId?.trim()))

    const updatePayload = canApplyType
      ? { ...identityPatch, phone_number: e164, last_seen_at: now }
      : { phone_number: e164, last_seen_at: now }

    const { data, error } = await supabase
      .from("sms_identities")
      .update(updatePayload)
      .eq("id", existing.id)
      .select(smsIdentitySelect)
      .single()

    if (error || !data) {
      console.error("[sms] upsertSmsIdentityForPhone update", error?.message)
      throw new Error("Failed to update SMS identity")
    }

    result = data as SmsIdentityRow
  } else {
    const { data, error } = await supabase
      .from("sms_identities")
      .insert({
        landlord_id: landlordId,
        phone_number: e164,
        ...identityPatch,
        last_seen_at: now,
      })
      .select(smsIdentitySelect)
      .single()

    if (error || !data) {
      if (error?.code === "23505") {
        const retryExisting = await lookupSmsIdentity(
          supabase,
          params.phone,
          landlordId,
        )
        if (retryExisting) {
          return upsertSmsIdentityForPhone(supabase, params)
        }
      }
      console.error("[sms] upsertSmsIdentityForPhone insert", error?.message)
      throw new Error("Failed to create SMS identity")
    }

    result = data as SmsIdentityRow
  }

  if (duplicateIds.length > 0) {
    const { error: dedupeErr } = await supabase
      .from("sms_identities")
      .delete()
      .in("id", duplicateIds)
    if (dedupeErr) {
      console.warn(
        "[sms] upsertSmsIdentityForPhone dedupe failed",
        dedupeErr.message,
      )
    }
  }

  return result
}

export async function upsertSmsIdentity(
  supabase: SupabaseClient,
  params: {
    fromNumber: string
    landlordId: string
    existing: SmsIdentityRow | null
    patch: Partial<
      Pick<
        SmsIdentityRow,
        "identity_type" | "resident_id" | "vendor_id" | "unit_id" | "verified"
      >
    >
  },
): Promise<SmsIdentityRow> {
  const e164 = normalizePhoneFlexible(params.fromNumber)
  const normalizedFrom = e164 ?? params.fromNumber.trim()
  const now = new Date().toISOString()

  if (params.existing) {
    const { data, error } = await supabase
      .from("sms_identities")
      .update({
        ...params.patch,
        ...(e164 ? { phone_number: e164 } : {}),
        last_seen_at: now,
      })
      .eq("id", params.existing.id)
      .select(
        "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
      )
      .single()

    if (error || !data) {
      console.error("[sms-inbound] sms_identities update", error?.message)
      throw new Error("Failed to update SMS identity")
    }

    return data as SmsIdentityRow
  }

  const { data, error } = await supabase
    .from("sms_identities")
    .insert({
      landlord_id: params.landlordId,
      phone_number: normalizedFrom,
      verified: false,
      ...params.patch,
    })
    .select(
      "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
    )
    .single()

  if (error || !data) {
    if (error?.code === "23505") {
      const existing = await lookupSmsIdentity(
        supabase,
        params.fromNumber,
        params.landlordId,
      )
      if (existing) {
        return upsertSmsIdentity(supabase, {
          ...params,
          existing,
        })
      }
    }
    console.error("[sms-inbound] sms_identities insert", error?.message)
    throw new Error("Failed to create SMS identity")
  }

  return data as SmsIdentityRow
}

export async function createUnknownIdentity(
  supabase: SupabaseClient,
  fromNumber: string,
  landlordId: string,
): Promise<SmsIdentityRow> {
  const normalizedFrom = normalizeSmsPhone(fromNumber)
  const { data, error } = await supabase
    .from("sms_identities")
    .insert({
      landlord_id: landlordId,
      phone_number: normalizedFrom,
      identity_type: "unknown",
      verified: false,
    })
    .select(
      "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
    )
    .single()

  if (error || !data) {
    if (error?.code === "23505") {
      const existing = await lookupSmsIdentity(supabase, fromNumber, landlordId)
      if (existing) return existing
    }
    console.error("[sms-inbound] sms_identities insert", error?.message)
    throw new Error("Failed to create SMS identity")
  }

  return data as SmsIdentityRow
}

/** Self-heal unknown or blank-tenant identities by matching resident/vendor phone records. */
export async function trySelfHealIdentity(
  supabase: SupabaseClient,
  identity: SmsIdentityRow,
  fromNumber: string,
): Promise<SmsIdentityRow> {
  if (identity.identity_type === "vendor" && identity.vendor_id?.trim()) {
    return identity
  }
  // Resident linked but unit missing — fill units.id from roster label.
  if (
    identity.identity_type === "resident" &&
    identity.resident_id?.trim() &&
    !identity.unit_id?.trim()
  ) {
    const landlordId = identity.landlord_id?.trim() || ""
    const { data: resident } = await supabase
      .from("users")
      .select("unit, building")
      .eq("id", identity.resident_id)
      .maybeSingle()
    const unitId = await resolveUnitIdForLandlord(supabase, {
      landlordId,
      unitLabel: (resident as { unit?: string | null } | null)?.unit,
      building: (resident as { building?: string | null } | null)?.building,
    })
    if (unitId) {
      const { data: updated, error } = await supabase
        .from("sms_identities")
        .update({
          unit_id: unitId,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", identity.id)
        .select(
          "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
        )
        .single()
      if (!error && updated) {
        console.info("[sms-inbound] self-healed missing unit_id", identity.id)
        return updated as SmsIdentityRow
      }
    }
    return identity
  }
  if (identity.identity_type === "resident" && identity.resident_id?.trim()) {
    return identity
  }
  if (
    identity.identity_type !== "unknown" &&
    identity.identity_type !== "resident"
  ) {
    return identity
  }

  const variants = phoneLookupVariants(fromNumber)
  const landlordId = identity.landlord_id?.trim() || ""

  let vendorQuery = supabase
    .from("vendors")
    .select("id, phone")
    .in("phone", variants)
  if (landlordId) vendorQuery = vendorQuery.eq("landlord_id", landlordId)

  const { data: vendorHit } = await vendorQuery.limit(1).maybeSingle()

  if (vendorHit?.id) {
    const { data: updated, error } = await supabase
      .from("sms_identities")
      .update({
        identity_type: "vendor",
        vendor_id: vendorHit.id,
        resident_id: null,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", identity.id)
      .select(
        "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
      )
      .single()
    if (!error && updated) {
      console.info("[sms-inbound] self-healed identity to vendor", identity.id)
      return updated as SmsIdentityRow
    }
  }

  let usersQuery = supabase
    .from("users")
    .select("id, phone, unit, building, status")
    .in("phone", variants)
    .in("status", ["active", "pending"])
  if (landlordId) usersQuery = usersQuery.eq("landlord_id", landlordId)
  const { data: users } = await usersQuery.limit(1)

  const resident = users?.[0] as {
    id: string
    phone: string
    unit: string | null
    building: string | null
  } | undefined
  if (resident?.id) {
    const unitId = await resolveUnitIdForLandlord(supabase, {
      landlordId,
      unitLabel: resident.unit,
      building: resident.building,
    })
    const { data: updated, error } = await supabase
      .from("sms_identities")
      .update({
        identity_type: "resident",
        resident_id: resident.id,
        unit_id: unitId,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", identity.id)
      .select(
        "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
      )
      .single()
    if (!error && updated) {
      console.info("[sms-inbound] self-healed identity to resident", identity.id)
      return updated as SmsIdentityRow
    }
  }

  const e164 = normalizePhoneFlexible(fromNumber)
  if (e164) {
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("id, resident_phone, unit")
      .eq("resident_phone", e164)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (ticket?.id) {
      const { data: updated, error } = await supabase
        .from("sms_identities")
        .update({
          identity_type: "resident",
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", identity.id)
        .select(
          "id, landlord_id, resident_id, vendor_id, unit_id, phone_number, identity_type, verified",
        )
        .single()
      if (!error && updated) {
        console.info(
          "[sms-inbound] self-healed identity via maintenance_requests",
          identity.id,
        )
        return updated as SmsIdentityRow
      }
    }
  }

  return identity
}

export async function touchIdentityLastSeen(
  supabase: SupabaseClient,
  identityId: string,
): Promise<void> {
  const { error } = await supabase
    .from("sms_identities")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", identityId)
  if (error) {
    console.error("[sms-inbound] identity last_seen update", error.message)
  }
}

export function conversationTypeForIdentity(
  identity: SmsIdentityRow | string,
): "resident_intake" | "vendor_alert" | "vendor_tenant_proxy" | "landlord_update" {
  if (typeof identity === "string") {
    return resolveConversationTypeFromFields(identity, null, null)
  }
  return resolveConversationTypeFromFields(
    identity.identity_type,
    identity.vendor_id,
    identity.resident_id,
  )
}

/** Higher = stronger operational context; weaker inferred types must not clobber. */
export const CONVERSATION_TYPE_STRENGTH: Record<string, number> = {
  landlord_update: 40,
  vendor_tenant_proxy: 30,
  vendor_alert: 20,
  resident_intake: 10,
}

export function conversationTypeStrength(conversationType: string): number {
  return CONVERSATION_TYPE_STRENGTH[conversationType] ?? 0
}

/**
 * Prefer the stronger of an existing thread type and a freshly inferred type.
 * Example: keep landlord_update from a vendor-choice ask when identity briefly
 * mis-resolves as a blank resident (resident_intake).
 */
export function pickStrongerConversationType(
  existing: string | null | undefined,
  inferred: "resident_intake" | "vendor_alert" | "vendor_tenant_proxy" | "landlord_update",
): "resident_intake" | "vendor_alert" | "vendor_tenant_proxy" | "landlord_update" {
  const prior = typeof existing === "string" ? existing.trim() : ""
  if (!prior) return inferred
  if (conversationTypeStrength(prior) >= conversationTypeStrength(inferred)) {
    if (
      prior === "landlord_update" ||
      prior === "vendor_tenant_proxy" ||
      prior === "vendor_alert" ||
      prior === "resident_intake"
    ) {
      return prior
    }
  }
  return inferred
}

/** Pick sms_conversations.conversation_type from resolved identity fields. */
export function resolveConversationTypeFromFields(
  identityType: string,
  vendorId: string | null | undefined,
  residentId: string | null | undefined,
): "resident_intake" | "vendor_alert" | "vendor_tenant_proxy" | "landlord_update" {
  const vendor = vendorId?.trim() ?? ""
  const resident = residentId?.trim() ?? ""

  if (identityType === "vendor" && vendor) {
    return "vendor_alert"
  }
  if (identityType === "landlord") {
    return "landlord_update"
  }
  if (identityType === "resident" && resident) {
    return "resident_intake"
  }
  // unknown senders + incomplete vendor rows → tenant intake / self-healing
  return "resident_intake"
}

export function sanitizeConversationType(
  conversationType: string,
  identity: SmsIdentityRow,
): "resident_intake" | "vendor_alert" | "vendor_tenant_proxy" | "landlord_update" {
  const resolved = conversationTypeForIdentity(identity)
  if (conversationType === "vendor_alert" && !identity.vendor_id?.trim()) {
    return "resident_intake"
  }
  if (conversationType === "vendor_alert" && identity.vendor_id?.trim()) {
    return "vendor_alert"
  }
  return resolved
}

export async function findOpenConversation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    smsNumberId: string
    externalPhone: string
  },
): Promise<{
  id: string
  maintenance_request_id: string | null
  status: string
  conversation_type: string
  resident_id: string | null
  vendor_id: string | null
  unit_id: string | null
} | null> {
  const external = normalizeSmsPhone(params.externalPhone)
  const { data, error } = await supabase
    .from("sms_conversations")
    .select(
      "id, maintenance_request_id, status, conversation_type, resident_id, vendor_id, unit_id",
    )
    .eq("landlord_id", params.landlordId)
    .eq("sms_number_id", params.smsNumberId)
    .eq("external_phone_number", external)
    .in("status", [
      "open",
      "awaiting_unit_number",
      "unresolved",
      "intake_collecting",
      "intake_confirm",
      "intake_edit",
    ])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[sms-inbound] conversation lookup", error.message)
    throw new Error("Failed to look up conversation")
  }

  return data as {
    id: string
    maintenance_request_id: string | null
    status: string
    conversation_type: string
    resident_id: string | null
    vendor_id: string | null
    unit_id: string | null
  } | null
}

/**
 * Find the most recent resident SMS thread for a phone (any status), including
 * completed late-rent / reminder threads that should receive follow-up SMS.
 * Falls back to resident_id when the phone on the thread was stored incorrectly
 * (e.g. demo ai_copilot rows keyed to the Ulo line).
 */
export async function findResidentConversationByPhone(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    smsNumberId: string
    externalPhone: string
    residentId?: string | null
  },
): Promise<{ id: string; maintenance_request_id: string | null; status: string; conversation_type: string } | null> {
  const external = normalizeSmsPhone(params.externalPhone)
  const selectCols = "id, maintenance_request_id, status, conversation_type"

  const byPhone = await supabase
    .from("sms_conversations")
    .select(selectCols)
    .eq("landlord_id", params.landlordId)
    .eq("sms_number_id", params.smsNumberId)
    .eq("external_phone_number", external)
    .is("vendor_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (byPhone.error) {
    console.error("[sms-inbound] resident conversation lookup", byPhone.error.message)
    throw new Error("Failed to look up resident conversation")
  }
  if (byPhone.data) {
    return byPhone.data as {
      id: string
      maintenance_request_id: string | null
      status: string
      conversation_type: string
    }
  }

  const residentId = params.residentId?.trim()
  if (!residentId) return null

  const byResident = await supabase
    .from("sms_conversations")
    .select(selectCols)
    .eq("landlord_id", params.landlordId)
    .eq("sms_number_id", params.smsNumberId)
    .eq("resident_id", residentId)
    .is("vendor_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (byResident.error) {
    console.error("[sms-inbound] resident conversation lookup by id", byResident.error.message)
    throw new Error("Failed to look up resident conversation")
  }

  return (byResident.data as {
    id: string
    maintenance_request_id: string | null
    status: string
    conversation_type: string
  } | null) ?? null
}

export async function createConversation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    smsNumberId: string
    externalPhone: string
    identity: SmsIdentityRow
    maintenanceRequestId?: string | null
    conversationStatus?: string
  },
): Promise<string> {
  let conversationType = conversationTypeForIdentity(params.identity)
  conversationType = sanitizeConversationType(conversationType, params.identity)

  const { data, error } = await supabase
    .from("sms_conversations")
    .insert({
      landlord_id: params.landlordId,
      sms_number_id: params.smsNumberId,
      external_phone_number: normalizeSmsPhone(params.externalPhone),
      conversation_type: conversationType,
      status: params.conversationStatus ?? "open",
      resident_id: params.identity.resident_id,
      vendor_id: params.identity.vendor_id,
      unit_id: params.identity.unit_id,
      maintenance_request_id: params.maintenanceRequestId ?? null,
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    console.error("[sms-inbound] conversation insert", error?.message)
    throw new Error("Failed to create conversation")
  }

  return data.id as string
}

export type FindOrCreateConversationResult = {
  conversationId: string
  created: boolean
  conversationType: ReturnType<typeof conversationTypeForIdentity>
}

/** Find an open thread or create one with a safe conversation_type. */
export async function findOrCreateConversation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    smsNumberId: string
    externalPhone: string
    identity: SmsIdentityRow
    maintenanceRequestId?: string | null
    conversationStatus?: string
  },
): Promise<FindOrCreateConversationResult> {
  const conversationType = sanitizeConversationType(
    conversationTypeForIdentity(params.identity),
    params.identity,
  )

  const existing = await findOpenConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: params.smsNumberId,
    externalPhone: params.externalPhone,
  })

  if (existing) {
    const preservedType = pickStrongerConversationType(
      existing.conversation_type,
      conversationType,
    )

    const { error } = await supabase
      .from("sms_conversations")
      .update({
        updated_at: new Date().toISOString(),
        status:
          preservedType === "vendor_alert"
            ? (params.conversationStatus ?? "open")
            : (params.conversationStatus ?? existing.status ?? "open"),
        conversation_type: preservedType,
        // Never wipe a linked resident/unit with a null identity patch.
        resident_id: params.identity.resident_id ?? existing.resident_id ?? null,
        vendor_id: params.identity.vendor_id ?? existing.vendor_id ?? null,
        unit_id: params.identity.unit_id ?? existing.unit_id ?? null,
        maintenance_request_id:
          params.maintenanceRequestId ?? existing.maintenance_request_id,
      })
      .eq("id", existing.id)

    if (error) {
      console.error("[sms-inbound] conversation update", error.message)
      throw new Error("Failed to update conversation")
    }

    return {
      conversationId: existing.id,
      created: false,
      conversationType: preservedType,
    }
  }

  const conversationId = await createConversation(supabase, params)
  return { conversationId, created: true, conversationType }
}

const OPEN_WORK_ORDER_STATUSES = [
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
] as const

/** Drop a conversation-linked ticket that belongs to another landlord. */
export async function maintenanceRequestIdIfSameLandlord(
  supabase: SupabaseClient,
  ticketId: string | null | undefined,
  landlordId: string,
): Promise<string | null> {
  const id = ticketId?.trim()
  if (!id) return null
  const { data } = await supabase
    .from("maintenance_requests")
    .select("id, landlord_id")
    .eq("id", id)
    .maybeSingle()
  if (!data?.id) return null
  const ticketLandlord = (data.landlord_id as string | null)?.trim()
  if (ticketLandlord && ticketLandlord !== landlordId) return null
  return data.id as string
}

export async function resolveOpenMaintenanceRequestId(
  supabase: SupabaseClient,
  identity: SmsIdentityRow,
  fromNumber: string,
): Promise<string | null> {
  if (identity.vendor_id?.trim()) {
    let vendorQuery = supabase
      .from("maintenance_requests")
      .select("id")
      .eq("assigned_vendor_id", identity.vendor_id)
      .in("vendor_work_status", ["pending_accept", "accepted", "in_progress"])
    if (identity.landlord_id) {
      vendorQuery = vendorQuery.eq("landlord_id", identity.landlord_id)
    }
    const { data: ticket } = await vendorQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (ticket?.id) return ticket.id as string
  }

  const e164 = normalizePhoneFlexible(fromNumber)
  if (e164) {
    let phoneQuery = supabase
      .from("maintenance_requests")
      .select("id")
      .eq("resident_phone", e164)
      .in("vendor_work_status", OPEN_WORK_ORDER_STATUSES)
    if (identity.landlord_id) {
      phoneQuery = phoneQuery.eq("landlord_id", identity.landlord_id)
    }
    const { data: ticket } = await phoneQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (ticket?.id) return ticket.id as string
  }

  // Resident-owned tickets only — never resolve by unit_id / unit label alone
  // (same P0 as loadOpenTickets: fail closed rather than guessing a neighbor's WO).
  if (identity.resident_id?.trim()) {
    const residentId = identity.resident_id.trim()
    let residentQuery = supabase
      .from("maintenance_requests")
      .select("id")
      .or(`resident_id.eq.${residentId},resident_user_id.eq.${residentId}`)
      .in("vendor_work_status", OPEN_WORK_ORDER_STATUSES)
    if (identity.landlord_id) {
      residentQuery = residentQuery.eq("landlord_id", identity.landlord_id)
    }
    const { data: ticket } = await residentQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (ticket?.id) return ticket.id as string
  }

  return null
}
