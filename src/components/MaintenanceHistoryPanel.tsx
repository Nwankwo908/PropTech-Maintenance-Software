/**
 * Guided Maintenance History import under Property Details.
 * Upload → AI process → landlord review → confirm → insights / timeline.
 */
import { useId, useRef, useState } from 'react'
import maintenanceHistoryUploadCloudIcon from '@/assets/maintenance-history-upload-cloud.svg'
import uloFoundSparkleIcon from '@/assets/ulo-found-sparkle.svg'
import {
  buildMaintenanceHistoryFindings,
  createMaintenanceHistoryDocument,
  deriveImportStep,
  fileTypeLabel,
  formatHistoryFileSize,
  formatHistoryUploadDate,
  isAcceptedMaintenanceHistoryFile,
  isCsvMaintenanceHistoryFile,
  listPendingReviewRecords,
  MAINTENANCE_HISTORY_ACCEPT,
  MAINTENANCE_HISTORY_MAX_BYTES,
  MAINTENANCE_TRADE_CATEGORIES,
  recordToTimelineRow,
  shouldMarkNeedsAttention,
  simulateMaintenanceHistoryExtract,
  statusLabel,
  updateRecordField,
  type MaintenanceHistoryDocument,
  type MaintenanceHistoryFinding,
  type MaintenanceHistoryRecord,
} from '@/lib/maintenanceHistoryImport'

function MaintenanceWrenchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4 text-[#0d0f11]" aria-hidden>
      <path
        d="M14.7 6.3a4.2 4.2 0 0 0-5.9 5.9L3 17.9V21h3.1l5.7-5.8a4.2 4.2 0 0 0 5.9-5.9l-2.5 2.5-2.5-2.5 2.5-2.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function statusChipClass(status: MaintenanceHistoryDocument['status']): string {
  switch (status) {
    case 'uploading':
    case 'processing':
      return 'bg-[#fffbeb] text-[#d97706]'
    case 'ready_for_review':
      return 'bg-[#ecfdf5] text-[#187960]'
    case 'needs_attention':
      return 'bg-[#fff7ed] text-[#c2410c]'
    case 'failed':
      return 'bg-[#fef2f2] text-[#b91c1c]'
    default:
      return 'bg-[#f1f5f9] text-[#64748b]'
  }
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return 'High'
  if (confidence >= 0.7) return 'Medium'
  return 'Low'
}

function confidenceClass(confidence: number): string {
  if (confidence >= 0.9) return 'text-[#187960]'
  if (confidence >= 0.7) return 'text-[#d97706]'
  return 'text-[#b91c1c]'
}

export type MaintenanceHistoryPanelProps = {
  building: string
  docs: MaintenanceHistoryDocument[]
  approved: MaintenanceHistoryRecord[]
  onDocsChange: (docs: MaintenanceHistoryDocument[]) => void
  onApprovedChange: (records: MaintenanceHistoryRecord[]) => void
  onError: (message: string | null) => void
}

