import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  classifyIssueForSla,
  severityFromResidentPriority,
} from "../_shared/classify_issue_sla.ts"
import { getEstimatedMinutes } from "../_shared/sla_rules.ts"
import { notifyResidentSubmitted } from "./resident_notify.ts"
import { assignVendorAndNotify } from "./vendor_notify.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function textField(form: FormData, key: string): string | null {
  const v = form.get(key)
  return typeof v === "string" ? v.trim() || null : null
}

function bearerFromAuthHeader(v: string | null): string | null {
  if (!v) return null
  const m = v.trim().match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() || null
}

/** Email comparison: trim + lowercase (case-insensitive matching). */
function normalizeEmail(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase()
}

/**
 * Unit comparison: ignore case, "unit"/"apt" labels, #, spaces, and punctuation.
 * e.g. "Unit 5A" → "5a", "#5-A" → "5a"
 */
function normalizeUnitForMatch(v: string | null | undefined): string {
  let s = (v ?? "").trim().toLowerCase()
  s = s.replace(/#/g, "")
  s = s.replace(/\b(unit|apt)\b/g, "")
  s = s.replace(/[^a-z0-9]/g, "")
  return s
}

/** Escape `%`, `_`, and `\` for use as a literal in Postgres `ILIKE`. */
function escapeIlikeLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

/** Multipart `issueCategory` from the client — only these values are honored. */
function normalizeFormIssueCategory(raw: string | null): string | null {
  if (!raw || typeof raw !== "string") return null
  const c = raw.trim().toLowerCase()
  if (c === "appliances") return "appliance"
  if (c === "plumbing" || c === "electrical" || c === "appliance") return c
  return null
}

/** Max active `public.users` rows scanned in-memory for unit-only matching (no normalized_unit column). */
const ACTIVE_USERS_SCAN_LIMIT = 2500

type ResidentLookupRow = {
  id: string
  email: string | null
  unit: string | null
  status: string
  supabase_user_id: string | null
}

function parseResidentNotificationChannel(form: FormData): string {
  const v = form.get("residentNotificationChannel")
  if (typeof v !== "string") return "both"
  const t = v.trim().toLowerCase()
  if (t === "email" || t === "sms" || t === "both") return t
  return "both"
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return jsonResponse({ error: "Expected multipart form data" }, 400)
  }

  // Form field remains `urgency` (resident UI); persisted as `priority` on maintenance_requests.
  const priority =
    textField(form, "urgency") ?? textField(form, "priority")
  const residentName = textField(form, "residentName")
  const email = textField(form, "email")
  const residentPhone = textField(form, "residentPhone")
  const unit = textField(form, "unit")
  const description = textField(form, "description")
  if (!priority || !residentName || !email || !unit || !description) {
    return jsonResponse(
      {
        error:
          "Missing required fields: urgency (or priority), residentName, email, unit, description",
      },
      400,
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const residentNotificationChannel = parseResidentNotificationChannel(form)
  const accessToken = bearerFromAuthHeader(req.headers.get("Authorization"))
  if (!accessToken) {
    return jsonResponse(
      { error: "Sign-in required. Please verify your resident email first." },
      401,
    )
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(
    accessToken,
  )
  const authUser = authData.user
  if (authError || !authUser) {
    return jsonResponse(
      { error: "Invalid session. Please verify your resident email again." },
      401,
    )
  }

  const normalizedFormEmail = normalizeEmail(email)
  const normalizedFormUnit = normalizeUnitForMatch(unit)
  const normalizedAuthEmail = normalizeEmail(authUser.email)
  if (!normalizedAuthEmail || normalizedAuthEmail !== normalizedFormEmail) {
    return jsonResponse(
      {
        error:
          "Signed-in email does not match this request. Use your resident email to continue.",
      },
      403,
    )
  }

  const { data: byEmailRaw, error: residentFetchError } = await supabase
    .from("users")
    .select("id, email, unit, status, supabase_user_id")
    .eq("status", "active")
    .ilike("email", escapeIlikeLiteral(normalizedFormEmail))
    .limit(50)

  if (residentFetchError) {
    console.error("[submit-maintenance-request] resident lookup failed", residentFetchError)
    return jsonResponse({ error: "Could not verify resident account." }, 500)
  }

  const byEmail = (byEmailRaw ?? []) as ResidentLookupRow[]

  const rowMatchesBoth = (row: ResidentLookupRow) =>
    normalizeEmail(row.email) === normalizedFormEmail &&
    normalizeUnitForMatch(row.unit) === normalizedFormUnit

  let residentRow = byEmail.find(rowMatchesBoth)

  if (!residentRow) {
    const { data: activeScanRaw, error: scanError } = await supabase
      .from("users")
      .select("id, email, unit, status, supabase_user_id")
      .eq("status", "active")
      .limit(ACTIVE_USERS_SCAN_LIMIT)

    if (scanError) {
      console.error("[submit-maintenance-request] active users scan failed", scanError)
      return jsonResponse({ error: "Could not verify resident account." }, 500)
    }

    const activeScan = (activeScanRaw ?? []) as ResidentLookupRow[]
    const mergedById = new Map<string, ResidentLookupRow>()
    for (const row of byEmail) mergedById.set(row.id, row)
    for (const row of activeScan) mergedById.set(row.id, row)
    const residentRows = [...mergedById.values()]

    residentRow = residentRows.find(rowMatchesBoth)

    if (!residentRow) {
      const emailMatches = residentRows.filter(
        (row) => normalizeEmail(row.email) === normalizedFormEmail,
      )
      const unitMatches = residentRows.filter(
        (row) => normalizeUnitForMatch(row.unit) === normalizedFormUnit,
      )

      const hasEmail = emailMatches.length > 0
      const hasUnit = unitMatches.length > 0

      let mismatchError: string
      if (!hasEmail && !hasUnit) {
        mismatchError = "No resident found with this email or unit."
      } else if (hasEmail && !hasUnit) {
        mismatchError =
          "This email is registered, but the unit does not match."
      } else if (!hasEmail && hasUnit) {
        mismatchError =
          "This unit exists, but the email does not match."
      } else {
        mismatchError =
          "Email and unit exist, but do not belong to the same resident."
      }

      return jsonResponse({ error: mismatchError }, 403)
    }
  }

  // Link or re-link roster row to this Auth user (same email + unit already verified above).
  if (residentRow.supabase_user_id !== authUser.id) {
    const previousAuthId = residentRow.supabase_user_id
    const isRelink = previousAuthId != null && previousAuthId !== authUser.id
    const { error: linkErr } = await supabase
      .from("users")
      .update({ supabase_user_id: authUser.id })
      .eq("id", residentRow.id)
    if (linkErr) {
      console.error("[submit-maintenance-request] resident link failed", linkErr)
      return jsonResponse({ error: "Could not link resident account." }, 500)
    }
    if (isRelink) {
      console.log(
        "[submit-maintenance-request] Resident re-linked to new auth user",
        { residentRowId: residentRow.id, previousAuthId, newAuthId: authUser.id },
      )
    }
  }

  const overrideCategory = normalizeFormIssueCategory(
    textField(form, "issueCategory"),
  )
  const slaClassification = overrideCategory
    ? {
      issue_category: overrideCategory,
      severity: severityFromResidentPriority(priority),
    }
    : await classifyIssueForSla(description, priority)
  const estimatedMinutes = getEstimatedMinutes(
    slaClassification.issue_category,
    slaClassification.severity,
  )
  const dueAt = new Date(Date.now() + estimatedMinutes * 60_000)

  const { data: row, error: insertError } = await supabase
    .from("maintenance_requests")
    .insert({
      priority,
      urgency: priority,
      resident_name: residentName,
      email,
      resident_phone: residentPhone ?? null,
      resident_notification_channel: residentNotificationChannel,
      unit,
      description,
      resident_user_id: authUser.id,
      photo_paths: [],
      issue_category: slaClassification.issue_category,
      severity: slaClassification.severity,
      estimated_minutes: estimatedMinutes,
      due_at: dueAt.toISOString(),
      vendor_work_status: "unassigned",
    })
    .select("id")
    .single()

  if (insertError || !row?.id) {
    const raw = insertError?.message ?? ""
    if (raw.includes("require_vendor_for_progress")) {
      console.error(
        "[submit-maintenance-request] require_vendor_for_progress: apply DB migrations (vendor_work_status default unassigned) and deploy this Edge Function so inserts set vendor_work_status to unassigned.",
        insertError,
      )
    } else {
      console.error(insertError)
    }
    return jsonResponse(
      {
        error:
          raw.includes("require_vendor_for_progress")
            ? "Could not save your request (server configuration). Please try again later or contact support."
            : raw || "Failed to create maintenance request",
      },
      500,
    )
  }

  const ticketId = row.id as string

  const paths: string[] = []
  const photoParts = form.getAll("photo")

  for (const part of photoParts) {
    if (!(part instanceof File) || part.size === 0) continue
    const safeName = part.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)
    const objectPath = `${ticketId}/${crypto.randomUUID()}-${safeName}`
    const bytes = new Uint8Array(await part.arrayBuffer())
    const { error: upErr } = await supabase.storage
      .from("maintenance-uploads")
      .upload(objectPath, bytes, {
        contentType: part.type || "application/octet-stream",
        upsert: false,
      })
    if (upErr) {
      console.error(upErr)
      continue
    }
    paths.push(objectPath)
  }

  if (paths.length > 0) {
    await supabase
      .from("maintenance_requests")
      .update({ photo_paths: paths })
      .eq("id", ticketId)
  }

  try {
    const descPrev =
      description.length > 200
        ? `${description.slice(0, 197)}…`
        : description
    await notifyResidentSubmitted(supabase, {
      ticketId,
      recipientName: residentName,
      recipientEmail: email,
      recipientPhone: residentPhone,
      notificationChannel: residentNotificationChannel,
      unit: unit ?? undefined,
      priority,
      descriptionPreview: descPrev,
    })
  } catch (e) {
    console.error("[submit-maintenance-request] resident notify failed", e)
  }

  try {
    await assignVendorAndNotify(supabase, {
      ticketId,
      priority,
      unit,
      description,
      dueAt: dueAt.toISOString(),
      estimatedMinutes,
    })
  } catch (e) {
    console.error("[submit-maintenance-request] vendor notify failed", e)
  }

  return jsonResponse({ id: ticketId, requestId: ticketId })
})
