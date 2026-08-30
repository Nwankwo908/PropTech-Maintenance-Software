/**
 * POST verify-external-vendor-compliance (ADMIN_REASSIGN_SECRET).
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { formatAdminEdgeUnauthorizedError, getAdminEdgeSecret } from '@/lib/adminEdgeAuth'

export type ExternalComplianceCheckSource =
  | 'thumbtack'
  | 'state_board'
  | 'certificial'
  | 'admin_attestation'

export type ExternalLicenseCheckDto = {
  status: 'auto_verified' | 'not_found' | 'expired' | 'manual_verified'
  licenseNumber: string | null
  detail: string
  boardLabel: string
  expirationDate: string | null
  simulated: boolean
  checkSource: ExternalComplianceCheckSource
}

export type ExternalCoiCheckDto = {
  status: 'verified' | 'not_found' | 'expired' | 'monitoring'
  policyNumber: string | null
  carrier: string | null
  detail: string
  expirationDate: string | null
  monitoringActive: boolean
  simulated: boolean
  checkSource: ExternalComplianceCheckSource
}

export type ExternalVendorComplianceSubjectInput = {
  name: string
  phone?: string | null
  website?: string | null
  tradeLabel?: string | null
  priceLabel?: string | null
  sources?: string[] | null
}

function resolveUrl(): string | null {
  const explicit = import.meta.env.VITE_VERIFY_EXTERNAL_VENDOR_COMPLIANCE_URL?.trim()
  if (explicit) return explicit
  const reassign = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
  if (reassign) {
    return reassign.replace(
      /admin-reassign-vendor\/?$/,
      'verify-external-vendor-compliance',
    )
  }
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (!base) return null
  return `${base}/functions/v1/verify-external-vendor-compliance`
}

async function invokeCompliance(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = resolveUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    throw new Error('External vendor compliance is not configured (admin Edge URL/secret).')
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let payload: Record<string, unknown> = {}
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    throw new Error(`Compliance check: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const base =
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error
        : `Compliance check failed (${res.status})`
    if (res.status === 401) {
      throw new Error(formatAdminEdgeUnauthorizedError(base))
    }
    throw new Error(base)
  }
  return payload
}

export async function lookupExternalVendorComplianceChecks(
  subject: ExternalVendorComplianceSubjectInput,
): Promise<{ license: ExternalLicenseCheckDto; coi: ExternalCoiCheckDto }> {
  const payload = await invokeCompliance({
    action: 'lookup',
    ...subject,
  })
  const license = payload.license as ExternalLicenseCheckDto | undefined
  const coi = payload.coi as ExternalCoiCheckDto | undefined
  if (!license || !coi) {
    throw new Error('Compliance check returned an incomplete response.')
  }
  return { license, coi }
}

export async function attestExternalVendorLicense(input: {
  subject: ExternalVendorComplianceSubjectInput
  licenseNumber: string
  approverName?: string | null
}): Promise<ExternalLicenseCheckDto> {
  const payload = await invokeCompliance({
    action: 'attest_license',
    ...input.subject,
    licenseNumber: input.licenseNumber,
    approverName: input.approverName ?? null,
  })
  const license = payload.license as ExternalLicenseCheckDto | undefined
  if (!license) throw new Error('Could not verify license.')
  return license
}

export async function attestExternalVendorCoi(input: {
  subject: ExternalVendorComplianceSubjectInput
  approverName?: string | null
}): Promise<ExternalCoiCheckDto> {
  const payload = await invokeCompliance({
    action: 'attest_coi',
    ...input.subject,
    approverName: input.approverName ?? null,
  })
  const coi = payload.coi as ExternalCoiCheckDto | undefined
  if (!coi) throw new Error('Could not confirm COI.')
  return coi
}
