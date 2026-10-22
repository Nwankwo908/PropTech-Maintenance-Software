import { EquipmentLabelNotice } from './EquipmentLabelNotice'
import { EQUIPMENT_PHOTO_TIPS } from '@shared/vision/equipmentLabel'
import { useCallback, useEffect, useState } from 'react'
import { type HomeCheckList, type HomeCheckOptions, homeCheckRequest } from '@/api/homeCheck'
import { supabase } from '@/lib/supabase'
import { notifyAssetRegistryChanged } from '@/lib/assetRegistry'
import { notifyInspectionSessionChanged } from '@/lib/inspectionSession'
import {
  formatHomeCheckLocation,
  HOME_CHECK_PHOTOS,
  homeCheckAssetStatusLabel,
  homeCheckFieldBasis,
  homeCheckFollowUpExplanation,
  type HomeCheckRole,
} from '@shared/homeCheck'
import { assertPilotAllows, pilotWorkflowGate } from '@shared/pilotGate'

export function HomeCheckPanel(
  { building, propertyId }: { building: string; propertyId?: string | null },
) {
  const [options, setOptions] = useState<HomeCheckOptions | null>(null)
  const [list, setList] = useState<HomeCheckList | null>(null)
  const [scope, setScope] = useState(propertyId || '')
  const [unitId, setUnitId] = useState('')
  const [role, setRole] = useState<HomeCheckRole>('landlord')
  const [vendorId, setVendorId] = useState('')
  const [windowEnd, setWindowEnd] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [labelEdits, setLabelEdits] = useState<
    Record<string, { modelNumber: string; serialNumber: string; manufactureMonth: string; manufactureYear: string }>
  >({})
  const refresh = useCallback(async () => {
    if (!scope || !supabase) return
    const result = await homeCheckRequest<HomeCheckList>({ action: 'list', propertyId: scope })
    setList(result)
  }, [scope])
  useEffect(() => {
    let cancelled = false
    if (!supabase) return
    homeCheckRequest<HomeCheckOptions>({
      action: 'options',
      propertyId: propertyId || scope || undefined,
    }).then((result) => {
      if (cancelled) return
      setOptions(result)
      const matches = result.targets.filter((target) =>
        !target.unitId && target.propertyName === building
      )
      if (!scope && matches.length === 1) setScope(matches[0].propertyId)
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Home Check unavailable.')
    })
    return () => {
      cancelled = true
    }
  }, [building, propertyId, scope])
  useEffect(() => {
    let cancelled = false
    if (!scope) return
    const update = () => {
      if (!cancelled) {
        void refresh().catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Could not load Home Checks.')
          }
        })
      }
    }
    update()
    const timer = window.setInterval(update, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [scope, refresh])
  const homeCheckPilot = assertPilotAllows('home_checks', {
    VITE_PILOT_STRICT: import.meta.env.VITE_PILOT_STRICT,
  })
  const homeCheckExcluded = !homeCheckPilot.ok

  async function start() {
    if (homeCheckExcluded && !homeCheckPilot.ok) {
      setError(homeCheckPilot.reason)
      return
    }
    setBusy(true)
    setError('')
    setLink('')
    setCopied(false)
    try {
      const result = await homeCheckRequest<
        { id: string; link: string; deliveryError: string | null }
      >({
        action: 'start',
        propertyId: scope,
        unitId: unitId || null,
        role,
        vendorId: role === 'contractor' ? vendorId || null : null,
        jobWindowEnd: role === 'contractor' && windowEnd ? new Date(windowEnd).toISOString() : null,
        sendSms: role !== 'landlord',
      })
      setLink(result.link)
      if (result.deliveryError) {
        setError(
          `Check created, but the text was not sent: ${result.deliveryError}. Share the link below.`,
        )
      }
      await refresh()
      notifyInspectionSessionChanged(building)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Home Check.')
    } finally {
      setBusy(false)
    }
  }
  async function confirm(id: string) {
    setBusy(true)
    setError('')
    try {
      const record = list?.checks.find((check) => check.id === id)
      const labelCorrections = record?.assets.filter((asset) =>
        labelEdits[asset.id]
      ).map((asset) => {
        const edits = labelEdits[asset.id]
        const year = edits.manufactureYear.trim()
        const month = edits.manufactureMonth.trim()
        return {
          assetId: asset.id,
          modelNumber: edits.modelNumber,
          serialNumber: edits.serialNumber,
          manufactureYear: year ? Number(year) : null,
          manufactureMonth: month ? Number(month) : null,
        }
      }) || []
      await homeCheckRequest({ action: 'confirm', id, labelCorrections })
      await refresh()
      notifyAssetRegistryChanged(building)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm Home Check.')
    } finally {
      setBusy(false)
    }
  }
  const targets =
    options?.targets.filter((target) => target.propertyId === scope && target.unitId) || []
  return (
    <section
      className='space-y-4 rounded-[10px] border border-[#e2e8f0] bg-white p-5'
      aria-label='Home Check'
    >
      <header>
        <h3 className='text-base font-semibold'>Scan property equipment</h3>
        <p className='mt-1 text-sm text-[#64748b]'>
          Home Check · Start each property’s baseline with its water heater and heating system:
          make, model, approximate age and visible condition.
        </p>
        {homeCheckExcluded || pilotWorkflowGate('home_checks').status === 'excluded'
          ? (
            <p className='mt-2 text-sm text-[#9a3412]' role='status'>
              Home Checks stay off this pilot until capture and confirmation are verified
              end to end. Starting a new check is blocked when pilot strict mode is on.
            </p>
          )
          : null}
      </header>
      <ul className='space-y-1 text-xs text-[#64748b]'>
        {EQUIPMENT_PHOTO_TIPS.map((tip) => <li key={tip}>{tip}</li>)}
      </ul>
      <p className='text-xs text-[#64748b]'>
        You or an authorized property manager or team member can also text{' '}
        <code>
          INSPECT {building}
          {unitId
            ? ` / ${targets.find((target) => target.unitId === unitId)?.unitLabel || ''}`
            : ''}
        </code>{' '}
        to Ulo to get your capture link. Text INSPECT on its own for instructions.
      </p>
      <ol className='grid gap-2 text-sm sm:grid-cols-2'>
        {HOME_CHECK_PHOTOS.map((photo, index) => (
          <li key={photo.slot}>{index + 1}. {photo.title}</li>
        ))}
        <li>5. Leaks, odd noises or smells? Yes / no</li>
        <li>6. Last service and last filter change, if known</li>
      </ol>
      <p className='text-xs text-[#64748b]'>
        Each field includes source and confidence. Age stays an estimate. Records stay unverified
        until you confirm. Observation only; no repairs authorized.
      </p>
      <label className='block text-sm font-medium'>
        Property / unit<select
          className='mt-1 w-full rounded border p-2'
          value={unitId}
          disabled={busy}
          onChange={(event) => {
            setUnitId(event.target.value)
            setLink('')
          }}
        >
          <option value=''>{building} · shared property equipment</option>
          {targets.map((target) => (
            <option key={target.unitId} value={target.unitId!}>
              {formatHomeCheckLocation(building, target.unitLabel)}
            </option>
          ))}
        </select>
      </label>
      <div
        className='flex flex-wrap gap-2'
        role='group'
        aria-label='Who will complete the Home Check?'
      >
        {([{ role: 'tenant', label: 'Ask my tenant' }, {
          role: 'contractor',
          label: 'Send to my contractor',
        }, { role: 'landlord', label: 'I’ll do it' }] as const).map((choice) => (
          <button
            key={choice.role}
            type='button'
            aria-pressed={role === choice.role}
            disabled={busy}
            onClick={() => {
              setRole(choice.role)
              setLink('')
            }}
            className={`rounded border px-3 py-2 text-sm ${
              role === choice.role
                ? 'border-[#186179] bg-[#eff6ff] text-[#186179]'
                : 'border-[#e2e8f0]'
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {role === 'tenant' && (
        <p className='text-sm text-[#64748b]'>
          Your request authorizes Ulo to text the selected unit’s tenant. Give them a heads-up
          first. One reminder after 48 hours, then stop. You can also text CHECK{' '}
          {formatHomeCheckLocation(
            building,
            unitId ? targets.find((target) => target.unitId === unitId)?.unitLabel : null,
          )} to Ulo.
        </p>
      )}
      {role === 'contractor' && (
        <div className='space-y-3'>
          <label className='block text-sm'>
            Contractor<select
              className='mt-1 w-full rounded border p-2'
              value={vendorId}
              onChange={(event) => setVendorId(event.target.value)}
            >
              <option value=''>Text me a link to forward</option>
              {options?.vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                  {vendor.distanceKm == null
                    ? ' · distance unknown'
                    : ` · ${vendor.distanceKm.toFixed(1)} km straight-line distance`}
                </option>
              ))}
            </select>
          </label>
          {options?.closest
            ? (
              <button
                type='button'
                className='text-sm font-medium text-[#186179]'
                onClick={() => setVendorId(options.closest!)}
              >
                Choose closest located contractor
              </button>
            )
            : (
              <p className='text-xs text-[#64748b]'>
                Exact property and vendor locations are needed to determine the closest contractor.
                You can choose one manually.
              </p>
            )}
          <label className='block text-sm'>
            Job window ends<input
              type='datetime-local'
              className='mt-1 w-full rounded border p-2'
              value={windowEnd}
              onChange={(event) => setWindowEnd(event.target.value)}
            />
          </label>
          <p className='text-xs text-[#64748b]'>
            Link expires at the end of the job window, within seven days. Direct contractor messages
            include this check’s property/unit and photo reference.
          </p>
        </div>
      )}
      {error && <p role='alert' className='text-sm text-red-700'>{error}</p>}
      {!supabase && (
        <p className='text-sm text-[#64748b]'>
          Connect Supabase to create scoped capture links and send Home Checks.
        </p>
      )}
      <button
        type='button'
        disabled={busy || homeCheckExcluded || !scope || !supabase ||
          (role === 'tenant' && !unitId) || (role === 'contractor' && !windowEnd)}
        onClick={() => void start()}
        className='rounded bg-[#186179] px-4 py-2 text-sm text-white disabled:opacity-50'
      >
        {busy
          ? 'Working…'
          : homeCheckExcluded
          ? 'Home Check unavailable in pilot'
          : role === 'landlord'
          ? 'Open my Home Check'
          : 'Send Home Check'}
      </button>
      {link && (
        <div className='space-y-2 rounded border border-[#e2e8f0] p-3'>
          <a
            href={`${new URL(link).pathname}${new URL(link).hash}`}
            target='_blank'
            rel='noreferrer'
            className='text-sm font-semibold text-[#186179]'
          >
            Open scoped capture page
          </a>
          <p className='break-all text-xs'>{link}</p>
          <button
            type='button'
            className='text-sm text-[#186179]'
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() =>
                setError('Could not copy. Select the link above to copy it.')
              )
            }}
          >
            {copied ? 'Copied' : 'Copy branded link'}
          </button>
        </div>
      )}
      {!!list?.checks.length && (
        <div className='space-y-3'>
          <h4 className='font-semibold'>Home Check records</h4>
          {list.checks.map((check) => (
            <article key={check.id} className='space-y-2 rounded border border-[#e2e8f0] p-3'>
              <p className='text-sm font-semibold'>
                {formatHomeCheckLocation(check.property_label, check.unit_label)} · {check.role} ·{' '}
                {check.reference}
              </p>
              <p className='text-xs text-[#64748b]'>
                {check.status} ·{' '}
                {check.labels_readable ? 'Labels readable' : 'Label details need review'}
              </p>
              <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                {check.photos.map((photo) => (
                  <figure key={photo.slot}>
                    {photo.previewUrl && (
                      <a href={photo.previewUrl} target='_blank' rel='noreferrer'>
                        <img
                          src={photo.previewUrl}
                          alt={HOME_CHECK_PHOTOS.find((item) =>
                            item.slot === photo.slot
                          )?.title ||
                            'Equipment photo'}
                          className='aspect-square w-full rounded object-cover'
                        />
                      </a>
                    )}
                    <figcaption className='mt-1 text-xs text-[#64748b]'>
                      {HOME_CHECK_PHOTOS.find((item) => item.slot === photo.slot)?.title}
                    </figcaption>
                  </figure>
                ))}
              </div>
              {check.assets.map((asset) => (
                <div key={asset.id}>
                  <p className='text-sm font-medium'>
                    {asset.system === 'water_heater' ? 'Water heater' : 'Heating system'} ·{' '}
                    {homeCheckAssetStatusLabel(asset)}
                  </p>
                  {homeCheckAssetStatusLabel(asset) !== 'Details verified' && (
                    <EquipmentLabelNotice quality={asset.labelReadability} />
                  )}
                  {!asset.verified && (
                    <button
                      type='button'
                      className='mt-2 text-sm font-medium text-[#186179]'
                      onClick={() =>
                        setLabelEdits((previous) => ({
                          ...previous,
                          [asset.id]: previous[asset.id] ||
                            {
                              modelNumber: String(asset.fields.model.value || ''),
                              serialNumber: String(asset.fields.serial.value || ''),
                              manufactureMonth: asset.manufactureDate?.month
                                ? String(asset.manufactureDate.month)
                                : '',
                              manufactureYear: asset.manufactureDate?.year
                                ? String(asset.manufactureDate.year)
                                : '',
                            },
                        }))}
                    >
                      I checked the data plate — enter label text
                    </button>
                  )}
                  {labelEdits[asset.id] && !asset.verified && (
                    <div className='mt-2 space-y-2'>
                      <p className='text-xs text-[#64748b]'>
                        Use only characters you can read in the photo. Leave unknown fields blank.
                        Your corrections are recorded with you as the source.
                      </p>
                      <label className='block text-xs'>
                        Verified model<input
                          className='mt-1 w-full rounded border p-2'
                          value={labelEdits[asset.id].modelNumber}
                          onChange={(event) =>
                            setLabelEdits((previous) => ({
                              ...previous,
                              [asset.id]: {
                                ...previous[asset.id],
                                modelNumber: event.target.value,
                              },
                            }))}
                        />
                      </label>
                      <label className='block text-xs'>
                        Manufacture month
                        <select
                          className='mt-1 w-full rounded border p-2'
                          value={labelEdits[asset.id].manufactureMonth}
                          onChange={(event) =>
                            setLabelEdits((previous) => ({
                              ...previous,
                              [asset.id]: {
                                ...previous[asset.id],
                                manufactureMonth: event.target.value,
                              },
                            }))}
                        >
                          <option value=''>Month unknown</option>
                          {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((name, index) => (
                            <option key={name} value={String(index + 1)}>{name}</option>
                          ))}
                        </select>
                      </label>
                      <label className='block text-xs'>
                        Manufacture year<input
                          className='mt-1 w-full rounded border p-2'
                          inputMode='numeric'
                          value={labelEdits[asset.id].manufactureYear}
                          onChange={(event) =>
                            setLabelEdits((previous) => ({
                              ...previous,
                              [asset.id]: {
                                ...previous[asset.id],
                                manufactureYear: event.target.value,
                              },
                            }))}
                        />
                      </label>
                      <p className='text-xs text-[#64748b]'>
                        Age is calculated from the month and year on the plate. Leave either one blank when it is not readable.
                      </p>
                      <label className='block text-xs'>
                        Verified serial<input
                          className='mt-1 w-full rounded border p-2'
                          value={labelEdits[asset.id].serialNumber}
                          onChange={(event) =>
                            setLabelEdits((previous) => ({
                              ...previous,
                              [asset.id]: {
                                ...previous[asset.id],
                                serialNumber: event.target.value,
                              },
                            }))}
                        />
                      </label>
                    </div>
                  )}
                  <dl className='mt-1 grid gap-1 text-xs'>
                    {Object.entries(asset.fields).map(([name, field]) => (
                      <div key={name}>
                        <dt className='inline font-medium'>
                          {({
                            make: 'Make',
                            model: 'Model',
                            serial: 'Serial',
                            approximateAge: 'Approximate age',
                            condition: 'Visible condition',
                            lastService: 'Last service',
                            lastFilterChange: 'Last filter change',
                          } as Record<string, string>)[name]}:
                        </dt>
                        <dd className='inline'>
                          {field.value == null
                            ? 'Unknown'
                            : name === 'approximateAge'
                            ? `About ${field.value} years (estimate)`
                            : field.value}
                          {field.value == null
                            ? (homeCheckFieldBasis(field) ? ` · ${homeCheckFieldBasis(field)}` : ' · Not verified')
                            : ` · ${field.source === 'photo_text'
                              ? `Photo from ${field.capturedBy}`
                              : field.source} · ${field.confidence} confidence${
                              homeCheckFieldBasis(field) ? ` · ${homeCheckFieldBasis(field)}` : ''
                            }`}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
              {check.issue_ticket_id && (
                <p className='text-sm text-amber-700'>
                  {homeCheckFollowUpExplanation({
                    warningSigns: check.answers?.warningSigns,
                    warningDetails: check.answers?.warningDetails,
                    detectedWarning: check.detected_warning,
                  })}
                </p>
              )}
              {check.completed_at && !check.confirmed_at && (
                <button
                  type='button'
                  disabled={busy || check.assets.length !== 2 || check.photos.some((photo) =>
                    photo.state === 'queued' || photo.state === 'analyzing'
                  ) || check.assets.some((asset) =>
                    asset.labelReadability?.retakeRequested && !labelEdits[asset.id]
                  )}
                  onClick={() =>
                    void confirm(check.id)}
                  className='rounded border border-[#186179] px-3 py-1 text-sm text-[#186179]'
                >
                  Confirm asset records
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {list && (
        <details>
          <summary className='cursor-pointer text-sm font-semibold'>
            Home Check outcomes by participant
          </summary>
          <div className='mt-2 overflow-x-auto'>
            <table className='w-full text-left text-xs'>
              <thead>
                <tr>
                  {[
                    'Participant',
                    'Link sent',
                    'Opened',
                    'Completed',
                    'Labels readable',
                    'Confirmed',
                    'Avg. minutes',
                    'Issues surfaced',
                    'Approved jobs / issues',
                  ].map((label) => <th key={label} className='p-2'>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.metrics.map((metric) => (
                  <tr key={metric.role}>
                    {[
                      metric.role,
                      metric.sent,
                      metric.opened,
                      metric.completed,
                      metric.labelReadable,
                      metric.confirmed,
                      metric.averageMinutes == null ? '—' : Math.round(metric.averageMinutes),
                      metric.issueShare == null ? '—' : `${Math.round(metric.issueShare * 100)}%`,
                      metric.approvedJobShare == null
                        ? '—'
                        : `${Math.round(metric.approvedJobShare * 100)}%`,
                    ].map((value, index) => <td key={index} className='p-2'>{value}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}
