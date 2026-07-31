/**
 * Property insurance binder extract — fills Insurance form fields after upload.
 * Deterministic mock until real document AI is wired (same pattern as COI scanner).
 */

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
}

export type InsuranceBinderScanResult = {
  fileName: string
  extracted: PropertyInsuranceExtracted
  confidence: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function hashFileSeed(fileName: string, fileSize: number): number {
  let hash = fileSize
  for (let i = 0; i < fileName.length; i += 1) {
    hash = (hash + fileName.charCodeAt(i) * (i + 7)) | 0
  }
  return Math.abs(hash)
}

function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const CARRIERS = [
  'State Farm',
  'Travelers',
  'Liberty Mutual',
  'Nationwide',
  'Allstate',
  'Hartford',
  'Chubb',
]

const CONTACTS = [
  'Jordan Lee',
  'Sam Rivera',
  'Alex Morgan',
  'Casey Nguyen',
  'Taylor Brooks',
]

/** Deterministic mock extraction from binder file name / size. */
export function mockExtractPropertyInsurance(
  fileName: string,
  fileSize: number,
): PropertyInsuranceExtracted {
  const seed = hashFileSeed(fileName, fileSize)
  const carrierMatch = fileName.match(
    /(state\s*farm|travelers|liberty|nationwide|allstate|hartford|chubb|farmers|geico)/i,
  )
  const carrier = carrierMatch
    ? carrierMatch[1].replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : CARRIERS[seed % CARRIERS.length]

  const policyFromName = fileName.match(/\b([A-Z]{2,4}-?\d{5,10})\b/)
  const policyNumber =
    policyFromName?.[1] ??
    `POL-${(100000 + (seed % 900000)).toString()}-${(seed % 99).toString().padStart(2, '0')}`

  const startOffset = -365 - (seed % 200)
  const termMonths = 12
  const coverageStartDate = isoDaysFromNow(startOffset)
  const end = new Date(coverageStartDate + 'T12:00:00')
  end.setMonth(end.getMonth() + termMonths)
  const coverageEndDate = end.toISOString().slice(0, 10)
  const renewal = new Date(coverageEndDate + 'T12:00:00')
  renewal.setDate(renewal.getDate() - 30)
  const renewalDate = renewal.toISOString().slice(0, 10)

  const contact = CONTACTS[seed % CONTACTS.length]
  const area = 200 + (seed % 700)
  const claimsPhone = `(${area}) ${200 + (seed % 700)}-${1000 + (seed % 9000)}`

  return {
    carrier,
    policyNumber,
    coverageStartDate,
    coverageEndDate,
    renewalDate,
    claimsContactName: contact,
    claimsPhone,
    additionalInsured: seed % 3 !== 0,
  }
}

export async function extractInsuranceBinder(
  file: File,
  onProgress: (progress: InsuranceBinderScanProgress) => void,
  signal?: AbortSignal,
): Promise<InsuranceBinderScanResult> {
  const stages: Array<{
    stage: InsuranceBinderScanStage
    label: string
    ms: number
    progress: number
  }> = [
    { stage: 'uploading', label: 'Uploading insurance binder…', ms: 320, progress: 18 },
    { stage: 'scanning', label: 'Reading policy details…', ms: 780, progress: 52 },
    { stage: 'extracting', label: 'Filling form fields…', ms: 620, progress: 88 },
  ]

  for (const stage of stages) {
    if (signal?.aborted) throw new Error('Insurance binder scan cancelled')
    onProgress({ stage: stage.stage, label: stage.label, progress: stage.progress })
    await sleep(stage.ms)
  }

  const extracted = mockExtractPropertyInsurance(file.name, file.size)
  onProgress({ stage: 'complete', label: 'Details extracted from binder', progress: 100 })

  return {
    fileName: file.name,
    extracted,
    confidence: 0.88 + (hashFileSeed(file.name, file.size) % 10) / 100,
  }
}

export function isInsuranceBinderScanProcessing(stage: InsuranceBinderScanStage): boolean {
  return stage === 'uploading' || stage === 'scanning' || stage === 'extracting'
}
