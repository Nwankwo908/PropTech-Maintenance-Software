import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../_shared/graph/logGraphEvent.ts"
import { recordVendorStripeConnectReadyIfTransition } from "../_shared/paymentActivityEvents.ts"
import { normalizePhoneFlexible } from "../_shared/resident_notify.ts"
import {
  getBackgroundStatus,
  parseCoi,
  scanLicenseDocument,
  startBackgroundCheck,
  verifyLicense,
} from "../_shared/vendor_verification/adapters.ts"
import { computeVerificationChecklist } from "../_shared/vendor_verification/checklist.ts"
import {
  normalizeTinDigits,
  parseTaxEntityFromPatch,
  taxProfileForEntity,
  tinFingerprint,
  tinLast4,
  validateTinDigits,
} from "../_shared/vendor_verification/w9TaxProfile.ts"
import { findLandlordVendorByContact } from "../_shared/vendor_verification/findVendor.ts"
import { finalizeVendorVerificationSubmit } from "../_shared/vendor_verification/finalizeVendorVerificationSubmit.ts"
import { runVendorOnboardingViaEngine } from "../_shared/engine/vendorOnboardingEngine.ts"
import {
  createConnectAccountLink,
  createExpressConnectAccount,
  isStripeConfigured,
  isStripeConnectReady,
  listConnectPayoutMethods,
  resolveConnectAppBaseUrl,
  retrieveConnectAccount,
  type StripeConnectPayoutMethod,
} from "../_shared/stripeConnect.ts"
import { uloAppUrl } from "../_shared/uloAppUrl.ts"

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
  license_expiration?: string | null
  coi_general_liability: number | null
  coi_expiration: string | null
  coi_additional_insured: boolean | null
  coi_status: string | null
  background_check_status: string | null
  background_check_ref: string | null
  w9_received: boolean | null
  tax_entity_type: string | null
  tin_type: string | null
  tin_last4: string | null
  tin_fingerprint: string | null
  w9_variant: string | null
  tax_1099_treatment: string | null
  stripe_connect_ready: boolean | null
  trade_categories: string[] | null
  service_area: Record<string, unknown> | null
  availability: string | null
  progress: Record<string, unknown> | null
  expires_at: string | null
  workflow_run_id: string | null
  /** Present after migration 20260717180000; optional for older DBs. */
  invite_conversation_id?: string | null
  compliance_expiry_notices?: Record<string, unknown> | null
}

const ROW_SELECT =
  "id, landlord_id, vendor_id, token, status, business_name, contact_name, vendor_first_name, email, phone, property_name, license_state, license_number, license_type, license_status, license_expiration, coi_general_liability, coi_expiration, coi_additional_insured, coi_status, background_check_status, background_check_ref, w9_received, tax_entity_type, tin_type, tin_last4, tin_fingerprint, w9_variant, tax_1099_treatment, stripe_connect_ready, trade_categories, service_area, availability, progress, expires_at, workflow_run_id, invite_conversation_id, compliance_expiry_notices"

async function applyTaxProfilePatch(
  patch: Record<string, unknown>,
  update: Record<string, unknown>,
  existing?: { tin_type?: string | null },
): Promise<{ error?: string }> {
  const entity = parseTaxEntityFromPatch(patch)
  const tinRaw = typeof patch.tin === "string"
    ? patch.tin
    : typeof patch.taxId === "string"
    ? patch.taxId
    : null

  if (!entity && tinRaw == null) return {}

  if (!entity) {
    return { error: "Choose your business entity type before entering a tax ID." }
  }

  const profile = taxProfileForEntity(entity)
  update.tax_entity_type = profile.taxEntityType
  update.tin_type = profile.tinType
  update.w9_variant = profile.w9Variant
  update.tax_1099_treatment = profile.tax1099Treatment

  if (tinRaw != null) {
    const digits = normalizeTinDigits(tinRaw)
    if (!digits) {
      return {}
    }
    const valid = validateTinDigits(digits, profile.tinType)
    if (!valid.ok) return { error: valid.error }
    update.tin_last4 = tinLast4(digits)
    update.tin_fingerprint = await tinFingerprint(digits)
  } else if (existing?.tin_type && existing.tin_type !== profile.tinType) {
    // Entity change invalidated prior TIN — require a fresh entry.
    update.tin_last4 = null
    update.tin_fingerprint = null
  }

  return {}
}

