/**
 * HQS inspection-letter SMS replies — unit mapping + YES/NO confirm.
 * Initial attachment classification sets pending intake_state; these handlers
 * are atomic (R1) and require that pending ask (R2).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  buildHqsLetterConfirmSummarySms,
  buildHqsUnitAskSms,
  type HqsLetterExtraction,
} from "../../../../shared/maintenance/hqsInspectionLetter.ts"
import {
  extractHqsLetterFromPdfText,
  extractHqsLetterViaVisionOcr,
  resolveHqsLetterMediaRoute,
} from "../../../../shared/maintenance/hqsLetterMediaExtract.ts"
import { pdfBytesToPlainText } from "../onboarding/pdfDocumentText.ts"
import type {
  InboundSmsHandlerContext,
  InboundSmsHandlerResult,
} from "./inboundHandlerTypes.ts"
import {
  confirmAndCreateHqsInspectionLetter,
  loadHqsOwnerTenantUnitMap,
  upsertHqsOwnerTenantUnitMap,
} from "./hqsInspectionLetterConfirm.ts"
import { resolveUnitIdForLandlord } from "./resolveUnitId.ts"
import {
  isHttpUrl,
  isStorageMediaPath,
  mediaKindFromRef,
} from "./media.ts"

function intakeRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
}

async function loadIntakeState(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  return intakeRecord(data?.intake_state)
}

async function patchIntakeState(
  supabase: SupabaseClient,
  conversationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const current = await loadIntakeState(supabase, conversationId)
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
}

export function canHandleHqsUnitReply(input: { intakeState: unknown }): boolean {
  return intakeRecord(input.intakeState).awaiting_hqs_unit === true
}

export function canHandleHqsConfirm(input: {
  intakeState: unknown
  body: string
}): boolean {
  if (intakeRecord(input.intakeState).awaiting_hqs_confirm !== true) return false
  const t = input.body.trim().toLowerCase()
  return t === "yes" || t === "y" || t === "no" || t === "n" ||
    /^(yes|y|no|n)\b/i.test(t)
}

function extractionFromIntake(intake: Record<string, unknown>): HqsLetterExtraction | null {
  const raw = intake.hqs_extraction
  if (!raw || typeof raw !== "object") return null
  return raw as HqsLetterExtraction
}

/** Parse "646 Bartlett Unit 1" / "Unit 1" style replies. */
export function parseHqsUnitReply(body: string): {
  unitLabel: string
  buildingHint: string | null
} {
  const t = body.trim()
  const unitMatch = t.match(/\bunit\s*([A-Za-z0-9\-]+)\b/i)
  const unitLabel = unitMatch?.[1]?.trim() || t.replace(/^unit\s+/i, "").trim()
  const buildingHint = unitMatch
    ? t.slice(0, unitMatch.index).replace(/[,\-·|]+$/g, "").trim() || null
    : null
  return { unitLabel, buildingHint }
}

export async function tryHandleHqsUnitReplyInbound(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const intake = await loadIntakeState(ctx.supabase, ctx.conversationId)
  if (!canHandleHqsUnitReply({ intakeState: intake })) {
    return { handled: false }
  }
  const extraction = extractionFromIntake(intake)
  if (!extraction) {
    await patchIntakeState(ctx.supabase, ctx.conversationId, {
      awaiting_hqs_unit: false,
      hqs_extraction: undefined,
    })
    return {
      handled: true,
      workflowRoute: "hqs_unit_reply",
      reply: {
        body: "I lost the inspection letter details. Please resend the letter photo or PDF.",
        source: "hqs_unit_reply",
        skipGenericFallback: true,
      },
    }
  }

  const parsed = parseHqsUnitReply(ctx.inbound.body)
  const unit = await resolveUnitForLandlord(ctx.supabase, {
    landlordId: ctx.landlordId,
    unitLabel: parsed.unitLabel,
    buildingHint: parsed.buildingHint,
  })
  if (!unit) {
    return {
      handled: true,
      workflowRoute: "hqs_unit_reply",
      reply: {
        body:
          `I couldn't find unit "${parsed.unitLabel}" on your roster. Reply with the building and unit (for example: 646 Bartlett Unit 1).`,
        source: "hqs_unit_reply",
        skipGenericFallback: true,
      },
    }
  }

  if (extraction.ownerIdExternal && extraction.tenantIdExternal) {
    await upsertHqsOwnerTenantUnitMap(ctx.supabase, {
      landlordId: ctx.landlordId,
      ownerIdExternal: extraction.ownerIdExternal,
      tenantIdExternal: extraction.tenantIdExternal,
      unitId: unit.unitId,
      propertyId: unit.propertyId,
    })
  }

  await patchIntakeState(ctx.supabase, ctx.conversationId, {
    awaiting_hqs_unit: false,
    awaiting_hqs_confirm: true,
    hqs_unit_id: unit.unitId,
    hqs_property_id: unit.propertyId,
  })

  return {
    handled: true,
    workflowRoute: "hqs_unit_reply",
    reply: {
      body: buildHqsLetterConfirmSummarySms({
        extraction,
        unitLabel: unit.unitLabel,
        propertyLabel: unit.building,
      }),
      source: "hqs_unit_reply",
      skipGenericFallback: true,
    },
  }
}

