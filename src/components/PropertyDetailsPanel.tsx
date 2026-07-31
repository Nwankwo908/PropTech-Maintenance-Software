import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ApplianceInspectionUploader } from '@/components/ApplianceInspectionUploader'
import { AssetRegistryPanel } from '@/components/AssetRegistryPanel'
import { MaintenanceHistoryPanel } from '@/components/MaintenanceHistoryPanel'
import assetRegistryIcon from '@/assets/asset-registry.png'
import insuranceUploadCloudIcon from '@/assets/insurance-upload-cloud.svg'
import maintenanceHistoryIcon from '@/assets/maintenance-history.png'
import propertyAccessIcon from '@/assets/property-access.png'
import propertyInsuranceIcon from '@/assets/property-insurance.png'
import smartInspectionReportIcon from '@/assets/smart-inspection-report.png'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  ASSET_REGISTRY_CHANGED_EVENT,
  assetRegistryHasContent,
  loadAssetRegistryAsync,
} from '@/lib/assetRegistry'
import {
  loadApprovedMaintenanceRecords,
  loadMaintenanceHistoryDocuments,
  saveApprovedMaintenanceRecords,
  saveMaintenanceHistoryDocuments,
  type MaintenanceHistoryDocument,
  type MaintenanceHistoryRecord,
} from '@/lib/maintenanceHistoryImport'
import {
  EMPTY_PROPERTY_ACCESS,
  loadPropertyAccess,
  savePropertyAccess,
  type PropertyAccessProfile,
} from '@/lib/propertyAccess'
import { loadPropertyBuildingProfile } from '@/lib/propertyBuildingProfile'
import {
  extractInsuranceBinder,
  isInsuranceBinderScanProcessing,
  type InsuranceBinderScanStage,
} from '@/lib/propertyInsuranceBinderExtract'
import { getErrorMessage } from '@/lib/errorMessage'

const INSPECTION_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.zip,.doc,.docx,application/pdf,application/zip,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const INSPECTION_MAX_BYTES = 25 * 1024 * 1024

type SectionId = 'inspection' | 'access' | 'assets' | 'insurance' | 'history'

type InspectionStatus = 'ready' | 'processing'

type InspectionDoc = {
  id: string
  fileName: string
  fileSize: number
  uploadedAt: string
  status: InspectionStatus
}

type InsuranceProfile = {
  carrier: string
  policyNumber: string
  coverageStartDate: string
  coverageEndDate: string
  renewalDate: string
  claimsContactName: string
  claimsPhone: string
  additionalInsured: boolean
  binderFileName: string | null
  binderUploadedAt: string | null
  updatedAt: string | null
}

const EMPTY_INSURANCE: InsuranceProfile = {
  carrier: '',
  policyNumber: '',
  coverageStartDate: '',
  coverageEndDate: '',
  renewalDate: '',
  claimsContactName: '',
  claimsPhone: '',
  additionalInsured: false,
  binderFileName: null,
  binderUploadedAt: null,
  updatedAt: null,
}

function normalizeInsuranceProfile(raw: unknown): InsuranceProfile {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const str = (key: string) => (typeof o[key] === 'string' ? (o[key] as string) : '')
  return {
    carrier: str('carrier'),
    policyNumber: str('policyNumber'),
    coverageStartDate: str('coverageStartDate'),
    coverageEndDate: str('coverageEndDate'),
    renewalDate: str('renewalDate'),
    claimsContactName: str('claimsContactName'),
    claimsPhone: str('claimsPhone'),
    additionalInsured: o.additionalInsured === true,
    binderFileName: typeof o.binderFileName === 'string' ? o.binderFileName : null,
    binderUploadedAt: typeof o.binderUploadedAt === 'string' ? o.binderUploadedAt : null,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
  }
}

function insuranceHasContent(profile: InsuranceProfile): boolean {
  return Boolean(
    profile.carrier.trim() ||
      profile.policyNumber.trim() ||
      profile.coverageStartDate.trim() ||
      profile.coverageEndDate.trim() ||
      profile.renewalDate.trim() ||
      profile.claimsContactName.trim() ||
      profile.claimsPhone.trim() ||
      profile.additionalInsured ||
      profile.binderFileName ||
      profile.updatedAt,
  )
}

