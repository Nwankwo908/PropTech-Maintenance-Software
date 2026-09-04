import { useEffect, useState } from 'react'
import {
  postPropertyInsights,
  resolvePropertyInsightsUrl,
  type PropertyInsightsOk,
} from '@/api/propertyInsights'
import { AskUloStreetView } from '@/components/AskUloStreetView'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getErrorMessage } from '@/lib/errorMessage'
import { zillowHomesSearchUrl } from '@/lib/zillowPropertyUrl'

type PropertyZillowMapProps = {
  address: string | null
  buildingName?: string | null
}

function PhotoChevron({ dir }: { dir: 'prev' | 'next' }) {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      {dir === 'prev' ? (
        <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

export function PropertyZillowMap({ address, buildingName }: PropertyZillowMapProps) {
  const query = address?.trim() || ''
  const zillowUrl = query ? zillowHomesSearchUrl(query) : 'https://www.zillow.com/homes/'
  const [data, setData] = useState<PropertyInsightsOk | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!query) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    const url = resolvePropertyInsightsUrl()
    const secret = getAdminEdgeSecret()
    if (!url || !secret) {
      setData(null)
      setError("Property data isn't available in this session.")
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setIndex(0)
    void postPropertyInsights({ url, secret, address: query })
      .then((result) => {
        if (cancelled) return
        setData(result)
      })
      .catch((err) => {
        if (cancelled) return
        setData(null)
        setError(getErrorMessage(err, 'Could not load property data.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query])

  const photos = data?.photos ?? []
  const current = photos[index] ?? null
  const hasStreet =
    Boolean(query) && (data?.latitude != null && data?.longitude != null || Boolean(query))

  return (
    <section className="sa-surface overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">Property photos</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
              {query
                ? [buildingName, query].filter(Boolean).join(' · ')
                : 'Add a street address on this property to load photos and market data.'}
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
          <div className="border-t border-[#e5e7eb] bg-[#f3f4f6]">
            {loading ? (
              <div className="flex h-[420px] items-center justify-center" aria-busy="true">
                <p className="text-[13px] text-[#6a7282]">Loading property data…</p>
              </div>
            ) : current ? (
              <div className="relative">
                <img src={current} alt="" className="h-[420px] w-full object-cover" />
                {photos.length > 1 ? (
                  <>
                    <button
                      type="button"
                      aria-label="Previous photo"
                      onClick={() => setIndex((i) => (i === 0 ? photos.length - 1 : i - 1))}
                      className="sa-press absolute left-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#0a0a0a] shadow-sm outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-[#0030b5]"
                    >
                      <PhotoChevron dir="prev" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next photo"
                      onClick={() => setIndex((i) => (i === photos.length - 1 ? 0 : i + 1))}
                      className="sa-press absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#0a0a0a] shadow-sm outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-[#0030b5]"
                    >
                      <PhotoChevron dir="next" />
                    </button>
                  </>
                ) : null}
              </div>
            ) : hasStreet ? (
              <AskUloStreetView
                embedded
                address={query}
                lat={data?.latitude}
                lng={data?.longitude}
                label={buildingName}
                frameClassName="h-[420px] w-full overflow-hidden bg-[#f3f4f6]"
              />
            ) : (
              <div className="flex h-[220px] items-center justify-center px-6">
                <p className="max-w-md text-center text-[13px] leading-5 text-[#6a7282]">
                  {error ??
                    (data?.configured === false
                      ? "Property data isn't connected on the server yet."
                      : 'No photos found for this address.')}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="border-t border-[#e5e7eb] px-6 py-16 text-center">
            <p className="text-[13px] leading-5 text-[#6a7282]">
              Save the property address in Details to load photos and market data.
            </p>
          </div>
        )}
    </section>
  )
}