export function MaintenanceHistoryPanel({
  building,
  docs,
  approved,
  onDocsChange,
  onApprovedChange,
  onError,
}: MaintenanceHistoryPanelProps) {
  const uploadInputId = useId()
  const csvInputId = useId()
  const uploadRef = useRef<HTMLInputElement>(null)
  const csvRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [editingFindings, setEditingFindings] = useState(false)
  const [findingsDraft, setFindingsDraft] = useState<MaintenanceHistoryFinding[] | null>(null)
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)

  const pending = listPendingReviewRecords(docs)
  const step = deriveImportStep(docs, approved)
  const findings =
    findingsDraft ??
    buildMaintenanceHistoryFindings(pending.length > 0 ? pending : approved)
  const isBusy = docs.some((d) => d.status === 'uploading' || d.status === 'processing')

  function processFiles(files: FileList | null, csvOnly = false) {
    if (!files?.length) return
    onError(null)
    const additions: MaintenanceHistoryDocument[] = []
    for (const file of Array.from(files)) {
      if (csvOnly && !isCsvMaintenanceHistoryFile(file)) {
        onError('Import CSV accepts .csv files only.')
        continue
      }
      if (!isAcceptedMaintenanceHistoryFile(file)) {
        onError('Upload a PDF, JPG, JPEG, PNG, or CSV file.')
        continue
      }
      if (file.size > MAINTENANCE_HISTORY_MAX_BYTES) {
        onError('Each file must be 10MB or smaller.')
        continue
      }
      additions.push(createMaintenanceHistoryDocument(file))
    }
    if (additions.length === 0) return

    const withUploading = [...docs, ...additions]
    onDocsChange(withUploading)
    setFindingsDraft(null)
    setEditingFindings(false)

    window.setTimeout(() => {
      const processing = withUploading.map((doc) =>
        additions.some((a) => a.id === doc.id) ? { ...doc, status: 'processing' as const } : doc,
      )
      onDocsChange(processing)

      window.setTimeout(() => {
        const finished = processing.map((doc) => {
          if (!additions.some((a) => a.id === doc.id)) return doc
          // Deterministic “failure” for clearly broken names in demos
          if (/corrupt|fail/i.test(doc.fileName)) {
            return {
              ...doc,
              status: 'failed' as const,
              error: 'Could not read this file. Try another copy or format.',
              records: [],
            }
          }
          const records = simulateMaintenanceHistoryExtract(doc, building)
          const needsAttention = shouldMarkNeedsAttention(records)
          return {
            ...doc,
            status: (needsAttention ? 'needs_attention' : 'ready_for_review') as const,
            records,
            error: needsAttention
              ? 'Some fields need a closer look before you confirm.'
              : undefined,
          }
        })
        onDocsChange(finished)
        const firstPending = listPendingReviewRecords(finished)[0]
        if (firstPending) setExpandedRecordId(firstPending.id)
      }, 900)
    }, 450)
  }

  function retryDocument(id: string) {
    const target = docs.find((d) => d.id === id)
    if (!target) return
    onError(null)
    const resetting = docs.map((d) =>
      d.id === id
        ? { ...d, status: 'processing' as const, error: undefined, records: [] }
        : d,
    )
    onDocsChange(resetting)
    window.setTimeout(() => {
      const finished = resetting.map((doc) => {
        if (doc.id !== id) return doc
        const records = simulateMaintenanceHistoryExtract(doc, building)
        const needsAttention = shouldMarkNeedsAttention(records)
        return {
          ...doc,
          status: (needsAttention ? 'needs_attention' : 'ready_for_review') as const,
          records,
          error: needsAttention
            ? 'Some fields need a closer look before you confirm.'
            : undefined,
        }
      })
      onDocsChange(finished)
    }, 900)
  }

  function removeDocument(id: string) {
    onDocsChange(docs.filter((d) => d.id !== id))
  }

  function patchPendingRecord(recordId: string, next: MaintenanceHistoryRecord) {
    onDocsChange(
      docs.map((doc) => ({
        ...doc,
        records: doc.records.map((r) => (r.id === recordId ? next : r)),
      })),
    )
  }

  function confirmAndSave() {
    if (pending.length === 0) return
    const stamped = pending.map((r) => ({ ...r, approved: true }))
    const merged = [...approved]
    for (const row of stamped) {
      const idx = merged.findIndex((r) => r.id === row.id)
      if (idx >= 0) merged[idx] = row
      else merged.push(row)
    }
    onApprovedChange(merged)
    // Drop reviewed source docs (records live in approved store)
    const pendingDocIds = new Set(pending.map((r) => r.sourceDocumentId))
    onDocsChange(docs.filter((d) => !pendingDocIds.has(d.id)))
    setFindingsDraft(null)
    setEditingFindings(false)
    setExpandedRecordId(null)
  }

  function discardPending() {
    const pendingDocIds = new Set(pending.map((r) => r.sourceDocumentId))
    onDocsChange(docs.filter((d) => !pendingDocIds.has(d.id) && d.status !== 'failed'))
    setFindingsDraft(null)
    setEditingFindings(false)
  }

  const showEmpty = step === 'empty'
  const showInsights = approved.length > 0 && pending.length === 0
  const showFindingsCard = pending.length > 0 || (showInsights && findings.length > 0)

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] leading-normal text-[#475569]">
        Upload previous invoices, receipts, or work orders to help Ulo understand past repairs,
        identify recurring issues, and improve future maintenance planning.
      </p>

      {showEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-6 py-10 text-center">
          <img
            src={maintenanceHistoryUploadCloudIcon}
            alt=""
            className="size-8 object-contain"
            aria-hidden
          />
          <div className="flex flex-col gap-1">
            <p className="text-[14px] font-semibold text-[#0d0f11]">
              No maintenance history added yet
            </p>
            <p className="mx-auto max-w-md text-[13px] leading-5 text-[#64748b]">
              Upload past invoices, receipts, or work orders. Ulo will organize the records and
              identify useful patterns across this property.
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              className="pd-btn pd-btn-primary rounded-[6px] px-4 py-2 text-[13px] font-semibold"
            >
              Upload Records
            </button>
            <button
              type="button"
              onClick={() => csvRef.current?.click()}
              className="pd-btn pd-btn-secondary rounded-[6px] px-4 py-2 text-[13px] font-semibold"
            >
              Import CSV
            </button>
          </div>
        </div>
      ) : (
        <div
          className={[
            'sa-dropzone flex flex-col items-center justify-center gap-3 rounded-[12px] border-2 border-dashed bg-[#f8fafc] p-8',
            dragging ? 'is-dragging border-[#94a3b8]' : 'border-[#e2e8f0]',
            isBusy ? 'opacity-90' : '',
          ].join(' ')}
          data-dragging={dragging ? 'true' : 'false'}
          onDragEnter={(e) => {
            e.preventDefault()
            if (!isBusy) setDragging(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (!isBusy) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (!isBusy) processFiles(e.dataTransfer.files)
          }}
        >
          <img
            src={maintenanceHistoryUploadCloudIcon}
            alt=""
            className="size-8 object-contain"
            aria-hidden
          />
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-[14px] font-semibold text-[#0d0f11]">
              Drag &amp; drop invoices, receipts, work orders, or CSV files
            </p>
            <p className="text-[12px] text-[#64748b]">
              {isBusy
                ? 'Processing maintenance records…'
                : 'Supported formats: PDF, JPG, JPEG, PNG, CSV up to 10MB'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => uploadRef.current?.click()}
              className="pd-btn pd-btn-primary rounded-[6px] px-4 py-2 text-[13px] font-semibold"
            >
              Upload Maintenance Records
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => csvRef.current?.click()}
              className="pd-btn pd-btn-secondary rounded-[6px] px-4 py-2 text-[13px] font-semibold"
            >
              Import CSV
            </button>
          </div>
        </div>
      )}

      <input
        ref={uploadRef}
        id={uploadInputId}
        type="file"
        accept={MAINTENANCE_HISTORY_ACCEPT}
        multiple
        capture="environment"
        className="sr-only"
        disabled={isBusy}
        onChange={(e) => {
          processFiles(e.target.files)
          if (uploadRef.current) uploadRef.current.value = ''
        }}
      />
      <input
        ref={csvRef}
        id={csvInputId}
        type="file"
        accept=".csv,text/csv"
        multiple
        className="sr-only"
        disabled={isBusy}
        onChange={(e) => {
          processFiles(e.target.files, true)
          if (csvRef.current) csvRef.current.value = ''
        }}
      />

      {docs.length > 0 ? (
        <div className="overflow-hidden rounded-[10px] border border-[#e2e8f0] bg-white">
          <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-2.5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#64748b]">
              Uploaded files
            </p>
          </div>
          <ul>
            {docs.map((doc, index) => (
              <li
                key={doc.id}
                className={[
                  'flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
                  index < docs.length - 1 ? 'border-b border-[#e2e8f0]' : '',
                ].join(' ')}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[#0d0f11]">{doc.fileName}</p>
                  <p className="text-[11px] text-[#64748b]">
                    {fileTypeLabel(doc.fileName)} · {formatHistoryFileSize(doc.fileSize)} ·{' '}
                    {formatHistoryUploadDate(doc.uploadedAt)}
                  </p>
                  {doc.error ? (
                    <p className="mt-0.5 text-[11px] text-[#b91c1c]">{doc.error}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={[
                      'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      statusChipClass(doc.status),
                    ].join(' ')}
                  >
                    {statusLabel(doc.status)}
                  </span>
                  {doc.status === 'failed' ? (
                    <button
                      type="button"
                      onClick={() => retryDocument(doc.id)}
                      className="pd-btn pd-btn-ghost rounded px-1.5 py-0.5 text-[12px] font-semibold"
                    >
                      Retry
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeDocument(doc.id)}
                    className="pd-btn pd-btn-ghost rounded px-1.5 py-0.5 text-[12px] font-semibold"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[15px] font-bold text-[#0d0f11]">Review extracted records</p>
              <p className="text-[12px] text-[#64748b]">
                Confirm details before saving them to this property&apos;s maintenance history.
              </p>
            </div>
            <p className="text-[12px] font-semibold text-[#187960]">
              {pending.length} record{pending.length === 1 ? '' : 's'} awaiting confirmation
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {pending.map((record) => {
              const open = expandedRecordId === record.id
              return (
                <li
                  key={record.id}
                  className="sa-surface overflow-hidden rounded-[10px] border border-[#e2e8f0] bg-white"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedRecordId(open ? null : record.id)}
                    className="sa-row flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-[#f8fafc] focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#187960]"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-[#f1f5f9]">
                      <MaintenanceWrenchIcon />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold text-[#0d0f11]">
                        {record.issueType.value || record.tradeCategory.value}
                      </p>
                      <p className="truncate text-[12px] text-[#64748b]">
                        {record.vendorName.value} ·{' '}
                        {recordToTimelineRow(record).dateLabel} · from {record.sourceFileName}
                      </p>
                    </div>
                    <p className="shrink-0 text-[14px] font-bold text-[#0d0f11]">
                      {record.totalAmount.value}
                    </p>
                  </button>
                  {open ? (
                    <div className="sa-enter border-t border-[#e2e8f0] bg-[#f8fafc] px-4 py-4">
                      <RecordReviewForm
                        record={record}
                        onChange={(next) => patchPendingRecord(record.id, next)}
                      />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={confirmAndSave}
              className="pd-btn pd-btn-primary rounded-[6px] px-4 py-2 text-[13px] font-semibold"
            >
              Confirm and save
            </button>
            <button
              type="button"
              onClick={discardPending}
              className="pd-btn pd-btn-secondary rounded-[6px] px-4 py-2 text-[13px] font-semibold"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {showFindingsCard && findings.length > 0 ? (
        <div className="flex flex-col gap-4 rounded-[12px] border border-solid border-[#e2e8f0] bg-[#f8fafc] p-5">
          <div className="flex items-center gap-2">
            <img
              src={uloFoundSparkleIcon}
              alt=""
              className="size-4 object-contain"
              aria-hidden
            />
            <p className="text-[14px] font-bold text-[#0d0f11]">Ulo found:</p>
          </div>
          <ul className="flex flex-col gap-2">
            {findings.map((finding) => (
              <li key={finding.id} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-[12px] leading-none text-[#187960]">✓</span>
                {editingFindings && pending.length > 0 ? (
                  <input
                    type="text"
                    value={finding.text}
                    onChange={(e) =>
                      setFindingsDraft(
                        findings.map((f) =>
                          f.id === finding.id ? { ...f, text: e.target.value } : f,
                        ),
                      )
                    }
                    className="min-w-0 flex-1 rounded-[6px] border border-solid border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[13px] text-[#0d0f11] outline-none focus:border-[#94a3b8]"
                  />
                ) : (
                  <p className="text-[13px] leading-normal text-[#0d0f11]">{finding.text}</p>
                )}
              </li>
            ))}
          </ul>
          {pending.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={confirmAndSave}
                className="pd-btn pd-btn-primary rounded-[6px] px-3.5 py-2 text-[12px] font-bold"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editingFindings) setFindingsDraft(findings)
                  setEditingFindings((v) => !v)
                }}
                className="pd-btn pd-btn-secondary rounded-[6px] px-3.5 py-2 text-[12px] font-semibold"
              >
                {editingFindings ? 'Done editing' : 'Edit'}
              </button>
              <button
                type="button"
                onClick={discardPending}
                className="pd-btn pd-btn-secondary rounded-[6px] px-3.5 py-2 text-[12px] font-semibold"
              >
                Discard
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {approved.length > 0 ? (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] font-bold text-[#0d0f11]">Property Maintenance Timeline</p>
          <ul className="flex flex-col gap-3">
            {approved.map((record) => {
              const row = recordToTimelineRow(record)
              return (
                <li
                  key={record.id}
                  className="flex items-center gap-4 rounded-[8px] border border-solid border-[#e2e8f0] bg-white p-4"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-[#f1f5f9]">
                    <MaintenanceWrenchIcon />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-[#0d0f11]">{row.issueType}</p>
                    <p className="truncate text-[12px] text-[#64748b]">
                      {row.vendorName} • {row.dateLabel}
                    </p>
                  </div>
                  <p className="shrink-0 text-[14px] font-bold text-[#0d0f11]">{row.amountLabel}</p>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function RecordReviewForm({
  record,
  onChange,
}: {
  record: MaintenanceHistoryRecord
  onChange: (next: MaintenanceHistoryRecord) => void
}) {
  function setField(
    key: Parameters<typeof updateRecordField>[1],
    value: string,
  ) {
    onChange(updateRecordField(record, key, value))
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FieldInput
        label="Vendor name"
        value={record.vendorName.value}
        confidence={record.vendorName.confidence}
        onChange={(v) => setField('vendorName', v)}
      />
      <FieldInput
        label="Trade category"
        value={record.tradeCategory.value}
        confidence={record.tradeCategory.confidence}
        onChange={(v) => setField('tradeCategory', v)}
        options={[...MAINTENANCE_TRADE_CATEGORIES]}
      />
      <FieldInput
        label="Service date"
        value={record.serviceDate.value}
        confidence={record.serviceDate.confidence}
        onChange={(v) => setField('serviceDate', v)}
        type="date"
      />
      <FieldInput
        label="Total amount"
        value={record.totalAmount.value}
        confidence={record.totalAmount.confidence}
        onChange={(v) => setField('totalAmount', v)}
      />
      <FieldInput
        label="Vendor phone"
        value={record.vendorPhone.value}
        confidence={record.vendorPhone.confidence}
        onChange={(v) => setField('vendorPhone', v)}
      />
      <FieldInput
        label="Vendor email"
        value={record.vendorEmail.value}
        confidence={record.vendorEmail.confidence}
        onChange={(v) => setField('vendorEmail', v)}
      />
      <FieldInput
        label="Invoice / work-order #"
        value={record.invoiceNumber.value}
        confidence={record.invoiceNumber.confidence}
        onChange={(v) => setField('invoiceNumber', v)}
      />
      <FieldInput
        label="Issue type"
        value={record.issueType.value}
        confidence={record.issueType.confidence}
        onChange={(v) => setField('issueType', v)}
      />
      <FieldInput
        label="Labor cost"
        value={record.laborCost.value}
        confidence={record.laborCost.confidence}
        onChange={(v) => setField('laborCost', v)}
      />
      <FieldInput
        label="Parts cost"
        value={record.partsCost.value}
        confidence={record.partsCost.confidence}
        onChange={(v) => setField('partsCost', v)}
      />
      <FieldInput
        label="Unit"
        value={record.unitLabel.value}
        confidence={record.unitLabel.confidence}
        onChange={(v) => setField('unitLabel', v)}
      />
      <FieldInput
        label="Asset / equipment"
        value={record.assetInvolved.value}
        confidence={record.assetInvolved.confidence}
        onChange={(v) => setField('assetInvolved', v)}
      />
      <FieldInput
        label="Payment status"
        value={record.paymentStatus.value}
        confidence={record.paymentStatus.confidence}
        onChange={(v) => setField('paymentStatus', v)}
      />
      <FieldInput
        label="Warranty"
        value={record.warrantyInfo.value}
        confidence={record.warrantyInfo.confidence}
        onChange={(v) => setField('warrantyInfo', v)}
      />
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-[#475569]">
          Work performed
          <span className={['text-[10px]', confidenceClass(record.workPerformed.confidence)].join(' ')}>
            {confidenceLabel(record.workPerformed.confidence)} ·{' '}
            {Math.round(record.workPerformed.confidence * 100)}%
          </span>
        </span>
        <textarea
          value={record.workPerformed.value}
          onChange={(e) => setField('workPerformed', e.target.value)}
          rows={3}
          className="w-full rounded-[6px] border border-[#e2e8f0] bg-white px-3 py-2 text-[13px] text-[#0d0f11] outline-none focus:border-[#94a3b8]"
        />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-[#475569]">
          Notes
          <span className={['text-[10px]', confidenceClass(record.notes.confidence)].join(' ')}>
            {confidenceLabel(record.notes.confidence)} · {Math.round(record.notes.confidence * 100)}%
          </span>
        </span>
        <textarea
          value={record.notes.value}
          onChange={(e) => setField('notes', e.target.value)}
          rows={2}
          className="w-full rounded-[6px] border border-[#e2e8f0] bg-white px-3 py-2 text-[13px] text-[#0d0f11] outline-none focus:border-[#94a3b8]"
        />
      </label>
    </div>
  )
}

function FieldInput({
  label,
  value,
  confidence,
  onChange,
  type = 'text',
  options,
}: {
  label: string
  value: string
  confidence: number
  onChange: (value: string) => void
  type?: 'text' | 'date'
  options?: string[]
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-[#475569]">
        {label}
        <span className={['shrink-0 text-[10px]', confidenceClass(confidence)].join(' ')}>
          {confidenceLabel(confidence)} · {Math.round(confidence * 100)}%
        </span>
      </span>
      {options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-[6px] border border-[#e2e8f0] bg-white px-3 py-2 text-[13px] text-[#0d0f11] outline-none focus:border-[#94a3b8]"
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-[6px] border border-[#e2e8f0] bg-white px-3 py-2 text-[13px] text-[#0d0f11] outline-none focus:border-[#94a3b8]"
        />
      )}
    </label>
  )
}

export default MaintenanceHistoryPanel
