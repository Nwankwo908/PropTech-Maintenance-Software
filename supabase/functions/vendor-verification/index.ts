import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../_shared/graph/logGraphEvent.ts"
import { normalizePhoneFlexible } from "../_shared/resident_notify.ts"
import {
  getBackgroundStatus,
  parseCoi,
  scanLicenseDocument,
  startBackgroundCheck,
  verifyLicense,
} from "../_shared/vendor_verification/adapters.ts"
import { computeVerificationChecklist } from "../_shared/vendor_verification/checklist.ts"
import { findLandlordVendorByContact } from "../_shared/vendor_verification/findVendor.ts"
import {
  logPipelineStageEvent,
  updateWorkflowRun,
} from "../_shared/engine/workflowRuns.ts"
import { appendVendorVerificationSubmittedToInbox } from "../_shared/sms/vendorVerificationInbox.ts"
import { sendVendorVerificationFollowUpSms } from "../_shared/sms/vendorVerificationFollowUp.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

type VerificationRow = {
  id: string
  landlord_id: string
  vendor_id: string | null
  token: string
  status: string
  business_name: string | null
  contact_name: string | null
  vendor_first_name: string | null
  email: string | null
  phone: string | null
  property_name: string | null
  license_state: string | null
  license_number: string | null
  license_type: string | null
  license_status: string | null
  coi_general_liability: number | null
  coi_expiration: string | null
  coi_additional_insured: boolean | null
  coi_status: string | null
  background_check_status: string | null
  background_check_ref: string | null
  w9_received: boolean | null
  trade_categories: string[] | null
  service_area: Record<string, unknown> | null
  availability: string | null
  progress: Record<string, unknown> | null
  expires_at: string | null
  workflow_run_id: string | null
  /** Present after migration 20260717180000; optional for older DBs. */
  invite_conversation_id?: string | null
}

const ROW_SELECT =
  "id, landlord_id, vendor_id, token, status, business_name, contact_name, vendor_first_name, email, phone, property_name, license_state, license_number, license_type, license_status, coi_general_liability, coi_expiration, coi_additional_insured, coi_status, background_check_status, background_check_ref, w9_received, trade_categories, service_area, availability, progress, expires_at, workflow_run_id"

/** Public-safe view of the verification record (no token / landlord_id). */
function sessionView(row: VerificationRow, documents: unknown[]) {
  const checklist = computeVerificationChecklist(row)
  return {
    status: row.status,
    businessName: row.business_name,
    contactName: row.contact_name,
    vendorFirstName: row.vendor_first_name,
    email: row.email,
    phone: row.phone,
    propertyName: row.property_name,
    license: {
      state: row.license_state,
      number: row.license_number,
      type: row.license_type,
      status: row.license_status,
    },
    insurance: {
      generalLiability: row.coi_general_liability,
      expiration: row.coi_expiration,
      additionalInsured: row.coi_additional_insured ?? false,
      status: row.coi_status,
    },
    backgroundCheck: {
      status: row.background_check_status,
      ref: row.background_check_ref,
    },
    w9Received: row.w9_received ?? false,
    tradeCategories: row.trade_categories ?? [],
    serviceArea: row.service_area ?? {},
    availability: row.availability ?? "active",
    progress: row.progress ?? {},
    documents,
    checklist,
  }
}

async function loadDocuments(supabase: SupabaseClient, verificationId: string) {
  const { data } = await supabase
    .from("vendor_documents")
    .select("id, kind, file_name, content_type, uploaded_at, parsed")
    .eq("verification_id", verificationId)
    .order("uploaded_at", { ascending: true })
  return (data ?? []).map((d) => ({
    id: d.id,
    kind: d.kind,
    fileName: d.file_name,
    contentType: d.content_type,
    uploadedAt: d.uploaded_at,
    parsed: d.parsed ?? {},
  }))
}