export async function tryHandleHqsConfirmInbound(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  const intake = await loadIntakeState(ctx.supabase, ctx.conversationId)
  if (!canHandleHqsConfirm({ intakeState: intake, body: ctx.inbound.body })) {
    return { handled: false }
  }
  const extraction = extractionFromIntake(intake)
  const unitId = typeof intake.hqs_unit_id === "string" ? intake.hqs_unit_id : null
  const propertyId = typeof intake.hqs_property_id === "string"
    ? intake.hqs_property_id
    : null
  const sourceDocumentId = typeof intake.hqs_source_document_id === "string"
    ? intake.hqs_source_document_id
    : null
  const yes = /^(yes|y)\b/i.test(ctx.inbound.body.trim())

  if (!yes) {
    await patchIntakeState(ctx.supabase, ctx.conversationId, {
      awaiting_hqs_confirm: false,
      hqs_extraction: undefined,
      hqs_unit_id: undefined,
      hqs_property_id: undefined,
      hqs_source_document_id: undefined,
    })
    return {
      handled: true,
      workflowRoute: "hqs_confirm",
      reply: {
        body: "Got it — I didn't create an inspection record or work orders.",
        source: "hqs_confirm",
        skipGenericFallback: true,
      },
    }
  }

  await patchIntakeState(ctx.supabase, ctx.conversationId, {
    awaiting_hqs_confirm: false,
  })

  if (!extraction || !unitId) {
    return {
      handled: true,
      workflowRoute: "hqs_confirm",
      reply: {
        body: "I couldn't finish that inspection letter. Please resend the document.",
        source: "hqs_confirm",
        skipGenericFallback: true,
      },
    }
  }

  const result = await confirmAndCreateHqsInspectionLetter(ctx.supabase, {
    landlordId: ctx.landlordId,
    unitId,
    propertyId,
    extraction,
    sourceDocumentId,
    conversationId: ctx.conversationId,
    landlordConfirmed: true,
  })

  if (!result.ok) {
    return {
      handled: true,
      workflowRoute: "hqs_confirm",
      reply: {
        body:
          "Something went wrong creating the work orders. Please try again or use the dashboard.",
        source: "hqs_confirm",
        skipGenericFallback: true,
      },
    }
  }

  const abatement = result.abatementAlertSent
    ? " A separate abatement alert was sent to your team."
    : ""
  return {
    handled: true,
    workflowRoute: "hqs_confirm",
    reply: {
      body:
        `Done. Inspection record created with ${result.workOrderIds.length} work order(s).${abatement}`,
      source: "hqs_confirm",
      skipGenericFallback: true,
    },
  }
}

async function resolveUnitForLandlord(
  supabase: SupabaseClient,
  input: { landlordId: string; unitLabel: string; buildingHint: string | null },
): Promise<
  { unitId: string; propertyId: string | null; unitLabel: string; building: string | null } | null
> {
  const unitId = await resolveUnitIdForLandlord(supabase, {
    landlordId: input.landlordId,
    unitLabel: input.unitLabel,
    building: input.buildingHint,
  })
  if (!unitId) return null
  const { data: row } = await supabase
    .from("units")
    .select("id, unit_label, building, property_id")
    .eq("id", unitId)
    .maybeSingle()
  if (!row?.id) return null
  return {
    unitId: String(row.id),
    propertyId: row.property_id == null ? null : String(row.property_id),
    unitLabel: String(row.unit_label ?? input.unitLabel),
    building: row.building == null ? null : String(row.building),
  }
}

