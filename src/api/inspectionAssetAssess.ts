import { getActiveLandlordId } from '@/lib/activeLandlord'
import { pickBuildingInspectionWriteSessionId } from '@/lib/inspectionSession'
import { recordActivityLog } from '@/lib/recordActivityLog'
import { supabase } from '@/lib/supabase'
import type {
  ApplianceVisionResult,
  InspectionPhotoRow,
  VisionHintCategory,
} from '@/lib/vision/types'

type ApiPhoto = {
  id: string
  assessmentId: string
  storagePath: string | null
  hintCategory: string | null
  status: InspectionPhotoRow['status']
  aiResult: ApplianceVisionResult | null
  confirmedResult: ApplianceVisionResult | null
  provider: InspectionPhotoRow['provider']
  errorMessage: string | null
  latencyMs: number | null
  fileName: string | null
  contentType?: string | null
  createdAt?: string | null
  unitAssetId?: string | null
}

function mapPhoto(p: ApiPhoto, previewUrl?: string | null): InspectionPhotoRow {
  return {
    id: p.id,
    assessmentId: p.assessmentId,
    storagePath: p.storagePath,
    hintCategory: (p.hintCategory as VisionHintCategory | null) ?? null,
    status: p.status,
    aiResult: p.aiResult,
    confirmedResult: p.confirmedResult,
    provider: p.provider,
    errorMessage: p.errorMessage,
    latencyMs: p.latencyMs,
    fileName: p.fileName,
    contentType: p.contentType ?? null,
    createdAt: p.createdAt ?? null,
    previewUrl: previewUrl ?? null,
    unitAssetId: p.unitAssetId ?? null,
  }
}

function mapDbPhoto(row: Record<string, unknown>): InspectionPhotoRow {
  return mapPhoto({
    id: String(row.id),
    assessmentId: String(row.assessment_id),
    storagePath: row.storage_path != null ? String(row.storage_path) : null,
    hintCategory: row.hint_category != null ? String(row.hint_category) : null,
    status: String(row.status) as InspectionPhotoRow['status'],
    aiResult: (row.ai_result as ApplianceVisionResult | null) ?? null,
    confirmedResult: (row.confirmed_result as ApplianceVisionResult | null) ?? null,
    provider: (row.provider as InspectionPhotoRow['provider']) ?? null,
    errorMessage: row.error_message != null ? String(row.error_message) : null,
    latencyMs: typeof row.latency_ms === 'number' ? row.latency_ms : null,
    fileName: row.file_name != null ? String(row.file_name) : null,
    contentType: row.content_type != null ? String(row.content_type) : null,
    createdAt: row.created_at != null ? String(row.created_at) : null,
    unitAssetId: row.unit_asset_id != null ? String(row.unit_asset_id) : null,
  })
}

const SIGN_TTL_SECONDS = 3600

export async function signInspectionUploadUrls(paths: string[]): Promise<Map<string, string>> {
  const signed = new Map<string, string>()
  const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
  if (unique.length === 0 || !supabase) return signed
  const { data, error } = await supabase.storage
    .from('inspection-uploads')
    .createSignedUrls(unique, SIGN_TTL_SECONDS)
  if (error || !Array.isArray(data)) return signed
  data.forEach((entry, index) => {
    const record = entry as {
      path?: string | null
      signedUrl?: string | null
      signedURL?: string | null
      error?: unknown
    }
    if (record.error) return
    const path = record.path?.trim() || unique[index]
    const url = record.signedUrl || record.signedURL
    if (path && url) signed.set(path, url)
  })
  return signed
}

export async function withInspectionPreviewUrls(
  photos: InspectionPhotoRow[],
): Promise<InspectionPhotoRow[]> {
  const urls = await signInspectionUploadUrls(
    photos.map((photo) => photo.storagePath ?? '').filter(Boolean),
  )
  return photos.map((photo) => ({
    ...photo,
    previewUrl:
      photo.previewUrl ||
      (photo.storagePath ? urls.get(photo.storagePath) ?? null : null),
  }))
}

