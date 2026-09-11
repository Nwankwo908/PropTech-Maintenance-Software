import { useEffect, useState, type ReactNode } from 'react'
import {
  postSyncHomeDataGraph,
  resolveSyncHomeDataGraphUrl,
} from '@/api/homeDataGraph'
import {
  postPropertyInsights,
  resolvePropertyInsightsUrl,
} from '@/api/propertyInsights'
import { PropertyHomeStreetView } from '@/components/PropertyHomeStreetView'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getErrorMessage } from '@/lib/errorMessage'
import { loadHomeDataGraphSnapshot } from '@/lib/loadHomeDataGraph'
import {
  emptyHomeDataFacts,
  formatHomeDataDate,
  formatHomeDataMoney,
  formatHomeDataNumber,
  formatHomeDataPool,
  formatHomeDataRange,
  formatHomeDataSqft,
  homeDataHasFacts,
  homeDataHasListingFacts,
  homeDataNeedsProviderRefresh,
  type HomeDataFacts,
  type HomeDataGraphSnapshot,
} from '@shared/homeDataGraph'

type PropertyHomeDataPanelProps = {
  propertyId: string | null
  landlordId: string
  address: string | null
  buildingName?: string | null
}

type FactRow = { label: string; value: string }
type HighlightRow = FactRow & {
  icon: 'property' | 'bedrooms' | 'bathrooms' | 'sqft' | 'year' | 'units'
}

