import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { weatherCellKey, type HourlyForecastPoint } from '@shared/weather/freezeRules'
import { GEOCODE_ADDRESS_HINT, weatherChipLabel } from '@shared/weather/weatherMonitor'

type Status =
  | { kind: 'hidden' }
  | { kind: 'address' }
  | { kind: 'chip'; label: string }

export function WeatherPropertyStatus({ propertyId }: { propertyId: string | null | undefined }) {
  const [status, setStatus] = useState<Status>({ kind: 'hidden' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase || !propertyId) {
        setStatus({ kind: 'hidden' })
        return
      }
      const { data: property } = await supabase
        .from('properties')
        .select('latitude, longitude, geocode_status')
        .eq('id', propertyId)
        .maybeSingle()
      if (cancelled) return
      const geocode = typeof property?.geocode_status === 'string' ? property.geocode_status : null
      if (geocode === 'not_found' || geocode === 'non_us') {
        setStatus({ kind: 'address' })
        return
      }
      const lat = typeof property?.latitude === 'number' ? property.latitude : null
      const lon = typeof property?.longitude === 'number' ? property.longitude : null
      if (lat == null || lon == null) {
        setStatus({ kind: 'hidden' })
        return
      }
      const { data: snap } = await supabase
        .from('weather_snapshots')
        .select('fetched_at, source_ok, forecast_hourly')
        .eq('cell_key', weatherCellKey(lat, lon))
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      const hourly = Array.isArray(snap?.forecast_hourly)
        ? (snap.forecast_hourly as HourlyForecastPoint[])
        : []
      setStatus({
        kind: 'chip',
        label: weatherChipLabel({
          sourceOk: snap?.source_ok === true,
          fetchedAt: typeof snap?.fetched_at === 'string' ? snap.fetched_at : '',
          hourly,
          now: new Date(),
        }),
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [propertyId])

  if (status.kind === 'address') {
    return (
      <p className="mt-2 text-[13px] leading-5 text-[#92400e]">{GEOCODE_ADDRESS_HINT}</p>
    )
  }
  if (status.kind !== 'chip') return null
  return (
    <span className="mt-2 inline-flex rounded-[4px] bg-[#f3f4f6] px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-[#364153]">
      {status.label}
    </span>
  )
}
