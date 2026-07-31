import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { resolveOperationsGraphScope } from "../graph/operationsGraph.ts"
import type { ApplianceVisionResult, ConditionRating } from "./types.ts"

type RegistryAssetType =
  | "hvac"
  | "water_heater"
  | "boiler"
  | "appliance"
  | "roof"
  | "electrical_panel"

type ApplianceSubtype =
  | "fridge"
  | "stove"
  | "microwave"
  | "washer"
  | "dryer"
  | "other"

function usefulLifeYears(type: string, category: string): number {
  const t = `${category} ${type}`.toLowerCase()
  if (t.includes("roof")) return 25
  if (t.includes("electrical") || t.includes("panel")) return 30
  if (category === "boiler" || t.includes("boiler")) return 15
  if (t.includes("water") || t.includes("heater")) return 12
  if (t.includes("hvac") || t.includes("furnace") || t.includes("condenser") || t.includes("ac")) {
    return 15
  }
  if (t.includes("refrigerator") || t.includes("washer") || t.includes("dryer")) return 12
  return 10
}

function failureFromCondition(
  rating: ConditionRating,
  ageYears: number | null,
  lifeYears: number,
): { risk: number; window: string; replace: boolean; urgency: string } {
  const ageRatio = ageYears != null && lifeYears > 0 ? ageYears / lifeYears : 0.5
  if (rating === "unsafe") {
    return { risk: 95, window: "Immediate", replace: true, urgency: "immediate" }
  }
  if (rating === "poor") {
    return { risk: 75, window: "3–6 months", replace: true, urgency: "soon" }
  }
  if (rating === "fair" || ageRatio >= 0.75) {
    return { risk: 45, window: "6–18 months", replace: ageRatio >= 0.85, urgency: "plan" }
  }
  return { risk: 15, window: "2–5 years", replace: false, urgency: "monitor" }
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso)
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}

function normalizeApplianceSubtype(raw: string): ApplianceSubtype {
  const t = raw.toLowerCase()
  if (t.includes("fridge") || t.includes("refrigerat")) return "fridge"
  if (t.includes("stove") || t.includes("range") || t.includes("oven") || t.includes("cook")) {
    return "stove"
  }
  if (t.includes("microwave")) return "microwave"
  if (t.includes("washer") || t.includes("washing")) return "washer"
  if (t.includes("dryer")) return "dryer"
  return "other"
}

function resolveRegistryType(
  category: string,
  itemType: string,
): { registryAssetType: RegistryAssetType; applianceSubtype: ApplianceSubtype | null; slotKey: string } {
  const cat = `${category} ${itemType}`.toLowerCase()
  if (cat.includes("electrical") || cat.includes("panel") || cat.includes("breaker")) {
    return {
      registryAssetType: "electrical_panel",
      applianceSubtype: null,
      slotKey: "electrical_panel",
    }
  }
  if (category === "roof" || cat.includes("roof")) {
    return { registryAssetType: "roof", applianceSubtype: null, slotKey: "roof" }
  }
  // Boiler before water_heater — "heater" must not steal boilers.
  if (category === "boiler" || cat.includes("boiler")) {
    return { registryAssetType: "boiler", applianceSubtype: null, slotKey: "boiler" }
  }
  if (
    category === "water_heater" ||
    cat.includes("water heater") ||
    cat.includes("water_heater") ||
    (cat.includes("water") && cat.includes("heater")) ||
    cat.includes("tankless")
  ) {
    return {
      registryAssetType: "water_heater",
      applianceSubtype: null,
      slotKey: "water_heater",
    }
  }
  if (
    category === "hvac" ||
    cat.includes("hvac") ||
    cat.includes("furnace") ||
    cat.includes("condenser") ||
    cat.includes("air condition")
  ) {
    return { registryAssetType: "hvac", applianceSubtype: null, slotKey: "hvac" }
  }
  const sub = normalizeApplianceSubtype(itemType)
  return {
    registryAssetType: "appliance",
    applianceSubtype: sub,
    slotKey: `appliance:${sub}`,
  }
}

function mapAiAgeBasis(basis: string, confidence: string): "known" | "ai_estimated" {
  if (/serial|nameplate|documented|label/i.test(basis) && confidence === "high") {
    return "known"
  }
  return "ai_estimated"
}

function isManualProvenance(meta: Record<string, unknown>, field: string): boolean {
  const provenance = meta.fieldProvenance
  if (!provenance || typeof provenance !== "object") return false
  const p = provenance as Record<string, unknown>
  return p[field] === "manual"
}

