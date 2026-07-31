import { getActiveLandlordId } from '@/lib/activeLandlord'
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
    previewUrl: previewUrl ?? null,
    unitAssetId: p.unitAssetId ?? null,
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const landlordId = getActiveLandlordId()
  if (!landlordId) throw new Error('No active landlord selected')

  const { data, error } = await supabase.functions.invoke('inspection-asset-assess', {
    body: { ...body, landlordId },
  })
  if (error) {
    const msg =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: unknown }).error)
        : error.message
    throw new Error(msg || 'Inspection assessment request failed')
  }
  if (data && typeof data === 'object' && 'error' in data && (data as { error: unknown }).error) {
    throw new Error(String((data as { error: unknown }).error))
  }
  return data as T
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
  return (data.photos ?? []).map((p) => mapPhoto(p))
}

export async function uploadAndAnalyzeInspectionPhoto(input: {
  assessmentId: string
  imageBase64: string
  contentType: string
  fileName: string
  hintCategory?: VisionHintCategory | null
  mode?: 'photo' | 'document'
  previewUrl?: string | null
}): Promise<InspectionPhotoRow> {
  const data = await invoke<{ photo: ApiPhoto }>({
    action: 'upload_and_analyze',
    assessmentId: input.assessmentId,
    imageBase64: input.imageBase64,
    contentType: input.contentType,
    fileName: input.fileName,
    hintCategory: input.hintCategory ?? null,
    mode: input.mode ?? 'photo',
  })
  return mapPhoto(data.photo, input.previewUrl)
}

export async function retryInspectionPhoto(photoId: string): Promise<InspectionPhotoRow> {
  const data = await invoke<{ photo: ApiPhoto }>({
    action: 'retry',
    photoId,
  })
  return mapPhoto(data.photo)
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
