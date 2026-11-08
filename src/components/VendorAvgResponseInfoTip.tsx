import { useId } from 'react'
import { NounInfoIcon } from '@/components/NounInfoIcon'
import { VENDOR_AVG_RESPONSE_RATE_INFO } from '@/lib/vendorAvgResponse'

/** Hover/focus tip explaining the Average response (%) metric. */
export function VendorAvgResponseInfoTip({
  className = '',
  align = 'left',
}: {
  className?: string
  /** Prefer `right` in table headers near the trailing edge. */
  align?: 'left' | 'right'
}) {
  const tipId = useId()
  return (
    <span className={`group relative inline-flex shrink-0 ${className}`.trim()}>
      <button
        type="button"
        className="inline-flex rounded-full p-0.5 text-[#9ca3af] outline-none hover:text-[#6a7282] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1"
        aria-label="About Average response"
        aria-describedby={tipId}
      >
        <NounInfoIcon />
      </button>
      <span
        id={tipId}
        role="tooltip"
        className={[
          'pointer-events-none absolute top-full z-20 mt-1.5 hidden w-[min(17rem,calc(100vw-2rem))] rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-2 text-left text-[12px] font-medium leading-4 text-[#475569] shadow-[0px_8px_24px_rgba(0,0,0,0.12)] group-hover:block group-focus-within:block',
          align === 'right' ? 'right-0' : 'left-0',
        ].join(' ')}
      >
        {VENDOR_AVG_RESPONSE_RATE_INFO}
      </span>
    </span>
  )
}