async function downloadInboundMediaBytes(
  supabase: SupabaseClient,
  ref: string,
): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
  const path = ref.trim()
  if (!path) return null
  try {
    if (isStorageMediaPath(path)) {
      const { data, error } = await supabase.storage
        .from("maintenance-uploads")
        .download(path)
      if (error || !data) {
        console.error("[hqs-letter] storage download failed", path, error?.message)
        return null
      }
      const bytes = new Uint8Array(await data.arrayBuffer())
      const ct = mediaKindFromRef(path) === "document"
        ? "application/pdf"
        : data.type || null
      return { bytes, contentType: ct }
    }
    if (!isHttpUrl(path)) return null
    const res = await fetch(path)
    if (!res.ok) {
      console.error("[hqs-letter] media fetch failed", path, res.status)
      return null
    }
    const contentType = res.headers.get("content-type")
    const bytes = new Uint8Array(await res.arrayBuffer())
    return { bytes, contentType }
  } catch (e) {
    console.error("[hqs-letter] media download error", path, e)
    return null
  }
}

async function ocrImageBytes(input: {
  bytes: Uint8Array
  contentType?: string | null
}): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? ""
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY for HQS letter OCR")
  const mediaType = (input.contentType || "image/jpeg").split(";")[0]?.trim() ||
    "image/jpeg"
  let binary = ""
  for (let i = 0; i < input.bytes.length; i++) {
    binary += String.fromCharCode(input.bytes[i]!)
  }
  const b64 = btoa(binary)
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      max_tokens: 4000,
      messages: [
        {
          role: "system",
          content:
            "You OCR housing-authority inspection / HQS fail letters. Return only the plain text of the letter, preserving labels, section headers, and line breaks. No commentary.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe this inspection letter exactly.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mediaType};base64,${b64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`HQS OCR failed (${res.status}): ${errText.slice(0, 200)}`)
  }
  const json = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return String(json.choices?.[0]?.message?.content ?? "").trim()
}

async function extractHqsFromMediaRef(
  supabase: SupabaseClient,
  ref: string,
): Promise<{
  extraction: HqsLetterExtraction
  mediaKind: "pdf" | "image" | "unknown"
  contentType: string | null
  storagePath: string
} | null> {
  const downloaded = await downloadInboundMediaBytes(supabase, ref)
  if (!downloaded) return null
  const route = resolveHqsLetterMediaRoute({
    contentType: downloaded.contentType,
    storagePathOrUrl: ref,
  })
  if (route === "unsupported") return null

  if (route === "pdf_text") {
    const pdfText = await pdfBytesToPlainText(downloaded.bytes)
    if (!pdfText.trim()) {
      console.warn("[hqs-letter] PDF text empty — cannot classify", ref)
      return null
    }
    const { extraction } = extractHqsLetterFromPdfText(pdfText)
    return {
      extraction,
      mediaKind: "pdf",
      contentType: downloaded.contentType ?? "application/pdf",
      storagePath: isStorageMediaPath(ref) ? ref : ref,
    }
  }

  // Photo → explicit vision OCR (rehost-only is not enough).
  const { extraction } = await extractHqsLetterViaVisionOcr({
    storagePathOrUrl: ref,
    contentType: downloaded.contentType,
    ocrImage: async () =>
      await ocrImageBytes({
        bytes: downloaded.bytes,
        contentType: downloaded.contentType,
      }),
  })
  return {
    extraction,
    mediaKind: "image",
    contentType: downloaded.contentType,
    storagePath: isStorageMediaPath(ref) ? ref : ref,
  }
}

async function persistHqsSourceDocument(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    storagePath: string
    contentType: string | null
    mediaKind: "pdf" | "image" | "unknown"
  },
): Promise<string | null> {
  const fileName = input.storagePath.split("/").pop() || "hqs-letter"
  const { data, error } = await supabase
    .from("inspection_source_documents")
    .insert({
      landlord_id: input.landlordId,
      storage_bucket: "maintenance-uploads",
      storage_path: input.storagePath,
      file_name: fileName,
      content_type: input.contentType,
      source_channel: "sms",
    })
    .select("id")
    .maybeSingle()
  if (error || !data?.id) {
    console.error("[hqs-letter] source document insert failed", error?.message)
    return null
  }
  return String(data.id)
}

