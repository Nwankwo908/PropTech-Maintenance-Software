/**
 * Property Details insurance upload — classify then extract via the same
 * onboarding insurance pipeline (COI vs dwelling / homeowners / commercial).
 */
import { extractOnboardingDocument } from '@/api/onboardingDocumentExtract'
import type { PortfolioDocumentExtractPayload } from '@/api/onboardingDocumentExtract'
import { extractPdfPageTexts, renderPdfFileToJpegDataUrls } from '@/lib/pdfPageImagesBrowser'
import { findRelevantInsurancePages } from '@shared/onboarding/typedDocumentExtract/insuranceClassify'

export type InsuranceBinderScanStage =
  | 'idle'
  | 'uploading'
  | 'scanning'
  | 'extracting'
  | 'complete'
  | 'failed'

export type InsuranceBinderScanProgress = {
  stage: InsuranceBinderScanStage
  label: string
  progress: number
}

export type PropertyInsuranceExtracted = {
  carrier: string
  policyNumber: string
  coverageStartDate: string
  coverageEndDate: string
  renewalDate: string
  claimsContactName: string
  claimsPhone: string
  additionalInsured: boolean
  policyType: string
  premium: string
  coverageAmount: string
  deductible: string
  dwellingCoverage: string
  otherStructures: string
  liability: string
  lossOfRentalIncome: string
}

export type InsuranceBinderScanResult = {
  fileName: string
  extracted: PropertyInsuranceExtracted
  confidence: number
}

const INLINE_BYTES_LIMIT = 4 * 1024 * 1024

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function coiHasPolicyFields(coi: NonNullable<PortfolioDocumentExtractPayload['insuranceCertificate']>): boolean {
  return Boolean(
    asText(coi.insurers?.[0]?.name) ||
      asText(coi.policy_number) ||
      asText(coi.effective_date) ||
      asText(coi.expiration_date),
  )
}

function dwellingHasPolicyFields(
  dwelling: NonNullable<PortfolioDocumentExtractPayload['dwellingPolicy']>,
): boolean {
  return Boolean(
    asText(dwelling.insurer_name) ||
      asText(dwelling.policy_number) ||
      asText(dwelling.policy_effective_date) ||
      asText(dwelling.policy_expiration_date),
  )
}

function fromRoleFacts(
  payload: PortfolioDocumentExtractPayload,
  role: string,
): string {
  const facts = payload.roleFacts ?? []
  const match = facts.find((fact) => fact.role === role && asText(fact.value))
  return asText(match?.value)
}

function amountToInput(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  return String(value)
}

function policyTypeFromDocumentType(value: string | null | undefined): string {
  const key = (value ?? '').trim().toLowerCase()
  if (key.includes('commercial')) return 'Commercial'
  if (key.includes('dwelling')) return 'Dwelling'
  if (key.includes('homeowners') || key.includes('homeowner')) return 'Homeowners'
  return ''
}

export function mapPortfolioInsuranceToPropertyFields(
  payload: PortfolioDocumentExtractPayload | null | undefined,
): PropertyInsuranceExtracted {
  const empty: PropertyInsuranceExtracted = {
    carrier: '',
    policyNumber: '',
    coverageStartDate: '',
    coverageEndDate: '',
    renewalDate: '',
    claimsContactName: '',
    claimsPhone: '',
    additionalInsured: false,
    policyType: '',
    premium: '',
    coverageAmount: '',
    deductible: '',
    dwellingCoverage: '',
    otherStructures: '',
    liability: '',
    lossOfRentalIncome: '',
  }
  if (!payload) return empty

  const kind = payload.extractKind
  const dwelling = payload.dwellingPolicy
  const coi = payload.insuranceCertificate

  const fromDwelling = dwelling
    ? {
        ...empty,
        carrier: asText(dwelling.insurer_name) || fromRoleFacts(payload, 'insurance_carrier'),
        policyNumber: asText(dwelling.policy_number),
        coverageStartDate: asText(dwelling.policy_effective_date),
        coverageEndDate: asText(dwelling.policy_expiration_date),
        claimsContactName: asText(dwelling.producer_agency_name),
        additionalInsured: false,
        policyType: policyTypeFromDocumentType(dwelling.document_type),
        premium: amountToInput(dwelling.total_annual_premium),
        coverageAmount: amountToInput(dwelling.coverage_a_dwelling_limit),
        deductible: amountToInput(dwelling.deductible_all_other_perils),
        dwellingCoverage: amountToInput(dwelling.coverage_a_dwelling_limit),
        liability: amountToInput(dwelling.coverage_l_liability_limit),
        lossOfRentalIncome: amountToInput(dwelling.coverage_d_fair_rental_value_limit),
      }
    : null

  const fromCoi = coi
    ? {
        ...empty,
        carrier: asText(coi.insurers?.[0]?.name) || fromRoleFacts(payload, 'insurance_carrier'),
        policyNumber: asText(coi.policy_number) || asText(coi.insurers?.[0]?.policy_number),
        coverageStartDate: asText(coi.effective_date),
        coverageEndDate: asText(coi.expiration_date),
        claimsContactName: asText(coi.producer_agency),
        additionalInsured: (coi.additional_insured ?? []).some((name) => name.trim()),
      }
    : null

  if (fromDwelling && dwellingHasPolicyFields(dwelling)) return fromDwelling
  if (kind === 'insurance_certificate' && fromCoi && coi && coiHasPolicyFields(coi)) return fromCoi
  if (fromDwelling && (fromDwelling.carrier || fromDwelling.policyNumber || fromDwelling.coverageStartDate)) {
    return fromDwelling
  }
  if (fromCoi && coiHasPolicyFields(coi!)) return fromCoi

  const carrier = fromRoleFacts(payload, 'insurance_carrier')
  if (carrier) {
    return {
      ...empty,
      carrier,
      additionalInsured: false,
    }
  }

  return empty
}

