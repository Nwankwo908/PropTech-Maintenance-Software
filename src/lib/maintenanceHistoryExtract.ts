/**
 * Real maintenance-history extract orchestration (CSV local + Edge for PDF/images).
 */
import { extractMaintenanceHistoryFromFile } from '@/api/extractMaintenanceHistory'
import { parseMaintenanceHistoryCsv } from '@/lib/maintenanceHistoryCsvExtract'
import {
  isCsvMaintenanceHistoryFile,
  recordsFromPlainJobs,
  shouldMarkNeedsAttention,
  type MaintenanceHistoryDocument,
  type MaintenanceHistoryRecord,
} from '@/lib/maintenanceHistoryImport'

export type MaintenanceHistoryExtractOutcome = {
  records: MaintenanceHistoryRecord[]
  needsAttention: boolean
  warnings: string[]
  method: string
}

async function readFileText(file: File): Promise<string> {
  return await file.text()
}

/**
 * Extract maintenance history records from an uploaded file.
 * CSV is parsed locally. PDF / images call the Edge extract function.
 */
export async function extractMaintenanceHistoryForDocument(input: {
  file: File
  document: MaintenanceHistoryDocument
  building: string
}): Promise<MaintenanceHistoryExtractOutcome> {
  const { file, document: doc, building } = input

  if (isCsvMaintenanceHistoryFile(file) || /\.csv$/i.test(file.name)) {
    const text = await readFileText(file)
    const jobs = parseMaintenanceHistoryCsv(text)
    const records = recordsFromPlainJobs(
      doc,
      building,
      jobs.map((job) => ({
        vendorName: job.vendorName,
        vendorPhone: job.vendorPhone,
        vendorEmail: job.vendorEmail,
        tradeCategory: job.tradeCategory,
        serviceDate: job.serviceDate,
        invoiceNumber: job.invoiceNumber,
        totalAmount: job.totalAmount,
        laborCost: job.laborCost,
        partsCost: job.partsCost,
        issueType: job.issueType,
        workPerformed: job.workPerformed,
        unitLabel: job.unitLabel,
        assetInvolved: job.assetInvolved,
        paymentStatus: job.paymentStatus,
        warrantyInfo: job.warrantyInfo,
        notes: job.notes,
        confidence: job.confidence,
      })),
    )
    return {
      records,
      needsAttention: shouldMarkNeedsAttention(records),
      warnings: [],
      method: 'csv',
    }
  }

  const extracted = await extractMaintenanceHistoryFromFile({
    file,
    buildingName: building,
  })
  const records = recordsFromPlainJobs(
    doc,
    building,
    extracted.records.map((job) => ({
      vendorName: job.vendorName,
      vendorPhone: job.vendorPhone,
      vendorEmail: job.vendorEmail,
      tradeCategory: job.tradeCategory,
      serviceDate: job.serviceDate,
      invoiceNumber: job.invoiceNumber,
      totalAmount: job.totalAmount,
      laborCost: job.laborCost,
      partsCost: job.partsCost,
      issueType: job.issueType,
      workPerformed: job.workPerformed,
      unitLabel: job.unitLabel,
      assetInvolved: job.assetInvolved,
      paymentStatus: job.paymentStatus,
      warrantyInfo: job.warrantyInfo,
      notes: job.notes,
      confidence: job.confidence,
    })),
  )

  if (records.length === 0) {
    const detail =
      extracted.warnings[0]?.trim() ||
      'No maintenance jobs were found in this file. Try a clearer invoice or a CSV export.'
    throw new Error(detail)
  }

  return {
    records,
    needsAttention: shouldMarkNeedsAttention(records) || extracted.warnings.length > 0,
    warnings: extracted.warnings,
    method: extracted.method,
  }
}