function agesConflict(manualAge: number, aiAge: number): boolean {
  if (manualAge <= 0 || aiAge <= 0) return false
  const delta = Math.abs(manualAge - aiAge)
  return delta >= 3 && delta / Math.max(manualAge, aiAge) >= 0.25
}

export type ConfirmAssessmentInput = {
  supabase: SupabaseClient
  landlordId: string
  building: string
  photoId: string
  assessmentId: string
  result: ApplianceVisionResult
  provider: string | null
  storagePath: string | null
  actorId?: string | null
}

export type ConfirmAssessmentOutput = {
  unitAssetId: string
  taskIds: string[]
}

/** Upsert unit_assets + PM tasks from a human-confirmed vision result. */
export async function confirmInspectionAssessment(
  input: ConfirmAssessmentInput,
): Promise<ConfirmAssessmentOutput> {
  const { supabase, landlordId, building, result, photoId, assessmentId } = input
  const now = new Date().toISOString()
  const itemType = result.identifiedItem.type.trim() || "Unknown asset"
  const brand = result.identifiedItem.brand?.trim() || null
  const model = result.identifiedItem.modelNumber?.trim() || null
  const serial = result.identifiedItem.serialNumber?.trim() || null
  const aiAgeYears = result.estimatedAge.value
  const life = usefulLifeYears(itemType, result.category)
  const slot = resolveRegistryType(result.category, itemType)
  const aiAgeBasis = mapAiAgeBasis(
    result.estimatedAge.basis || "",
    result.estimatedAge.confidence,
  )

  const scope = await resolveOperationsGraphScope(supabase, {
    landlordId,
    building,
  })

  // Prefer matching by registry slot metadata, then model/serial/type
  let existingId: string | null = null
  let existingRow: {
    id: string
    brand: string | null
    model: string | null
    estimated_age_years: number | null
    detection_source: string | null
    metadata: Record<string, unknown> | null
  } | null = null

  const { data: buildingAssets } = await supabase
    .from("unit_assets")
    .select("id, brand, model, estimated_age_years, detection_source, metadata, appliance_type")
    .eq("landlord_id", landlordId)
    .eq("building", building)
    .order("updated_at", { ascending: false })
    .limit(100)

  if (buildingAssets?.length) {
    const bySlot = buildingAssets.find((row) => {
      const meta =
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : {}
      if (meta.registryAssetType === slot.registryAssetType) {
        if (slot.registryAssetType !== "appliance") return true
        return meta.applianceSubtype === slot.applianceSubtype
      }
      return false
    })
    const byModel =
      model
        ? buildingAssets.find(
          (row) =>
            row.model &&
            String(row.model).toLowerCase() === model.toLowerCase() &&
            String(row.appliance_type || "").toLowerCase().includes(
              itemType.toLowerCase().slice(0, 12),
            ),
        )
        : null
    const byTypeBrand = buildingAssets.find((row) => {
      const typeOk = String(row.appliance_type || "").toLowerCase() === itemType.toLowerCase()
      if (!typeOk) return false
      if (model && row.model) return String(row.model).toLowerCase() === model.toLowerCase()
      if (brand && row.brand) return String(row.brand).toLowerCase() === brand.toLowerCase()
      return !model && !brand
    })
    const match = bySlot || byModel || byTypeBrand
    if (match) {
      existingId = String(match.id)
      existingRow = {
        id: String(match.id),
        brand: match.brand,
        model: match.model,
        estimated_age_years:
          match.estimated_age_years != null ? Number(match.estimated_age_years) : null,
        detection_source: match.detection_source,
        metadata:
          match.metadata && typeof match.metadata === "object"
            ? (match.metadata as Record<string, unknown>)
            : {},
      }
    }
  }

  const prevMeta = existingRow?.metadata ?? {}
  const fieldConflicts: Array<{ field: string; manualValue: string; aiValue: string }> =
    Array.isArray(prevMeta.fieldConflicts)
      ? [...(prevMeta.fieldConflicts as Array<{ field: string; manualValue: string; aiValue: string }>)]
      : []

  // Preserve manually entered service/inspection dates and known ages on conflict
  let ageYears = aiAgeYears
  let ageBasis: "known" | "ai_estimated" | "estimated_from_build_year" = aiAgeBasis
  const manualAgeProtected = isManualProvenance(prevMeta, "age")
  const prevAge =
    existingRow?.estimated_age_years != null && existingRow.estimated_age_years > 0
      ? existingRow.estimated_age_years
      : null

  if (manualAgeProtected && prevAge != null && aiAgeYears != null && agesConflict(prevAge, aiAgeYears)) {
    ageYears = prevAge
    ageBasis = "known"
    const already = fieldConflicts.some((c) => c.field === "age")
    if (!already) {
      fieldConflicts.push({
        field: "age",
        manualValue: String(prevAge),
        aiValue: String(aiAgeYears),
      })
    }
  } else if (manualAgeProtected && prevAge != null && aiAgeYears == null) {
    ageYears = prevAge
    ageBasis = "known"
  } else if (
    prevMeta.ageBasis === "estimated_from_build_year" &&
    (aiAgeYears == null || aiAgeBasis !== "known")
  ) {
    // Keep build-year estimate when AI has no stronger signal
    if (prevAge != null && aiAgeYears == null) {
      ageYears = prevAge
      ageBasis = "estimated_from_build_year"
    }
  }

  const preserveManualBrand =
    isManualProvenance(prevMeta, "brand") &&
    existingRow?.brand &&
    brand &&
    existingRow.brand.toLowerCase() !== brand.toLowerCase()

  if (preserveManualBrand) {
    const already = fieldConflicts.some((c) => c.field === "brand")
    if (!already) {
      fieldConflicts.push({
        field: "brand",
        manualValue: String(existingRow!.brand),
        aiValue: brand!,
      })
    }
  }

  const mergedBrand = preserveManualBrand
    ? existingRow!.brand
    : brand || existingRow?.brand || null
  const mergedModel = model || existingRow?.model || null

  const lastServiceDate =
    typeof prevMeta.lastServiceDate === "string" ? prevMeta.lastServiceDate : null
  const lastInspectionDate =
    typeof prevMeta.lastInspectionDate === "string" ? prevMeta.lastInspectionDate : null

  const derived = failureFromCondition(result.condition.rating, ageYears, life)

  const priorSource = prevMeta.source
  const source =
    priorSource === "manual" || priorSource === "manual_updated" ||
      existingRow?.detection_source === "manual" ||
      existingRow?.detection_source === "manual_updated"
      ? "manual_updated"
      : "ai_inspection"

  const metadata = {
    ...prevMeta,
    deficiencies: result.deficiencies,
    maintenanceRecommendations: result.maintenanceRecommendations,
    sourcePhotoUrl: input.storagePath,
    provider: input.provider,
    rawAiResult: result,
    ageConfidence: result.estimatedAge.confidence,
    ageBasis,
    serialNumber: serial || prevMeta.serialNumber || null,
    conditionRating: result.condition.rating,
    conditionSummary: result.condition.summary,
    category: result.category === "other" || result.category === "unknown"
      ? slot.registryAssetType
      : result.category,
    registryAssetType: slot.registryAssetType,
    applianceSubtype: slot.applianceSubtype,
    fuelType:
      slot.registryAssetType === "boiler"
        ? result.identifiedItem.fuelType ?? prevMeta.fuelType ?? null
        : prevMeta.fuelType ?? null,
    btuOutput:
      slot.registryAssetType === "boiler"
        ? result.identifiedItem.btuOutput ?? prevMeta.btuOutput ?? null
        : prevMeta.btuOutput ?? null,
    assessmentId,
    photoId,
    rawConfidenceNotes: result.rawConfidenceNotes ?? null,
    source,
    lastAssessedDate: now,
    lastServiceDate,
    lastInspectionDate,
    fieldProvenance: {
      ...(typeof prevMeta.fieldProvenance === "object" && prevMeta.fieldProvenance
        ? prevMeta.fieldProvenance as Record<string, unknown>
        : {}),
      age: manualAgeProtected && ageBasis === "known"
        ? "manual"
        : ageBasis === "ai_estimated"
          ? "ai"
          : prevMeta.fieldProvenance &&
              typeof prevMeta.fieldProvenance === "object" &&
              (prevMeta.fieldProvenance as Record<string, unknown>).age
            ? (prevMeta.fieldProvenance as Record<string, unknown>).age
            : ageBasis,
    },
    fieldConflicts,
    lastUpdatedBy: "ai_inspection_confirm",
    lastUpdatedAt: now,
  }

  const assetPayload = {
    landlord_id: landlordId,
    property_id: scope.propertyId,
    unit_id: scope.unitId,
    building,
    unit_label: null as string | null,
    appliance_type: itemType.slice(0, 120),
    appliance_label: [mergedBrand, itemType].filter(Boolean).join(" ").slice(0, 160) || itemType,
    brand: mergedBrand,
    model: mergedModel,
    estimated_age_years: ageYears != null && ageYears >= 0 ? ageYears : 0,
    useful_life_years: life,
    failure_risk_pct: derived.risk,
    failure_prediction_window: derived.window,
    replacement_recommended: derived.replace,
    replacement_urgency: derived.urgency,
    detection_source: source === "manual_updated" ? "manual_updated" : "photo_ai",
    detection_confidence:
      result.estimatedAge.confidence === "high"
        ? 0.9
        : result.estimatedAge.confidence === "medium"
          ? 0.65
          : 0.35,
    last_detected_at: now,
    due_at: addMonths(
      now,
      result.maintenanceRecommendations[0]?.suggestedIntervalMonths ?? 12,
    ),
    task_kind:
      slot.registryAssetType === "roof" || slot.registryAssetType === "hvac"
        ? "inspection"
        : slot.registryAssetType === "appliance"
          ? "appliance"
          : "service", // water_heater, boiler, electrical_panel
    metadata,
    updated_at: now,
  }

  let unitAssetId = existingId
  if (existingId) {
    const { error } = await supabase
      .from("unit_assets")
      .update(assetPayload)
      .eq("id", existingId)
    if (error) throw new Error(`Failed to update asset: ${error.message}`)
  } else {
    const { data, error } = await supabase
      .from("unit_assets")
      .insert(assetPayload)
      .select("id")
      .single()
    if (error || !data?.id) {
      throw new Error(`Failed to create asset: ${error?.message ?? "unknown"}`)
    }
    unitAssetId = String(data.id)
  }

  const recs =
    result.maintenanceRecommendations.length > 0
      ? result.maintenanceRecommendations
      : [
          {
            action:
              slot.registryAssetType === "boiler"
                ? `Annual professional service for ${itemType}`
                : `Inspect / service ${itemType}`,
            urgency: "routine" as const,
            suggestedIntervalMonths: 12,
          },
        ]

  const taskIds: string[] = []
  // Avoid duplicate open tasks for the same asset from repeat inspections
  const { data: openTasks } = await supabase
    .from("preventive_maintenance_tasks")
    .select("id")
    .eq("unit_asset_id", unitAssetId!)
    .neq("status", "cancelled")
    .neq("status", "completed")
    .limit(5)

  if (!openTasks?.length) {
    for (const rec of recs) {
      const months = rec.suggestedIntervalMonths && rec.suggestedIntervalMonths > 0
        ? rec.suggestedIntervalMonths
        : 12
      const taskKind =
        slot.registryAssetType === "hvac" ||
          slot.registryAssetType === "water_heater" ||
          slot.registryAssetType === "boiler" ||
          slot.registryAssetType === "roof"
          ? "service"
          : "appliance"
      const { data: task, error: taskError } = await supabase
        .from("preventive_maintenance_tasks")
        .insert({
          landlord_id: landlordId,
          unit_asset_id: unitAssetId,
          title: rec.action.slice(0, 200),
          task_kind: taskKind,
          due_at: addMonths(now, months),
          status: "scheduled",
          building,
          unit_label: null,
          metadata: {
            urgency: rec.urgency,
            suggestedIntervalMonths: months,
            source: "inspection_assessment",
            photoId,
            assessmentId,
            conditionRating: result.condition.rating,
            registryAssetType: slot.registryAssetType,
          },
        })
        .select("id")
        .single()

      if (taskError) {
        console.error("[confirmInspectionAssessment] task insert", taskError.message)
        continue
      }
      if (task?.id) taskIds.push(String(task.id))
    }
  } else {
    taskIds.push(...openTasks.map((t) => String(t.id)))
  }

  await supabase
    .from("property_inspection_photos")
    .update({
      status: "confirmed",
      confirmed_result: result,
      unit_asset_id: unitAssetId,
      updated_at: now,
    })
    .eq("id", photoId)

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "inspection.asset_assessment_confirmed",
    source: "dashboard",
    actor_type: "landlord",
    actor_id: input.actorId ?? null,
    property_id: scope.propertyId,
    unit_id: scope.unitId,
    metadata: {
      building,
      unit_asset_id: unitAssetId,
      photo_id: photoId,
      assessment_id: assessmentId,
      appliance_type: itemType,
      registry_asset_type: slot.registryAssetType,
      asset_source: source,
      age_basis: ageBasis,
      field_conflicts: fieldConflicts,
      task_ids: taskIds,
      provider: input.provider,
      condition_rating: result.condition.rating,
      has_safety_hazard: result.deficiencies.some((d) => d.severity === "safety_hazard"),
    },
  })

  return { unitAssetId: unitAssetId!, taskIds }
}
