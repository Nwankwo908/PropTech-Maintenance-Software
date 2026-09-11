import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PropertyInsurancePolicyCard } from '@/components/PropertyInsurancePolicyCard'
import { PropertyRecordHierarchy } from '@/components/PropertyRecordHierarchy'
import { MaintenanceHistoryPanel } from '@/components/MaintenanceHistoryPanel'
import insuranceUploadCloudIcon from '@/assets/insurance-upload-cloud.svg'
import maintenanceHistoryIcon from '@/assets/maintenance-history.png'
import propertyAccessIcon from '@/assets/property-access.png'
import propertyInsuranceIcon from '@/assets/property-insurance.png'
import smartInspectionReportIcon from '@/assets/smart-inspection-report.png'
import {
  listInspectionAssets,
  loadBuildingInspectionSession,
  removeInspectionPhoto,
  uploadAndAnalyzeInspectionPhoto,
} from '@/api/inspectionAssetAssess'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isLimitedAlpha1Landlord } from '@shared/landlordCapabilities'
import { prepareInspectionDocumentUpload } from '@/lib/prepareInspectionDocumentUpload'
import {
  INSPECTION_SESSION_CHANGED_EVENT,
  hasPersistedInspectionData,
  isInspectionReportPhoto,
  notifyInspectionSessionChanged,
} from '@/lib/inspectionSession'
import { notifyAssetRegistryChanged } from '@/lib/assetRegistry'
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
  clearPropertyAccess,
  loadPropertyAccess,
  propertyAccessHasContent,
  savePropertyAccess,
  type PropertyAccessProfile,
} from '@/lib/propertyAccess'
import {
  extractInsuranceBinder,
  isInsuranceBinderScanProcessing,
  type InsuranceBinderScanStage,
} from '@/lib/propertyInsuranceBinderExtract'
import { notifyPropertyDetailsChanged } from '@/lib/propertyDetailsCompleteness'
import { getErrorMessage } from '@/lib/errorMessage'
import {
  ADMIN_RAIL_FOOTER_CLASS,
  ADMIN_RAIL_FOOTER_PRIMARY_BUTTON_CLASS,
  ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS,
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
} from '@/lib/adminRightRail'

const INSPECTION_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*'
const INSPECTION_MAX_BYTES = 25 * 1024 * 1024

type SectionId = 'inspection' | 'access' | 'insurance' | 'history'

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
  policyType: string
  premium: string
  coverageAmount: string
  deductible: string
  dwellingCoverage: string
  otherStructures: string
  liability: string
  lossOfRentalIncome: string
  binderFileName: string | null
  binderFileUrl: string | null
  binderFileSize: number | null
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
  policyType: '',
  premium: '',
  coverageAmount: '',
  deductible: '',
  dwellingCoverage: '',
  otherStructures: '',
  liability: '',
  lossOfRentalIncome: '',
  binderFileName: null,
  binderFileUrl: null,
  binderFileSize: null,
  binderUploadedAt: null,
  updatedAt: null,
}

function insuranceFormHasInput(profile: InsuranceProfile): boolean {
  return Boolean(
    profile.carrier.trim() ||
      profile.policyNumber.trim() ||
      profile.coverageStartDate.trim() ||
      profile.coverageEndDate.trim() ||
      profile.renewalDate.trim() ||
      profile.claimsContactName.trim() ||
      profile.claimsPhone.trim() ||
      profile.policyType.trim() ||
      profile.premium.trim() ||
      profile.coverageAmount.trim() ||
      profile.deductible.trim() ||
      profile.dwellingCoverage.trim() ||
      profile.otherStructures.trim() ||
      profile.liability.trim() ||
      profile.lossOfRentalIncome.trim() ||
      profile.binderFileName?.trim() ||
      profile.additionalInsured,
  )
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
    policyType: str('policyType'),
    premium: str('premium'),
    coverageAmount: str('coverageAmount'),
    deductible: str('deductible'),
    dwellingCoverage: str('dwellingCoverage'),
    otherStructures: str('otherStructures'),
    liability: str('liability'),
    lossOfRentalIncome: str('lossOfRentalIncome'),
    binderFileName: typeof o.binderFileName === 'string' ? o.binderFileName : null,
    binderFileUrl: typeof o.binderFileUrl === 'string' ? o.binderFileUrl : null,
    binderFileSize:
      typeof o.binderFileSize === 'number' && Number.isFinite(o.binderFileSize)
        ? o.binderFileSize
        : null,
    binderUploadedAt: typeof o.binderUploadedAt === 'string' ? o.binderUploadedAt : null,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
  }
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

