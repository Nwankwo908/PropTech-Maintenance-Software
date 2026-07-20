/**
 * Vendor completion photos + job close (Phase 4 / 4.4).
 * Min 1 completion photo required. Landlord gets photo receipt + 1-tap star rating.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "./delivery.ts"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import { sendOutboundSms } from "./sms/adapters.ts"
import { resolveLandlordId } from "./sms/landlordSmsOnboarding.ts"
import { normalizePhoneFlexible } from "./resident_notify.ts"
import { sendVendorJobAlert } from "./sms/vendorSmsRouting.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"
import { requestVendorFeedback } from "./vendor_feedback.ts"
import {
  notifyResidentCompleted,
} from "../submit-maintenance-request/resident_notify.ts"

const MAX_PHOTOS = 12
const MAX_BYTES = 12 * 1024 * 1024

function appBaseUrl(): string {
  const raw = Deno.env.get("APP_URL")?.trim() ?? ""
  if (!raw) return ""
  const t = raw.replace(/\/$/, "")
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

function rateFnBase(): string {
  const explicit = Deno.env.get("LANDLORD_RATE_VENDOR_FN_URL")?.trim()?.replace(
    /\/$/,
    "",
  )
  if (explicit) return explicit
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()?.replace(/\/$/, "") ?? ""
  if (!supabaseUrl) return ""
  return `${supabaseUrl}/functions/v1/landlord-rate-vendor`
}

function adminNotifyEmails(): string[] {
  const raw = Deno.env.get("SMS_ADMIN_NOTIFY_EMAILS")?.trim()
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((e: string) => e.trim())
    .filter((e: string) => e.includes("@"))
}

function adminNotifyPhones(): string[] {
  const raw =
    Deno.env.get("SMS_ADMIN_NOTIFY_PHONES")?.trim() ||
    Deno.env.get("LANDLORD_OPS_PHONE")?.trim() ||
    ""
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((p: string) => normalizePhoneFlexible(p))
    .filter((p): p is string => Boolean(p))
}

function extFromContentType(ct: string): string {
  const c = ct.toLowerCase()
  if (c.includes("png")) return "png"
  if (c.includes("webp")) return "webp"
  if (c.includes("heic") || c.includes("heif")) return "heic"
  if (c.includes("jpeg") || c.includes("jpg")) return "jpg"
  return "jpg"
}

export type CompletionPhotoInput = {
  bytes: Uint8Array
  contentType: string
  fileName?: string
}

export async function loadCompletionContextForJobToken(
  supabase: SupabaseClient,
  jobToken: string,
): Promise<
  | {
      ok: true
      ticketId: string
      vendorId: string
      workOrderRef: string
      unit: string
      description: string
      vendorWorkStatus: string
      completionPhotoCount: number
      completionPhotoUrls: string[]
      canComplete: boolean
      alreadyCompleted: boolean
    }
  | { ok: false; error: string; status: number }
> {
  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, unit, description, assigned_vendor_id, vendor_work_status, completion_photo_paths, vendor_action_token",
    )
    .eq("vendor_action_token", jobToken)
    .maybeSingle()

  if (error || !ticket?.id) {
    return { ok: false, error: "Job not found", status: 404 }
  }
  if (typeof ticket.assigned_vendor_id !== "string" || !ticket.assigned_vendor_id) {
    return { ok: false, error: "No vendor assigned to this job", status: 400 }
  }

  const paths = Array.isArray(ticket.completion_photo_paths)
    ? (ticket.completion_photo_paths as string[]).filter(
        (p): p is string => typeof p === "string" && p.trim().length > 0,
      )
    : []

  const urls: string[] = []
  for (const path of paths.slice(0, MAX_PHOTOS)) {
    const { data } = await supabase.storage
      .from("maintenance-uploads")
      .createSignedUrl(path, 60 * 60)
    if (data?.signedUrl) urls.push(data.signedUrl)
  }

  const status = String(ticket.vendor_work_status ?? "")
  const alreadyCompleted = status === "completed"
  const canComplete =
    !alreadyCompleted &&
    (status === "accepted" || status === "in_progress") &&
    paths.length >= 1

  return {
    ok: true,
    ticketId: ticket.id as string,
    vendorId: ticket.assigned_vendor_id,
    workOrderRef: formatWorkOrderRef(ticket.id as string),
    unit: typeof ticket.unit === "string" ? ticket.unit : "",
    description: typeof ticket.description === "string" ? ticket.description : "",
    vendorWorkStatus: status,
    completionPhotoCount: paths.length,
    completionPhotoUrls: urls,
    canComplete,
    alreadyCompleted,
  }
}

export async function uploadCompletionPhotos(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    photos: CompletionPhotoInput[]
  },
): Promise<
  | { ok: true; added: number; completionPhotoCount: number }
  | { ok: false; error: string; status?: number }
> {
  if (!params.photos.length) {
    return { ok: false, error: "Add at least one photo", status: 400 }
  }

  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, assigned_vendor_id, vendor_work_status, completion_photo_paths, landlord_id",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (error || !ticket) {
    return { ok: false, error: "Job not found", status: 404 }
  }
  if (ticket.assigned_vendor_id !== params.vendorId) {
    return { ok: false, error: "This job is not assigned to your company", status: 403 }
  }

  const status = String(ticket.vendor_work_status ?? "")
  if (status === "completed") {
    return { ok: false, error: "This job is already complete", status: 409 }
  }
  if (status !== "accepted" && status !== "in_progress" && status !== "pending_accept") {
    return {
      ok: false,
      error: "Photos can be uploaded after the job is accepted",
      status: 409,
    }
  }

  const existing = Array.isArray(ticket.completion_photo_paths)
    ? (ticket.completion_photo_paths as string[]).filter(
        (p): p is string => typeof p === "string" && p.trim().length > 0,
      )
    : []

  if (existing.length >= MAX_PHOTOS) {
    return { ok: false, error: `At most ${MAX_PHOTOS} completion photos`, status: 400 }
  }

  const addedPaths: string[] = []
  for (const photo of params.photos) {
    if (existing.length + addedPaths.length >= MAX_PHOTOS) break
    if (!photo.bytes.length || photo.bytes.length > MAX_BYTES) continue
    const ct = photo.contentType?.trim() || "image/jpeg"
    if (!ct.startsWith("image/")) continue
    const ext = extFromContentType(ct)
    const safe =
      (photo.fileName ?? `photo.${ext}`)
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 80) || `photo.${ext}`
    const objectPath = `${params.ticketId}/completion/${crypto.randomUUID()}-${safe}`
    const { error: upErr } = await supabase.storage
      .from("maintenance-uploads")
      .upload(objectPath, photo.bytes, {
        contentType: ct,
        upsert: false,
      })
    if (upErr) {
      console.error("[maintenance-completion] upload", upErr.message)
      continue
    }
    addedPaths.push(objectPath)
  }

  if (!addedPaths.length) {
    return {
      ok: false,
      error: "Could not save photos. Use JPG or PNG under 12MB.",
      status: 400,
    }
  }

  const next = [...existing, ...addedPaths]
  const { error: upRowErr } = await supabase
    .from("maintenance_requests")
    .update({ completion_photo_paths: next })
    .eq("id", params.ticketId)

  if (upRowErr) {
    console.error("[maintenance-completion] paths update", upRowErr.message)
    return { ok: false, error: "Could not save photo references", status: 500 }
  }

  const landlordId =
    (typeof ticket.landlord_id === "string" && ticket.landlord_id.trim()) ||
    resolveLandlordId()

  try {
    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "maintenance.completion_photos_uploaded",
      source: "edge_function",
      actor_type: "vendor",
      actor_id: params.vendorId,
      vendor_id: params.vendorId,
      maintenance_request_id: params.ticketId,
      metadata: {
        added: addedPaths.length,
        total: next.length,
      },
    })
  } catch (e) {
    console.error("[maintenance-completion] graph upload", e)
  }

  return { ok: true, added: addedPaths.length, completionPhotoCount: next.length }
}

export async function notifyLandlordJobCompleted(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    jobToken: string
    unit: string
    vendorName: string
    photoCount: number
  },
): Promise<void> {
  const wo = formatWorkOrderRef(params.ticketId)
  const rateBase = rateFnBase()
  const jobUrl = (() => {
    const base = appBaseUrl()
    return base
      ? `${base}/w/${encodeURIComponent(params.jobToken)}`
      : null
  })()

  const starLinks = rateBase
    ? [1, 2, 3, 4, 5]
        .map(
          (n) =>
            `${n}: ${rateBase}?rating=${n}&ticketId=${encodeURIComponent(params.ticketId)}&token=${encodeURIComponent(params.jobToken)}`,
        )
        .join("\n")
    : null

  const photoBit =
    params.photoCount === 1
      ? "1 completion photo"
      : `${params.photoCount} completion photos`

  const smsLines = [
    `${wo} (${params.unit || "unit"}) is complete.`,
    `${params.vendorName} uploaded ${photoBit}.`,
    jobUrl ? `Job: ${jobUrl}` : null,
    starLinks
      ? `Rate the vendor (1–5):\n${starLinks}`
      : "Reply in the admin dashboard if you want to follow up.",
  ].filter(Boolean) as string[]

  const smsBody = smsLines.join("\n")

  for (const phone of adminNotifyPhones()) {
    try {
      await sendOutboundSms(phone, smsBody)
    } catch (e) {
      console.error("[maintenance-completion] landlord SMS", e)
    }
  }

  const emails = adminNotifyEmails()
  let landlordEmail: string | null = null
  const { data: landlord } = await supabase
    .from("landlords")
    .select("email")
    .eq("id", params.landlordId)
    .maybeSingle()
  if (typeof landlord?.email === "string" && landlord.email.includes("@")) {
    landlordEmail = landlord.email.trim()
  }
  const allEmails = [...new Set([...emails, ...(landlordEmail ? [landlordEmail] : [])])]

  if (allEmails.length) {
    const starHtml = rateBase
      ? `<p>Rate the vendor:</p><p>${[1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<a href="${rateBase}?rating=${n}&ticketId=${encodeURIComponent(params.ticketId)}&token=${encodeURIComponent(params.jobToken)}" style="margin-right:8px;">${n}</a>`,
          )
          .join("")}</p>`
      : ""
    const text =
      `${wo} (${params.unit || "unit"}) is complete.\n` +
      `${params.vendorName} uploaded ${photoBit}.\n` +
      (jobUrl ? `Job: ${jobUrl}\n` : "") +
      (starLinks ? `\nRate the vendor (1–5):\n${starLinks}\n` : "")
    const html = `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#101828;">
  <p><strong>${wo}</strong> (${params.unit || "unit"}) is complete.</p>
  <p>${params.vendorName} uploaded ${photoBit}.</p>
  ${jobUrl ? `<p><a href="${jobUrl}">View job</a></p>` : ""}
  ${starHtml}
</body></html>`
    for (const to of allEmails) {
      try {
        await sendResendEmail(
          to,
          `${wo} complete — rate the vendor`,
          text,
          html,
        )
      } catch (e) {
        console.error("[maintenance-completion] landlord email", e)
      }
    }
  }

  // Track open landlord rating request (1-tap completes it; no SMS inbound needed).
  const { data: existing } = await supabase
    .from("vendor_feedback_requests")
    .select("id, status")
    .eq("maintenance_request_id", params.ticketId)
    .eq("rater_type", "landlord")
    .maybeSingle()

  if (!existing) {
    const { data: ticketVendor } = await supabase
      .from("maintenance_requests")
      .select("assigned_vendor_id")
      .eq("id", params.ticketId)
      .maybeSingle()
    const vendorId =
      typeof ticketVendor?.assigned_vendor_id === "string"
        ? ticketVendor.assigned_vendor_id
        : null
    if (vendorId) {
      await supabase.from("vendor_feedback_requests").insert({
        landlord_id: params.landlordId,
        vendor_id: vendorId,
        maintenance_request_id: params.ticketId,
        rater_type: "landlord",
        phase: "rating",
        status: "open",
      })
    }
  } else if (existing.status !== "open") {
    await supabase
      .from("vendor_feedback_requests")
      .update({ status: "open", phase: "rating", completed_at: null })
      .eq("id", existing.id)
  }

  try {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "maintenance.completion_landlord_notified",
      source: "edge_function",
      actor_type: "system",
      maintenance_request_id: params.ticketId,
      metadata: {
        photo_count: params.photoCount,
        sms_targets: adminNotifyPhones().length,
        email_targets: allEmails.length,
      },
    })
  } catch (e) {
    console.error("[maintenance-completion] graph landlord notify", e)
  }
}

export async function completeJobWithPhotos(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    jobToken: string
  },
): Promise<
  | { ok: true; message: string; photoCount: number }
  | { ok: false; error: string; status?: number }
> {
  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, unit, resident_name, email, resident_phone, priority, resident_notification_channel, assigned_vendor_id, vendor_work_status, completion_photo_paths, vendor_action_token",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (error || !ticket) {
    return { ok: false, error: "Job not found", status: 404 }
  }
  if (ticket.assigned_vendor_id !== params.vendorId) {
    return { ok: false, error: "This job is not assigned to your company", status: 403 }
  }
  if (
    typeof ticket.vendor_action_token === "string" &&
    ticket.vendor_action_token !== params.jobToken
  ) {
    return { ok: false, error: "Invalid job token", status: 403 }
  }

  const status = String(ticket.vendor_work_status ?? "")
  if (status === "completed") {
    return { ok: false, error: "This job is already complete", status: 409 }
  }
  if (status !== "accepted" && status !== "in_progress") {
    return {
      ok: false,
      error: "Mark the job accepted (or in progress) before completing",
      status: 409,
    }
  }

  const paths = Array.isArray(ticket.completion_photo_paths)
    ? (ticket.completion_photo_paths as string[]).filter(
        (p): p is string => typeof p === "string" && p.trim().length > 0,
      )
    : []

  if (paths.length < 1) {
    return {
      ok: false,
      error: "Upload at least one before/after photo before closing the job",
      status: 422,
    }
  }

  const { error: upErr } = await supabase
    .from("maintenance_requests")
    .update({ vendor_work_status: "completed" })
    .eq("id", params.ticketId)
    .eq("assigned_vendor_id", params.vendorId)

  if (upErr) {
    console.error("[maintenance-completion] complete update", upErr.message)
    return { ok: false, error: "Could not complete job", status: 500 }
  }

  try {
    const { markMaintenanceJobCompleted } = await import("./maintenanceSpend.ts")
    await markMaintenanceJobCompleted(supabase, params.ticketId)
  } catch (e) {
    console.error("[maintenance-completion] mark completed", e)
  }

  await supabase.from("vendor_status_events").insert({
    ticket_id: params.ticketId,
    from_status: status,
    to_status: "completed",
    source: "email_link",
    vendor_id: params.vendorId,
  })

  const landlordId =
    (typeof ticket.landlord_id === "string" && ticket.landlord_id.trim()) ||
    resolveLandlordId()

  const { data: vendor } = await supabase
    .from("vendors")
    .select("name")
    .eq("id", params.vendorId)
    .maybeSingle()
  const vendorName =
    typeof vendor?.name === "string" && vendor.name.trim()
      ? vendor.name.trim()
      : "Vendor"

  try {
    await notifyResidentCompleted(supabase, {
      ticketId: params.ticketId,
      recipientName: String(ticket.resident_name ?? ""),
      recipientEmail: typeof ticket.email === "string" ? ticket.email.trim() : "",
      recipientPhone:
        typeof ticket.resident_phone === "string" ? ticket.resident_phone : null,
      notificationChannel:
        typeof ticket.resident_notification_channel === "string"
          ? ticket.resident_notification_channel
          : null,
      unit: typeof ticket.unit === "string" ? ticket.unit : undefined,
      priority: typeof ticket.priority === "string" ? ticket.priority : undefined,
      vendorName,
      completionPhotoCount: paths.length,
    })
  } catch (e) {
    console.error("[maintenance-completion] resident notify", e)
  }

  try {
    const { data: enriched } = await supabase
      .from("maintenance_request_enriched")
      .select("resident_id")
      .eq("id", params.ticketId)
      .maybeSingle()
    await requestVendorFeedback(supabase, {
      ticketId: params.ticketId,
      landlordId,
      vendorId: params.vendorId,
      residentId:
        typeof enriched?.resident_id === "string" ? enriched.resident_id : null,
      residentPhone:
        typeof ticket.resident_phone === "string" ? ticket.resident_phone : null,
      residentName:
        typeof ticket.resident_name === "string" ? ticket.resident_name : null,
    })
  } catch (e) {
    console.error("[maintenance-completion] resident feedback", e)
  }

  try {
    await notifyLandlordJobCompleted(supabase, {
      landlordId,
      ticketId: params.ticketId,
      jobToken: params.jobToken,
      unit: typeof ticket.unit === "string" ? ticket.unit : "",
      vendorName,
      photoCount: paths.length,
    })
  } catch (e) {
    console.error("[maintenance-completion] landlord notify", e)
  }

  try {
    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "vendor.work_status_changed",
      source: "edge_function",
      actor_type: "vendor",
      actor_id: params.vendorId,
      vendor_id: params.vendorId,
      maintenance_request_id: params.ticketId,
      metadata: {
        action: "completed",
        from_status: status,
        to_status: "completed",
        auth_source: "upload_token",
        completion_photo_count: paths.length,
      },
    })
  } catch (e) {
    console.error("[maintenance-completion] graph complete", e)
  }

  return {
    ok: true,
    photoCount: paths.length,
    message:
      "Job marked complete. The resident and property team were notified with your photos.",
  }
}

/** SMS nudge when work starts — upload before/after photos to close. */
export async function sendCompletionUploadNudge(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    jobToken: string | null
  },
): Promise<void> {
  const { data: vendor } = await supabase
    .from("vendors")
    .select("phone")
    .eq("id", params.vendorId)
    .maybeSingle()
  const phone = typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
  if (!phone || !params.jobToken) return

  const base = appBaseUrl()
  const uploadUrl = base
    ? `${base}/upload/${encodeURIComponent(params.jobToken)}`
    : null
  if (!uploadUrl) return

  const wo = formatWorkOrderRef(params.ticketId)
  await sendVendorJobAlert(supabase, {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    vendorPhone: phone,
    body:
      `Job complete? Upload before/after photos for ${wo}, then mark it done:\n` +
      uploadUrl,
  })
}

