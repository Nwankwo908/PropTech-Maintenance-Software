import { guardEquipmentLabel } from '../../../../shared/vision/equipmentLabel.ts'
import type { EquipmentPhotoContext } from './types.ts'
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  createInspectionUploadSignedUrl,
  identifyWithDibSmartAdd,
  isDibSmartAddEnabled,
} from "./dibSmartAdd.ts"
import {
  buildHybridVisionProviderLabel,
  mergeDibIdentificationWithVisionAssessment,
} from "./dibHybrid.ts"
import { getVisionProvider, getVisionProviderName } from "./getProvider.ts"
import { mergeHintCategory, preclassifyWithRoboflow } from "./roboflowPreclassify.ts"
import { extractInspectionReport } from "./extractInspectionReport.ts"
import { persistInspectionDocumentAnalysis } from "./persistInspectionDocument.ts"
import { readEquipmentSerial } from "./serialOcr.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"

/** Run vision on an existing property_inspection_photos row. Does not mint unit_assets. */
export async function analyzeInspectionPhotoRow(
  supabase: SupabaseClient,
  photoId: string,
  imageBase64: string,
  contentType: string,
  hintCategory: string | null,
  mode: "photo" | "document",
  storagePath: string | null = null,
  nameplate?: { base64: string; mediaType: string } | null,
  photoContext?: EquipmentPhotoContext,
): Promise<Record<string, unknown>> {
  const started = Date.now()
  await supabase
    .from("property_inspection_photos")
    .update({ status: "analyzing", error_message: null, updated_at: new Date().toISOString() })
    .eq("id", photoId)

  try {

    let roboflow: Awaited<ReturnType<typeof preclassifyWithRoboflow>> = null
    if (mode === "photo") {
      roboflow = await preclassifyWithRoboflow(imageBase64)
    }
    const effectiveHint = mergeHintCategory(hintCategory, roboflow)

    if (mode === "document") {
      const extract = await extractInspectionReport({ imageBase64, contentType })
      return await persistInspectionDocumentAnalysis({
        supabase,
        photoId,
        extract,
        provider: "gpt4o",
        latencyMs: Date.now() - started,
      })
    }

    const provider = getVisionProvider()

    let dibPass: Awaited<ReturnType<typeof identifyWithDibSmartAdd>> = null
    if (mode === "photo" && storagePath && isDibSmartAddEnabled()) {
      const signedUrl = await createInspectionUploadSignedUrl(supabase, storagePath)
      if (signedUrl) {
        dibPass = await identifyWithDibSmartAdd(signedUrl)
      }
    }

    const result = await provider.analyzeImage(
      imageBase64,
      effectiveHint ?? undefined,
      contentType,
      photoContext,
    )
    const merged = guardEquipmentLabel(mergeDibIdentificationWithVisionAssessment(
      dibPass?.identification ?? null,
      result,
    ))
    const serialReview = await readEquipmentSerial({
      images: [
        { base64: imageBase64.replace(/^data:[^;]+;base64,/, ""), mediaType: contentType || "image/jpeg" },
        ...(nameplate?.base64
          ? [{ base64: nameplate.base64.replace(/^data:[^;]+;base64,/, ""), mediaType: nameplate.mediaType || "image/jpeg" }]
          : []),
      ],
      brand: merged.identifiedItem.brand,
      paired: Boolean(nameplate?.base64),
    })
    if (serialReview?.serial) {
      merged.identifiedItem.serialNumber = serialReview.serial
    }
    const enriched = {
      ...merged,
      rawConfidenceNotes: [merged.rawConfidenceNotes, roboflow?.note]
        .filter(Boolean)
        .join(" "),
      ...(roboflow
        ? {
          _roboflow: {
            modelId: roboflow.modelId,
            hintCategory: roboflow.hintCategory,
            confidence: roboflow.confidence,
            topClass: roboflow.topClass,
            predictions: roboflow.predictions.slice(0, 8),
            latencyMs: roboflow.latencyMs,
            userHint: hintCategory,
            effectiveHint,
          },
        }
        : {}),
      ...(dibPass
        ? {
          _dib: {
            confidence: dibPass.identification.confidence,
            confidenceThreshold: dibPass.confidenceThreshold,
            latencyMs: dibPass.latencyMs,
            rawCandidateCount: dibPass.rawCandidateCount,
            category: dibPass.identification.dibCategory,
            subCategory: dibPass.identification.dibSubCategory,
            itemId: dibPass.identification.dibItemId,
            identifiedItem: dibPass.identification,
          },
        }
        : {}),
      ...(serialReview ? { serialReview } : {}),
    }
    const latencyMs = Date.now() - started
    const providerName = result.extractionTrace?.selectedProvider || provider.name
    // The photo row only allows gemini, gpt4o, or claude. The attempt trace keeps the real model.
    const storedProvider = providerName === "openai" || providerName.startsWith("gpt-")
      ? "gpt4o"
      : providerName === "gemini" || providerName.startsWith("gemini-")
      ? "gemini"
      : providerName
    const providerLabel = dibPass
      ? buildHybridVisionProviderLabel(storedProvider)
      : storedProvider
    const { data, error } = await supabase
      .from("property_inspection_photos")
      .update({
        status: "needs_review",
        ai_result: enriched,
        ...(effectiveHint && !hintCategory ? { hint_category: effectiveHint } : {}),
        provider: providerLabel,
        latency_ms: latencyMs,
        estimated_cost_usd: dibPass ? 0.012 : 0.008,
        serial_review: serialReview,
        updated_at: new Date().toISOString(),
      })
      .eq("id", photoId)
      .select("*")
      .single()
    if (error) throw new Error(error.message)
    const landlordId = data?.landlord_id != null ? String(data.landlord_id) : ""
    if (landlordId && serialReview) {
      await recordActivityLog(supabase, {
        landlordId,
        eventType: serialReview.retake
          ? "inspection.serial_retake_needed"
          : "inspection.serial_read",
        source: "edge_function",
        actorType: "system",
        metadata: {
          message: serialReview.retakePrompt ??
            `Serial number read${serialReview.serial ? `: ${serialReview.serial}` : ""}.`,
          serial: serialReview.serial ?? null,
          appliance: hintCategory && !/_/.test(hintCategory) ? hintCategory : null,
          provider: serialReview.provider,
          paired: serialReview.paired,
        },
      }).catch(() => undefined)
    }
    return data as Record<string, unknown>
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vision analysis failed"
    console.error("[analyze-inspection-photo]", photoId, message)
    const { data } = await supabase
      .from("property_inspection_photos")
      .update({
        status: "error",
        error_message: message.slice(0, 500),
        provider: getVisionProviderName(),
        latency_ms: Date.now() - started,
        updated_at: new Date().toISOString(),
      })
      .eq("id", photoId)
      .select("*")
      .single()
    return (data as Record<string, unknown>) ?? {
      id: photoId,
      status: "error",
      error_message: message,
    }
  }
}
