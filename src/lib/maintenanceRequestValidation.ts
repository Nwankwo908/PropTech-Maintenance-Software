export type MaintenanceField =
  | 'urgency'
  | 'residentName'
  | 'email'
  | 'phone'
  | 'unit'
  | 'description'
  | 'photo'

export type ResidentNotificationPreference = 'email' | 'sms' | 'both'

export type MaintenanceFormValues = {
  urgency: string
  residentName: string
  email: string
  /** Optional mobile for SMS updates (US-style or E.164). */
  phone: string
  /** How the resident wants lifecycle updates delivered. */
  residentNotificationChannel: ResidentNotificationPreference
  unit: string
  description: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function loosePhoneDigitsOk(s: string): boolean {
  const d = s.replace(/\D/g, '')
  return d.length >= 10
}

/** Photos + short video clips */
const MAX_MEDIA_BYTES = 50 * 1024 * 1024

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg'])
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
])

const MEDIA_EXT_RE = /\.(png|jpe?g|mp4|webm|mov)$/i

function isAllowedMediaFile(file: File): boolean {
  if (ALLOWED_IMAGE_TYPES.has(file.type) || ALLOWED_VIDEO_TYPES.has(file.type)) {
    return true
  }
  if (!file.type && MEDIA_EXT_RE.test(file.name)) {
    return true
  }
  return false
}

export function validateMaintenanceForm(
  values: MaintenanceFormValues,
  files: File[],
): Partial<Record<MaintenanceField, string>> {
  const errors: Partial<Record<MaintenanceField, string>> = {}

  if (!values.urgency) {
    errors.urgency = 'Select an urgency level.'
  }

  const name = values.residentName.trim()
  if (!name) {
    errors.residentName = 'Enter your full name.'
  } else if (name.length < 2) {
    errors.residentName = 'Use at least 2 characters.'
  }

  const email = values.email.trim()
  if (!email) {
    errors.email = 'Enter your email address.'
  } else if (!EMAIL_RE.test(email)) {
    errors.email = 'Enter a valid email address.'
  }

  const phone = values.phone.trim()
  if (phone && !loosePhoneDigitsOk(phone)) {
    errors.phone = 'Enter a valid phone number or leave blank.'
  }

  const unit = values.unit.trim()
  if (!unit) {
    errors.unit = 'Enter your unit number.'
  }

  const desc = values.description.trim()
  if (!desc) {
    errors.description = 'Describe the issue.'
  } else if (desc.length < 15) {
    errors.description = 'Add a bit more detail (at least 15 characters).'
  }

  if (files.length === 0) {
    errors.photo = 'Add at least one photo or video.'
  } else {
    for (const file of files) {
      if (file.size === 0) {
        errors.photo = `"${file.name}" is empty.`
        break
      }
      if (!isAllowedMediaFile(file)) {
        errors.photo = `"${file.name}" must be PNG, JPG, MP4, WebM, or MOV.`
        break
      }
      if (file.size > MAX_MEDIA_BYTES) {
        errors.photo = `"${file.name}" must be 50MB or smaller.`
        break
      }
    }
  }

  return errors
}

export function isFormValid(
  values: MaintenanceFormValues,
  files: File[],
): boolean {
  return Object.keys(validateMaintenanceForm(values, files)).length === 0
}