function buildingKey(building: string): string {
  return building.trim().toLowerCase().replace(/\s+/g, '-')
}

function landlordScopedKey(prefix: string, building: string): string {
  return `${prefix}.${getActiveLandlordId()}.${buildingKey(building)}`
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private mode / quota
  }
}

function loadInspectionDocs(building: string): InspectionDoc[] {
  const parsed = readJson<unknown>(landlordScopedKey('ulo.propertyInspection', building), [])
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(
      (row): row is Record<string, unknown> =>
        row != null &&
        typeof row === 'object' &&
        typeof (row as InspectionDoc).id === 'string' &&
        typeof (row as InspectionDoc).fileName === 'string',
    )
    .map((row) => ({
      id: String(row.id),
      fileName: String(row.fileName),
      fileSize: typeof row.fileSize === 'number' ? row.fileSize : 0,
      uploadedAt: typeof row.uploadedAt === 'string' ? row.uploadedAt : new Date().toISOString(),
      status: row.status === 'processing' ? 'processing' : 'ready',
    }))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileTypeLabel(fileName: string): string {
  const ext = fileName.split('.').pop()?.trim().toUpperCase()
  return ext || 'FILE'
}

function formatUploadDate(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function isAcceptedInspectionFile(file: File): boolean {
  if (/\.(pdf|png|jpe?g|webp|zip|docx?)$/i.test(file.name)) return true
  const type = file.type.toLowerCase()
  return (
    type.startsWith('image/') ||
    type === 'application/pdf' ||
    type === 'application/zip' ||
    type.includes('word') ||
    type.includes('document')
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[13px] text-[#94a3b8]" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function FileDocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[14px] text-[#64748b]" aria-hidden>
      <path
        d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

function ReadyCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-2.5 text-[#059669]" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ProcessingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-2.5 animate-spin text-[#f59e0b]" aria-hidden>
      <path
        d="M12 4a8 8 0 1 1-7.07 4.07"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function RemoveXIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[13px]" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4 text-[#64748b]" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function UploadDocIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="size-8 text-[#94a3b8]" aria-hidden>
      <path
        d="M18.5 4H10a2.5 2.5 0 0 0-2.5 2.5v19A2.5 2.5 0 0 0 10 28h12a2.5 2.5 0 0 0 2.5-2.5V11.5L18.5 4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M18.5 4v7.5H26" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 18h8M16 14v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

type DetailCardProps = {
  emoji?: string
  icon?: ReactNode
  title: string
  description: string
  empty: boolean
  expanded: boolean
  onToggle: () => void
  children?: ReactNode
}

function DetailCard({
  emoji,
  icon,
  title,
  description,
  empty: _empty,
  expanded,
  onToggle,
  children,
}: DetailCardProps) {
  return (
    <div
      className={[
        'property-details-card sa-surface group overflow-hidden rounded-[12px] border border-solid bg-white',
        expanded
          ? 'border-[#cbd5e1] shadow-[0px_2px_10px_0px_rgba(15,23,42,0.06)]'
          : 'border-[#e2e8f0] shadow-none hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:shadow-[0px_2px_10px_0px_rgba(15,23,42,0.06)]',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onToggle}
        className={[
          'flex w-full cursor-pointer flex-col gap-4 border border-transparent bg-transparent p-[18px] text-left outline-none transition-[background-color,box-shadow] duration-150 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
          'hover:bg-[#f8fafc] focus-visible:bg-[#f8fafc] focus-visible:shadow-[0_0_0_2px_#ffffff,0_0_0_4px_#187960] active:bg-[#eef2f7]',
          expanded ? 'bg-[#f8fafc]/60' : '',
        ].join(' ')}
        aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
          <div
            className={[
              'flex size-9 shrink-0 items-center justify-center text-[18px] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:size-10 sm:text-[20px]',
              expanded ? 'scale-105' : 'scale-100 group-hover:scale-105',
            ].join(' ')}
            aria-hidden
          >
            {icon ?? emoji}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-medium leading-none text-[#0d0f11] transition-colors duration-150 group-hover:text-[#020617]">
              {title}
            </h3>
            <p className="mt-1 text-[13px] leading-normal text-[#64748b] transition-colors duration-150 group-hover:text-[#475569]">
              {description}
            </p>
          </div>
        </div>

        <span
          className={[
            'inline-flex shrink-0 self-start rounded p-1 text-[#64748b] transition-colors duration-150 group-hover:bg-[#e2e8f0] group-hover:text-[#0f172a] sm:self-center',
          ].join(' ')}
          aria-hidden
        >
          <span
            className={[
              'inline-flex transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
              expanded ? 'rotate-180' : 'rotate-0',
            ].join(' ')}
          >
            <ChevronDownIcon />
          </span>
        </span>
      </button>

      {children ? (
        <div
          className={[
            'grid transition-[grid-template-rows] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          ].join(' ')}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              className={[
                'border-t border-[#e2e8f0] bg-white px-[18px] py-4 transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none',
                expanded
                  ? 'translate-y-0 opacity-100 delay-[40ms]'
                  : 'pointer-events-none -translate-y-2 opacity-0',
              ].join(' ')}
              inert={!expanded ? true : undefined}
            >
              {children}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AccessField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
}) {
  const empty = !value.trim()
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-[12px] font-semibold leading-normal text-[#475569]">
        {label}
        {required ? <span className="text-[#ef4444]"> *</span> : null}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={[
          'w-full rounded-[8px] border px-3 py-3 text-[13px] leading-normal text-[#0d0f11] outline-none placeholder:text-[#94a3b8] focus:border-[#94a3b8]',
          empty
            ? 'border-dashed border-[#e2e8f0] bg-transparent'
            : 'border-solid border-[#e2e8f0] bg-[#f8fafc]',
        ].join(' ')}
      />
    </label>
  )
}

function InsuranceField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'date' | 'tel'
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-[12px] font-semibold leading-normal text-[#475569]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={[
          'w-full rounded-[6px] border border-solid border-[#e2e8f0] bg-white px-3 py-2.5 text-[13px] leading-normal text-[#0d0f11] outline-none placeholder:text-[#64748b] focus:border-[#94a3b8]',
          type === 'date' && !value ? 'text-[#64748b]' : '',
        ].join(' ')}
      />
    </label>
  )
}

/** Expanded Insurance — Figma node 1140:1927. */
function InsuranceExpandedPanel({
  insurance,
  onChange,
  onSave,
  onBinderFiles,
  extracting = false,
  extractLabel = null,
  extractProgress = 0,
  isSaved = false,
}: {
  insurance: InsuranceProfile
  onChange: (next: InsuranceProfile) => void
  onSave: () => void
  onBinderFiles: (files: FileList | null) => void
  extracting?: boolean
  extractLabel?: string | null
  extractProgress?: number
  isSaved?: boolean
}) {
  const binderInputId = useId()
  const binderInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function patch(partial: Partial<InsuranceProfile>) {
    onChange({ ...insurance, ...partial })
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] leading-normal text-[#475569]">
        Store your property&apos;s insurance details in one secure place.
      </p>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-4">
          <InsuranceField
            label="Insurance Company"
            value={insurance.carrier}
            onChange={(carrier) => patch({ carrier })}
            placeholder="Enter company name"
          />
          <InsuranceField
            label="Policy Number"
            value={insurance.policyNumber}
            onChange={(policyNumber) => patch({ policyNumber })}
            placeholder="Enter policy number"
          />
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:gap-4">
          <InsuranceField
            label="Coverage Start Date"
            value={insurance.coverageStartDate}
            onChange={(coverageStartDate) => patch({ coverageStartDate })}
            type="date"
            placeholder="MM/DD/YYYY"
          />
          <InsuranceField
            label="Coverage End Date"
            value={insurance.coverageEndDate}
            onChange={(coverageEndDate) => patch({ coverageEndDate })}
            type="date"
            placeholder="MM/DD/YYYY"
          />
          <InsuranceField
            label="Renewal Date"
            value={insurance.renewalDate}
            onChange={(renewalDate) => patch({ renewalDate })}
            type="date"
            placeholder="Select date"
          />
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:gap-4">
          <InsuranceField
            label="Claims Contact Name"
            value={insurance.claimsContactName}
            onChange={(claimsContactName) => patch({ claimsContactName })}
            placeholder="Enter contact name"
          />
          <InsuranceField
            label="Claims Phone"
            value={insurance.claimsPhone}
            onChange={(claimsPhone) => patch({ claimsPhone })}
            type="tel"
            placeholder="Enter phone number"
          />
        </div>

        <div className="flex items-center gap-3 py-2">
          <button
            type="button"
            role="switch"
            aria-checked={insurance.additionalInsured}
            disabled={extracting}
            onClick={() => patch({ additionalInsured: !insurance.additionalInsured })}
            className="pd-switch"
          >
            <span
              className={[
                'sa-switch-thumb absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow',
                insurance.additionalInsured ? 'translate-x-[1.125rem]' : 'translate-x-0',
              ].join(' ')}
            />
          </button>
          <span className="text-[13px] font-semibold text-[#0d0f11]">
            Additional Insured listed on policy
          </span>
        </div>
      </div>

      <div
        className={[
          'sa-dropzone flex flex-col items-center justify-center gap-3 rounded-[12px] border-2 border-dashed bg-[#f8fafc] p-10',
          dragging ? 'is-dragging border-[#94a3b8]' : 'border-[#e2e8f0]',
          extracting ? 'opacity-80' : '',
        ].join(' ')}
        data-dragging={dragging ? 'true' : 'false'}
        onDragEnter={(e) => {
          e.preventDefault()
          if (!extracting) setDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!extracting) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!extracting) onBinderFiles(e.dataTransfer.files)
        }}
      >
        <input
          ref={binderInputRef}
          id={binderInputId}
          type="file"
          accept=".pdf,image/*,application/pdf"
          className="sr-only"
          disabled={extracting}
          onChange={(e) => {
            onBinderFiles(e.target.files)
            if (binderInputRef.current) binderInputRef.current.value = ''
          }}
        />
        <img
          src={insuranceUploadCloudIcon}
          alt=""
          className="size-8 object-contain"
          aria-hidden
        />
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-[14px] font-semibold text-[#0d0f11]">Upload Insurance Binder</p>
          <p className="text-[12px] text-[#64748b]">
            {extracting && extractLabel
              ? extractLabel
              : insurance.binderFileName
                ? insurance.binderFileName
                : 'PDF or scanned documents'}
          </p>
        </div>
        {extracting ? (
          <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-[#e2e8f0]">
            <div
              className="h-full rounded-full bg-[#187960] transition-[width] duration-300"
              style={{ width: `${Math.min(100, Math.max(0, extractProgress))}%` }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => binderInputRef.current?.click()}
            className="pd-btn pd-btn-primary rounded-[6px] px-4 py-2 text-[13px] font-semibold"
          >
            Browse Files
          </button>
        )}
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaved || extracting}
          className="pd-btn pd-btn-primary rounded-[8px] px-5 py-2.5 text-[13px] font-semibold"
        >
          {isSaved ? 'Saved' : extracting ? 'Extracting…' : 'Save Details'}
        </button>
      </div>
    </div>
  )
}

type HomeInspectionExpandedPanelProps = {
  building: string
  docs: InspectionDoc[]
  onFiles: (files: FileList | null) => void
  onRemove: (id: string) => void
}

/** Expanded Smart Inspection Report — Figma node 1144:20784. */
function HomeInspectionExpandedPanel({
  building,
  docs,
  onFiles,
  onRemove,
}: HomeInspectionExpandedPanelProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState(false)

  const filtered = docs.filter((doc) =>
    doc.fileName.toLowerCase().includes(query.trim().toLowerCase()),
  )

  function handleFiles(files: FileList | null) {
    onFiles(files)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-[10px] border border-[#e2e8f0] bg-white">
        <div className="flex items-center gap-2 border-b border-[#e2e8f0] px-4 py-3">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents..."
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#0d0f11] outline-none placeholder:text-[#94a3b8]"
          />
        </div>

        <div className="hidden border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_80px_80px_110px_32px] sm:gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.275px] text-[#64748b]">
            Document
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.275px] text-[#64748b]">
            Type
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.275px] text-[#64748b]">
            Size
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.275px] text-[#64748b]">
            Uploaded
          </p>
          <span />
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-[#94a3b8]">
            {docs.length === 0
              ? 'No documents uploaded yet.'
              : 'No documents match your search.'}
          </div>
        ) : (
          <ul>
            {filtered.map((doc, index) => (
              <li
                key={doc.id}
                className={[
                  'grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_80px_80px_110px_32px] sm:items-center sm:gap-2',
                  index < filtered.length - 1 ? 'border-b border-[#e2e8f0]' : '',
                ].join(' ')}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <FileDocIcon />
                  <p className="truncate text-[13px] font-medium leading-[19.5px] text-[#0d0f11]">
                    {doc.fileName}
                  </p>
                  {doc.status === 'ready' ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#ecfdf5] px-1.5 py-0.5 text-[10px] font-semibold text-[#059669]">
                      <ReadyCheckIcon />
                      Ready
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#fffbeb] px-1.5 py-0.5 text-[10px] font-semibold text-[#f59e0b]">
                      <ProcessingIcon />
                      Processing
                    </span>
                  )}
                </div>
                <p className="text-[12px] leading-[18px] text-[#64748b]">
                  <span className="sm:hidden">Type · </span>
                  {fileTypeLabel(doc.fileName)}
                </p>
                <p className="text-[12px] leading-[18px] text-[#64748b]">
                  <span className="sm:hidden">Size · </span>
                  {formatBytes(doc.fileSize)}
                </p>
                <p className="text-[12px] leading-[18px] text-[#64748b]">
                  <span className="sm:hidden">Uploaded · </span>
                  {formatUploadDate(doc.uploadedAt)}
                </p>
                <button
                  type="button"
                  onClick={() => onRemove(doc.id)}
                  className="pd-btn pd-btn-icon justify-self-start rounded p-1 sm:justify-self-center"
                  aria-label={`Remove ${doc.fileName}`}
                >
                  <RemoveXIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className={[
          'sa-dropzone rounded-[10px] border border-dashed bg-[#f8fafc] p-px',
          dragging ? 'is-dragging border-[#0d0f11] bg-[#f1f5f9]' : 'border-[#cbd5e1]',
        ].join(' ')}
        data-dragging={dragging ? 'true' : 'false'}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
      >
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center">
          <UploadDocIcon />
          <p className="text-[14px] font-semibold leading-[21px] text-[#0d0f11]">
            Upload PDF, images, or inspection documents
          </p>
          <p className="text-[12px] leading-[18px] text-[#64748b]">
            PDF, DOCX up to 25MB — or drag and drop here
          </p>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={INSPECTION_ACCEPT}
            multiple
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="pd-btn pd-btn-primary rounded-[10px] px-4 py-2 text-[13px] font-semibold leading-[19.5px]"
          >
            Upload Document
          </button>
        </div>
      </div>

      {building ? <ApplianceInspectionUploader building={building} /> : null}
    </div>
  )
}

export type PropertyDetailsPanelProps = {
  building: string
  loading?: boolean
  /** Seed from onboarding / demo meta when no saved profile yet. */
  initialYearBuilt?: number | null
}

/** Property Details tab — Figma card stack for optional property data modules. */
export function PropertyDetailsPanel({
  building,
  loading = false,
  initialYearBuilt = null,
}: PropertyDetailsPanelProps) {
  const [expanded, setExpanded] = useState<SectionId | null>(null)
  const [inspectionDocs, setInspectionDocs] = useState<InspectionDoc[]>([])
  const [historyDocs, setHistoryDocs] = useState<MaintenanceHistoryDocument[]>([])
  const [historyApproved, setHistoryApproved] = useState<MaintenanceHistoryRecord[]>([])
  const [access, setAccess] = useState<PropertyAccessProfile>(EMPTY_PROPERTY_ACCESS)
  const [assetsHasContent, setAssetsHasContent] = useState(false)
  const [insurance, setInsurance] = useState<InsuranceProfile>(EMPTY_INSURANCE)
  const [insuranceSaved, setInsuranceSaved] = useState(false)
  const [insuranceExtractStage, setInsuranceExtractStage] =
    useState<InsuranceBinderScanStage>('idle')
  const [insuranceExtractLabel, setInsuranceExtractLabel] = useState<string | null>(null)
  const [insuranceExtractProgress, setInsuranceExtractProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!building) return
    setInspectionDocs(loadInspectionDocs(building))
    const loadedHistory = loadMaintenanceHistoryDocuments({ building })
    setHistoryDocs(loadedHistory)
    setHistoryApproved(loadApprovedMaintenanceRecords({ building }))
    void loadPropertyAccess(building).then(setAccess)
    void Promise.all([
      loadAssetRegistryAsync(building),
      loadPropertyBuildingProfile(building),
    ]).then(([state, profile]) => {
      setAssetsHasContent(
        assetRegistryHasContent(state) ||
          profile.yearBuilt != null ||
          (initialYearBuilt != null && Number.isFinite(initialYearBuilt)),
      )
    })
    const loadedInsurance = normalizeInsuranceProfile(
      readJson(landlordScopedKey('ulo.propertyInsurance', building), EMPTY_INSURANCE),
    )
    setInsurance(loadedInsurance)
    setInsuranceSaved(Boolean(loadedInsurance.updatedAt))
    setInsuranceExtractStage('idle')
    setInsuranceExtractLabel(null)
    setInsuranceExtractProgress(0)
    setExpanded(null)
    setError(null)

    function onRegistryEvent(ev: Event) {
      const detail = (ev as CustomEvent<{ building?: string }>).detail
      if (detail?.building && detail.building.trim() !== building.trim()) return
      void Promise.all([
        loadAssetRegistryAsync(building),
        loadPropertyBuildingProfile(building),
      ]).then(([state, profile]) => {
        setAssetsHasContent(assetRegistryHasContent(state) || profile.yearBuilt != null)
      })
    }
    window.addEventListener(ASSET_REGISTRY_CHANGED_EVENT, onRegistryEvent)
    return () => window.removeEventListener(ASSET_REGISTRY_CHANGED_EVENT, onRegistryEvent)
  }, [building, initialYearBuilt])

  const persistInspection = useCallback(
    (next: InspectionDoc[]) => {
      setInspectionDocs(next)
      writeJson(landlordScopedKey('ulo.propertyInspection', building), next)
    },
    [building],
  )

  const persistHistory = useCallback(
    (next: MaintenanceHistoryDocument[]) => {
      setHistoryDocs(next)
      saveMaintenanceHistoryDocuments(next, { building })
    },
    [building],
  )

  const persistHistoryApproved = useCallback(
    (next: MaintenanceHistoryRecord[]) => {
      setHistoryApproved(next)
      saveApprovedMaintenanceRecords(next, { building })
    },
    [building],
  )

  function toggle(id: SectionId) {
    setExpanded((prev) => (prev === id ? null : id))
    setError(null)
  }

  function onInspectionFiles(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    const additions: InspectionDoc[] = []
    for (const file of Array.from(files)) {
      if (!isAcceptedInspectionFile(file)) {
        setError('Upload a PDF, DOCX, image, or ZIP inspection document.')
        continue
      }
      if (file.size > INSPECTION_MAX_BYTES) {
        setError('Each file must be 25MB or smaller.')
        continue
      }
      additions.push({
        id: `insp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        fileName: file.name,
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
        status: 'processing',
      })
    }
    if (additions.length === 0) return
    const next = [...inspectionDocs, ...additions]
    persistInspection(next)
    const additionIds = new Set(additions.map((a) => a.id))
    window.setTimeout(() => {
      setInspectionDocs((current) => {
        const updated = current.map((doc) =>
          additionIds.has(doc.id) ? { ...doc, status: 'ready' as const } : doc,
        )
        writeJson(landlordScopedKey('ulo.propertyInspection', building), updated)
        return updated
      })
    }, 1400)
  }

  const inspectionEmpty = inspectionDocs.length === 0
  const accessEmpty = !access.updatedAt
  const assetsEmpty = !assetsHasContent
  const insuranceEmpty = !insuranceHasContent(insurance)
  const historyEmpty = historyDocs.length === 0 && historyApproved.length === 0

  if (loading) {
    return (
      <div className="mt-6 rounded-[12px] border border-[#e2e8f0] bg-white px-5 py-10 text-center">
        <p className="text-[13px] text-[#64748b]">Loading property details…</p>
      </div>
    )
  }

  return (
    <div className="mt-6 flex w-full flex-col gap-3">
      {error ? <p className="text-[12px] text-[#b91c1c]">{error}</p> : null}

      <DetailCard
        icon={
          <img
            src={smartInspectionReportIcon}
            alt=""
            className="size-[32px] object-contain"
          />
        }
        title="Smart Inspection Report"
        description={
          inspectionEmpty
            ? 'Upload an inspection report for property condition'
            : 'Upload a report to help Ulo understand property condition'
        }
        empty={inspectionEmpty}
        expanded={expanded === 'inspection'}
        onToggle={() => toggle('inspection')}
      >
        <HomeInspectionExpandedPanel
          building={building}
          docs={inspectionDocs}
          onFiles={onInspectionFiles}
          onRemove={(id) => persistInspection(inspectionDocs.filter((d) => d.id !== id))}
        />
      </DetailCard>

      <DetailCard
        icon={
          <img
            src={propertyAccessIcon}
            alt=""
            className="size-[32px] object-contain"
          />
        }
        title="Property Access"
        description="Help vendors get to the job faster"
        empty={accessEmpty}
        expanded={expanded === 'access'}
        onToggle={() => toggle('access')}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-4">
            <AccessField
              label="Building Entry Instructions"
              value={access.buildingEntry}
              onChange={(buildingEntry) => setAccess((prev) => ({ ...prev, buildingEntry }))}
              placeholder="e.g. Use main entrance, buzzer code…"
            />
            <AccessField
              label="Gate Code"
              value={access.gateCode}
              onChange={(gateCode) => setAccess((prev) => ({ ...prev, gateCode }))}
              placeholder="e.g. 4521#"
            />
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-4">
            <AccessField
              label="Lockbox Location"
              value={access.lockboxLocation}
              onChange={(lockboxLocation) =>
                setAccess((prev) => ({ ...prev, lockboxLocation }))
              }
              placeholder="e.g. Unit 101 — behind mailbox"
            />
            <AccessField
              label="Lockbox Code"
              value={access.lockboxCode}
              onChange={(lockboxCode) => setAccess((prev) => ({ ...prev, lockboxCode }))}
              placeholder="Enter lockbox code"
              required
            />
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-4">
            <AccessField
              label="Utility Room Access"
              value={access.utilityRoomAccess}
              onChange={(utilityRoomAccess) =>
                setAccess((prev) => ({ ...prev, utilityRoomAccess }))
              }
              placeholder="e.g. Key is with Superintendent..."
            />
            <AccessField
              label="Visitor Parking Instructions"
              value={access.visitorParking}
              onChange={(visitorParking) =>
                setAccess((prev) => ({ ...prev, visitorParking }))
              }
              placeholder="e.g. Visitor lot B"
            />
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-4">
            <AccessField
              label="Superintendent Contact"
              value={access.superintendentContact}
              onChange={(superintendentContact) =>
                setAccess((prev) => ({ ...prev, superintendentContact }))
              }
              placeholder="e.g. Mike Rodriguez — 555-0142"
            />
            <AccessField
              label="Emergency Access Notes"
              value={access.emergencyAccessNotes}
              onChange={(emergencyAccessNotes) =>
                setAccess((prev) => ({ ...prev, emergencyAccessNotes }))
              }
              placeholder="e.g. Fire escape instructions..."
            />
          </div>
          <button
            type="button"
            onClick={() => {
              if (!access.lockboxCode.trim()) {
                setError('Lockbox code is required.')
                return
              }
              void (async () => {
                try {
                  await savePropertyAccess(building, access)
                  setAccess((prev) => ({
                    ...prev,
                    updatedAt: new Date().toISOString(),
                  }))
                  setError(null)
                } catch (err) {
                  setError(
                    getErrorMessage(err, 'Could not save property access.'),
                  )
                }
              })()
            }}
            className="pd-btn pd-btn-primary self-start rounded-[8px] px-4 py-2 text-[12px] font-semibold"
          >
            Save 
          </button>
        </div>
      </DetailCard>

      <DetailCard
        icon={
          <img
            src={assetRegistryIcon}
            alt=""
            className="size-[32px] object-contain"
          />
        }
        title="Asset Registry"
        description="Help Ulo predict repairs before things break"
        empty={assetsEmpty}
        expanded={expanded === 'assets'}
        onToggle={() => toggle('assets')}
      >
        <AssetRegistryPanel
          building={building}
          initialYearBuilt={initialYearBuilt}
          onChanged={setAssetsHasContent}
        />
      </DetailCard>

      <DetailCard
        icon={
          <img
            src={propertyInsuranceIcon}
            alt=""
            className="size-[32px] object-contain"
          />
        }
        title="Insurance"
        description="Keep your property insurance in one place"
        empty={insuranceEmpty}
        expanded={expanded === 'insurance'}
        onToggle={() => toggle('insurance')}
      >
        <InsuranceExpandedPanel
          insurance={insurance}
          extracting={isInsuranceBinderScanProcessing(insuranceExtractStage)}
          extractLabel={insuranceExtractLabel}
          extractProgress={insuranceExtractProgress}
          isSaved={insuranceSaved}
          onChange={(next) => {
            setInsurance(next)
            setInsuranceSaved(false)
          }}
          onSave={() => {
            const next = { ...insurance, updatedAt: new Date().toISOString() }
            setInsurance(next)
            writeJson(landlordScopedKey('ulo.propertyInsurance', building), next)
            setInsuranceSaved(true)
          }}
          onBinderFiles={(files) => {
            const file = files?.[0]
            if (!file) return
            void (async () => {
              try {
                setInsuranceExtractStage('uploading')
                setInsuranceExtractLabel('Uploading insurance binder…')
                setInsuranceExtractProgress(10)
                setInsuranceSaved(false)
                const result = await extractInsuranceBinder(file, (progress) => {
                  setInsuranceExtractStage(progress.stage)
                  setInsuranceExtractLabel(progress.label)
                  setInsuranceExtractProgress(progress.progress)
                })
                setInsurance((prev) => ({
                  ...prev,
                  ...result.extracted,
                  binderFileName: result.fileName,
                  binderUploadedAt: new Date().toISOString(),
                  updatedAt: null,
                }))
                setInsuranceSaved(false)
                setInsuranceExtractStage('complete')
                setInsuranceExtractLabel('Details filled from binder — review and save')
                setInsuranceExtractProgress(100)
              } catch (err) {
                setInsuranceExtractStage('failed')
                setInsuranceExtractLabel(
                  getErrorMessage(err, 'Could not read binder'),
                )
                setError(
                  getErrorMessage(err, 'Could not extract insurance details from the binder.'),
                )
              }
            })()
          }}
        />
      </DetailCard>

      <DetailCard
        icon={
          <img
            src={maintenanceHistoryIcon}
            alt=""
            className="size-[32px] object-contain"
          />
        }
        title="Maintenance History"
        description="Upload previous invoices, receipts, or work orders to help Ulo understand past repairs, identify recurring issues, and improve future maintenance planning."
        empty={historyEmpty}
        expanded={expanded === 'history'}
        onToggle={() => toggle('history')}
      >
        <MaintenanceHistoryPanel
          building={building}
          docs={historyDocs}
          approved={historyApproved}
          onDocsChange={persistHistory}
          onApprovedChange={persistHistoryApproved}
          onError={setError}
        />
      </DetailCard>
    </div>
  )
}

export default PropertyDetailsPanel
