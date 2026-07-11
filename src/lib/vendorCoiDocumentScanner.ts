import type { VendorIntakeInsuranceStep } from '@/lib/vendorIntakeForm'

export type CoiScanStage = 'idle' | 'uploading' | 'scanning' | 'extracting' | 'complete' | 'failed'

export type CoiScanProgress = {
  stage: CoiScanStage
  label: string
  progress: number
}

export type CoiScanResult = {
  fileName: string
  extracted: Pick<VendorIntakeInsuranceStep, 'generalLiability' | 'workersComp' | 'policyExpiration'>
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

function formatLiabilityAmount(amount: number): string {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

/** Deterministic mock extraction until real document AI is wired. */
export function mockExtractCoiInsurance(
  fileName: string,
  fileSize: number,
): CoiScanResult['extracted'] {
  const seed = hashFileSeed(fileName, fileSize)
  const liabilityAmounts = [1_000_000, 2_000_000, 1_500_000]
  const generalLiability = formatLiabilityAmount(liabilityAmounts[seed % liabilityAmounts.length])

  const workersComp: 'active' | 'inactive' =
    /no.?wc|without.?workers|exempt/i.test(fileName) || seed % 11 === 0 ? 'inactive' : 'active'

  const expiration = new Date()
  expiration.setMonth(expiration.getMonth() + 6 + (seed % 8))
  const policyExpiration = expiration.toISOString().slice(0, 10)

  return {
    generalLiability,
    workersComp,
    policyExpiration,
  }
}

/** Mock document scanner — digitize, scan pages, extract COI fields. */
export async function scanCoiDocument(
  file: File,
  onProgress: (progress: CoiScanProgress) => void,
  signal?: AbortSignal,
): Promise<CoiScanResult> {
  const stages: Array<{ stage: CoiScanStage; label: string; ms: number; progress: number }> = [
    { stage: 'uploading', label: 'Uploading COI…', ms: 350, progress: 20 },
    { stage: 'scanning', label: 'Scanning document…', ms: 850, progress: 55 },
    { stage: 'extracting', label: 'Extracting insurance details…', ms: 650, progress: 85 },
  ]

  for (const stage of stages) {
    if (signal?.aborted) throw new Error('COI scan cancelled')
    onProgress({ stage: stage.stage, label: stage.label, progress: stage.progress })
    await sleep(stage.ms)
  }

  const extracted = mockExtractCoiInsurance(file.name, file.size)
  onProgress({ stage: 'complete', label: 'Insurance details extracted', progress: 100 })

  return {
    fileName: file.name,
    extracted,
    confidence: 0.9 + (hashFileSeed(file.name, file.size) % 9) / 100,
  }
}

export function isCoiScanProcessing(stage: CoiScanStage): boolean {
  return stage === 'uploading' || stage === 'scanning' || stage === 'extracting'
}
