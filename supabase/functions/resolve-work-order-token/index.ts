/**
 * Public resolve: vendor_action_token → full job detail for /w/:token (Phase 2 / 4.2).
 * No login required. Service-role lookup + signed photo URLs.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.1"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SIGNED_URL_TTL_SEC = 3600

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function formatWorkOrderRef(ticketId: string): string {
  const compact = ticketId.replace(/-/g, "").slice(0, 4).toUpperCase()
  return `WO-${compact || "0000"}`
}

async function photoSignedUrls(
  supabase: SupabaseClient,
  paths: unknown,
): Promise<string[]> {
  if (!Array.isArray(paths) || paths.length === 0) return []
  const urls: string[] = []
  for (const p of paths) {
    if (typeof p !== "string" || !p.trim()) continue
    const { data, error } = await supabase.storage
      .from("maintenance-uploads")
      .createSignedUrl(p.trim(), SIGNED_URL_TTL_SEC)
    if (error) {
      console.error("[resolve-work-order-token] signed url", p, error.message)
      continue
    }
    if (data?.signedUrl) urls.push(data.signedUrl)
  }
  return urls
}

function appBaseUrl(): string {
  const raw = Deno.env.get("APP_URL")?.trim() ?? ""
  if (!raw) return ""
  const t = raw.replace(/\/$/, "")
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  let body: { token?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const token = typeof body.token === "string" ? body.token.trim() : ""
  if (!token || !uuidRe.test(token)) {
    return jsonResponse({ error: "Invalid token" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: row, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, created_at, landlord_id, priority, urgency, unit, description, photo_paths, completion_photo_paths, resident_name, resident_phone, email, issue_category, vendor_work_status, assigned_vendor_id, vendor_action_token, scheduled_at, scheduled_window_text, schedule_confirmed_at, access_instructions, due_at",
    )
    .eq("vendor_action_token", token)
    .maybeSingle()

  if (error) {
    console.error("[resolve-work-order-token] lookup", error.message)
    return jsonResponse({ error: "Lookup failed" }, 500)
  }

  if (!row?.id) {
    return jsonResponse({ error: "Job not found" }, 404)
  }

  const ticketId = row.id as string
  const landlordId =
    typeof row.landlord_id === "string" ? row.landlord_id : null

  const { data: enriched } = await supabase
    .from("maintenance_request_enriched")
    .select("building, property_id, unit, unit_id")
    .eq("id", ticketId)
    .maybeSingle()

  const building =
    typeof enriched?.building === "string" && enriched.building.trim()
      ? enriched.building.trim()
      : null
  const unitLabel =
    (typeof row.unit === "string" && row.unit.trim()) ||
    (typeof enriched?.unit === "string" && enriched.unit.trim()) ||
    "Unit"

  let streetAddress: string | null = null
  let city: string | null = null
  let state: string | null = null
  let zipCode: string | null = null

  if (landlordId) {
    const unitId =
      typeof enriched?.unit_id === "string" && enriched.unit_id.trim()
        ? enriched.unit_id.trim()
        : null
    if (unitId) {
      const { data: unitRow } = await supabase
        .from("units")
        .select("city, state, zip_code, building")
        .eq("id", unitId)
        .maybeSingle()
      if (unitRow) {
        city =
          typeof unitRow.city === "string" && unitRow.city.trim()
            ? unitRow.city.trim()
            : null
        state =
          typeof unitRow.state === "string" && unitRow.state.trim()
            ? unitRow.state.trim()
            : null
        zipCode =
          typeof unitRow.zip_code === "string" && unitRow.zip_code.trim()
            ? unitRow.zip_code.trim()
            : null
      }
    } else if (building) {
      const { data: unitRow } = await supabase
        .from("units")
        .select("city, state, zip_code")
        .eq("landlord_id", landlordId)
        .eq("building", building)
        .limit(1)
        .maybeSingle()
      if (unitRow) {
        city =
          typeof unitRow.city === "string" && unitRow.city.trim()
            ? unitRow.city.trim()
            : null
        state =
          typeof unitRow.state === "string" && unitRow.state.trim()
            ? unitRow.state.trim()
            : null
        zipCode =
          typeof unitRow.zip_code === "string" && unitRow.zip_code.trim()
            ? unitRow.zip_code.trim()
            : null
      }
    }

    // Street address lives on onboarding properties (matched by building name).
    const { data: onboarding } = await supabase
      .from("landlord_onboarding")
      .select("properties")
      .eq("landlord_id", landlordId)
      .maybeSingle()
    const props = Array.isArray(onboarding?.properties)
      ? (onboarding!.properties as Record<string, unknown>[])
      : []
    const buildingLc = (building ?? "").toLowerCase()
    const match = props.find((p) => {
      const name = typeof p.name === "string" ? p.name.trim().toLowerCase() : ""
      return Boolean(buildingLc && name && name === buildingLc)
    })
    if (match) {
      const street =
        typeof match.streetAddress === "string"
          ? match.streetAddress.trim()
          : typeof match.address === "string"
          ? match.address.trim()
          : ""
      if (street) streetAddress = street
      if (typeof match.city === "string" && match.city.trim()) {
        city = match.city.trim()
      }
      if (typeof match.state === "string" && match.state.trim()) {
        state = match.state.trim()
      }
      if (typeof match.zipCode === "string" && match.zipCode.trim()) {
        zipCode = match.zipCode.trim()
      } else if (typeof match.zip_code === "string" && match.zip_code.trim()) {
        zipCode = match.zip_code.trim()
      }
    }
  }

  const cityStateZip = [city, state].filter(Boolean).join(", ")
  const cityStateZipLine = [cityStateZip, zipCode].filter(Boolean).join(" ")
  const addressLine = [streetAddress, cityStateZipLine].filter(Boolean).join(", ")
    || (building ? `${building}, ${unitLabel}` : unitLabel)

  let vendorName: string | null = null
  let portalApiKey: string | null = null
  if (typeof row.assigned_vendor_id === "string" && row.assigned_vendor_id) {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("name, portal_api_key")
      .eq("id", row.assigned_vendor_id)
      .maybeSingle()
    if (typeof vendor?.name === "string" && vendor.name.trim()) {
      vendorName = vendor.name.trim()
    }
    if (typeof vendor?.portal_api_key === "string" && vendor.portal_api_key.trim()) {
      portalApiKey = vendor.portal_api_key.trim()
    }
  }

  const photoUrls = await photoSignedUrls(supabase, row.photo_paths)

  type HistoryItem = {
    ticketId: string
    workOrderRef: string
    unit: string
    description: string
    status: string
    createdAt: string
  }
  const propertyHistory: HistoryItem[] = []
  const propertyId =
    typeof enriched?.property_id === "string" ? enriched.property_id : null

  if (landlordId && propertyId) {
    const { data: siblings } = await supabase
      .from("maintenance_request_enriched")
      .select("id, unit, description, vendor_work_status, created_at, property_id")
      .eq("landlord_id", landlordId)
      .eq("property_id", propertyId)
      .neq("id", ticketId)
      .order("created_at", { ascending: false })
      .limit(8)

    for (const s of siblings ?? []) {
      if (typeof s.id !== "string") continue
      propertyHistory.push({
        ticketId: s.id,
        workOrderRef: formatWorkOrderRef(s.id),
        unit: typeof s.unit === "string" ? s.unit : "",
        description:
          typeof s.description === "string"
            ? s.description.replace(/\s+/g, " ").slice(0, 120)
            : "",
        status:
          typeof s.vendor_work_status === "string"
            ? s.vendor_work_status
            : "unknown",
        createdAt:
          typeof s.created_at === "string" ? s.created_at : new Date().toISOString(),
      })
    }
  } else if (landlordId && typeof row.unit === "string" && row.unit.trim()) {
    const { data: siblings } = await supabase
      .from("maintenance_requests")
      .select("id, unit, description, vendor_work_status, created_at")
      .eq("landlord_id", landlordId)
      .ilike("unit", row.unit.trim())
      .neq("id", ticketId)
      .order("created_at", { ascending: false })
      .limit(8)

    for (const s of siblings ?? []) {
      if (typeof s.id !== "string") continue
      propertyHistory.push({
        ticketId: s.id,
        workOrderRef: formatWorkOrderRef(s.id),
        unit: typeof s.unit === "string" ? s.unit : "",
        description:
          typeof s.description === "string"
            ? s.description.replace(/\s+/g, " ").slice(0, 120)
            : "",
        status:
          typeof s.vendor_work_status === "string"
            ? s.vendor_work_status
            : "unknown",
        createdAt:
          typeof s.created_at === "string" ? s.created_at : new Date().toISOString(),
      })
    }
  }

  // Latest non-superseded estimate drives action gating on /w/:token.
  // Best-effort: never fail the public job page if estimates aren't available yet.
  let estimateStatus: string | null = null
  try {
    const { data: estimateRow, error: estimateError } = await supabase
      .from("maintenance_estimates")
      .select("status")
      .eq("maintenance_request_id", ticketId)
      .neq("status", "superseded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (estimateError) {
      console.error(
        "[resolve-work-order-token] estimate lookup",
        estimateError.message,
      )
    } else if (typeof estimateRow?.status === "string") {
      estimateStatus = estimateRow.status
    }
  } catch (err) {
    console.error("[resolve-work-order-token] estimate lookup threw", err)
  }
  const estimateSubmitted =
    estimateStatus === "pending_approval" || estimateStatus === "approved"
  const estimateApproved = estimateStatus === "approved"

  const completionPhotoPaths = Array.isArray(row.completion_photo_paths)
    ? (row.completion_photo_paths as unknown[]).filter(
      (p): p is string => typeof p === "string" && p.trim().length > 0,
    )
    : []
  const completionPhotosUploaded = completionPhotoPaths.length > 0

  const base = appBaseUrl()
  const tokenEnc = encodeURIComponent(token)
  const links = {
    estimate: base ? `${base}/estimate/${tokenEnc}` : `/estimate/${tokenEnc}`,
    upload: base ? `${base}/upload/${tokenEnc}` : `/upload/${tokenEnc}`,
    invoice: base ? `${base}/invoice/${tokenEnc}` : `/invoice/${tokenEnc}`,
    portal: `/vendor/ticket/${ticketId}`,
  }

  const accessRaw =
    typeof row.access_instructions === "string"
      ? row.access_instructions.trim()
      : ""

  return jsonResponse({
    ok: true,
    ticketId,
    workOrderRef: formatWorkOrderRef(ticketId),
    portalPath: links.portal,
    portalApiKey,
    job: {
      address: addressLine,
      streetAddress,
      city,
      state,
      zipCode,
      building,
      unit: unitLabel,
      issueCategory:
        typeof row.issue_category === "string" ? row.issue_category : null,
      description:
        typeof row.description === "string" ? row.description : "",
      priority:
        (typeof row.priority === "string" && row.priority) ||
        (typeof row.urgency === "string" && row.urgency) ||
        null,
      status:
        typeof row.vendor_work_status === "string"
          ? row.vendor_work_status
          : null,
      createdAt:
        typeof row.created_at === "string" ? row.created_at : null,
      dueAt: typeof row.due_at === "string" ? row.due_at : null,
      photoUrls,
      accessInstructions: accessRaw || null,
      accessInstructionsFallback:
        "Contact the property team if you need entry instructions for this unit.",
      tenant: {
        name:
          typeof row.resident_name === "string" && row.resident_name.trim()
            ? row.resident_name.trim()
            : "Resident",
        phone:
          typeof row.resident_phone === "string" && row.resident_phone.trim()
            ? row.resident_phone.trim()
            : null,
        // Email omitted from public page for privacy; phone is enough for visit.
      },
      appointment: {
        windowText:
          typeof row.scheduled_window_text === "string" &&
            row.scheduled_window_text.trim()
            ? row.scheduled_window_text.trim()
            : null,
        scheduledAt:
          typeof row.scheduled_at === "string" ? row.scheduled_at : null,
        confirmedAt:
          typeof row.schedule_confirmed_at === "string"
            ? row.schedule_confirmed_at
            : null,
      },
      vendorName,
      propertyHistory,
      links,
      estimateStatus,
      estimateSubmitted,
      estimateApproved,
      completionPhotosUploaded,
    },
  })
})
