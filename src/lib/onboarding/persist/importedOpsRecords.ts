/**
 * Fast Track imported maintenance issues + financial records (review snapshot).
 * Tickets also persist in maintenance_requests; history uses maintenanceHistoryImport.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'

export type ImportedOnboardingFinancialRecord = {
  id: string
  recordType: string
  description: string
  amount: string
  period: string
  sourceDocumentName: string
}

export type ImportedOnboardingMaintenanceIssue = {
  id: string
  description: string
  unit: string
  building: string
  category: string
  priority: string
}

export type ImportedOnboardingOpsRecords = {
  financialRecords: ImportedOnboardingFinancialRecord[]
  maintenanceIssues: ImportedOnboardingMaintenanceIssue[]
}

function storageKey(landlordId: string): string {
  return `ulo.onboardingImportedOps.${landlordId}`
}

export function emptyImportedOpsRecords(): ImportedOnboardingOpsRecords {
  return { financialRecords: [], maintenanceIssues: [] }
}

export function loadImportedOpsRecords(
  landlordId: string = getActiveLandlordId(),
): ImportedOnboardingOpsRecords {
  if (!landlordId || typeof window === 'undefined') return emptyImportedOpsRecords()
  try {
    const raw = window.localStorage.getItem(storageKey(landlordId))
    if (!raw) return emptyImportedOpsRecords()
    const parsed = JSON.parse(raw) as Partial<ImportedOnboardingOpsRecords>
    return {
      financialRecords: Array.isArray(parsed.financialRecords) ? parsed.financialRecords : [],
      maintenanceIssues: Array.isArray(parsed.maintenanceIssues)
        ? parsed.maintenanceIssues
        : [],
    }
  } catch {
    return emptyImportedOpsRecords()
  }
}

export function saveImportedOpsRecords(
  records: ImportedOnboardingOpsRecords,
  landlordId: string = getActiveLandlordId(),
): void {
  if (!landlordId || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(landlordId), JSON.stringify(records))
  } catch {
    // private mode / quota
  }
}

export function clearImportedOpsRecords(landlordId: string = getActiveLandlordId()): void {
  if (!landlordId || typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storageKey(landlordId))
  } catch {
    // private mode
  }
}
