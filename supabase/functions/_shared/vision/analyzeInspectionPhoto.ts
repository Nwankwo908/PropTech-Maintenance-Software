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
import { normalizeApplianceVisionResult } from "./normalize.ts"

/** Run vision on an existing property_inspection_photos row. Does not mint unit_assets. */
export async function analyzeInspectionPhotoRow(
  supabase: SupabaseClient,
  photoId: string,
  imageBase64: string,
  contentType: string,
  hintCategory: string | null,
  mode: "photo" | "document",
  storagePath: string | null = null,
): Promise<Record<string, unknown>> {
  const started = Date.now()
  await supabase
    .from("property_inspection_photos")
    .update({ status: "analyzing", error_message: null, updated_at: new Date().toISOString() })
    .eq("id", photoId)

  try {
    const provider = getVisionProvider()
    const providerName = provider.name

    let roboflow: Awaited<ReturnType<typeof preclassifyWithRoboflow>> = null
    if (mode === "photo") {
      roboflow = await preclassifyWithRoboflow(imageBase64)
    }
    const effectiveHint = mergeHintCategory(hintCategory, roboflow)

    if (mode === "document" && provider.analyzeDocument) {
      const items = await provider.analyzeDocument(imageBase64, contentType)
      const primary = items[0] ?? normalizeApplianceVisionResult({
        category: "unknown",
        identifiedItem: { type: "Inspection report findings" },
        estimatedAge: { value: null, confidence: "low", basis: "No items extracted" },
        condition: { rating: "fair", summary: "No discrete assets extracted from document." },
        deficiencies: [],
        maintenanceRecommendations: [],
        rawConfidenceNotes: "Document extract returned no items.",
      })
      const packed = {
        ...primary,
        rawConfidenceNotes: [
          primary.rawConfidenceNotes,
          items.length > 1
            ? `${items.length} items extracted; confirming the primary finding first.`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
        _extractedItems: items,
      }
      const latencyMs = Date.now() - started
      const { data, error } = await supabase
        .from("property_inspection_photos")
        .update({
          status: "needs_review",
          ai_result: packed,
          provider: providerName,
          latency_ms: latencyMs,
          estimated_cost_usd: 0.01,
          updated_at: new Date().toISOString(),
        })
        .eq("id", photoId)
        .select("*")
        .single()
      if (error) throw new Error(error.message)
      return data as Record<string, unknown>
    }

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
    )
    const merged = mergeDibIdentificationWithVisionAssessment(
      dibPass?.identification ?? null,
      result,
    )
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
    }
    const latencyMs = Date.now() - started
    const providerLabel = dibPass
      ? buildHybridVisionProviderLabel(providerName)
      : providerName
    const { data, error } = await supabase
      .from("property_inspection_photos")
      .update({
        status: "needs_review",
        ai_result: enriched,
        ...(effectiveHint && !hintCategory ? { hint_category: effectiveHint } : {}),
        provider: providerLabel,
        latency_ms: latencyMs,
        estimated_cost_usd: dibPass ? 0.012 : 0.008,
        updated_at: new Date().toISOString(),
      })
      .eq("id", photoId)
      .select("*")
      .single()
    if (error) throw new Error(error.message)
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
