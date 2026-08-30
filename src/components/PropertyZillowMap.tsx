import { AskUloStreetView } from '@/components/AskUloStreetView'
import { zillowHomesSearchUrl } from '@/lib/zillowPropertyUrl'

type PropertyZillowMapProps = {
  address: string | null
  buildingName?: string | null
}

export function PropertyZillowMap({ address, buildingName }: PropertyZillowMapProps) {
  const query = address?.trim() || ''
  const zillowUrl = query ? zillowHomesSearchUrl(query) : 'https://www.zillow.com/homes/'

  return (
    <section className="sa-surface overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">Street View</h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
            {query
              ? [buildingName, query].filter(Boolean).join(' · ')
              : 'Add a street address on this property to see Street View.'}
          </p>
        </div>
        {query ? (
          <a
            href={zillowUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="sa-link shrink-0 text-[13px] font-medium text-[#186179] hover:text-[#0f4a5c]"
          >
            View on Zillow
          </a>
        ) : null}
      </div>

      {query ? (
        <AskUloStreetView
          address={query}
          label={buildingName}
          embedded
          frameClassName="h-[420px] w-full overflow-hidden border-t border-[#e5e7eb] bg-[#f3f4f6]"
        />
      ) : (
        <div className="border-t border-[#e5e7eb] px-6 py-16 text-center">
          <p className="text-[13px] leading-5 text-[#6a7282]">
            Save the property address in Details to see Street View and the listing on Zillow.
          </p>
        </div>
      )}
    </section>
  )
}
