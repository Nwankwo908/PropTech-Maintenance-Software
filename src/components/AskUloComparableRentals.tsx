import type { AskUloMarketCompVisual } from '@/api/askUlo'

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

type AskUloComparableRentalsProps = {
  comps: AskUloMarketCompVisual[]
}

/** Clickable comparable rentals for market analysis answers. */
export function AskUloComparableRentals({ comps }: AskUloComparableRentalsProps) {
  if (comps.length === 0) return null

  return (
    <section className="mt-4">
      <h2 className="mb-2 text-[15px] font-semibold leading-5 tracking-[-0.15px] text-[#0a0a0a]">
        Comparable Rentals
      </h2>
      <ul className="space-y-3">
        {comps.map((c, i) => {
          const mix = [
            c.bedrooms != null ? `${c.bedrooms} Bed` : null,
            c.bathrooms != null ? `${c.bathrooms} Bath` : null,
            c.squareFootage != null
              ? `${c.squareFootage.toLocaleString('en-US')} sq ft`
              : null,
          ].filter(Boolean)

          return (
            <li
              key={`${c.address}-${i}`}
              className="rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] px-3.5 py-3"
            >
              <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">{c.address}</p>
              <ul className="mt-1.5 space-y-0.5 text-[13px] leading-5 text-[#374151]">
                {c.rent != null ? <li>{money(c.rent)}/month</li> : null}
                {mix.length > 0 ? <li>{mix.join(' · ')}</li> : null}
                {c.distanceMiles != null ? (
                  <li>{c.distanceMiles.toFixed(1)} miles away</li>
                ) : null}
                <li>Source: {c.source}</li>
                {c.listingUrl ? (
                  <li>
                    <a
                      href={c.listingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 font-medium text-[#0A4D38] underline-offset-2 hover:underline"
                    >
                      <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          stroke="currentColor"
                          strokeWidth={1.75}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      View Listing
                    </a>
                  </li>
                ) : (
                  <li className="text-[#9ca3af]">No public listing URL available</li>
                )}
              </ul>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
