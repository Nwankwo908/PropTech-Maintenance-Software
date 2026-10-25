import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import { DEFAULT_WEATHER_SETTINGS } from '@shared/weather/weatherMonitor'

const sectionCardClass =
  'sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]'

export function FreezeAlertSettings() {
  const [textEnabled, setTextEnabled] = useState(DEFAULT_WEATHER_SETTINGS.textEnabled)
  const [adjust, setAdjust] = useState(DEFAULT_WEATHER_SETTINGS.thresholdAdjustF)
  const [watchText, setWatchText] = useState(DEFAULT_WEATHER_SETTINGS.watchTextEnabled)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabase) return
      const { data } = await supabase
        .from('landlord_weather_settings')
        .select('text_enabled, threshold_adjust_f, watch_text_enabled')
        .eq('landlord_id', getActiveLandlordId())
        .maybeSingle()
      if (cancelled || !data) return
      setTextEnabled(data.text_enabled !== false)
      setAdjust(typeof data.threshold_adjust_f === 'number' ? data.threshold_adjust_f : 0)
      setWatchText(data.watch_text_enabled === true)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function save(next: { textEnabled: boolean; adjust: number; watchText: boolean }) {
    if (!supabase) return
    setMessage(null)
    const { error } = await supabase.from('landlord_weather_settings').upsert({
      landlord_id: getActiveLandlordId(),
      text_enabled: next.textEnabled,
      threshold_adjust_f: next.adjust,
      watch_text_enabled: next.watchText,
      updated_at: new Date().toISOString(),
    })
    setMessage(error ? getErrorMessage(error, "Couldn't save freeze alerts.") : 'Saved.')
  }

  return (
    <section className={sectionCardClass}>
      <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
        Freeze alerts
      </h2>
      <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
        Texts are on for a hard freeze or extreme cold. Freeze watches stay in the app.
      </p>
      <div className="mt-5 flex flex-col gap-4">
        <label className="flex items-center justify-between gap-4 text-[14px] text-[#101828]">
          Freeze alerts by text
          <input
            type="checkbox"
            checked={textEnabled}
            onChange={(event) => {
              const next = event.target.checked
              setTextEnabled(next)
              void save({ textEnabled: next, adjust, watchText })
            }}
          />
        </label>
        <label className="flex items-center justify-between gap-4 text-[14px] text-[#101828]">
          Threshold adjustment
          <select
            className="h-10 rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[14px] text-[#101828]"
            value={String(adjust)}
            onChange={(event) => {
              const next = Number(event.target.value)
              setAdjust(next)
              void save({ textEnabled, adjust: next, watchText })
            }}
          >
            <option value="-4">4°F lower</option>
            <option value="0">No adjustment</option>
            <option value="4">4°F higher</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-4 text-[14px] text-[#101828]">
          Include freeze watches by text
          <input
            type="checkbox"
            checked={watchText}
            onChange={(event) => {
              const next = event.target.checked
              setWatchText(next)
              void save({ textEnabled, adjust, watchText: next })
            }}
          />
        </label>
      </div>
      {message ? <p className="mt-3 text-[13px] text-[#6a7282]">{message}</p> : null}
    </section>
  )
}