function inspectionInvokeError(data: unknown, fallback: string): Error {
  if (data && typeof data === 'object') {
    const payload = data as {
      error?: unknown
      extractedAddress?: unknown
      expectedAddress?: unknown
    }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return new Error(payload.error.trim())
    }
  }
  return new Error(fallback)
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const landlordId = getActiveLandlordId()
  if (!landlordId) throw new Error('No active landlord selected')
  if (!supabase) throw new Error('Database unavailable')

  const { data, error } = await supabase.functions.invoke('inspection-asset-assess', {
    body: { ...body, landlordId },
  })
  let payload: unknown = data
  if (error && (payload == null || typeof payload !== 'object')) {
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context
    if (typeof context?.json === 'function') {
      try {
        payload = await context.json()
      } catch {
        payload = data
      }
    }
  }
  if (error) {
    throw inspectionInvokeError(
      payload,
      typeof error.message === 'string' && error.message.trim()
        ? error.message
        : 'Inspection assessment request failed',
    )
  }
  if (payload && typeof payload === 'object' && 'error' in payload && (payload as { error: unknown }).error) {
    throw inspectionInvokeError(payload, 'Inspection assessment request failed')
  }
  return payload as T
}

export async function createInspectionAssessment(building: string): Promise<{ id: string }> {
  const data = await invoke<{ assessment: { id: string } }>({
    action: 'create_assessment',
    building,
  })
  return { id: data.assessment.id }
}

export async function listInspectionPhotos(assessmentId: string): Promise<InspectionPhotoRow[]> {
  const data = await invoke<{ photos: ApiPhoto[] }>({
    action: 'list_photos',
    assessmentId,
  })
  return withInspectionPreviewUrls((data.photos ?? []).map((p) => mapPhoto(p)))
}

/** Reuse the building's existing photos instead of starting an empty session. */
export async function loadBuildingInspectionSession(building: string): Promise<{
  id: string
  photos: InspectionPhotoRow[]
}> {
  const landlordId = getActiveLandlordId()
  if (!landlordId) throw new Error('No active landlord selected')

  if (supabase) {
    const { data: sessions } = await supabase
      .from('property_inspection_assessments')
      .select('id, created_at')
      .eq('landlord_id', landlordId)
      .eq('building', building)
      .in('status', ['open', 'completed'])
      .order('created_at', { ascending: false })
      .limit(40)

    const sessionIds = (sessions ?? []).map((session) => String(session.id))
    if (sessionIds.length > 0) {
      const { data: rows } = await supabase
        .from('property_inspection_photos')
        .select('*')
        .in('assessment_id', sessionIds)
        .order('created_at', { ascending: true })

      const allPhotos = (rows ?? []).map((row) => mapDbPhoto(row as Record<string, unknown>))
      const activeId = pickBuildingInspectionWriteSessionId(sessionIds, allPhotos) ?? sessionIds[0]!
      const photos = await withInspectionPreviewUrls(allPhotos)
      return { id: activeId, photos }
    }
  }

  const created = await createInspectionAssessment(building)
  return { id: created.id, photos: [] }
}

const MAX_INSPECTION_UPLOAD_BYTES = 25 * 1024 * 1024
/** Files over this size (and PDFs) upload to storage instead of the function body. */
const DIRECT_UPLOAD_MIN_BYTES = 1.5 * 1024 * 1024

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

export async function uploadAndAnalyzeInspectionPhoto(input: {
  assessmentId: string
  contentType: string
  fileName: string
  hintCategory?: VisionHintCategory | null
  mode?: 'photo' | 'document'
  autoConfirm?: boolean
  previewUrl?: string | null
  blob?: Blob
  imageBase64?: string
}): Promise<InspectionPhotoRow> {
  const blob = input.blob
  if (blob && blob.size > MAX_INSPECTION_UPLOAD_BYTES) {
    throw new Error('Each file must be 25MB or smaller.')
  }

  const useDirectUpload =
    Boolean(blob) &&
    (input.contentType.includes('pdf') || (blob?.size ?? 0) > DIRECT_UPLOAD_MIN_BYTES)

  if (useDirectUpload && blob) {
    if (!supabase) throw new Error('Database unavailable')
    const prepared = await invoke<{ storagePath: string; token: string }>({
      action: 'create_upload_url',
      assessmentId: input.assessmentId,
      contentType: input.contentType,
      fileName: input.fileName,
    })
    const { error: upErr } = await supabase.storage
      .from('inspection-uploads')
      .uploadToSignedUrl(prepared.storagePath, prepared.token, blob, {
        contentType: input.contentType,
      })
    if (upErr) throw new Error(upErr.message || 'Upload failed')
    const data = await invoke<{ photo: ApiPhoto }>({
      action: 'ingest_stored',
      assessmentId: input.assessmentId,
      storagePath: prepared.storagePath,
      contentType: input.contentType,
      fileName: input.fileName,
      hintCategory: input.hintCategory ?? null,
      mode: input.mode ?? 'photo',
      autoConfirm: input.autoConfirm === true,
    })
    const mapped = mapPhoto(data.photo, input.previewUrl)
    if (mapped.previewUrl || !mapped.storagePath) return mapped
    const [withUrl] = await withInspectionPreviewUrls([mapped])
    return withUrl ?? mapped
  }

  const imageBase64 = input.imageBase64 || (blob ? await blobToBase64(blob) : '')
  if (!imageBase64) throw new Error('File data is required')

  const data = await invoke<{ photo: ApiPhoto }>({
    action: 'upload_and_analyze',
    assessmentId: input.assessmentId,
    imageBase64,
    contentType: input.contentType,
    fileName: input.fileName,
    hintCategory: input.hintCategory ?? null,
    mode: input.mode ?? 'photo',
    autoConfirm: input.autoConfirm === true,
  })
  const mapped = mapPhoto(data.photo, input.previewUrl)
  if (mapped.previewUrl || !mapped.storagePath) return mapped
  const [withUrl] = await withInspectionPreviewUrls([mapped])
  return withUrl ?? mapped
}

