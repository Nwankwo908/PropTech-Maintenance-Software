import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

/** Per-document GPT extraction payload (matches edge function output). */
export type PortfolioDocumentExtractPayload = {
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
}

export type ExtractOnboardingDocumentResult = {
  extracted: PortfolioDocumentExtractPayload
  hasData: boolean
  needsAttention: boolean
}

export async function extractOnboardingDocument(
  input: ExtractOnboardingDocumentInput,
): Promise<ExtractOnboardingDocumentResult> {
  if (!supabase) {
    throw new Error('Supabase is not configured')
  }

  const landlordId = input.landlordId?.trim() || getActiveLandlordId()
  const { data, error } = await supabase.functions.invoke('onboarding-document-extract', {
    body: {
      landlordId,
      docId: input.docId,
      fileName: input.fileName,
      documentCategory: input.documentCategory,
      storageBucket: input.storageBucket ?? undefined,
      storagePath: input.storagePath ?? undefined,
      contentType: input.contentType ?? undefined,
      fileBase64: input.fileBase64 ?? undefined,
    },
  })

  if (error) {
    const msg =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: unknown }).error)
        : error.message
    throw new Error(msg || 'Document extraction failed')
  }

  if (data && typeof data === 'object' && 'error' in data && (data as { error: unknown }).error) {
    throw new Error(String((data as { error: unknown }).error))
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