function decodeBase64(input: string): Uint8Array {
  const cleaned = input.includes(",") ? input.slice(input.indexOf(",") + 1) : input
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function extForContentType(contentType: string | null, fileName: string | null): string {
  const fromName = fileName?.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()
    : ""
  if (fromName) return fromName
  if (contentType?.includes("pdf")) return "pdf"
  if (contentType?.includes("png")) return "png"
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg"
  return "bin"
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const token = typeof body.token === "string" ? body.token.trim() : ""
  const action = typeof body.action === "string" ? body.action.trim() : ""
  if (!token) return jsonResponse({ error: "Missing token" }, 400)
  if (!action) return jsonResponse({ error: "Missing action" }, 400)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: rowRaw, error: loadErr } = await supabase
    .from("vendor_verifications")
    .select(ROW_SELECT)
    .eq("token", token)
    .maybeSingle()

  if (loadErr) {
    console.error("[vendor-verification] load", loadErr)
    return jsonResponse({ error: "Lookup failed" }, 500)
  }
  if (!rowRaw) {
    return jsonResponse({ error: "This link is not valid." }, 404)
  }

  const row = rowRaw as unknown as VerificationRow

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return jsonResponse({ error: "This link has expired." }, 410)
  }

  const landlordId = row.landlord_id

  async function reloadAndRespond(status = 200): Promise<Response> {
    const { data: fresh } = await supabase
      .from("vendor_verifications")
      .select(ROW_SELECT)
      .eq("id", row.id)
      .maybeSingle()
    const current = (fresh as unknown as VerificationRow) ?? row
    const documents = await loadDocuments(supabase, row.id)
    return jsonResponse({ ok: true, session: sessionView(current, documents) }, status)
  }

  try {
    switch (action) {
      case "resolve": {
        // First open flips invited -> in_progress.
        if (row.status === "invited") {
          await supabase
            .from("vendor_verifications")
            .update({ status: "in_progress" })
            .eq("id", row.id)
        }
        return await reloadAndRespond()
      }

      case "save": {
        const patch = (body.patch ?? {}) as Record<string, unknown>
        const update: Record<string, unknown> = {}
        if (typeof patch.businessName === "string") {
          update.business_name = patch.businessName.trim() || null
        }
        if (typeof patch.contactName === "string") {
          update.contact_name = patch.contactName.trim() || null
        }
        if (typeof patch.vendorFirstName === "string") {
          update.vendor_first_name = patch.vendorFirstName.trim() || null
        }
        if (typeof patch.email === "string") {
          update.email = patch.email.trim() || null
        }
        if (typeof patch.phone === "string") {
          update.phone = patch.phone.trim() || null
        }
        if (typeof patch.propertyName === "string") {
          update.property_name = patch.propertyName.trim() || null
        }
        if (Array.isArray(patch.tradeCategories)) {
          update.trade_categories = patch.tradeCategories.filter(
            (t): t is string => typeof t === "string",
          )
        }
        if (patch.serviceArea && typeof patch.serviceArea === "object") {
          update.service_area = patch.serviceArea
        }
        if (patch.availability === "active" || patch.availability === "paused") {
          update.availability = patch.availability
        }
        if (patch.progress && typeof patch.progress === "object") {
          update.progress = patch.progress
        }
        if (Object.keys(update).length > 0) {
          if (row.status === "invited") update.status = "in_progress"
          const { error } = await supabase
            .from("vendor_verifications")
            .update(update)
            .eq("id", row.id)
          if (error) {
            console.error("[vendor-verification] save", error)
            return jsonResponse({ error: "Could not save" }, 500)
          }
        }
        return await reloadAndRespond()
      }

      case "verifyLicense": {
        const licenseState = typeof body.licenseState === "string"
          ? body.licenseState.trim()
          : row.license_state
        const licenseNumber = typeof body.licenseNumber === "string"
          ? body.licenseNumber.trim()
          : null
        const result = verifyLicense({
          businessName: row.business_name,
          contactName: row.contact_name,
          licenseState,
          licenseNumber,
          tradeCategories: row.trade_categories,
        })
        const { error } = await supabase
          .from("vendor_verifications")
          .update({
            license_state: licenseState || null,
            license_number: result.licenseNumber,
            license_type: result.licenseType,
            license_status: result.status,
            status: row.status === "invited" ? "in_progress" : row.status,
          })
          .eq("id", row.id)
        if (error) {
          console.error("[vendor-verification] verifyLicense", error)
          return jsonResponse({ error: "Could not verify license" }, 500)
        }
        return await reloadAndRespond()
      }

      case "upload": {
        const kind = typeof body.kind === "string" ? body.kind.trim() : ""
        if (!["license", "coi", "w9"].includes(kind)) {
          return jsonResponse({ error: "Invalid document kind" }, 400)
        }
        const dataBase64 = typeof body.dataBase64 === "string"
          ? body.dataBase64
          : ""
        if (!dataBase64) {
          return jsonResponse({ error: "Missing file data" }, 400)
        }
        const fileName = typeof body.fileName === "string"
          ? body.fileName.trim()
          : null
        const contentType = typeof body.contentType === "string"
          ? body.contentType.trim()
          : "application/octet-stream"

        let bytes: Uint8Array
        try {
          bytes = decodeBase64(dataBase64)
        } catch {
          return jsonResponse({ error: "Could not decode file" }, 400)
        }
        if (bytes.byteLength > 12 * 1024 * 1024) {
          return jsonResponse({ error: "File is too large (max 12MB)" }, 413)
        }

        const ext = extForContentType(contentType, fileName)
        const storagePath = `${row.id}/${kind}-${crypto.randomUUID()}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from("vendor-documents")
          .upload(storagePath, bytes, { contentType, upsert: true })
        if (uploadErr) {
          console.error("[vendor-verification] storage upload", uploadErr)
          return jsonResponse({ error: "Upload failed" }, 500)
        }

        let parsed: Record<string, unknown> = { simulated: true }
        const verificationUpdate: Record<string, unknown> = {
          status: row.status === "invited" ? "in_progress" : row.status,
        }

        if (kind === "license") {
          // Scan the uploaded license and read the number off the document so the
          // vendor's form auto-fills (document scanner / OCR seam).
          const scan = scanLicenseDocument({
            fileName,
            contentType,
            businessName: row.business_name,
            contactName: row.contact_name,
            licenseState: row.license_state,
            tradeCategories: row.trade_categories,
          })
          parsed = scan as unknown as Record<string, unknown>
          verificationUpdate.license_number = scan.licenseNumber
          verificationUpdate.license_type = scan.licenseType
          verificationUpdate.license_status = scan.status
          if (scan.licenseState) verificationUpdate.license_state = scan.licenseState
        } else if (kind === "coi") {
          const coi = parseCoi({
            fileName,
            contentType,
            businessName: row.business_name,
          })
          parsed = coi as unknown as Record<string, unknown>
          verificationUpdate.coi_general_liability = coi.generalLiability
          verificationUpdate.coi_expiration = coi.expirationDate
          verificationUpdate.coi_additional_insured = coi.additionalInsured
          verificationUpdate.coi_status = coi.status
        } else if (kind === "w9") {
          verificationUpdate.w9_received = true
        }

        await supabase.from("vendor_documents").insert({
          verification_id: row.id,
          vendor_id: row.vendor_id,
          landlord_id: landlordId,
          kind,
          storage_path: storagePath,
          file_name: fileName,
          content_type: contentType,
          parsed,
        })

        await supabase
          .from("vendor_verifications")
          .update(verificationUpdate)
          .eq("id", row.id)

        return await reloadAndRespond()
      }

      case "startBackgroundCheck": {
        const result = startBackgroundCheck({
          contactName: row.contact_name,
          email: row.email,
        })
        await supabase
          .from("vendor_verifications")
          .update({
            background_check_ref: result.ref,
            background_check_status: result.status,
            status: row.status === "invited" ? "in_progress" : row.status,
          })
          .eq("id", row.id)
        return await reloadAndRespond()
      }

      case "backgroundStatus": {
        const ref = row.background_check_ref
        if (!ref) {
          return jsonResponse({ error: "Background check not started" }, 400)
        }
        const result = getBackgroundStatus(ref)
        const { error: bgUpdateError } = await supabase
          .from("vendor_verifications")
          .update({ background_check_status: result.status })
          .eq("id", row.id)
        if (bgUpdateError) {
          return jsonResponse(
            { error: bgUpdateError.message || "Could not update background check" },
            500,
          )
        }
        return await reloadAndRespond()
      }

      case "submit": {
        // Persist any final patch first.
        const patch = (body.patch ?? {}) as Record<string, unknown>
        const finalUpdate: Record<string, unknown> = {}
        if (Array.isArray(patch.tradeCategories)) {
          finalUpdate.trade_categories = patch.tradeCategories.filter(
            (t): t is string => typeof t === "string",
          )
        }
        if (patch.serviceArea && typeof patch.serviceArea === "object") {
          finalUpdate.service_area = patch.serviceArea
        }
        if (patch.availability === "active" || patch.availability === "paused") {
          finalUpdate.availability = patch.availability
        }
        if (Object.keys(finalUpdate).length > 0) {
          await supabase
            .from("vendor_verifications")
            .update(finalUpdate)
            .eq("id", row.id)
        }

        const { data: freshRaw } = await supabase
          .from("vendor_verifications")
          .select(ROW_SELECT)
          .eq("id", row.id)
          .maybeSingle()
        const fresh = (freshRaw as unknown as VerificationRow) ?? row
        const workflowRunId = fresh.workflow_run_id ?? null
        const checklist = computeVerificationChecklist(fresh)
        const overall = checklist.overall // 'verified' | 'needs_review'

        const primaryTrade = (fresh.trade_categories ?? [])[0] ?? null
        const notificationChannel = fresh.phone && fresh.email
          ? "both"
          : fresh.phone
          ? "sms"
          : "email"

        // Create or link the vendors row. Prefer the verification's vendor_id,
        // otherwise match an existing roster vendor by email/phone so submit
        // updates the profile the landlord already has (instead of a duplicate).
        // Normalize phone to E.164 for vendors.phone_format_check.
        let vendorId = await findLandlordVendorByContact(supabase, landlordId, {
          vendorId: fresh.vendor_id,
          email: fresh.email,
          phone: fresh.phone,
        })
        const vendorPhone = normalizePhoneFlexible(fresh.phone)
        const vendorPayload: Record<string, unknown> = {
          name: fresh.business_name || fresh.contact_name || "Vendor",
          email: fresh.email,
          phone: vendorPhone,
          category: primaryTrade,
          active:
            overall === "verified" &&
            (fresh.availability ?? "active") === "active",
          notification_channel: notificationChannel,
        }

        if (vendorId) {
          const { error: updErr } = await supabase
            .from("vendors")
            .update(vendorPayload)
            .eq("id", vendorId)
            .eq("landlord_id", landlordId)
          if (updErr) {
            console.error("[vendor-verification] update vendor", updErr)
            return jsonResponse(
              {
                error: `Could not update vendor profile${
                  updErr.message ? `: ${updErr.message}` : ""
                }`,
              },
              500,
            )
          }
        } else {
          const { data: ins, error: insErr } = await supabase
            .from("vendors")
            .insert({
              landlord_id: landlordId,
              ...vendorPayload,
              onboarded_from_external: true,
            })
            .select("id")
            .single()
          if (insErr || !ins?.id) {
            console.error("[vendor-verification] create vendor", insErr)
            return jsonResponse(
              {
                error: `Could not finalize vendor${
                  insErr?.message ? `: ${insErr.message}` : ""
                }`,
              },
              500,
            )
          }
          vendorId = ins.id as string
        }

        const nowIso = new Date().toISOString()
        await supabase
          .from("vendor_verifications")
          .update({
            vendor_id: vendorId,
            status: overall,
            submitted_at: nowIso,
            verified_at: overall === "verified" ? nowIso : null,
          })
          .eq("id", row.id)

        // Stamp documents with the resolved vendor id.
        await supabase
          .from("vendor_documents")
          .update({ vendor_id: vendorId })
          .eq("verification_id", row.id)

        const vendorLabel = fresh.business_name || fresh.contact_name || "Vendor"
        const workflowTemplateId = workflowRunId ? "vendor_onboarding" : null

        let inviteConversationId = fresh.invite_conversation_id ?? null
        if (!inviteConversationId) {
          const { data: linkRow } = await supabase
            .from("vendor_verifications")
            .select("invite_conversation_id")
            .eq("id", row.id)
            .maybeSingle()
          inviteConversationId =
            (linkRow as { invite_conversation_id?: string | null } | null)
              ?.invite_conversation_id ?? null
        }

        const inbox = await appendVendorVerificationSubmittedToInbox(supabase, {
          landlordId,
          inviteConversationId,
          workflowRunId,
          vendorId,
          phone: vendorPhone ?? fresh.phone,
          vendorLabel,
          overall,
          checklist,
          trades: fresh.trade_categories,
          verificationId: row.id,
        })

        // Ack under review, then status (approved) or incomplete outstanding-items SMS.
        await sendVendorVerificationFollowUpSms(supabase, {
          landlordId,
          verificationId: row.id,
          token,
          vendorLabel,
          overall,
          checklist,
          inviteConversationId: inbox.conversationId ?? inviteConversationId,
          workflowRunId,
          vendorId,
          phone: vendorPhone ?? fresh.phone,
        })

        await logGraphEvent(supabase, {
          landlord_id: landlordId,
          event_type: "vendor.verification_submitted",
          source: "vendor_portal",
          actor_type: "vendor",
          vendor_id: vendorId,
          conversation_id: inbox.conversationId,
          message_id: inbox.messageId,
          workflow_run_id: workflowRunId,
          workflow_template_id: workflowTemplateId,
          metadata: {
            message: `${vendorLabel} completed vendor verification.`,
            verification_id: row.id,
            checklist_complete: checklist.completeCount,
            checklist_required: checklist.requiredCount,
            workflow_run_id: workflowRunId,
          },
        })
        await logGraphEvent(supabase, {
          landlord_id: landlordId,
          event_type: overall === "verified"
            ? "vendor.verified"
            : "vendor.verification_needs_review",
          source: "vendor_portal",
          actor_type: "system",
          vendor_id: vendorId,
          conversation_id: inbox.conversationId,
          message_id: inbox.messageId,
          workflow_run_id: workflowRunId,
          workflow_template_id: workflowTemplateId,
          metadata: {
            message: overall === "verified"
              ? `${vendorLabel} is verified and ready for assignments.`
              : `${vendorLabel} needs review: ${
                checklist.missingReasons.join("; ")
              }`,
            verification_id: row.id,
            missing_reasons: checklist.missingReasons,
            workflow_run_id: workflowRunId,
          },
        })

        // Advance + close the vendor_onboarding workflow run.
        if (workflowRunId) {
          await logPipelineStageEvent(supabase, {
            runId: workflowRunId,
            stage: "act",
            step: "verify_and_roster",
            actorType: "vendor",
            message: `${vendorLabel} submitted verification (${checklist.completeCount}/${checklist.requiredCount} complete).`,
            metadata: { verification_id: row.id, overall },
          })
          await logPipelineStageEvent(supabase, {
            runId: workflowRunId,
            stage: "log",
            step: "append_graph_events",
            message: overall === "verified"
              ? `${vendorLabel} verified and added to the roster.`
              : `${vendorLabel} needs review before roster assignment.`,
            metadata: { verification_id: row.id, overall },
          })
          await updateWorkflowRun(supabase, workflowRunId, {
            status: overall === "verified" ? "completed" : "active",
            currentStep: overall,
            completedAt: overall === "verified" ? nowIso : null,
            metadata: { verification_id: row.id, vendor_id: vendorId },
          })
        }

        const documents = await loadDocuments(supabase, row.id)
        return jsonResponse({
          ok: true,
          overall,
          session: sessionView(
            { ...fresh, vendor_id: vendorId, status: overall },
            documents,
          ),
        })
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    console.error("[vendor-verification] handler error", action, err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
