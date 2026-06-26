import { useCallback, useRef, useState } from 'react'
import {
  ACCEPTED_UPLOAD_MIME,
  formatFileSize,
  UPLOAD_STATUS_LABELS,
  type OnboardingUploadedDocument,
  type UploadFileStatus,
} from '@/lib/onboardingDocumentUpload'

const btnPrimary =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-[#187960] px-6 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#146b52] disabled:cursor-not-allowed disabled:opacity-50'

const btnSecondary =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50'

const btnGhost =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] px-4 py-2.5 text-[14px] font-medium text-[#6a7282] transition-colors hover:bg-[#f3f4f6] hover:text-[#101828] disabled:cursor-not-allowed disabled:opacity-50'

function UploadDocumentsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-8 text-[#99a1af]" aria-hidden>
      <path
        d="M12 16V8m0 0-3 3m3-3 3 3"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
      />
    </svg>
  )
}

function statusTone(status: UploadFileStatus): string {
  if (status === 'ready_for_review') return 'text-[#187930] bg-[#ecfdf3]'
  if (status === 'needs_attention') return 'text-[#a65f00] bg-[#fef9c2]'
  if (status === 'failed') return 'text-[#b91c1c] bg-[#fef2f2]'
  if (status === 'waiting') return 'text-[#6a7282] bg-[#f3f4f6]'
  return 'text-[#186179] bg-[#eef6fa]'
}

function FileStatusBadge({ status }: { status: UploadFileStatus }) {
  return (
    <span
      className={`inline-flex rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${statusTone(status)}`}
    >
      {UPLOAD_STATUS_LABELS[status]}
    </span>
  )
}

function FileRow({
  doc,
  onRemove,
  disabled,
}: {
  doc: OnboardingUploadedDocument
  onRemove: (id: string) => void
  disabled: boolean
}) {
  const isProcessing =
    doc.uploadStatus === 'uploading' ||
    doc.uploadStatus === 'scanning' ||
    doc.uploadStatus === 'extracting' ||
    doc.uploadStatus === 'digitizing' ||
    doc.uploadStatus === 'handwriting'

  return (
    <li className="rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-[#101828]">{doc.fileName}</p>
          <p className="mt-0.5 text-[12px] text-[#6a7282]">
            {formatFileSize(doc.fileSize)} · {doc.fileType.toUpperCase()}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || isProcessing}
          onClick={() => onRemove(doc.id)}
          className="shrink-0 rounded-[6px] px-2 py-1 text-[12px] font-medium text-[#64748b] transition-colors hover:bg-[#fef2f2] hover:text-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Remove
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <FileStatusBadge status={doc.uploadStatus} />
        {doc.processingLabel && doc.uploadStatus !== 'ready_for_review' ? (
          <span className="text-[12px] text-[#6a7282]">{doc.processingLabel}</span>
        ) : null}
      </div>

      {doc.uploadStatus === 'uploading' || isProcessing ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f3f4f6]">
            <div
              className="h-full rounded-full bg-[#187960] transition-all duration-200"
              style={{ width: `${Math.max(doc.uploadProgress, isProcessing ? 100 : 0)}%` }}
            />
          </div>
        </div>
      ) : null}

      {doc.errorMessage ? (
        <p className="mt-2 text-[12px] text-[#b91c1c]">{doc.errorMessage}</p>
      ) : null}

      {doc.imageLabels.length > 0 && doc.uploadStatus === 'ready_for_review' ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {doc.imageLabels.map((label) => (
            <span
              key={label}
              className="rounded-[4px] bg-[#f3f4f6] px-2 py-0.5 text-[11px] font-medium text-[#364153]"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}

      {doc.hasHandwriting && doc.uploadStatus === 'handwriting' ? (
        <p className="mt-2 text-[12px] italic text-[#6a7282]">
          Reading handwritten notes from signed sheets and checklists…
        </p>
      ) : null}
    </li>
  )
}

export type OnboardingDocumentUploadStepProps = {
  documents: OnboardingUploadedDocument[]
  processing: boolean
  uploadError: string | null
  onFilesSelected: (files: FileList | File[]) => void
  onRemoveDocument: (id: string) => void
  onBack: () => void
  onContinue: () => void
  onSkip: () => void
}

export function OnboardingDocumentUploadStep({
  documents,
  processing,
  uploadError,
  onFilesSelected,
  onRemoveDocument,
  onBack,
  onContinue,
  onSkip,
}: OnboardingDocumentUploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setDragActive(false)
      if (event.dataTransfer.files?.length) {
        onFilesSelected(event.dataTransfer.files)
      }
    },
    [onFilesSelected],
  )

  const canContinue =
    documents.length > 0 &&
    documents.every(
      (doc) =>
        doc.uploadStatus === 'ready_for_review' ||
        doc.uploadStatus === 'needs_attention' ||
        doc.uploadStatus === 'failed',
    )

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <h2 className="text-[18px] font-semibold text-[#101828]">Upload your documents</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-[#6a7282]">
        Upload leases, spreadsheets, photos, or property documents and Ulo will pull out the important
        details for you to review before importing.
      </p>

      <div
        className={[
          'mt-4 flex cursor-pointer flex-col items-center justify-center rounded-[10px] border-2 border-dashed px-6 py-14 text-center transition-colors',
          dragActive
            ? 'border-[#187960] bg-[#f0fdf8]'
            : 'border-[#e5e7eb] bg-white hover:border-[#d1d5dc] hover:bg-[#fafafa]',
        ].join(' ')}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          setDragActive(false)
        }}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload documents"
      >
        <UploadDocumentsIcon />
        <span className="mt-4 text-[14px] font-semibold text-[#101828]">
          Drop files here or click to browse
        </span>
        <span className="mt-1 max-w-[480px] text-[13px] text-[#6a7282]">
          Bulk upload supported · PDF, Word, Excel, CSV, JPG, PNG, HEIC, WEBP, TIFF · up to 20MB each
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_UPLOAD_MIME}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files?.length) {
              onFilesSelected(event.target.files)
              event.target.value = ''
            }
          }}
        />
      </div>

      {uploadError ? (
        <div className="mt-3 rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
          {uploadError}
        </div>
      ) : null}

      {documents.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-[#364153]">
              {documents.length} file{documents.length === 1 ? '' : 's'} uploaded
            </p>
            {processing ? (
              <p className="text-[12px] text-[#6a7282]">Processing documents…</p>
            ) : null}
          </div>
          <ul className="space-y-2">
            {documents.map((doc) => (
              <FileRow
                key={doc.id}
                doc={doc}
                disabled={processing}
                onRemove={onRemoveDocument}
              />
            ))}
          </ul>
          <p className="mt-3 text-[12px] leading-relaxed text-[#6a7282]">
            Ulo digitizes each file, runs text recognition, labels inspection photos, and reads
            handwritten notes before you review extracted data.
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button type="button" disabled={processing} onClick={onSkip} className={btnGhost}>
          Skip for now
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={processing} onClick={onBack} className={btnSecondary}>
            Back
          </button>
          <button
            type="button"
            disabled={processing || !canContinue}
            onClick={onContinue}
            className={btnPrimary}
          >
            {processing ? 'Processing…' : 'Review extracted data'}
          </button>
        </div>
      </div>
    </section>
  )
}