function insuranceExtractHasFields(extracted: PropertyInsuranceExtracted): boolean {
  return Boolean(
    extracted.carrier ||
      extracted.policyNumber ||
      extracted.coverageStartDate ||
      extracted.coverageEndDate,
  )
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function extractInsuranceBinder(
  file: File,
  onProgress: (progress: InsuranceBinderScanProgress) => void,
  signal?: AbortSignal,
): Promise<InsuranceBinderScanResult> {
  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error('Insurance binder scan cancelled')
  }

  onProgress({ stage: 'uploading', label: 'Uploading insurance document…', progress: 18 })
  throwIfAborted()

  onProgress({ stage: 'scanning', label: 'Finding declarations or certificate pages…', progress: 42 })
  let pageImages: string[] = []
  try {
    const pageTexts = await extractPdfPageTexts(file)
    const relevant = findRelevantInsurancePages(pageTexts)
    pageImages = await renderPdfFileToJpegDataUrls(file, {
      pageNumbers: relevant.length > 0 ? relevant : [1, 2, 3, 4, 5],
      maxPages: 5,
    })
  } catch {
    pageImages = []
  }
  throwIfAborted()

  onProgress({ stage: 'extracting', label: 'Reading policy details…', progress: 72 })
  const fileBase64 = file.size <= INLINE_BYTES_LIMIT ? await fileToBase64(file) : undefined
  if (!fileBase64 && pageImages.length === 0) {
    throw new Error(
      'This insurance file is too large to scan here. Upload a shorter PDF or a photo of the declarations page.',
    )
  }

  const result = await extractOnboardingDocument({
    docId: crypto.randomUUID(),
    fileName: file.name,
    documentCategory: 'property_insurance',
    contentType: file.type || 'application/pdf',
    fileBase64,
    pageImages: pageImages.length ? pageImages : undefined,
    insuranceIntent: 'property_policy',
  })
  throwIfAborted()

  const extracted = mapPortfolioInsuranceToPropertyFields(result.extracted)
  if (!insuranceExtractHasFields(extracted)) {
    const warning = (result.extracted?.warnings ?? []).map((row) => row.trim()).find(Boolean)
    throw new Error(
      warning ||
        'We couldn’t read insurance company, policy number, or coverage dates from this file. Try the declarations page or a certificate of insurance.',
    )
  }

  onProgress({ stage: 'complete', label: 'Details filled from the document — review and save', progress: 100 })

  const confidence =
    (result.extracted.dwellingPolicy as { confidence?: number } | null)?.confidence ??
    result.extracted.insuranceCertificate?.confidence ??
    80

  return {
    fileName: file.name,
    extracted,
    confidence: confidence > 1 ? confidence / 100 : confidence,
  }
}

export function isInsuranceBinderScanProcessing(stage: InsuranceBinderScanStage): boolean {
  return stage === 'uploading' || stage === 'scanning' || stage === 'extracting'
}
