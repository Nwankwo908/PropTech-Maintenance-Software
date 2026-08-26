/**
 * Organization logo upload — private onboarding bucket + durable path in landlords.logo_url.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import { LANDLORD_ONBOARDING_DOCUMENTS_BUCKET } from '@/lib/onboardingDocumentUpload'
import { supabase } from '@/lib/supabase'

export const LOGO_MAX_BYTES = 2 * 1024 * 1024

export const LOGO_ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
])

const STORAGE_REF_PREFIX = 'storage:'
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days; refreshed on settings load

export function buildLogoStoragePath(landlordId: string, fileName: string): string {
  const ext = extensionForFile(fileName)
  return `${landlordId}/branding/logo.${ext}`
}

export function encodeLogoStorageRef(bucket: string, path: string): string {
  return `${STORAGE_REF_PREFIX}${bucket}/${path}`
}

export function parseLogoStorageRef(
  raw: string | null | undefined,
): { bucket: string; path: string } | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return null

  if (value.startsWith(STORAGE_REF_PREFIX)) {
    const rest = value.slice(STORAGE_REF_PREFIX.length)
    const slash = rest.indexOf('/')
    if (slash <= 0) return null
    return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) }
  }

  // Legacy: bare path under the onboarding documents bucket
  if (!/^https?:\/\//i.test(value) && value.includes('/')) {
    return { bucket: LANDLORD_ONBOARDING_DOCUMENTS_BUCKET, path: value }
  }

  return null
}

export async function resolveLogoDisplayUrl(
  logoRef: string | null | undefined,
): Promise<string> {
  const value = typeof logoRef === 'string' ? logoRef.trim() : ''
  if (!value) return ''

  if (/^https?:\/\//i.test(value)) return value

  const parsed = parseLogoStorageRef(value)
  if (!parsed || !supabase) return ''

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) {
    console.warn('[landlordLogoUpload] signed URL failed', error?.message)
    return ''
  }
  return data.signedUrl
}

export function validateLogoFile(file: File): string | null {
  const mime = (file.type || '').toLowerCase()
  if (!LOGO_ALLOWED_MIME.has(mime)) {
    return 'Use a PNG, JPG, WebP, or SVG image.'
  }
  if (file.size > LOGO_MAX_BYTES) {
    return 'Logo must be 2 MB or smaller.'
  }
  return null
}

export async function uploadLandlordLogo(
  file: File,
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: true; logoRef: string; displayUrl: string } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Storage unavailable.' }
  if (!landlordId.trim()) return { ok: false, error: 'Missing landlord id.' }

  const validationError = validateLogoFile(file)
  if (validationError) return { ok: false, error: validationError }

  const storagePath = buildLogoStoragePath(landlordId, file.name)
  const { error } = await supabase.storage
    .from(LANDLORD_ONBOARDING_DOCUMENTS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'image/png',
      upsert: true,
    })

  if (error) {
    return { ok: false, error: getErrorMessage(error, 'Could not upload logo.') }
  }

  const logoRef = encodeLogoStorageRef(LANDLORD_ONBOARDING_DOCUMENTS_BUCKET, storagePath)
  const displayUrl = await resolveLogoDisplayUrl(logoRef)
  return { ok: true, logoRef, displayUrl: displayUrl || '' }
}

export async function removeLandlordLogoObject(
  logoRef: string | null | undefined,
): Promise<void> {
  const parsed = parseLogoStorageRef(logoRef)
  if (!parsed || !supabase) return
  await supabase.storage.from(parsed.bucket).remove([parsed.path])
}

function extensionForFile(fileName: string): string {
  const match = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/)
  const ext = match?.[1]
  if (ext === 'jpeg') return 'jpg'
  if (ext === 'svg') return 'svg'
  if (ext === 'png' || ext === 'jpg' || ext === 'webp') return ext
  return 'png'
}
