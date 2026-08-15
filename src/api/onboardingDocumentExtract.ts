import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
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

function readInvokeErrorBody(data: unknown): string | null {
  if (data && typeof data === 'object' && 'error' in data) {
    const msg = (data as { error: unknown }).error
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  }
  return null
}

async function readHttpErrorMessage(error: FunctionsHttpError): Promise<string | null> {
  const ctx = error.context as Response | undefined
  if (!ctx) return null
  try {
    const json = (await ctx.clone().json()) as { error?: unknown }
    if (typeof json.error === 'string' && json.error.trim()) return json.error.trim()
  } catch {
    try {
      const text = (await ctx.clone().text()).trim()
      return text || null
    } catch {
      return null
    }
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
    if (error instanceof FunctionsFetchError) {
      throw new Error(
        getErrorMessage(
          error.message,
          'Could not reach document scanning. Check your connection and try again.',
        ),
      )
    }

    const fromData = readInvokeErrorBody(data)
    if (fromData) {
      throw new Error(getErrorMessage(fromData, 'Document extraction failed'))
    }

    if (error instanceof FunctionsHttpError) {
      const fromHttp = await readHttpErrorMessage(error)
      throw new Error(
        getErrorMessage(fromHttp ?? error.message, 'Document extraction failed'),
      )
    }

    if (error instanceof FunctionsRelayError) {
      throw new Error(
        getErrorMessage(error.message, 'Document extraction failed. Please try again.'),
      )
    }

    throw new Error(getErrorMessage(error.message, 'Document extraction failed'))
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