function appBaseUrl(req: Request, bodyOrigin?: string): string {
  return resolveConnectAppBaseUrl({
    returnOrigin: bodyOrigin,
    requestOrigin: req.headers.get("origin"),
  })
}

async function loadPayoutMethods(
  accountId: string | null | undefined,
): Promise<StripeConnectPayoutMethod[]> {
  const id = typeof accountId === "string" ? accountId.trim() : ""
  if (!id.startsWith("acct_") || !isStripeConfigured()) return []
  const listed = await listConnectPayoutMethods(id)
  if (!listed.ok) {
    console.warn("[vendor-verification] payout methods", listed.error)
    return []
  }
  return listed.methods
}

async function payoutMethodsForVendor(
  supabase: SupabaseClient,
  vendorId: string | null | undefined,
): Promise<StripeConnectPayoutMethod[]> {
  const id = typeof vendorId === "string" ? vendorId.trim() : ""
  if (!id) return []
  const { data } = await supabase
    .from("vendors")
    .select("stripe_connect_account_id")
    .eq("id", id)
    .maybeSingle()
  return loadPayoutMethods(data?.stripe_connect_account_id)
}

/** Public-safe view of the verification record (no token / landlord_id). */
function sessionView(
  row: VerificationRow,
  documents: unknown[],
  payoutMethods: StripeConnectPayoutMethod[] = [],
) {
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
    taxEntityType: row.tax_entity_type ?? null,
    tinType: row.tin_type ?? null,
    tinLast4: row.tin_last4 ?? null,
    w9Variant: row.w9_variant ?? null,
    tax1099Treatment: row.tax_1099_treatment ?? null,
    stripeConnectReady: row.stripe_connect_ready === true,
    payoutMethods,
    tradeCategories: row.trade_categories ?? [],
    serviceArea: row.service_area ?? {},
    availability: row.availability ?? "active",
    progress: row.progress ?? {},
    documents,
    checklist,
  }
}

async function ensureVendorRow(
  supabase: SupabaseClient,
  row: VerificationRow,
  landlordId: string,
): Promise<string | null> {
  let vendorId = await findLandlordVendorByContact(supabase, landlordId, {
    vendorId: row.vendor_id,
    email: row.email,
    phone: row.phone,
  })
  if (vendorId) {
    if (row.vendor_id !== vendorId) {
      await supabase
        .from("vendor_verifications")
        .update({ vendor_id: vendorId })
        .eq("id", row.id)
    }
    return vendorId
  }

  const vendorPhone = normalizePhoneFlexible(row.phone)
  const { data: ins, error: insErr } = await supabase
    .from("vendors")
    .insert({
      landlord_id: landlordId,
      name: row.business_name || row.contact_name || "Vendor",
      email: row.email,
      phone: vendorPhone,
      active: false,
      notification_channel: row.phone && row.email
        ? "both"
        : row.phone
        ? "sms"
        : "email",
      onboarded_from_external: true,
    })
    .select("id")
    .single()
  if (insErr || !ins?.id) {
    console.error("[vendor-verification] ensure vendor", insErr)
    return null
  }
  vendorId = ins.id as string
  await supabase
    .from("vendor_verifications")
    .update({ vendor_id: vendorId })
    .eq("id", row.id)
  return vendorId
}

