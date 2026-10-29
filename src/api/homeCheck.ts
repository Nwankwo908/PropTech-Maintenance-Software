import type { LabelReadability } from '@shared/vision/equipmentLabel'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { compressImageForVision } from '@/lib/imageCompress'
import { supabase } from '@/lib/supabase'
import type {
  HomeCheckAnswers,
  HomeCheckAsset,
  HomeCheckMetricRow,
  homeCheckMetrics,
  HomeCheckRole,
  HomeCheckTarget,
} from '@shared/homeCheck'

export type HomeCheckPublic = {
  feedback?: Array<
    {
      slot: string
      state: string
      retakeMessage: string | null
      uncertainCharacters: LabelReadability['uncertainCharacters']
      formatWarnings: string[]
    }
  >
  id: string
  reference: string
  role: HomeCheckRole
  location: string
  expiresAt: string
  slots: string[]
  status: string
}
export type HomeCheckSummaryRow = HomeCheckMetricRow & {
  id: string
  reference: string
  property_label: string
  unit_label: string | null
  status: string
  expires_at: string
  assets: Array<HomeCheckAsset & { id: string }>
  photos: Array<{ slot: string; previewUrl: string | null; state?: string }>
  answers?: HomeCheckAnswers
  detected_warning?: string | null
}
export type HomeCheckVendor = {
  id: string
  name: string
  distanceKm: number | null
  latitude?: number | null
  longitude?: number | null
  states?: string[]
  preferred?: boolean
  preferred_emergency?: boolean
}
export type HomeCheckOptions = {
  targets: HomeCheckTarget[]
  vendors: HomeCheckVendor[]
  closest: string | null
  propertyState?: string | null
}
export type HomeCheckList = {
  checks: HomeCheckSummaryRow[]
  metrics: ReturnType<typeof homeCheckMetrics>
}

export async function homeCheckRequest<T>(
  body: Record<string, unknown>,
  publicCapture = false,
): Promise<T> {
  if (!supabase) throw new Error('Connect Supabase to use Home Check.')
  const { data, error } = await supabase.functions.invoke('home-check', {
    body: publicCapture ? body : { ...body, landlordId: getActiveLandlordId() },
  })
  if (error) {
    let message = error.message
    if ('context' in error && error.context instanceof Response) {
      try {
        message = (await error.context.json()).error || message
      } catch { /* keep original error */ }
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(String(data.error))
  return data as T
}

export async function requestPlatformHomeCheck(input: {
  propertyId: string
  vendorId: string
}): Promise<{
  ok: true
  checkId: string
  workflowRunId: string
  vendorName: string
  deliveryError: string | null
}> {
  return homeCheckRequest({
    action: 'request',
    propertyId: input.propertyId,
    vendorId: input.vendorId,
  })
}

/** Landlord dashboard photo. No public link and no text. */
export async function uploadDashboardEquipmentPhoto(input: {
  propertyId: string
  file: File
}): Promise<{ checkId: string; slot: string }> {
  const image = await compressImageForVision(input.file)
  if (!image.base64 || image.contentType === 'application/pdf') {
    throw new Error('Use a photo of the equipment.')
  }
  return homeCheckRequest({
    action: 'dashboard_photo',
    propertyId: input.propertyId,
    imageBase64: image.base64,
    contentType: image.contentType,
  })
}