export async function submitLandlordVendorRating(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    jobToken: string
    rating: number
  },
): Promise<
  | { ok: true; message: string }
  | { ok: false; error: string; status?: number }
> {
  if (!Number.isInteger(params.rating) || params.rating < 1 || params.rating > 5) {
    return { ok: false, error: "Rating must be 1–5", status: 400 }
  }

  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, vendor_action_token, vendor_work_status",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (error || !ticket) {
    return { ok: false, error: "Job not found", status: 404 }
  }
  if (ticket.vendor_action_token !== params.jobToken) {
    return { ok: false, error: "Invalid rating link", status: 403 }
  }
  if (String(ticket.vendor_work_status) !== "completed") {
    return { ok: false, error: "Rate after the job is complete", status: 409 }
  }
  if (typeof ticket.assigned_vendor_id !== "string" || !ticket.assigned_vendor_id) {
    return { ok: false, error: "No vendor on this job", status: 400 }
  }

  const landlordId =
    (typeof ticket.landlord_id === "string" && ticket.landlord_id.trim()) ||
    resolveLandlordId()

  const { data: existing } = await supabase
    .from("vendor_feedback")
    .select("id, rating")
    .eq("maintenance_request_id", params.ticketId)
    .eq("rater_type", "landlord")
    .maybeSingle()

  if (existing?.id) {
    return {
      ok: true,
      message: `Thanks — you already rated this job ${existing.rating}/5.`,
    }
  }

  const now = new Date().toISOString()
  const { data: feedback, error: insErr } = await supabase
    .from("vendor_feedback")
    .insert({
      landlord_id: landlordId,
      vendor_id: ticket.assigned_vendor_id,
      maintenance_request_id: params.ticketId,
      rater_type: "landlord",
      rating: params.rating,
      submitted_at: now,
    })
    .select("id")
    .single()

  if (insErr || !feedback?.id) {
    console.error("[maintenance-completion] landlord rating", insErr?.message)
    return { ok: false, error: "Could not save rating", status: 500 }
  }

  await supabase
    .from("vendor_feedback_requests")
    .update({
      status: "completed",
      completed_at: now,
      feedback_id: feedback.id,
      phase: "comment",
    })
    .eq("maintenance_request_id", params.ticketId)
    .eq("rater_type", "landlord")
    .eq("status", "open")

  try {
    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "vendor.landlord_feedback_submitted",
      source: "edge_function",
      actor_type: "landlord",
      vendor_id: ticket.assigned_vendor_id,
      maintenance_request_id: params.ticketId,
      metadata: {
        rating: params.rating,
        feedback_id: feedback.id,
      },
    })
  } catch (e) {
    console.error("[maintenance-completion] graph rating", e)
  }

  return {
    ok: true,
    message: `Thanks — you rated this vendor ${params.rating}/5.`,
  }
}