/**
 * Landlord/account-holder MMS after rehost: classify attachment as HQS letter
 * and begin unit-map / confirm intake. Never runs for tenants/vendors.
 * Creates zero inspection_reports / work orders until YES.
 */
export async function tryStartHqsLetterIntakeFromInbound(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  // Tenants / vendors / unknown — never open HQS letter intake on their thread.
  if (ctx.identity.identity_type !== "landlord") {
    return { handled: false }
  }
  const media = Array.isArray(ctx.inbound.mediaUrls) ? ctx.inbound.mediaUrls : []
  if (media.length === 0) return { handled: false }

  const intake = await loadIntakeState(ctx.supabase, ctx.conversationId)
  if (intake.awaiting_hqs_unit === true || intake.awaiting_hqs_confirm === true) {
    return { handled: false }
  }

  for (const ref of media) {
    if (typeof ref !== "string" || !ref.trim()) continue
    let extracted: Awaited<ReturnType<typeof extractHqsFromMediaRef>> = null
    try {
      extracted = await extractHqsFromMediaRef(ctx.supabase, ref.trim())
    } catch (e) {
      console.error("[hqs-letter] extract failed", ref, e)
      continue
    }
    if (!extracted?.extraction.isHqsLetter) continue

    const sourceDocumentId = await persistHqsSourceDocument(ctx.supabase, {
      landlordId: ctx.landlordId,
      storagePath: extracted.storagePath,
      contentType: extracted.contentType,
      mediaKind: extracted.mediaKind,
    })

    const started = await beginHqsLetterIntake({
      supabase: ctx.supabase,
      landlordId: ctx.landlordId,
      conversationId: ctx.conversationId,
      extraction: extracted.extraction,
      sourceDocumentId,
      mediaKind: extracted.mediaKind,
    })

    return {
      handled: true,
      workflowRoute: "hqs_letter_intake",
      reply: {
        body: started.responseText,
        source: "hqs_letter_intake",
        skipGenericFallback: true,
      },
      workflowMetadata: {
        emergency_item_count: extracted.extraction.emergencyItemCount,
        standard_item_count: extracted.extraction.standardItemCount,
        letter_type: extracted.extraction.letterType,
        media_kind: extracted.mediaKind,
      },
    }
  }

  return { handled: false }
}

/**
 * After classifying an inbound attachment as an HQS letter, ask for unit or confirm.
 * Creates zero inspection_reports / work orders until YES.
 */
export async function beginHqsLetterIntake(input: {
  supabase: SupabaseClient
  landlordId: string
  conversationId: string
  extraction: HqsLetterExtraction
  sourceDocumentId?: string | null
  mediaKind: "pdf" | "image" | "unknown"
}): Promise<{ responseText: string }> {
  const mapped = await loadHqsOwnerTenantUnitMap(input.supabase, {
    landlordId: input.landlordId,
    ownerIdExternal: input.extraction.ownerIdExternal,
    tenantIdExternal: input.extraction.tenantIdExternal,
  })

  if (!mapped) {
    await patchIntakeState(input.supabase, input.conversationId, {
      awaiting_hqs_unit: true,
      awaiting_hqs_confirm: false,
      hqs_extraction: input.extraction,
      hqs_source_document_id: input.sourceDocumentId ?? null,
      hqs_media_kind: input.mediaKind,
    })
    return {
      responseText: buildHqsUnitAskSms({
        ownerId: input.extraction.ownerIdExternal,
        tenantId: input.extraction.tenantIdExternal,
      }),
    }
  }

  await patchIntakeState(input.supabase, input.conversationId, {
    awaiting_hqs_unit: false,
    awaiting_hqs_confirm: true,
    hqs_extraction: input.extraction,
    hqs_source_document_id: input.sourceDocumentId ?? null,
    hqs_unit_id: mapped.unitId,
    hqs_property_id: mapped.propertyId,
    hqs_media_kind: input.mediaKind,
  })

  const { data: unitRow } = await input.supabase
    .from("units")
    .select("unit_label, building")
    .eq("id", mapped.unitId)
    .maybeSingle()

  return {
    responseText: buildHqsLetterConfirmSummarySms({
      extraction: input.extraction,
      unitLabel: unitRow?.unit_label == null ? null : String(unitRow.unit_label),
      propertyLabel: unitRow?.building == null ? null : String(unitRow.building),
    }),
  }
}
