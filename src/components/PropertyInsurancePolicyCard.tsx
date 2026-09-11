import { useEffect, useId, useRef, useState } from 'react'
import policyDownloadIcon from '@/assets/insurance/policy-download.svg'
import policyOverflowIcon from '@/assets/insurance/policy-overflow.svg'
import policyShareIcon from '@/assets/insurance/policy-share.svg'

export type SavedPropertyInsuranceCard = {
  policyType: string
  building: string
  carrier: string
  policyNumber: string
  premium: string
  coverageAmount: string
  deductible: string
  coverageStartDate: string
  coverageEndDate: string
  dwellingCoverage: string
  otherStructures: string
  liability: string
  lossOfRentalIncome: string
  agent: string
  claimHotline: string
  binderFileName: string | null
  binderFileUrl: string | null
  binderFileSize: number | null
  binderUploadedAt: string | null
}

function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const amount = Number(cleaned)
  return Number.isFinite(amount) ? amount : null
}

function formatUsd(value: string): string {
  const amount = parseAmount(value)
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount)
}

function formatPremium(value: string): string {
  const formatted = formatUsd(value)
  return formatted === '—' ? '—' : `${formatted}/yr`
}

function formatPolicyDate(value: string): string {
  const raw = value.trim()
  if (!raw) return '—'
  const iso = raw.length === 10 ? `${raw}T12:00:00` : raw
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatPolicyNumberShort(value: string): string {
  const text = value.trim()
  if (!text) return '—'
  if (text.length <= 8) return text
  return `...${text.slice(-6)}`
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function policyTypeLabel(value: string): string {
  const key = value.trim().toLowerCase()
  if (key.includes('commercial')) return 'Commercial'
  if (key.includes('dwelling')) return 'Dwelling'
  return 'Homeowners'
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-start rounded-[8px] bg-[#f9fafb] px-3 py-2">
      <p className="text-[10px] leading-[15px] text-[#99a1af]">{label}</p>
      <p className="w-full pt-0.5 text-[12px] font-semibold leading-4 text-[#1e2939]">{value}</p>
    </div>
  )
}

function DetailRow({
  label,
  value,
  last = false,
}: {
  label: string
  value: string
  last?: boolean
}) {
  return (
    <div
      className={[
        'flex w-full items-center justify-between',
        last ? 'pt-2.5' : 'border-b border-[#f3f4f6] py-2.5',
      ].join(' ')}
    >
      <p className="text-[12px] leading-4 text-[#6a7282]">{label}</p>
      <p className="text-[12px] font-medium leading-4 text-[#1e2939]">{value}</p>
    </div>
  )
}

function downloadBinder(insurance: SavedPropertyInsuranceCard) {
  const href = insurance.binderFileUrl?.trim()
  if (!href) return
  const link = document.createElement('a')
  link.href = href
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.download = insurance.binderFileName?.trim() || 'insurance-policy'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function shareBinder(insurance: SavedPropertyInsuranceCard) {
  const title = `${policyTypeLabel(insurance.policyType)} Policy - ${insurance.building}`
  const href = insurance.binderFileUrl?.trim()
  try {
    if (navigator.share) {
      await navigator.share({
        title,
        text: [insurance.carrier, insurance.policyNumber].filter(Boolean).join(' · '),
        ...(href && /^https?:/i.test(href) ? { url: href } : {}),
      })
      return
    }
    await navigator.clipboard.writeText(title)
  } catch {
    // user cancelled share
  }
}

type PropertyInsurancePolicyCardProps = {
  insurance: SavedPropertyInsuranceCard
  onEdit: () => void
  onDelete: () => void
}

/** Saved policy card — Figma node 1454:1180. */
export function PropertyInsurancePolicyCard({
  insurance,
  onEdit,
  onDelete,
}: PropertyInsurancePolicyCardProps) {
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const canDownload = Boolean(insurance.binderFileUrl?.trim())
  const typeLabel = policyTypeLabel(insurance.policyType)
  const coverage = insurance.coverageAmount.trim() || insurance.dwellingCoverage

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-[12px] border border-solid border-[#e5e7eb] bg-white shadow-[0px_2px_8px_0px_rgba(16,24,40,0.04)]">
      <div className="flex w-full flex-col gap-3 border-b border-solid border-[#f3f4f6] px-5 py-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="inline-flex w-fit items-center rounded-full bg-[#eff6ff] px-2 py-0.5 text-[10px] font-medium leading-[15px] text-[#1447e6]">
              {typeLabel}
            </span>
            <h3 className="text-[14px] font-semibold leading-[19.25px] text-[#101828]">
              {typeLabel} Policy - {insurance.building}
            </h3>
            <p className="text-[12px] leading-4 text-[#99a1af]">{insurance.carrier.trim() || '—'}</p>
          </div>
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              aria-label="Insurance actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              onClick={() => setMenuOpen((open) => !open)}
              className="sa-press inline-flex size-8 items-center justify-center rounded-[8px] border border-solid border-[#e5e7eb] bg-white"
            >
              <img src={policyOverflowIcon} alt="" width={16} height={16} className="size-4" />
            </button>
            {menuOpen ? (
              <div
                id={menuId}
                role="menu"
                className="sa-enter absolute right-0 z-20 mt-1 min-w-[140px] overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white py-1 shadow-[0_8px_24px_rgba(16,24,40,0.12)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="sa-press block w-full cursor-pointer px-3 py-2 text-left text-[13px] font-medium text-[#0a0a0a] hover:bg-[#f3f4f6]"
                  onClick={() => {
                    setMenuOpen(false)
                    onEdit()
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="sa-press block w-full cursor-pointer px-3 py-2 text-left text-[13px] font-medium text-[#a03e3e] hover:bg-[#fef2f2]"
                  onClick={() => {
                    setMenuOpen(false)
                    onDelete()
                  }}
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 gap-2">
          <button
            type="button"
            disabled={!canDownload}
            onClick={() => downloadBinder(insurance)}
            className="sa-press inline-flex h-10 min-w-px flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-[#155dfc] px-3 py-2 text-[12px] font-medium leading-4 text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <img src={policyDownloadIcon} alt="" width={14} height={14} className="size-[14px]" />
            Download
          </button>
          <button
            type="button"
            onClick={() => void shareBinder(insurance)}
            className="sa-press inline-flex h-10 min-w-px flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-solid border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-medium leading-4 text-[#4a5565]"
          >
            <img src={policyShareIcon} alt="" width={14} height={14} className="size-[14px]" />
            Share
          </button>
        </div>
      </div>

      <div className="flex w-full flex-col gap-3 border-b border-solid border-[#f3f4f6] px-5 py-4">
        <p className="text-[10px] font-semibold uppercase leading-[15px] tracking-[0.5px] text-[#99a1af]">
          Policy Summary
        </p>
        <div className="flex w-full flex-col gap-2">
          <div className="flex gap-2">
            <SummaryTile label="Premium" value={formatPremium(insurance.premium)} />
            <SummaryTile label="Coverage" value={formatUsd(coverage)} />
          </div>
          <div className="flex gap-2">
            <SummaryTile label="Deductible" value={formatUsd(insurance.deductible)} />
            <SummaryTile label="Start" value={formatPolicyDate(insurance.coverageStartDate)} />
          </div>
          <div className="flex gap-2">
            <SummaryTile label="Expires" value={formatPolicyDate(insurance.coverageEndDate)} />
            <SummaryTile label="Policy #" value={formatPolicyNumberShort(insurance.policyNumber)} />
          </div>
        </div>
      </div>

      <div className="flex w-full flex-col gap-3 border-b border-solid border-[#f3f4f6] px-5 py-4">
        <p className="text-[10px] font-semibold uppercase leading-[15px] tracking-[0.5px] text-[#99a1af]">
          Extracted Details
        </p>
        <div className="flex w-full flex-col gap-2">
          <DetailRow label="Dwelling Coverage" value={formatUsd(insurance.dwellingCoverage || coverage)} />
          <DetailRow label="Other Structures" value={formatUsd(insurance.otherStructures)} />
          <DetailRow label="Liability" value={formatUsd(insurance.liability)} />
          <DetailRow label="Loss of Rental Income" value={formatUsd(insurance.lossOfRentalIncome)} />
          <DetailRow label="Agent" value={insurance.agent.trim() || '—'} />
          <DetailRow label="Claim Hotline" value={insurance.claimHotline.trim() || '—'} last />
        </div>
      </div>

      <div className="flex w-full flex-col gap-2 px-5 py-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] leading-4 text-[#99a1af]">File size</p>
          <p className="text-[12px] leading-4 text-[#4a5565]">{formatFileSize(insurance.binderFileSize)}</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[12px] leading-4 text-[#99a1af]">Uploaded</p>
          <p className="text-[12px] leading-4 text-[#4a5565]">
            {formatPolicyDate(insurance.binderUploadedAt ?? '')}
          </p>
        </div>
      </div>
    </div>
  )
}