function fileSizeFromAiResult(result: unknown): number {
  if (!result || typeof result !== 'object') return 0
  const size = (result as { _fileSize?: unknown })._fileSize
  return typeof size === 'number' && Number.isFinite(size) ? size : 0
}

function inspectionDocsFromSessionPhotos(
  photos: Array<{
    id: string
    fileName: string | null
    contentType?: string | null
    createdAt?: string | null
    status: string
    aiResult: unknown
  }>,
): InspectionDoc[] {
  return photos.filter(isInspectionReportPhoto).map((photo) => ({
    id: photo.id,
    fileName: photo.fileName?.trim() || 'Inspection report',
    fileSize: fileSizeFromAiResult(photo.aiResult),
    uploadedAt: photo.createdAt || new Date().toISOString(),
    status: photo.status === 'queued' || photo.status === 'analyzing' ? 'processing' : 'ready',
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
  if (/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) return true
  const type = file.type.toLowerCase()
  return type.startsWith('image/') || type === 'application/pdf'
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
  /** When false, the card stays open with no chevron accordion. */
  collapsible?: boolean
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
  collapsible = true,
  children,
}: DetailCardProps) {
  const open = !collapsible || expanded
  const headerClass = [
    'flex w-full flex-col gap-4 border border-transparent bg-transparent p-[18px] text-left outline-none sm:flex-row sm:items-center sm:justify-between sm:gap-6',
    collapsible
      ? [
          'cursor-pointer transition-[background-color,box-shadow] duration-150',
          'hover:bg-[#f8fafc] focus-visible:bg-[#f8fafc] focus-visible:shadow-[0_0_0_2px_#ffffff,0_0_0_4px_#187960] active:bg-[#eef2f7]',
          expanded ? 'bg-[#f8fafc]/60' : '',
        ].join(' ')
      : '',
  ].join(' ')

  const headerBody = (
    <>
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
        <div
          className={[
            'flex size-9 shrink-0 items-center justify-center text-[18px] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:size-10 sm:text-[20px]',
            open ? 'scale-105' : 'scale-100 group-hover:scale-105',
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

      {collapsible ? (
        <span
          className="inline-flex shrink-0 self-start rounded p-1 text-[#64748b] transition-colors duration-150 group-hover:bg-[#e2e8f0] group-hover:text-[#0f172a] sm:self-center"
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
      ) : null}
    </>
  )

  return (
    <div
      className={[
        'property-details-card sa-surface group min-w-0 rounded-[12px] border border-solid bg-white',
        open
          ? 'overflow-x-hidden overflow-y-visible border-[#cbd5e1] shadow-[0px_2px_10px_0px_rgba(15,23,42,0.06)]'
          : 'overflow-hidden border-[#e2e8f0] shadow-none hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:shadow-[0px_2px_10px_0px_rgba(15,23,42,0.06)]',
      ].join(' ')}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          className={headerClass}
          aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
          aria-expanded={expanded}
        >
          {headerBody}
        </button>
      ) : (
        <div className={headerClass}>{headerBody}</div>
      )}

      {children ? (
        <div
          className={[
            'grid',
            collapsible
              ? 'transition-[grid-template-rows] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
              : '',
            open ? 'grid-rows-[auto]' : 'grid-rows-[0fr]',
          ].join(' ')}
        >
          <div className={open ? 'min-h-0 min-w-0 overflow-x-hidden overflow-y-visible' : 'min-h-0 overflow-hidden'}>
            <div
              className={[
                'min-w-0 border-t border-[#e2e8f0] bg-white px-[18px] py-4',
                collapsible
                  ? 'transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none'
                  : '',
                open
                  ? 'translate-y-0 opacity-100 delay-[40ms]'
                  : 'pointer-events-none -translate-y-2 opacity-0',
              ].join(' ')}
              inert={!open ? true : undefined}
            >
              {children}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const PROPERTY_ACCESS_TABLE_FIELDS: Array<{
  key: keyof Omit<PropertyAccessProfile, 'updatedAt'>
  label: string
}> = [
  { key: 'buildingEntry', label: 'Building Entry Instructions' },
  { key: 'gateCode', label: 'Gate Code' },
  { key: 'lockboxLocation', label: 'Lockbox Location' },
  { key: 'lockboxCode', label: 'Lockbox Code' },
  { key: 'utilityRoomAccess', label: 'Utility Room Access' },
  { key: 'visitorParking', label: 'Visitor Parking Instructions' },
  { key: 'superintendentContact', label: 'Superintendent Contact' },
  { key: 'emergencyAccessNotes', label: 'Emergency Access Notes' },
]

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
          'w-full min-w-0 rounded-[8px] border px-3 py-3 text-[13px] leading-normal text-[#0d0f11] outline-none placeholder:text-[#94a3b8] focus:border-[#94a3b8]',
          empty
            ? 'border-dashed border-[#e2e8f0] bg-transparent'
            : 'border-solid border-[#e2e8f0] bg-[#f8fafc]',
        ].join(' ')}
      />
    </label>
  )
}

function PropertyAccessSavedTable({
  access,
  checked,
  onChecked,
}: {
  access: PropertyAccessProfile
  checked: boolean
  onChecked: (checked: boolean) => void
}) {
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-[10px] border border-[#e2e8f0] bg-white">
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
            <th className="w-8 px-2 py-2" aria-hidden />
            {PROPERTY_ACCESS_TABLE_FIELDS.map((field) => (
              <th
                key={field.key}
                className="break-words px-1.5 py-2 text-left text-[10px] font-semibold uppercase leading-3 tracking-[0.2px] text-[#64748b] sm:px-2 sm:text-[11px] sm:leading-4"
              >
                {field.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="w-8 px-2 py-3 align-top">
              <label className="flex cursor-pointer items-center justify-center">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onChecked(e.target.checked)}
                  aria-label="Select saved property access"
                  className="size-4 cursor-pointer rounded border-[#cbd5e1] accent-[#186179]"
                />
              </label>
            </td>
            {PROPERTY_ACCESS_TABLE_FIELDS.map((field) => (
              <td
                key={field.key}
                className="break-words px-1.5 py-3 align-top text-[12px] leading-[18px] text-[#0d0f11] sm:px-2 sm:text-[13px] sm:leading-[19.5px]"
              >
                {access[field.key].trim() || '—'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Could not read the insurance document.'))
    reader.readAsDataURL(file)
  })
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
          'w-full min-w-0 rounded-[6px] border border-solid border-[#e2e8f0] bg-white px-3 py-2.5 text-[13px] leading-normal text-[#0d0f11] outline-none placeholder:text-[#64748b] focus:border-[#94a3b8]',
          type === 'date' && !value ? 'text-[#64748b]' : '',
        ].join(' ')}
      />
    </label>
  )
}

function InsuranceDetailsFields({
  insurance,
  onChange,
  extracting = false,
}: {
  insurance: InsuranceProfile
  onChange: (next: InsuranceProfile) => void
  extracting?: boolean
}) {
  function patch(partial: Partial<InsuranceProfile>) {
    onChange({ ...insurance, ...partial })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-4">
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

      <InsuranceField
        label="Annual Premium"
        value={insurance.premium}
        onChange={(premium) => patch({ premium })}
        placeholder="1840"
      />
      <InsuranceField
        label="Coverage Amount"
        value={insurance.coverageAmount}
        onChange={(coverageAmount) => patch({ coverageAmount })}
        placeholder="450000"
      />
      <InsuranceField
        label="Deductible"
        value={insurance.deductible}
        onChange={(deductible) => patch({ deductible })}
        placeholder="1000"
      />
      <InsuranceField
        label="Dwelling Coverage"
        value={insurance.dwellingCoverage}
        onChange={(dwellingCoverage) => patch({ dwellingCoverage })}
        placeholder="450000"
      />
      <InsuranceField
        label="Other Structures"
        value={insurance.otherStructures}
        onChange={(otherStructures) => patch({ otherStructures })}
        placeholder="45000"
      />
      <InsuranceField
        label="Liability"
        value={insurance.liability}
        onChange={(liability) => patch({ liability })}
        placeholder="300000"
      />
      <InsuranceField
        label="Loss of Rental Income"
        value={insurance.lossOfRentalIncome}
        onChange={(lossOfRentalIncome) => patch({ lossOfRentalIncome })}
        placeholder="18000"
      />

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
  )
}

function CloseInsuranceRailIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function InsuranceDetailsRail({
  open,
  mode,
  insurance,
  extracting = false,
  onChange,
  onSave,
  onClose,
}: {
  open: boolean
  mode: 'add' | 'edit'
  insurance: InsuranceProfile
  extracting?: boolean
  onChange: (next: InsuranceProfile) => void
  onSave: () => void
  onClose: () => void
}) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  const canSave = !extracting && insuranceFormHasInput(insurance)

  return createPortal(
    <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
      <div role="presentation" className={ADMIN_RIGHT_RAIL_SCRIM} aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={adminRightRailPanelClass(undefined)}
      >
        <header className="sa-enter shrink-0 border-b border-[#e5e7eb] px-5 py-4 pr-12">
          <h2 id={titleId} className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
            {mode === 'edit' ? 'Edit insurance' : 'Add insurance'}
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
            Store your property&apos;s insurance details in one secure place.
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="sa-press absolute right-4 top-4 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            <CloseInsuranceRailIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <InsuranceDetailsFields
            insurance={insurance}
            onChange={onChange}
            extracting={extracting}
          />
        </div>

        <footer className={ADMIN_RAIL_FOOTER_CLASS}>
          <button type="button" onClick={onClose} className={ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className={ADMIN_RAIL_FOOTER_PRIMARY_BUTTON_CLASS}
          >
            Save Details
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/** Expanded Insurance — Figma node 1140:1927. */
function InsuranceExpandedPanel({
  building,
  insurance,
  savedInsurance,
  onOpenAdd,
  onEditSaved,
  onDeleteSaved,
  onBinderFiles,
  extracting = false,
  extractLabel = null,
  extractProgress = 0,
}: {
  building: string
  insurance: InsuranceProfile
  savedInsurance: InsuranceProfile | null
  onOpenAdd: () => void
  onEditSaved: () => void
  onDeleteSaved: () => void
  onBinderFiles: (files: FileList | null) => void
  extracting?: boolean
  extractLabel?: string | null
  extractProgress?: number
}) {
  const binderInputId = useId()
  const binderInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const hasDraft = insuranceFormHasInput(insurance)

  return (
    <div className="flex flex-col gap-5">
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
            className="mt-1 flex size-10 items-center justify-center rounded-[10px] bg-transparent text-[#186179] outline-none hover:text-[#0f4a5c] focus-visible:ring-2 focus-visible:ring-[#186179] disabled:text-[#94a3b8]"
            aria-label="Upload insurance binder"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-6" aria-hidden>
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {!savedInsurance || hasDraft ? (
        <div>
          <button
            type="button"
            onClick={onOpenAdd}
            disabled={extracting}
            className="pd-btn pd-btn-ghost rounded-[10px] px-4 py-2.5 text-[13px] font-semibold text-[#186179] hover:bg-[#eff6ff]"
          >
            {hasDraft ? 'Continue insurance details' : 'Add insurance details'}
          </button>
        </div>
      ) : null}

      {savedInsurance ? (
        <PropertyInsurancePolicyCard
          insurance={{
            policyType: savedInsurance.policyType,
            building,
            carrier: savedInsurance.carrier,
            policyNumber: savedInsurance.policyNumber,
            premium: savedInsurance.premium,
            coverageAmount: savedInsurance.coverageAmount,
            deductible: savedInsurance.deductible,
            coverageStartDate: savedInsurance.coverageStartDate,
            coverageEndDate: savedInsurance.coverageEndDate,
            dwellingCoverage: savedInsurance.dwellingCoverage,
            otherStructures: savedInsurance.otherStructures,
            liability: savedInsurance.liability,
            lossOfRentalIncome: savedInsurance.lossOfRentalIncome,
            agent: savedInsurance.claimsContactName,
            claimHotline: savedInsurance.claimsPhone,
            binderFileName: savedInsurance.binderFileName,
            binderFileUrl: savedInsurance.binderFileUrl,
            binderFileSize: savedInsurance.binderFileSize,
            binderUploadedAt: savedInsurance.binderUploadedAt,
          }}
          onEdit={onEditSaved}
          onDelete={onDeleteSaved}
        />
      ) : null}
    </div>
  )
}

type HomeInspectionExpandedPanelProps = {
  building: string
  docs: InspectionDoc[]
  hasPersistedInspection: boolean
  onFiles: (files: FileList | null) => void
  onRemove: (id: string) => void
}

/** Expanded Smart Inspection Report — Figma node 1144:20784. */
function HomeInspectionExpandedPanel({
  building,
  docs,
  hasPersistedInspection,
  onFiles,
  onRemove,
}: HomeInspectionExpandedPanelProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleFiles(files: FileList | null) {
    onFiles(files)
    if (inputRef.current) inputRef.current.value = ''
  }

  const uploadCard = (
      <div
        className={[
          'sa-dropzone flex h-full min-h-[220px] flex-col rounded-[10px] border border-dashed bg-[#f8fafc] p-px',
          dragging ? 'is-dragging' : 'border-[#cbd5e1]',
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
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
          <UploadDocIcon />
          <p className="text-[14px] font-semibold leading-[21px] text-[#0d0f11]">
            Upload inspection report
          </p>
          <p className="text-[12px] leading-[18px] text-[#64748b]">
            Save an existing inspection report to this property. The address on
            the report must match this property.
          </p>
          <p className="text-[12px] leading-[18px] text-[#64748b]">
            PDF or image · Max 25 MB
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
            className="mt-1 flex size-10 items-center justify-center rounded-[10px] bg-transparent text-[#186179] outline-none hover:text-[#0f4a5c] focus-visible:ring-2 focus-visible:ring-[#186179] disabled:text-[#94a3b8]"
            aria-label="Upload inspection report"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-6" aria-hidden>
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
  )

  const documentList = (
      <div className="overflow-hidden rounded-[10px] border border-[#e2e8f0] bg-white">
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

        {docs.length === 0 ? (
          hasPersistedInspection ? null : (
          <div className="px-4 py-6 text-center text-[13px] text-[#94a3b8]">
            No documents uploaded yet.
          </div>
          )
        ) : (
          <ul>
            {docs.map((doc, index) => (
              <li
                key={doc.id}
                className={[
                  'grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_80px_80px_110px_32px] sm:items-center sm:gap-2',
                  index < docs.length - 1 ? 'border-b border-[#e2e8f0]' : '',
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
  )

  if (!building) {
    return (
      <div className="flex flex-col gap-4">
        {uploadCard}
        {documentList}
      </div>
    )
  }

  return (
    <ApplianceInspectionUploader
      building={building}
      leading={uploadCard}
      trailing={documentList}
    />
  )
}

export type PropertyDetailsModule = 'inspection' | 'access' | 'insurance' | 'history'

export type PropertyDetailsPanelProps = {
  building: string
  loading?: boolean
  /** Seed from onboarding / demo meta when no saved profile yet. */
  initialYearBuilt?: number | null
  /** Which modules to show. Defaults to the full Property Intelligence stack. */
  modules?: PropertyDetailsModule[]
}

const ALL_DETAIL_MODULES: PropertyDetailsModule[] = [
  'inspection',
  'access',
  'insurance',
  'history',
]

/** Property Details tab — Figma card stack for optional property data modules. */
export function PropertyDetailsPanel({
  building,
  loading = false,
  initialYearBuilt = null,
  modules = ALL_DETAIL_MODULES,
}: PropertyDetailsPanelProps) {
  const showModule = (id: PropertyDetailsModule) => modules.includes(id)
  const [expanded, setExpanded] = useState<SectionId | null>(() =>
    modules.length === 1 ? modules[0]! : null,
  )
  const [inspectionDocs, setInspectionDocs] = useState<InspectionDoc[]>([])
  const [inspectionHasPersistedWork, setInspectionHasPersistedWork] = useState(false)
  const [inspectionSaveMessage, setInspectionSaveMessage] = useState<string | null>(null)
  const [historyDocs, setHistoryDocs] = useState<MaintenanceHistoryDocument[]>([])
  const [historyApproved, setHistoryApproved] = useState<MaintenanceHistoryRecord[]>([])
  const [access, setAccess] = useState<PropertyAccessProfile>(EMPTY_PROPERTY_ACCESS)
  const [savedAccess, setSavedAccess] = useState<PropertyAccessProfile | null>(null)
  const [accessRowChecked, setAccessRowChecked] = useState(false)
  const [insurance, setInsurance] = useState<InsuranceProfile>(EMPTY_INSURANCE)
  const [savedInsurance, setSavedInsurance] = useState<InsuranceProfile | null>(null)
  const [insuranceRailOpen, setInsuranceRailOpen] = useState(false)
  const [insuranceRailMode, setInsuranceRailMode] = useState<'add' | 'edit'>('add')
  const [insuranceExtractStage, setInsuranceExtractStage] =
    useState<InsuranceBinderScanStage>('idle')
  const [insuranceExtractLabel, setInsuranceExtractLabel] = useState<string | null>(null)
  const [insuranceExtractProgress, setInsuranceExtractProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const moduleKey = modules.join(',')

  useEffect(() => {
    if (modules.length === 1) setExpanded(modules[0]!)
  }, [moduleKey])

  useEffect(() => {
    if (!building) return
    let cancelled = false
    async function loadDocs() {
      try {
        const [session, assets] = await Promise.all([
          loadBuildingInspectionSession(building),
          listInspectionAssets(building).catch(() => []),
        ])
        if (cancelled) return
        setInspectionDocs(inspectionDocsFromSessionPhotos(session.photos))
        setInspectionHasPersistedWork(
          hasPersistedInspectionData({
            photoCount: session.photos.length,
            assetCount: assets.length,
          }),
        )
      } catch {
        if (!cancelled) {
          setInspectionDocs([])
          setInspectionHasPersistedWork(false)
        }
      }
    }
    void loadDocs()
    const loadedHistory = loadMaintenanceHistoryDocuments({ building })
    setHistoryDocs(loadedHistory)
    setHistoryApproved(loadApprovedMaintenanceRecords({ building }))
    void loadPropertyAccess(building).then((loaded) => {
      if (cancelled) return
      setAccessRowChecked(false)
      if (loaded.updatedAt) {
        setSavedAccess(loaded)
        setAccess({ ...EMPTY_PROPERTY_ACCESS })
      } else {
        setSavedAccess(null)
        setAccess(loaded)
      }
    })
    const loadedInsurance = normalizeInsuranceProfile(
      readJson(landlordScopedKey('ulo.propertyInsurance', building), EMPTY_INSURANCE),
    )
    if (loadedInsurance.updatedAt) {
      setSavedInsurance(loadedInsurance)
      setInsurance({ ...EMPTY_INSURANCE })
    } else {
      setSavedInsurance(null)
      setInsurance(loadedInsurance)
    }
    setInsuranceRailOpen(false)
    setInsuranceRailMode('add')
    setInsuranceExtractStage('idle')
    setInsuranceExtractLabel(null)
    setInsuranceExtractProgress(0)
    setExpanded(null)
    setError(null)
    setInspectionSaveMessage(null)
    return () => {
      cancelled = true
    }
  }, [building, initialYearBuilt])

  useEffect(() => {
    if (!building) return
    function onSessionChanged(event: Event) {
      const detail = (event as CustomEvent<{ building?: string }>).detail
      if (detail?.building && detail.building !== building) return
      void Promise.all([
        loadBuildingInspectionSession(building),
        listInspectionAssets(building).catch(() => []),
      ])
        .then(([session, assets]) => {
          setInspectionDocs(inspectionDocsFromSessionPhotos(session.photos))
          setInspectionHasPersistedWork(
            hasPersistedInspectionData({
              photoCount: session.photos.length,
              assetCount: assets.length,
            }),
          )
        })
        .catch(() => {
          /* keep current list */
        })
    }
    window.addEventListener(INSPECTION_SESSION_CHANGED_EVENT, onSessionChanged)
    return () => window.removeEventListener(INSPECTION_SESSION_CHANGED_EVENT, onSessionChanged)
  }, [building])

  const persistHistory = useCallback(
    (next: MaintenanceHistoryDocument[]) => {
      setHistoryDocs(next)
      saveMaintenanceHistoryDocuments(next, { building })
      notifyPropertyDetailsChanged(building)
    },
    [building],
  )

  const persistHistoryApproved = useCallback(
    (next: MaintenanceHistoryRecord[]) => {
      setHistoryApproved(next)
      saveApprovedMaintenanceRecords(next, { building })
      notifyPropertyDetailsChanged(building)
    },
    [building],
  )

  function toggle(id: SectionId) {
    setExpanded((prev) => (prev === id ? null : id))
    setError(null)
  }

  async function onInspectionFiles(files: FileList | null) {
    if (!files?.length || !building) return
    setError(null)
    setInspectionSaveMessage(null)
    const accepted: File[] = []
    for (const file of Array.from(files)) {
      if (!isAcceptedInspectionFile(file)) {
        setError('Upload a PDF or image of the inspection report. ZIP and Word files are not supported.')
        continue
      }
      if (file.size > INSPECTION_MAX_BYTES) {
        setError('Each file must be 25MB or smaller.')
        continue
      }
      accepted.push(file)
    }
    if (accepted.length === 0) return

    const pending = accepted.map((file) => ({
      id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fileName: file.name,
      fileSize: file.size,
      uploadedAt: new Date().toISOString(),
      status: 'processing' as const,
    }))
    setInspectionDocs((current) => [...current, ...pending])

    try {
      const session = await loadBuildingInspectionSession(building)
      for (const file of accepted) {
        const compressed = await prepareInspectionDocumentUpload(file)
        await uploadAndAnalyzeInspectionPhoto({
          assessmentId: session.id,
          blob: compressed.blob,
          imageBase64: compressed.base64 || undefined,
          contentType: compressed.contentType,
          fileName: compressed.fileName,
          mode: 'document',
          autoConfirm: true,
        })
      }
      const [refreshed, assets] = await Promise.all([
        loadBuildingInspectionSession(building),
        listInspectionAssets(building).catch(() => []),
      ])
      setInspectionDocs(inspectionDocsFromSessionPhotos(refreshed.photos))
      setInspectionHasPersistedWork(
        hasPersistedInspectionData({
          photoCount: refreshed.photos.length,
          assetCount: assets.length,
        }),
      )
      notifyInspectionSessionChanged(building)
      notifyAssetRegistryChanged(building)
      notifyPropertyDetailsChanged(building)
      setInspectionSaveMessage(
        accepted.length === 1 ? 'Inspection report saved' : `${accepted.length} inspection reports saved`,
      )
    } catch (err) {
      try {
        const [refreshed, assets] = await Promise.all([
          loadBuildingInspectionSession(building),
          listInspectionAssets(building).catch(() => []),
        ])
        setInspectionDocs(inspectionDocsFromSessionPhotos(refreshed.photos))
        setInspectionHasPersistedWork(
          hasPersistedInspectionData({
            photoCount: refreshed.photos.length,
            assetCount: assets.length,
          }),
        )
      } catch {
        setInspectionDocs((current) => current.filter((doc) => !pending.some((row) => row.id === doc.id)))
      }
      setError(
        getErrorMessage(
          err,
          'This report could not be saved. Check that the address matches this property and try again.',
        ),
      )
    }
  }

  async function onRemoveInspectionDoc(id: string) {
    setError(null)
    const previous = inspectionDocs
    setInspectionDocs((current) => current.filter((doc) => doc.id !== id))
    if (id.startsWith('pending-')) return
    try {
      await removeInspectionPhoto(id)
      notifyInspectionSessionChanged(building)
      notifyAssetRegistryChanged(building)
      notifyPropertyDetailsChanged(building)
    } catch (err) {
      setInspectionDocs(previous)
      setError(getErrorMessage(err, 'Could not remove that report.'))
    }
  }

  const inspectionEmpty = !inspectionHasPersistedWork
  const accessEmpty = !savedAccess
  const insuranceEmpty = !savedInsurance
  const historyEmpty = historyDocs.length === 0 && historyApproved.length === 0
  const limitedAlpha1 = isLimitedAlpha1Landlord(getActiveLandlordId())

  if (loading) {
    return (
      <div className="mt-6 rounded-[12px] border border-[#e2e8f0] bg-white px-5 py-10 text-center">
        <p className="text-[13px] text-[#64748b]">Loading property details…</p>
      </div>
    )
  }

  return (
    <div className="mt-6 flex w-full min-w-0 flex-col gap-3 overflow-x-hidden">
      {error ? <p className="text-[12px] text-[#b91c1c]">{error}</p> : null}
      {showModule('inspection') && inspectionSaveMessage ? (
        <p className="text-[12px] text-[#059669]">{inspectionSaveMessage}</p>
      ) : null}

      {limitedAlpha1 ||
      !(showModule('inspection') || showModule('access') || showModule('history')) ? null : (
        <PropertyRecordHierarchy />
      )}

      {showModule('inspection') ? (
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
          hasPersistedInspection={inspectionHasPersistedWork}
          onFiles={(files) => void onInspectionFiles(files)}
          onRemove={(id) => void onRemoveInspectionDoc(id)}
        />
      </DetailCard>
      ) : null}

      {showModule('access') ? (
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
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-4">
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
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-4">
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
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-4">
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
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-4">
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
          {propertyAccessHasContent(access) || !savedAccess ? (
            <button
              type="button"
              onClick={() => {
                if (!access.lockboxCode.trim()) {
                  setError('Lockbox code is required.')
                  return
                }
                void (async () => {
                  try {
                    const next = {
                      ...access,
                      updatedAt: new Date().toISOString(),
                    }
                    await savePropertyAccess(building, next)
                    setSavedAccess(next)
                    setAccess({ ...EMPTY_PROPERTY_ACCESS })
                    setAccessRowChecked(false)
                    setError(null)
                    notifyPropertyDetailsChanged(building)
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
          ) : null}
          {savedAccess ? (
            <div className="flex flex-col gap-3">
              {accessRowChecked ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAccess({ ...savedAccess, updatedAt: null })
                      setAccessRowChecked(false)
                      setError(null)
                    }}
                    className="pd-btn pd-btn-ghost rounded-[10px] px-4 py-2.5 text-[13px] font-semibold text-[#186179] hover:bg-[#eff6ff]"
                  >
                    Edit selected
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          await clearPropertyAccess(building)
                          setSavedAccess(null)
                          setAccess({ ...EMPTY_PROPERTY_ACCESS })
                          setAccessRowChecked(false)
                          setError(null)
                          notifyPropertyDetailsChanged(building)
                        } catch (err) {
                          setError(
                            getErrorMessage(err, 'Could not remove property access.'),
                          )
                        }
                      })()
                    }}
                    className="pd-btn pd-btn-ghost rounded-[10px] px-4 py-2.5 text-[13px] font-semibold text-[#a03e3e] hover:bg-[#fef2f2] hover:text-[#991b1b]"
                  >
                    Delete selected
                  </button>
                </div>
              ) : null}
              <PropertyAccessSavedTable
                access={savedAccess}
                checked={accessRowChecked}
                onChecked={setAccessRowChecked}
              />
            </div>
          ) : null}
        </div>
      </DetailCard>
      ) : null}

      {showModule('insurance') ? (
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
        collapsible={false}
      >
        <InsuranceExpandedPanel
          building={building}
          insurance={insurance}
          savedInsurance={savedInsurance}
          extracting={isInsuranceBinderScanProcessing(insuranceExtractStage)}
          extractLabel={insuranceExtractLabel}
          extractProgress={insuranceExtractProgress}
          onOpenAdd={() => {
            setInsuranceRailMode('add')
            setInsuranceRailOpen(true)
          }}
          onEditSaved={() => {
            if (!savedInsurance) return
            setInsurance({ ...savedInsurance, updatedAt: null })
            setInsuranceRailMode('edit')
            setInsuranceRailOpen(true)
            setError(null)
          }}
          onDeleteSaved={() => {
            writeJson(landlordScopedKey('ulo.propertyInsurance', building), EMPTY_INSURANCE)
            setSavedInsurance(null)
            setInsurance({ ...EMPTY_INSURANCE })
            setInsuranceRailOpen(false)
            setError(null)
            notifyPropertyDetailsChanged(building)
          }}
          onBinderFiles={(files) => {
            const file = files?.[0]
            if (!file) return
            void (async () => {
              try {
                setInsuranceExtractStage('uploading')
                setInsuranceExtractLabel('Uploading insurance binder…')
                setInsuranceExtractProgress(10)
                const result = await extractInsuranceBinder(file, (progress) => {
                  setInsuranceExtractStage(progress.stage)
                  setInsuranceExtractLabel(progress.label)
                  setInsuranceExtractProgress(progress.progress)
                })
                const binderFileUrl =
                  file.size <= 3.5 * 1024 * 1024 ? await fileToDataUrl(file) : URL.createObjectURL(file)
                setInsurance((prev) => ({
                  ...prev,
                  ...result.extracted,
                  policyType: result.extracted.policyType || prev.policyType || 'Homeowners',
                  binderFileName: result.fileName,
                  binderFileUrl,
                  binderFileSize: file.size,
                  binderUploadedAt: new Date().toISOString(),
                  updatedAt: null,
                }))
                setInsuranceExtractStage('complete')
                setInsuranceExtractLabel('Details filled from binder — review and save')
                setInsuranceExtractProgress(100)
                setInsuranceRailMode('add')
                setInsuranceRailOpen(true)
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
        <InsuranceDetailsRail
          open={insuranceRailOpen}
          mode={insuranceRailMode}
          insurance={insurance}
          extracting={isInsuranceBinderScanProcessing(insuranceExtractStage)}
          onChange={setInsurance}
          onClose={() => setInsuranceRailOpen(false)}
          onSave={() => {
            const next = {
              ...insurance,
              policyType: insurance.policyType.trim() || 'Homeowners',
              updatedAt: new Date().toISOString(),
            }
            writeJson(landlordScopedKey('ulo.propertyInsurance', building), next)
            setSavedInsurance(next)
            setInsurance({ ...EMPTY_INSURANCE })
            setInsuranceRailOpen(false)
            setError(null)
            notifyPropertyDetailsChanged(building)
          }}
        />
      </DetailCard>
      ) : null}

      {showModule('history') ? (
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
      ) : null}
    </div>
  )
}

export default PropertyDetailsPanel