function HighlightIcon({ name }: { name: HighlightRow['icon'] }) {
  const className = 'size-5 shrink-0 text-[#6a7282]'
  if (name === 'property') {
    return (
      <svg viewBox="8 8 84 84" fill="currentColor" className={className} aria-hidden>
        <path d="m43.598 31.684-30.797 17.781v37.699c0 1.1445 0.46875 2.1914 1.2188 2.9414 0.75391 0.75781 1.8008 1.2227 2.9453 1.2227h14.488v-15.98c0-3.3398 1.3672-6.375 3.5977-8.6055 2.2266-2.1914 5.2383-3.5352 8.5469-3.5352 3.3359 0 6.3711 1.3672 8.5742 3.5664 2.2031 2.1992 3.5703 5.2344 3.5703 8.5742v15.98h14.516c1.1523-0.015625 2.1758-0.48047 2.9141-1.2188 0.75781-0.75391 1.2227-1.8008 1.2227-2.9453v-37.699l-30.793-17.781zm35.922-4.957h11.648c0.55078 0 1 0.44922 1 1v7.3906c0 0.55078-0.44922 1-1 1h-11.648c-0.55078 0-1-0.44922-1-1v-7.3906c0-0.55078 0.44922-1 1-1zm10.648 2h-9.6484v5.3906h9.6484zm-29.098-15.727h11.648c0.55078 0 1 0.44922 1 1v7.3945c0 0.55078-0.44922 1-1 1h-11.648c-0.55078 0-1-0.44922-1-1v-7.3945c0-0.55078 0.44922-1 1-1zm10.648 2h-9.6484v5.3945h9.6484zm7.8008-2h11.648c0.55078 0 1 0.44922 1 1v7.3945c0 0.55078-0.44922 1-1 1h-11.648c-0.55078 0-1-0.44922-1-1v-7.3945c0-0.55078 0.44922-1 1-1zm10.648 2h-9.6484v5.3945h9.6484zm-15.402 76.324h18.863c0.78906 0 1.5078-0.32422 2.0273-0.84375s0.84375-1.2383 0.84375-2.0273v-76.91c0-0.78906-0.32422-1.5078-0.84375-2.0273s-1.2383-0.84375-2.0273-0.84375h-35.016c-0.78906 0-1.5117 0.32422-2.0312 0.84375-0.51562 0.52344-0.84375 1.2422-0.84375 2.0312v15.988l27.605 15.938c1.1133 0.66797 1.8672 1.7266 2.1797 2.8984 0.3125 1.168 0.19141 2.4492-0.4375 3.5859l-0.085938 0.14844c-0.66797 1.1133-1.7266 1.8672-2.8984 2.1836-1.1914 0.32031-2.5156 0.18359-3.668-0.48047l-2.0469-1.1836v36.543c0 1.5977-0.61719 3.0625-1.6289 4.1641zm-69.906-46.137c-0.64062 0.39062-1.0742 1.0078-1.2578 1.6875-0.18359 0.68359-0.11328 1.4414 0.24609 2.0977l0.074219 0.12891c0.39062 0.63281 1.0039 1.0625 1.6836 1.2461 0.70703 0.1875 1.4844 0.10938 2.1562-0.27734l35.344-20.406c0.29688-0.16797 0.67578-0.18359 0.99219 0l35.348 20.406c0.67188 0.38672 1.4492 0.46484 2.1523 0.27734 0.69141-0.18359 1.3203-0.63281 1.7188-1.3086 0.39453-0.68359 0.47266-1.4609 0.28516-2.1641-0.18359-0.69141-0.63281-1.3203-1.293-1.7109l-28.113-16.23-10.594-6.1172-38.742 22.367zm20.535-14.156v-4.9258c0-0.41406-0.16016-0.79297-0.44141-1.0977-0.30859-0.30859-0.70703-0.48828-1.1367-0.48828h-4.9766c-0.43359 0-0.83203 0.17969-1.1172 0.46484s-0.46484 0.67969-0.46484 1.1172v9.625l8.1406-4.6992zm8.0625 60.293h20.285v-15.98c0-2.7891-1.1406-5.3242-2.9805-7.1602-1.8359-1.8359-4.3711-2.9805-7.1641-2.9805-2.7617 0-5.2773 1.1211-7.1367 2.9492-1.8633 1.8672-3.0078 4.4023-3.0078 7.1875v15.98z" />
      </svg>
    )
  }
  if (name === 'bedrooms') {
    return (
      <svg viewBox="15 20 70 58" fill="currentColor" className={className} aria-hidden>
        <path d="m29.688 71.094v4.6875c0 0.86328-0.69922 1.5625-1.5625 1.5625h-3.125c-0.86328 0-1.5625-0.69922-1.5625-1.5625v-4.6875z" />
        <path d="m76.562 71.094v4.6875c0 0.86328-0.69922 1.5625-1.5625 1.5625h-3.125c-0.86328 0-1.5625-0.69922-1.5625-1.5625v-4.6875z" />
        <path d="m78.125 50.781c2.5898 0 4.6875 2.0977 4.6875 4.6875v10.938c0 0.86328-0.69922 1.5625-1.5625 1.5625h-62.5c-0.86328 0-1.5625-0.69922-1.5625-1.5625v-10.938c0-2.5898 2.0977-4.6875 4.6875-4.6875z" />
        <path d="m68.75 24.219c2.5898 0 4.6875 2.0977 4.6875 4.6875v18.75h-6.5195c0.17578-0.48828 0.26953-1.0156 0.26953-1.5625v-5.4688c0-2.5898-2.0977-4.6875-4.6875-4.6875h-9.375c-1.1992 0-2.2969 0.45312-3.125 1.1953-0.82812-0.74219-1.9258-1.1953-3.125-1.1953h-9.375c-2.5898 0-4.6875 2.0977-4.6875 4.6875v5.4688c0 0.54688 0.09375 1.0742 0.26953 1.5625h-6.5195v-18.75c0-2.5898 2.0977-4.6875 4.6875-4.6875z" />
        <path d="m46.875 39.062c0.86328 0 1.5625 0.69922 1.5625 1.5625v5.4688c0 0.86328-0.69922 1.5625-1.5625 1.5625h-9.375c-0.86328 0-1.5625-0.69922-1.5625-1.5625v-5.4688c0-0.86328 0.69922-1.5625 1.5625-1.5625z" />
        <path d="m62.5 39.062c0.86328 0 1.5625 0.69922 1.5625 1.5625v5.4688c0 0.86328-0.69922 1.5625-1.5625 1.5625h-9.375c-0.86328 0-1.5625-0.69922-1.5625-1.5625v-5.4688c0-0.86328 0.69922-1.5625 1.5625-1.5625z" />
      </svg>
    )
  }
  if (name === 'bathrooms') {
    return (
      <svg viewBox="18 14 64 72" fill="currentColor" className={className} aria-hidden>
        <path d="m31.234 83.594h-4.6719v-5.4688h8.6484z" />
        <path d="m73.438 83.594h-4.6719l-3.9766-5.4688h8.6484z" />
        <path d="m35.938 15.625c5.7812 0 10.512 4.4844 10.91 10.164 3.4922 0.14844 6.2773 3.0273 6.2773 6.5547 0 0.25781-0.21094 0.46875-0.46875 0.46875h-16.25c-0.25781 0-0.46875-0.21094-0.46875-0.46875 0-3.5039 2.7461-6.3633 6.2031-6.5508-0.38281-3.0898-3.0117-5.4805-6.2031-5.4805h-1.5625c-4.3164 0-7.8125 3.4961-7.8125 7.8125v26.562h28.125v9.375c0 2.5898 2.0977 4.6875 4.6875 4.6875h9.375c2.5898 0 4.6875-2.0977 4.6875-4.6875v-9.375h7.8125c0.86328 0 1.5625 0.69922 1.5625 1.5625v7.8125c0 6.0391-4.8984 10.938-10.938 10.938h-43.75c-6.0391 0-10.938-4.8984-10.938-10.938v-7.8125c0-0.86328 0.69922-1.5625 1.5625-1.5625h3.125v-26.562c0-6.9023 5.5977-12.5 12.5-12.5z" />
        <path d="m68.75 50c0.86328 0 1.5625 0.69922 1.5625 1.5625v12.5c0 0.86328-0.69922 1.5625-1.5625 1.5625h-9.375c-0.86328 0-1.5625-0.69922-1.5625-1.5625v-12.5c0-0.86328 0.69922-1.5625 1.5625-1.5625z" />
      </svg>
    )
  }
  if (name === 'sqft') {
    return (
      <svg viewBox="1 1 22 22" fill="currentColor" fillRule="evenodd" className={className} aria-hidden>
        <path d="M1.25,6.25l-0,-3.174c0,-0.738 0.445,-1.404 1.127,-1.687c0.683,-0.283 1.468,-0.126 1.99,0.396l17.848,17.848c0.522,0.522 0.679,1.307 0.396,1.99c-0.283,0.682 -0.949,1.127 -1.687,1.127l-3.174,-0l0,-1.75c-0,-0.414 -0.336,-0.75 -0.75,-0.75c-0.414,0 -0.75,0.336 -0.75,0.75l0,1.75l-3.5,-0l0,-1.75c-0,-0.414 -0.336,-0.75 -0.75,-0.75c-0.414,0 -0.75,0.336 -0.75,0.75l0,1.75l-3.5,-0l0,-1.75c0,-0.414 -0.336,-0.75 -0.75,-0.75c-0.414,-0 -0.75,0.336 -0.75,0.75l0,1.75l-3.174,-0c-0.484,0 -0.949,-0.192 -1.291,-0.535c-0.343,-0.342 -0.535,-0.807 -0.535,-1.291l-0,-3.174l1.75,-0c0.414,0 0.75,-0.336 0.75,-0.75c0,-0.414 -0.336,-0.75 -0.75,-0.75l-1.75,-0l-0,-3.5l1.75,-0c0.414,-0 0.75,-0.336 0.75,-0.75c-0,-0.414 -0.336,-0.75 -0.75,-0.75l-1.75,-0l-0,-3.5l1.75,-0c0.414,0 0.75,-0.336 0.75,-0.75c-0,-0.414 -0.336,-0.75 -0.75,-0.75l-1.75,-0Zm12.82,12c0.477,-0 0.907,-0.288 1.09,-0.729c0.183,-0.441 0.082,-0.949 -0.256,-1.286l-7.139,-7.139c-0.337,-0.338 -0.845,-0.439 -1.286,-0.256c-0.441,0.183 -0.729,0.613 -0.729,1.09l-0,7.14c-0,0.313 0.124,0.613 0.346,0.834c0.221,0.222 0.521,0.346 0.834,0.346l7.14,-0Zm-6.82,-7.548l6.048,6.048l-6.048,0l-0,-6.048Z" />
      </svg>
    )
  }
  if (name === 'year') {
    return (
      <svg viewBox="8 6 84 84" fill="currentColor" className={className} aria-hidden>
        <path d="m91.508 31.578c-0.16406-3.1641-4.3711-4.75-6.5508-2.4102l-13.68 13.68c-0.66016 0.64062-1.7695 0.64062-2.4102 0l-11.844-11.844c-0.65625-0.63672-0.64453-1.7734 0-2.4102l13.574-13.574c2.3281-2.1562 0.76562-6.4141-2.4102-6.5508-19.527-1.9648-33.91 18.672-25.523 36.281 0.21484 0.44922 0.12891 0.96094-0.21484 1.2812l-30.711 28.383c-9.7227 9.5312 3.6445 23.641 13.402 14.062l28.703-31.051c0.32031-0.33984 0.83203-0.42578 1.2812-0.21484 17.543 8.4258 38.457-6.1758 36.387-25.633zm-71.43 51.988c-2.5234 2.4453-6.2227-1.2578-3.7773-3.7773 2.5234-2.4453 6.2227 1.2578 3.7773 3.7773z" />
      </svg>
    )
  }
  if (name === 'units') {
    return (
      <svg viewBox="28 8 44 84" fill="currentColor" className={className} aria-hidden>
        <path d="M69.5485229,90V10H30.4514771v80h11.9831543V78.4646606c0-4.1782837,3.387146-7.5654297,7.5653687-7.5654297  s7.5653687,3.387146,7.5653687,7.5654297V90H69.5485229z M47.081604,64.1804199H35.8494873v-5.6160278  c0-3.1016846,2.5144043-5.6160889,5.6160278-5.6160889h0.000061c3.1016235,0,5.6160278,2.5144043,5.6160278,5.6160889V64.1804199z   M47.081604,47.2208252H35.8494873v-5.6160278c0-3.1016846,2.5144043-5.6160889,5.6160278-5.6160889h0.000061  c3.1016235,0,5.6160278,2.5144043,5.6160278,5.6160889V47.2208252z M47.081604,30.2612305H35.8494873v-5.6160278  c0-3.1016846,2.5144043-5.6160889,5.6160278-5.6160889h0.000061c3.1016235,0,5.6160278,2.5144043,5.6160278,5.6160889V30.2612305z   M52.918396,24.6452026c0-3.1016846,2.5144043-5.6160889,5.6160278-5.6160889h0.000061  c3.1016235,0,5.6160278,2.5144043,5.6160278,5.6160889v5.6160278H52.918396V24.6452026z M52.918396,41.6047974  c0-3.1016846,2.5144043-5.6160889,5.6160278-5.6160889h0.000061c3.1016235,0,5.6160278,2.5144043,5.6160278,5.6160889v5.6160278  H52.918396V41.6047974z M52.918396,64.1804199v-5.6160278c0-3.1016846,2.5144043-5.6160889,5.6160278-5.6160889h0.000061  c3.1016235,0,5.6160278,2.5144043,5.6160278,5.6160889v5.6160278H52.918396z" />
      </svg>
    )
  }
  return null
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

function formatLotSize(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${formatHomeDataNumber(value)} Square Feet`
}

function formatTaxLine(facts: HomeDataFacts): string {
  const tax = formatHomeDataMoney(facts.propertyTaxAnnual)
  if (tax === '—') return '—'
  return facts.taxYear != null ? `${tax} (${facts.taxYear})` : tax
}

function FactsBullet({ label, value }: FactRow) {
  return (
    <li className="flex items-start gap-2.5 text-[16px] font-normal leading-6 text-[#0a0a0a]">
      <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-[#0a0a0a]" aria-hidden />
      <span>
        {label}: {value}
      </span>
    </li>
  )
}

function FactsGroup({
  title,
  items,
}: {
  title?: string
  items: FactRow[]
}) {
  return (
    <div className="px-4 py-4">
      {title ? (
        <h5 className="mb-2 text-[16px] font-bold leading-6 text-[#0a0a0a]">{title}</h5>
      ) : null}
      <ul className="space-y-1">
        {items.map((item) => (
          <FactsBullet key={item.label} {...item} />
        ))}
      </ul>
    </div>
  )
}

function FactsCategory({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="bg-[#f5f5f5] px-4 py-2.5">
        <h4 className="text-[16px] font-bold leading-6 text-[#0a0a0a]">{title}</h4>
      </div>
      {children}
    </div>
  )
}

function HomeMetricCard({ label, value }: FactRow) {
  return (
    <div className="flex min-h-[88px] flex-col justify-center rounded-[10px] bg-[#f3f4f6] px-4 py-3">
      <p className="text-[12px] font-medium leading-4 text-[#6a7282]">{label}</p>
      <p className="mt-1 text-[16px] font-semibold leading-6 tracking-[-0.15px] text-[#0a0a0a]">{value}</p>
    </div>
  )
}

function homeValueCards(facts: HomeDataFacts): FactRow[] {
  const rent = formatHomeDataMoney(facts.estimatedRent)
  const rentRange = formatHomeDataRange(facts.estimatedRentLow, facts.estimatedRentHigh)
  return [
    { label: 'Property value', value: formatHomeDataMoney(facts.estimatedValue) },
    { label: 'Property value range', value: formatHomeDataRange(facts.estimatedValueLow, facts.estimatedValueHigh) },
    { label: 'Rent estimate', value: rent === '—' ? '—' : `${rent}/mo` },
    { label: 'Rent estimate range', value: rentRange === '—' ? '—' : `${rentRange}/mo` },
  ]
}

function homeHighlightRows(facts: HomeDataFacts): HighlightRow[] {
  const bedDigits = facts.bedrooms != null && facts.bedrooms % 1 !== 0 ? 1 : 0
  const bathDigits = facts.bathrooms != null && facts.bathrooms % 1 !== 0 ? 1 : 0
  return [
    { icon: 'property', label: 'Property type', value: facts.propertyType?.trim() || '—' },
    { icon: 'bedrooms', label: 'Bedrooms', value: formatHomeDataNumber(facts.bedrooms, bedDigits) },
    { icon: 'bathrooms', label: 'Bathrooms', value: formatHomeDataNumber(facts.bathrooms, bathDigits) },
    { icon: 'sqft', label: 'Square footage', value: formatHomeDataSqft(facts.livingAreaSqft) },
    { icon: 'year', label: 'Year built', value: facts.yearBuilt != null ? String(facts.yearBuilt) : '—' },
    { icon: 'units', label: 'Number of units', value: formatHomeDataNumber(facts.unitCount) },
  ]
}

export function PropertyHomeDataPanel({
  propertyId,
  landlordId,
  address,
  buildingName,
}: PropertyHomeDataPanelProps) {
  const query = address?.trim() || ''
  const [snapshot, setSnapshot] = useState<HomeDataGraphSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [listingPhotos, setListingPhotos] = useState<string[]>([])
  const [fallbackCoords, setFallbackCoords] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!propertyId || !query) {
      setSnapshot(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    async function run() {
      const existing = await loadHomeDataGraphSnapshot(propertyId)
      if (cancelled) return
      if (existing && !homeDataNeedsProviderRefresh(existing)) {
        setSnapshot(existing)
        setLoading(false)
        return
      }
      if (existing) setSnapshot(existing)

      const url = resolveSyncHomeDataGraphUrl()
      const secret = getAdminEdgeSecret()
      if (!url || !secret) {
        setError("Property data isn't available in this session.")
        setLoading(false)
        return
      }
      try {
        const result = await postSyncHomeDataGraph({
          url,
          secret,
          propertyId,
          landlordId,
          address: query,
          force: !existing || !homeDataHasListingFacts(existing),
        })
        if (cancelled) return
        if (result.snapshot) setSnapshot(result.snapshot)
        setError(result.lookupError)
      } catch (err) {
        if (cancelled) return
        setError(getErrorMessage(err, 'Could not load property data.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [propertyId, landlordId, query])

  useEffect(() => {
    if (!query) {
      setListingPhotos([])
      setFallbackCoords(null)
      return
    }
    if ((snapshot?.photoUrls.length ?? 0) > 0) {
      setListingPhotos([])
      return
    }
    const url = resolvePropertyInsightsUrl()
    const secret = getAdminEdgeSecret()
    if (!url || !secret) return
    let cancelled = false
    void postPropertyInsights({ url, secret, address: query })
      .then((result) => {
        if (cancelled) return
        setListingPhotos(result.photos)
        if (result.latitude != null && result.longitude != null) {
          setFallbackCoords({ lat: result.latitude, lng: result.longitude })
        }
      })
      .catch(() => {
        if (!cancelled) setListingPhotos([])
      })
    return () => {
      cancelled = true
    }
  }, [query, snapshot?.photoUrls, snapshot?.fetchedAt])

  useEffect(() => {
    setPhotoIndex(0)
  }, [snapshot?.propertyId, snapshot?.fetchedAt, (snapshot?.photoUrls ?? []).join('|')])

  const facts = snapshot ?? emptyHomeDataFacts()
  const cards = homeValueCards(facts)
  const highlights = homeHighlightRows(facts)
  const hasLoadedFacts = Boolean(snapshot && homeDataHasFacts(snapshot))
  const photos = (snapshot?.photoUrls?.length ? snapshot.photoUrls : listingPhotos) ?? []
  const currentPhoto = photos[photoIndex] ?? null
  const viewLat = snapshot?.latitude ?? fallbackCoords?.lat ?? null
  const viewLng = snapshot?.longitude ?? fallbackCoords?.lng ?? null

  return (
    <section className="sa-surface overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      {!query ? (
        <div className="px-6 py-16 text-center">
          <p className="text-[13px] leading-5 text-[#6a7282]">
            Save the property address in Details to load home data.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2">
          <div className="p-4 lg:p-6">
          <div className="relative h-[240px] min-h-[240px] overflow-hidden rounded-[8px] bg-[#f3f4f6] [contain:strict] lg:h-full lg:min-h-[320px]">
            {currentPhoto ? (
              <div className="relative h-full min-h-[240px] lg:min-h-[320px]">
                <img
                  src={currentPhoto}
                  alt=""
                  className="h-full min-h-[240px] w-full object-cover lg:min-h-[320px]"
                />
                {photos.length > 1 ? (
                  <>
                    <button
                      type="button"
                      aria-label="Previous photo"
                      onClick={() =>
                        setPhotoIndex((i) => (i === 0 ? photos.length - 1 : i - 1))
                      }
                      className="sa-press absolute left-3 top-1/2 z-[2] flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#0a0a0a] shadow-sm outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-[#0030b5]"
                    >
                      <PhotoChevron dir="prev" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next photo"
                      onClick={() =>
                        setPhotoIndex((i) => (i === photos.length - 1 ? 0 : i + 1))
                      }
                      className="sa-press absolute right-3 top-1/2 z-[2] flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#0a0a0a] shadow-sm outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-[#0030b5]"
                    >
                      <PhotoChevron dir="next" />
                    </button>
                  </>
                ) : null}
              </div>
            ) : (
              <PropertyHomeStreetView
                address={query}
                lat={viewLat}
                lng={viewLng}
                label={buildingName}
              />
            )}
          </div>
          </div>
          <div className="relative z-10 flex min-h-[240px] flex-col gap-3 bg-white p-4 lg:min-h-[320px] lg:p-6">
            <h3 className="text-[13px] font-semibold leading-5 text-[#0a0a0a]">
              Home Value
            </h3>
            <div className="grid grid-cols-2 content-start gap-3">
              {cards.map((card) => (
                <HomeMetricCard key={card.label} {...card} />
              ))}
            </div>
            <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-4">
              <h3 className="text-[13px] font-medium leading-5 text-[#0a0a0a]">
                Home highlights
              </h3>
              <dl className="mt-3 grid grid-cols-3 gap-3">
                {highlights.map((row) => (
                  <div key={row.label} className="flex min-w-0 items-center gap-2">
                    <HighlightIcon name={row.icon} />
                    <dd className="m-0 min-w-0 text-[16px] font-normal leading-6 text-[#0a0a0a]">
                      <span className="sr-only">{row.label} </span>
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            {loading && !hasLoadedFacts ? (
              <p className="text-[12px] leading-4 text-[#6a7282]">
                Updating home value…
              </p>
            ) : null}
            {error && !hasLoadedFacts ? (
              <p className="text-[12px] leading-4 text-[#92400e]">{error}</p>
            ) : null}
          </div>
          </div>
          <div className="px-4 pb-6 lg:px-6">
            <h3 className="pb-4 text-[24px] font-bold leading-8 tracking-[0.07px] text-[#0a0a0a]">
              Facts & features
            </h3>
            <div className="overflow-hidden rounded-[4px]">
              <FactsCategory title="Property">
                <FactsGroup
                  title="Lot"
                  items={[{ label: 'Size', value: formatLotSize(facts.lotSizeSqft) }]}
                />
                <FactsGroup
                  title="Type & style"
                  items={[
                    { label: 'Property type', value: facts.propertyType?.trim() || '—' },
                    { label: 'Pool', value: formatHomeDataPool(facts) },
                  ]}
                />
              </FactsCategory>
              <FactsCategory title="Construction">
                <FactsGroup
                  title="Heating / cooling"
                  items={[
                    { label: 'Heating', value: facts.heating?.trim() || '—' },
                    { label: 'Cooling', value: facts.cooling?.trim() || '—' },
                  ]}
                />
              </FactsCategory>
              <FactsCategory title="Financial & listing details">
                <FactsGroup
                  title="Taxes"
                  items={[
                    { label: 'Property taxes', value: formatTaxLine(facts) },
                    { label: 'Assessment', value: formatHomeDataMoney(facts.assessedValue) },
                  ]}
                />
                <FactsGroup
                  title="Last sale"
                  items={[
                    { label: 'Last sale price', value: formatHomeDataMoney(facts.lastSalePrice) },
                    { label: 'Last sale date', value: formatHomeDataDate(facts.lastSaleDate) },
                  ]}
                />
              </FactsCategory>
            </div>
          </div>
        </>
      )}
      {error && hasLoadedFacts ? (
        <p className="border-t border-[#e5e7eb] px-6 py-3 text-[12px] leading-4 text-[#92400e]">{error}</p>
      ) : null}
    </section>
  )
}
