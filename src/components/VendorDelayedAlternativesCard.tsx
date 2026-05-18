import { useState } from 'react'
import type { AdminVendorReassignChoice } from '@/api/adminReassignVendor'

export type VendorDelayedAlternativePick = {
  id?: string
  name: string
}

type VendorDelayedAlternativesCardProps = {
  candidates: VendorDelayedAlternativePick[]
  loading?: boolean
  /** When true, empty `candidates` means the API returned `alternatives: []`. */
  alternativesFromApi?: boolean
  errorMessage?: string | null
  /** Shown under the footer line when `assignedAt` is known */
  autoDeadlineLabel?: string | null
  onSelectVendor: (choice: AdminVendorReassignChoice) => void | Promise<void>
}

/**
 * Figma: Property-Tech-Prototypes node 57:2574 — “Vendors Delayed - Alternative Recommendations”.
 */
export function VendorDelayedAlternativesCard({
  candidates,
  loading = false,
  alternativesFromApi = false,
  errorMessage = null,
  autoDeadlineLabel,
  onSelectVendor,
}: VendorDelayedAlternativesCardProps) {
  const [picking, setPicking] = useState<string | null>(null)

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3 rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
      <div className="flex min-h-10 w-full shrink-0 flex-col gap-0.5">
        <p className="text-[12px] leading-4 text-[#6a7282]">Vendors Delayed</p>
        <p className="mt-0.5 text-[15px] font-semibold leading-6 tracking-[-0.2px] text-[#0a0a0a]">
          Alternative Recommendations
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {loading ? (
          <p
            className="rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-3 py-3 text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]"
            role="status"
            aria-live="polite"
          >
            Finding better vendors…
          </p>
        ) : null}
        {errorMessage ? (
          <p className="rounded-lg border border-[#b52a00]/30 bg-[#fff4f0] px-3 py-2 text-[12px] leading-4 text-[#b52a00]">
            {errorMessage}
          </p>
        ) : null}
        {!loading && candidates.length > 0
          ? candidates.map((c) => (
              <button
                key={c.id ?? c.name}
                type="button"
                disabled={Boolean(picking)}
                onClick={async () => {
                  setPicking(c.name)
                  try {
                    await onSelectVendor({
                      vendorName: c.name,
                      ...(c.id?.trim() ? { vendorId: c.id.trim() } : {}),
                    })
                  } finally {
                    setPicking(null)
                  }
                }}
                className="flex h-[38px] w-full shrink-0 items-center rounded-lg border border-[#e5e7eb] bg-white px-3 text-left text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors hover:border-black/10 hover:bg-[#f3f3f5] focus-visible:ring-2 focus-visible:ring-[#0030b5]/35 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {picking === c.name ? 'Applying…' : c.name}
              </button>
            ))
          : null}
        {!loading && !errorMessage && candidates.length === 0 ? (
          <p
            className="rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-3 py-3 text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]"
            role="status"
          >
            {alternativesFromApi
              ? 'No better vendors available'
              : 'No alternative vendors matched this ticket yet.'}
          </p>
        ) : null}
      </div>

      <div className="mt-auto shrink-0 border-t border-[#e5e7eb] pt-3">
        <div className="flex gap-2">
          <svg
            className="mt-0.5 size-3.5 shrink-0 text-[#6a7282]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" strokeLinecap="round" />
          </svg>
          <p className="min-w-0 flex-1 text-[12px] font-normal leading-4 text-[#6a7282]">
            If no vendor is selected by the due date, an alternative will be
            automatically recommended.
            {autoDeadlineLabel ? (
              <>
                {' '}
                (deadline {autoDeadlineLabel}).
              </>
            ) : null}
          </p>
        </div>
      </div>
    </div>
  )
}