async function persistConnectSnapshot(
  supabase: SupabaseClient,
  params: {
    vendorId: string
    verificationId: string
    landlordId: string
    accountId: string
    chargesEnabled: boolean
    payoutsEnabled: boolean
    detailsSubmitted: boolean
  },
): Promise<boolean> {
  const nowIso = new Date().toISOString()
  const ready = isStripeConnectReady({
    accountId: params.accountId,
    chargesEnabled: params.chargesEnabled,
  })
  const { error: vErr } = await supabase
    .from("vendors")
    .update({
      stripe_connect_account_id: params.accountId,
      stripe_connect_charges_enabled: params.chargesEnabled,
      stripe_connect_payouts_enabled: params.payoutsEnabled,
      stripe_connect_details_submitted: params.detailsSubmitted,
      stripe_connect_updated_at: nowIso,
    })
    .eq("id", params.vendorId)
  if (vErr) {
    console.error("[vendor-verification] persist connect vendor", vErr)
    return false
  }
  const { error: verErr } = await supabase
    .from("vendor_verifications")
    .update({ stripe_connect_ready: ready })
    .eq("id", params.verificationId)
  if (verErr) {
    console.error("[vendor-verification] persist connect verification", verErr)
    return false
  }
  return ready
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
    const payoutMethods = await payoutMethodsForVendor(supabase, current.vendor_id)
    return jsonResponse(
      { ok: true, session: sessionView(current, documents, payoutMethods) },
      status,
    )
  }

  try {
    switch (action) {
      case "resolve": {
        // First open flips invited -> in_progress (engine advances the run).
        if (row.status === "invited") {
          await supabase
            .from("vendor_verifications")
            .update({ status: "in_progress" })
            .eq("id", row.id)
          if (row.workflow_run_id) {
            await runVendorOnboardingViaEngine(supabase, {
              landlordId,
              runId: row.workflow_run_id,
              trigger: "vendor_portal",
              vendorOnboarding: {
                action: "portal_in_progress",
                verificationId: row.id,
                vendorId: row.vendor_id,
                vendorLabel: row.business_name || row.contact_name || "Vendor",
              },
            })
          }
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
        if (patch.progress && typeof patch.progress === "object") {
          update.progress = patch.progress
        }
        const taxResult = await applyTaxProfilePatch(patch, update, {
          tin_type: row.tin_type,
        })
        if (taxResult.error) {
          return jsonResponse({ error: taxResult.error }, 400)
        }
        if (Object.keys(update).length > 0) {
          const flippedToInProgress = row.status === "invited"
          if (flippedToInProgress) update.status = "in_progress"
          const { error } = await supabase
            .from("vendor_verifications")
            .update(update)
            .eq("id", row.id)
          if (error) {
            console.error("[vendor-verification] save", error)
            return jsonResponse({ error: "Could not save" }, 500)
          }
          if (flippedToInProgress && row.workflow_run_id) {
            await runVendorOnboardingViaEngine(supabase, {
              landlordId,
              runId: row.workflow_run_id,
              trigger: "vendor_portal",
              vendorOnboarding: {
                action: "portal_in_progress",
                verificationId: row.id,
                vendorId: row.vendor_id,
                vendorLabel: row.business_name || row.contact_name || "Vendor",
              },
            })
          }
        }
        // Capacity toggle (PAUSE/RESUME) — separate from account verification status.
        if (
          (patch.availability === "active" || patch.availability === "paused") &&
          row.vendor_id
        ) {
          const { setVendorCapacityAvailability } = await import(
            "../_shared/vendor_capacity.ts"
          )
          await setVendorCapacityAvailability(supabase, {
            landlordId,
            vendorId: String(row.vendor_id),
            availability: patch.availability,
            source: "portal",
          })
        } else if (
          patch.availability === "active" ||
          patch.availability === "paused"
        ) {
          await supabase
            .from("vendor_verifications")
            .update({ availability: patch.availability })
            .eq("id", row.id)
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
            license_expiration: result.expirationDate,
            status: row.status === "invited" ? "in_progress" : row.status,
          })
          .eq("id", row.id)
        if (error) {
          console.error("[vendor-verification] verifyLicense", error)
          return jsonResponse({ error: "Could not verify license" }, 500)
        }
        if (row.vendor_id) {
          const { maybeRestoreVendorAfterComplianceRenewal } = await import(
            "../_shared/vendor_verification/vendorComplianceExpiry.ts"
          )
          await maybeRestoreVendorAfterComplianceRenewal(supabase, {
            landlordId,
            vendorId: row.vendor_id,
            verificationId: row.id,
            token: row.token,
            phone: row.phone,
            inviteConversationId: row.invite_conversation_id,
            vendorLabel: row.business_name || row.contact_name,
            coi_expiration: row.coi_expiration,
            coi_general_liability: row.coi_general_liability,
            coi_status: row.coi_status,
            coi_additional_insured: row.coi_additional_insured,
            license_expiration: result.expirationDate,
            license_status: result.status,
            license_number: result.licenseNumber,
            compliance_expiry_notices: row.compliance_expiry_notices,
          })
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
          verificationUpdate.license_expiration = scan.expirationDate
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

        if (
          row.vendor_id &&
          (kind === "coi" || kind === "license")
        ) {
          const { maybeRestoreVendorAfterComplianceRenewal } = await import(
            "../_shared/vendor_verification/vendorComplianceExpiry.ts"
          )
          await maybeRestoreVendorAfterComplianceRenewal(supabase, {
            landlordId,
            vendorId: row.vendor_id,
            verificationId: row.id,
            token: row.token,
            phone: row.phone,
            inviteConversationId: row.invite_conversation_id,
            vendorLabel: row.business_name || row.contact_name,
            coi_expiration:
              typeof verificationUpdate.coi_expiration === "string"
                ? verificationUpdate.coi_expiration
                : row.coi_expiration,
            coi_general_liability:
              typeof verificationUpdate.coi_general_liability === "number"
                ? verificationUpdate.coi_general_liability
                : row.coi_general_liability,
            coi_status:
              typeof verificationUpdate.coi_status === "string"
                ? verificationUpdate.coi_status
                : row.coi_status,
            coi_additional_insured:
              typeof verificationUpdate.coi_additional_insured === "boolean"
                ? verificationUpdate.coi_additional_insured
                : row.coi_additional_insured,
            license_expiration:
              typeof verificationUpdate.license_expiration === "string"
                ? verificationUpdate.license_expiration
                : row.license_expiration,
            license_status:
              typeof verificationUpdate.license_status === "string"
                ? verificationUpdate.license_status
                : row.license_status,
            license_number:
              typeof verificationUpdate.license_number === "string"
                ? verificationUpdate.license_number
                : row.license_number,
            compliance_expiry_notices: row.compliance_expiry_notices,
          })
        }

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

      case "create_connect_account_link": {
        if (!isStripeConfigured()) {
          return jsonResponse(
            {
              error:
                "Payout setup is temporarily unavailable. Please try again later.",
            },
            503,
          )
        }
        const base = appBaseUrl(
          req,
          typeof body.returnOrigin === "string" ? body.returnOrigin : undefined,
        )
        if (!base) {
          return jsonResponse(
            {
              error:
                "Could not determine Connect return URL. Open this link from the app, or ask the property manager to check setup.",
            },
            500,
          )
        }

        const vendorId = await ensureVendorRow(supabase, row, landlordId)
        if (!vendorId) {
          return jsonResponse(
            { error: "Could not prepare your profile for payouts." },
            500,
          )
        }

        const { data: vendorRow } = await supabase
          .from("vendors")
          .select("stripe_connect_account_id")
          .eq("id", vendorId)
          .maybeSingle()

        let accountId =
          typeof vendorRow?.stripe_connect_account_id === "string"
            ? vendorRow.stripe_connect_account_id.trim()
            : ""

        if (!accountId) {
          const created = await createExpressConnectAccount({
            vendorId,
            landlordId,
            email: row.email,
            businessName: row.business_name || row.contact_name,
          })
          if (!created.ok) {
            return jsonResponse({ error: created.error }, 502)
          }
          accountId = created.account.id
          await persistConnectSnapshot(supabase, {
            vendorId,
            verificationId: row.id,
            landlordId,
            accountId,
            chargesEnabled: created.account.chargesEnabled,
            payoutsEnabled: created.account.payoutsEnabled,
            detailsSubmitted: created.account.detailsSubmitted,
          })
          await logGraphEvent(supabase, {
            landlord_id: landlordId,
            event_type: "vendor.stripe_connect_started",
            source: "vendor_portal",
            actor_type: "vendor",
            vendor_id: vendorId,
            workflow_run_id: row.workflow_run_id,
            workflow_template_id: row.workflow_run_id
              ? "vendor_onboarding"
              : null,
            metadata: {
              message: "Vendor started payout account setup.",
              verification_id: row.id,
              stripe_connect_account_id: accountId,
            },
          })
        }

        const returnUrl = uloAppUrl.vendorVerification(token, {
          returnOrigin: base,
          connect: "return",
        })
        const refreshUrl = uloAppUrl.vendorVerification(token, {
          returnOrigin: base,
          connect: "refresh",
        })
        const link = await createConnectAccountLink({
          accountId,
          refreshUrl,
          returnUrl,
        })
        if (!link.ok) {
          return jsonResponse({ error: link.error }, 502)
        }

        if (row.status === "invited") {
          await supabase
            .from("vendor_verifications")
            .update({ status: "in_progress" })
            .eq("id", row.id)
        }

        const { data: fresh } = await supabase
          .from("vendor_verifications")
          .select(ROW_SELECT)
          .eq("id", row.id)
          .maybeSingle()
        const current = (fresh as unknown as VerificationRow) ?? row
        const documents = await loadDocuments(supabase, row.id)
        const payoutMethods = await loadPayoutMethods(accountId)
        return jsonResponse({
          ok: true,
          url: link.url,
          session: sessionView(current, documents, payoutMethods),
        })
      }

      case "refresh_connect_status": {
        if (!isStripeConfigured()) {
          return jsonResponse(
            {
              error:
                "Payout setup is temporarily unavailable. Please try again later.",
            },
            503,
          )
        }

        const vendorId = await ensureVendorRow(supabase, row, landlordId)
        if (!vendorId) {
          return jsonResponse(
            { error: "Could not load your payout profile." },
            500,
          )
        }

        const { data: vendorRow } = await supabase
          .from("vendors")
          .select(
            "stripe_connect_account_id, stripe_connect_charges_enabled",
          )
          .eq("id", vendorId)
          .maybeSingle()

        const accountId =
          typeof vendorRow?.stripe_connect_account_id === "string"
            ? vendorRow.stripe_connect_account_id.trim()
            : ""
        if (!accountId) {
          await supabase
            .from("vendor_verifications")
            .update({ stripe_connect_ready: false })
            .eq("id", row.id)
          return await reloadAndRespond()
        }

        const retrieved = await retrieveConnectAccount(accountId)
        if (!retrieved.ok) {
          return jsonResponse({ error: retrieved.error }, 502)
        }

        const wasReady = isStripeConnectReady({
          accountId: vendorRow?.stripe_connect_account_id,
          chargesEnabled: vendorRow?.stripe_connect_charges_enabled,
        })
        const ready = await persistConnectSnapshot(supabase, {
          vendorId,
          verificationId: row.id,
          landlordId,
          accountId: retrieved.account.id,
          chargesEnabled: retrieved.account.chargesEnabled,
          payoutsEnabled: retrieved.account.payoutsEnabled,
          detailsSubmitted: retrieved.account.detailsSubmitted,
        })

        if (ready && !wasReady) {
          await recordVendorStripeConnectReadyIfTransition(supabase, {
            landlordId,
            vendorId,
            verificationId: row.id,
            wasReady,
            nowReady: ready,
            workflowRunId: row.workflow_run_id,
          })
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
        const taxResult = await applyTaxProfilePatch(patch, finalUpdate, {
          tin_type: row.tin_type,
        })
        if (taxResult.error) {
          return jsonResponse({ error: taxResult.error }, 400)
        }
        if (Object.keys(finalUpdate).length > 0) {
          await supabase
            .from("vendor_verifications")
            .update(finalUpdate)
            .eq("id", row.id)
        }

        const workflowRunId = row.workflow_run_id ?? null

        if (workflowRunId) {
          const engineResult = await runVendorOnboardingViaEngine(supabase, {
            landlordId,
            runId: workflowRunId,
            trigger: "vendor_portal",
            vendorOnboarding: {
              action: "submit",
              verificationId: row.id,
            },
          })
          const submitError = typeof engineResult?.metadata?.error === "string"
            ? engineResult.metadata.error
            : null
          if (submitError) {
            return jsonResponse({ error: submitError }, 500)
          }
        } else {
          // Legacy verifications without a workflow run — run side effects directly.
          try {
            await finalizeVendorVerificationSubmit(supabase, {
              landlordId,
              verificationId: row.id,
            })
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return jsonResponse({ error: message }, 500)
          }
        }

        const { data: freshRaw } = await supabase
          .from("vendor_verifications")
          .select(ROW_SELECT)
          .eq("id", row.id)
          .maybeSingle()
        const fresh = (freshRaw as unknown as VerificationRow) ?? row
        const checklist = computeVerificationChecklist(fresh)
        const overall = checklist.overall
        const vendorId = fresh.vendor_id

        const documents = await loadDocuments(supabase, row.id)
        const payoutMethods = await payoutMethodsForVendor(supabase, vendorId)
        return jsonResponse({
          ok: true,
          overall,
          session: sessionView(
            { ...fresh, status: overall },
            documents,
            payoutMethods,
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
