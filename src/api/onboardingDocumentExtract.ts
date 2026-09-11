import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabase'

/** Per-document GPT extraction payload (matches edge function output). */
export type PortfolioDocumentExtractPayload = {
  account?: {
    companyName?: string
    contactName?: string
    email?: string
    phone?: string
  }
  properties: Array<{
    name: string
    streetAddress: string
    city: string
    state: string
    zipCode: string
    propertyType: string
    unitCount: number
    confidence: number
  }>
  units: Array<{ label: string; building: string; confidence: number }>
  residents: Array<{
    fullName: string
    unit: string
    building: string
    phone: string
    email: string
    leaseStart: string
    leaseEnd: string
    monthlyRent: string
    confidence: number
  }>
  vendors: Array<{
    name: string
    category: string
    phone: string
    email: string
    confidence: number
  }>
  leases: Array<{
    residentName: string
    unit: string
    building: string
    leaseStart: string
    leaseEnd: string
    rentAmount: string
    securityDeposit: string
    confidence: number
  }>
  maintenanceIssues: Array<{
    unit: string
    building: string
    category: string
    description: string
    priority: string
    confidence: number
  }>
  financialRecords: Array<{
    recordType: string
    description: string
    amount: string
    period: string
    confidence: number
  }>
  imageLabels: string[]
  warnings: string[]
  extractKind?:
    | 'rent_roll'
    | 'lease'
    | 'insurance_certificate'
    | 'dwelling_policy_declarations'
    | 'homeowners_policy_declarations'
    | 'commercial_property_policy'
    | 'insurance'
    | 'generic'
  roleFacts?: Array<{
    role: string
    label: string
    value: string
    confidence: number
    needsReview: boolean
  }>
  insuranceCertificate?: {
    document_type?: 'certificate_of_liability_insurance'
    named_insured: string | null
    certificate_holder: string | null
    additional_insured: string[]
    producer_agency: string | null
    insurers: Array<{ name: string; policy_number: string | null }>
    policy_number: string | null
    effective_date: string | null
    expiration_date: string | null
    certificate_date: string | null
    general_liability?: string | null
    automobile_liability?: string | null
    workers_compensation?: string | null
    confidence: number
    warnings: string[]
  } | null
  dwellingPolicy?: {
    document_type:
      | 'dwelling_policy_declarations'
      | 'homeowners_policy_declarations'
      | 'commercial_property_policy'
    insurer_name?: string | null
    policy_number?: string | null
    producer_agency_name?: string | null
    named_insured_primary: string | null
    occupancy_type: string | null
    mortgagee_name: string | null
    insured_property_address: string | null
    date_issued: string | null
    policy_effective_date: string | null
    policy_expiration_date: string | null
    coverage_c_personal_property_limit: number | null
    total_annual_premium?: number | null
    coverage_a_dwelling_limit?: number | null
    coverage_d_fair_rental_value_limit?: number | null
    coverage_l_liability_limit?: number | null
    deductible_all_other_perils?: number | null
  } | null
}

export type ExtractOnboardingDocumentInput = {
  landlordId?: string
  docId: string
  fileName: string
  documentCategory: string
  storageBucket?: string | null
  storagePath?: string | null
  contentType?: string | null
  fileBase64?: string
  pageImages?: string[]
  insuranceIntent?: 'property_policy' | 'auto'
}

export type ExtractOnboardingDocumentResult = {
  extracted: PortfolioDocumentExtractPayload
  hasData: boolean
  needsAttention: boolean
}

function readInvokeErrorBody(data: unknown): string | null {
  if (data && typeof data === 'object' && 'error' in data) {
    const msg = (data as { error: unknown }).error
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  }
  return null
}

export async function extractOnboardingDocument(
  input: ExtractOnboardingDocumentInput,
): Promise<ExtractOnboardingDocumentResult> {
  if (!supabase) {
    throw new Error('Supabase is not configured')
  }

  const landlordId = input.landlordId?.trim() || getActiveLandlordId()
  let session = (await supabase.auth.getSession()).data.session
  const expiresAtMs = typeof session?.expires_at === 'number' ? session.expires_at * 1000 : 0
  if (!session?.access_token || expiresAtMs < Date.now() + 60_000) {
    session = (await supabase.auth.refreshSession()).data.session
  }
  if (!session?.access_token) {
    throw new Error('Your sign-in expired. Sign in again, then retry document scanning.')
  }

  const { error: userError } = await supabase.auth.getUser(session.access_token)
  if (userError) {
    throw new Error('Your sign-in expired. Sign in again, then retry document scanning.')
  }

  const functionsUrl = `${String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')}/functions/v1/onboarding-document-extract`
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  if (!functionsUrl.startsWith('http') || !anonKey) {
    throw new Error('Supabase is not configured')
  }

  let response: Response
  try {
    response = await fetch(functionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        'x-ulo-access-token': session.access_token,
      },
      body: JSON.stringify({
        landlordId,
        docId: input.docId,
        fileName: input.fileName,
        documentCategory: input.documentCategory,
        storageBucket: input.storageBucket ?? undefined,
        storagePath: input.storagePath ?? undefined,
        contentType: input.contentType ?? undefined,
        fileBase64: input.fileBase64 ?? undefined,
        pageImages: input.pageImages?.length ? input.pageImages : undefined,
        insuranceIntent: input.insuranceIntent ?? undefined,
      }),
    })
  } catch (err) {
    throw new Error(
      getErrorMessage(
        err,
        'Could not reach document scanning. Check your connection and try again.',
      ),
    )
  }

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    const fromData = readInvokeErrorBody(data)
    throw new Error(getErrorMessage(fromData ?? `Document extraction failed`, 'Document extraction failed'))
  }

  const bodyError = readInvokeErrorBody(data)
  if (bodyError) {
    throw new Error(getErrorMessage(bodyError, 'Document extraction failed'))
  }

  const payload = data as {
    extracted: PortfolioDocumentExtractPayload
    hasData?: boolean
    needsAttention?: boolean
  }

  return {
    extracted: payload.extracted,
    hasData: Boolean(payload.hasData),
    needsAttention: Boolean(payload.needsAttention),
  }
}
