import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'
import type { InspectionCaptureSessionStatus } from '@/lib/inspectionCaptureStatus'

export type InspectionCaptureSession = {
  id: string
  status: InspectionCaptureSessionStatus
  expiresAt: string
  connectedAt: string | null
  assessmentId: string | null
  photoCount: number
  propertyName: string
  propertyAddress: string
}

export type InspectionCapturePhoto = {
  id: string
  inspectionPhotoId: string | null
  storagePath: string
  mimeType: string | null
  fileSize: number | null
  source: string
  processingStatus: string
  createdAt: string
  previewUrl: string | null
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.functions.invoke('inspection-capture', { body })
  if (error) {
    const msg =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: unknown }).error)
        : error.message
    throw new Error(msg || 'Capture request failed')
  }
  if (data && typeof data === 'object' && 'error' in data && (data as { error: unknown }).error) {
    throw new Error(String((data as { error: unknown }).error))
  }
  return data as T
}

export async function createInspectionCaptureSession(assessmentId: string): Promise<{
  session: InspectionCaptureSession
  token: string
}> {
  const landlordId = getActiveLandlordId()
  return invoke({
    action: 'create_session',
    landlordId,
    assessmentId,
  })
}

export async function completeInspectionCaptureSession(sessionId: string): Promise<void> {
  const landlordId = getActiveLandlordId()
  await invoke({
    action: 'complete_session',
    landlordId,
    sessionId,
  })
}

export async function listInspectionCapturePhotos(sessionId: string): Promise<{
  session: InspectionCaptureSession
  photos: InspectionCapturePhoto[]
}> {
  const landlordId = getActiveLandlordId()
  return invoke({
    action: 'list_photos',
    landlordId,
    sessionId,
  })
}

export async function getInspectionCaptureSession(input: {
  sessionId: string
  token: string
}): Promise<InspectionCaptureSession> {
  const data = await invoke<{ session: InspectionCaptureSession }>({
    action: 'get_session',
    sessionId: input.sessionId,
    token: input.token,
  })
  return data.session
}

export async function uploadInspectionCapturePhoto(input: {
  sessionId: string
  token: string
  imageBase64: string
  contentType: string
  fileName: string
}): Promise<{
  photo: { id: string; inspectionPhotoId: string; processingStatus: string; previewUrl: string | null }
  photoCount: number
}> {
  return invoke({
    action: 'upload_photo',
    sessionId: input.sessionId,
    token: input.token,
    imageBase64: input.imageBase64,
    contentType: input.contentType,
    fileName: input.fileName,
  })
}
