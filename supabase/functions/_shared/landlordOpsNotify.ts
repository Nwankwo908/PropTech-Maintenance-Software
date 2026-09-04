/**
 * Landlord / ops email delivery gate.
 *
 * Never send privileged landlord-action mail (estimate approve links, etc.)
 * to addresses that belong to vendors. All landlord-ops email should go
 * through `sendLandlordOpsEmail` or `resolveLandlordOpsEmails`.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "./delivery.ts"

export function normalizeOpsEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase()
  if (!e.includes("@") || e.length > 254) return null
  return e
}

/** Alpha / demo login mailboxes — never prefer these over a real support email. */
export const PLATFORM_LOGIN_EMAILS = new Set([
  "limitedalpha1@ulohome.io",
  "demo@ulohome.io",
  "newlandlord@ulohome.io",
])

/** Organization / onboarding support email takes priority over the login mailbox. */
export function collectLandlordSupportEmails(input: {
  accountSetupEmail?: string | null
  organizationSupportEmail?: string | null
  landlordEmail?: string | null
}): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [
    input.accountSetupEmail,
    input.organizationSupportEmail,
    input.landlordEmail,
  ]) {
    const n = normalizeOpsEmail(typeof raw === "string" ? raw : "")
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

export function primaryLandlordSupportEmail(input: {
  accountSetupEmail?: string | null
  organizationSupportEmail?: string | null
  landlordEmail?: string | null
}): string | null {
  const all = collectLandlordSupportEmails(input)
  const operational = all.filter((email) => !PLATFORM_LOGIN_EMAILS.has(email))
  return operational[0] ?? all[0] ?? null
}

export function supportContactFromOnboardingRow(onboarding: {
  draft_state?: unknown
  account_settings?: unknown
} | null | undefined): {
  accountSetupEmail: string | null
  organizationSupportEmail: string | null
} {
  const draft =
    onboarding?.draft_state && typeof onboarding.draft_state === "object"
      ? (onboarding.draft_state as Record<string, unknown>)
      : {}
  const account = (draft.accountSetup ?? {}) as Record<string, unknown>
  const settings =
    onboarding?.account_settings && typeof onboarding.account_settings === "object"
      ? (onboarding.account_settings as Record<string, unknown>)
      : {}
  const org = {
    ...((draft.organizationSettings ?? {}) as Record<string, unknown>),
    ...((settings.organization ?? {}) as Record<string, unknown>),
  }
  return {
    accountSetupEmail: typeof account.email === "string" ? account.email : null,
    organizationSupportEmail:
      typeof org.supportEmail === "string" ? org.supportEmail : null,
  }
}

export async function loadLandlordSupportContact(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<{
  accountSetupEmail: string | null
  organizationSupportEmail: string | null
  landlordEmail: string | null
}> {
  const id = landlordId.trim()
  const { data: landlord } = await supabase
    .from("landlords")
    .select("email")
    .eq("id", id)
    .maybeSingle()

  let onboarding: { draft_state?: unknown; account_settings?: unknown } | null =
    null
  const withSettings = await supabase
    .from("landlord_onboarding")
    .select("draft_state, account_settings")
    .eq("landlord_id", id)
    .maybeSingle()
  if (withSettings.error) {
    const draftOnly = await supabase
      .from("landlord_onboarding")
      .select("draft_state")
      .eq("landlord_id", id)
      .maybeSingle()
    onboarding = draftOnly.data
  } else {
    onboarding = withSettings.data
  }

  const fromOnboarding = supportContactFromOnboardingRow(onboarding)
  return {
    ...fromOnboarding,
    landlordEmail: typeof landlord?.email === "string" ? landlord.email : null,
  }
}

/** Parse comma/space/semicolon-separated env email lists. */
export function parseOpsEmailList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[,;\s]+/)) {
    const n = normalizeOpsEmail(part)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

export function adminNotifyEmailsFromEnv(): string[] {
  return parseOpsEmailList(Deno.env.get("SMS_ADMIN_NOTIFY_EMAILS"))
}

export function escalationNotifyEmailsFromEnv(): string[] {
  const raw =
    Deno.env.get("WORKFLOW_ESCALATION_NOTIFY_EMAILS")?.trim() ||
    Deno.env.get("SMS_ADMIN_NOTIFY_EMAILS")?.trim() ||
    ""
  const parsed = parseOpsEmailList(raw)
  if (parsed.length > 0) return parsed
  // Bootstrap fallback for Ulo ops only — still filtered against vendors at send.
  return ["emeka@ulohome.io", "osi@ulohome.io"]
}

/**
 * Pure filter: drop any candidate that matches a vendor email (case-insensitive).
 */
export function filterVendorEmailsFromOpsRecipients(
  candidates: Iterable<string>,
  vendorEmails: Iterable<string>,
): { allowed: string[]; blocked: string[] } {
  const blockedSet = new Set<string>()
  for (const v of vendorEmails) {
    const n = normalizeOpsEmail(v)
    if (n) blockedSet.add(n)
  }
  const allowed: string[] = []
  const blocked: string[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    const n = normalizeOpsEmail(typeof c === "string" ? c : "")
    if (!n || seen.has(n)) continue
    seen.add(n)
    if (blockedSet.has(n)) {
      blocked.push(n)
      continue
    }
    allowed.push(n)
  }
  return { allowed, blocked }
}

async function loadVendorEmailsForLandlord(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string[]> {
  const id = landlordId.trim()
  if (!id) return []
  const { data, error } = await supabase
    .from("vendors")
    .select("email")
    .eq("landlord_id", id)
    .not("email", "is", null)
    .limit(2000)
  if (error) {
    console.error("[landlord-ops-notify] vendor email lookup", error.message)
    return []
  }
  const out: string[] = []
  for (const row of data ?? []) {
    const n = normalizeOpsEmail(
      typeof row.email === "string" ? row.email : "",
    )
    if (n) out.push(n)
  }
  return out
}

/**
 * Resolve landlord-ops recipients.
 *
 * Default: env notify list (`SMS_ADMIN_NOTIFY_EMAILS`) + organization
 * support email (onboarding / Settings) + `landlords.email`, minus vendor emails.
 *
 * `accountHolderOnly: true` — only the landlord support / account emails
 * (+ optional extras). Use for Needs Your Attention and other account-facing
 * alerts; do not CC Ulo staff env lists.
 */
export async function resolveLandlordOpsEmails(
  supabase: SupabaseClient,
  landlordId: string,
  options?: {
    extraEmails?: string[]
    excludeEmails?: string[]
    /** Override env list (tests). */
    envEmails?: string[]
    /**
     * When true, skip `SMS_ADMIN_NOTIFY_EMAILS` and send only to the
     * landlord account email (+ extraEmails).
     */
    accountHolderOnly?: boolean
    logLabel?: string
  },
): Promise<{ emails: string[]; blocked: string[] }> {
  const candidates = new Set<string>()
  if (!options?.accountHolderOnly) {
    for (const e of options?.envEmails ?? adminNotifyEmailsFromEnv()) {
      candidates.add(e)
    }
  }
  for (const e of options?.extraEmails ?? []) {
    const n = normalizeOpsEmail(e)
    if (n) candidates.add(n)
  }

  const contact = await loadLandlordSupportContact(supabase, landlordId)
  const supportEmail = primaryLandlordSupportEmail(contact)
  if (supportEmail) candidates.add(supportEmail)

  const vendorEmails = await loadVendorEmailsForLandlord(supabase, landlordId)
  for (const e of options?.excludeEmails ?? []) {
    const n = normalizeOpsEmail(e)
    if (n) vendorEmails.push(n)
  }

  const { allowed, blocked } = filterVendorEmailsFromOpsRecipients(
    candidates,
    vendorEmails,
  )

  if (blocked.length > 0) {
    console.warn("[landlord-ops-notify] blocked vendor emails", {
      label: options?.logLabel ?? "ops",
      landlordId,
      blocked,
    })
  }
  if (allowed.length === 0) {
    console.warn("[landlord-ops-notify] no recipients after vendor filter", {
      label: options?.logLabel ?? "ops",
      landlordId,
    })
  }

  return { emails: allowed, blocked }
}

export type LandlordOpsEmailResult = {
  sent: string[]
  blocked: string[]
  errors: string[]
}

/**
 * Send privileged landlord/ops email. Vendor addresses are never recipients.
 * Pass `accountHolderOnly: true` for Needs Your Attention (account email only).
 */
export async function sendLandlordOpsEmail(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    subject: string
    text: string
    html: string
    extraEmails?: string[]
    excludeEmails?: string[]
    envEmails?: string[]
    accountHolderOnly?: boolean
    logLabel?: string
  },
): Promise<LandlordOpsEmailResult> {
  const { emails, blocked } = await resolveLandlordOpsEmails(
    supabase,
    params.landlordId,
    {
      extraEmails: params.extraEmails,
      excludeEmails: params.excludeEmails,
      envEmails: params.envEmails,
      accountHolderOnly: params.accountHolderOnly,
      logLabel: params.logLabel,
    },
  )

  const sent: string[] = []
  const errors: string[] = []
  for (const email of emails) {
    const result = await sendResendEmail(
      email,
      params.subject,
      params.text,
      params.html,
    )
    if ("error" in result) {
      errors.push(`${email}: ${result.error}`)
      console.error(
        "[landlord-ops-notify] send failed",
        params.logLabel ?? "ops",
        email,
        result.error,
      )
    } else {
      sent.push(email)
    }
  }

  return { sent, blocked, errors }
}