export async function retryInspectionPhoto(photoId: string): Promise<InspectionPhotoRow> {
  const data = await invoke<{ photo: ApiPhoto }>({
    action: 'retry',
    photoId,
  })
  return (await withInspectionPreviewUrls([mapPhoto(data.photo)]))[0]!
}

export async function removeInspectionPhoto(photoId: string): Promise<void> {
  await invoke({
    action: 'remove_photo',
    photoId,
  })
}

export async function removeInspectionAsset(assetId: string): Promise<void> {
  await invoke({
    action: 'remove_asset',
    assetId,
  })
}

export async function updateInspectionAssetDetails(input: {
  assetId: string
  result: ApplianceVisionResult
}): Promise<void> {
  const landlordId = getActiveLandlordId()
  if (!landlordId) throw new Error('No active landlord selected')
  if (!supabase) throw new Error('Database unavailable')

  const { data: existing, error: loadError } = await supabase
    .from('unit_assets')
    .select('id, metadata, building')
    .eq('id', input.assetId)
    .eq('landlord_id', landlordId)
    .maybeSingle()
  if (loadError) throw new Error(loadError.message)
  if (!existing) throw new Error('Asset not found')

  const itemType = input.result.identifiedItem.type.trim() || 'Equipment'
  const brand = input.result.identifiedItem.brand?.trim() || null
  const model = input.result.identifiedItem.modelNumber?.trim() || null
  const serial = input.result.identifiedItem.serialNumber?.trim() || null
  const prevMeta =
    existing.metadata && typeof existing.metadata === 'object'
      ? (existing.metadata as Record<string, unknown>)
      : {}
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('unit_assets')
    .update({
      appliance_type: itemType.slice(0, 120),
      appliance_label: [brand, itemType].filter(Boolean).join(' ').slice(0, 160) || itemType,
      brand,
      model,
      metadata: {
        ...prevMeta,
        rawAiResult: input.result,
        serialNumber: serial,
        conditionRating: input.result.condition.rating,
        conditionSummary: input.result.condition.summary,
        category: input.result.category,
        deficiencies: input.result.deficiencies,
        maintenanceRecommendations: input.result.maintenanceRecommendations,
        rawConfidenceNotes: input.result.rawConfidenceNotes ?? null,
        lastUpdatedBy: 'inspection_table_edit',
        lastUpdatedAt: now,
      },
      updated_at: now,
    })
    .eq('id', input.assetId)
    .eq('landlord_id', landlordId)
  if (error) throw new Error(error.message)

  await recordActivityLog({
    landlordId,
    eventType: 'inspection.asset_updated',
    source: 'dashboard',
    actorType: 'landlord',
    metadata: {
      message: `${itemType} details were updated from the inspection table.`,
      unit_asset_id: input.assetId,
      building: existing.building != null ? String(existing.building) : null,
    },
  })
}

export async function confirmInspectionPhoto(input: {
  photoId: string
  result: ApplianceVisionResult
}): Promise<{ unitAssetId: string; taskIds: string[] }> {
  return invoke({
    action: 'confirm',
    photoId: input.photoId,
    result: input.result,
  })
}

export type InspectionAssetSummary = {
  id: string
  appliance_type: string
  appliance_label: string
  brand: string | null
  model: string | null
  estimated_age_years: number
  replacement_urgency: string
  failure_risk_pct: number
  detection_source: string
  last_detected_at: string | null
  metadata: Record<string, unknown> | null
}

export async function listInspectionAssets(building: string): Promise<InspectionAssetSummary[]> {
  const data = await invoke<{ assets: InspectionAssetSummary[] }>({
    action: 'list_assets',
    building,
  })
  return data.assets ?? []
}
