import { InspectionAssessmentTable } from './InspectionAssessmentTable'
import { EQUIPMENT_PHOTO_TIPS } from '@shared/vision/equipmentLabel'
import { useCallback, useEffect, useState } from 'react'
import { type HomeCheckList, type HomeCheckOptions, homeCheckRequest } from '@/api/homeCheck'
import { supabase } from '@/lib/supabase'
import { notifyAssetRegistryChanged } from '@/lib/assetRegistry'
import { notifyInspectionSessionChanged } from '@/lib/inspectionSession'
import {
  HOME_CHECK_MONTHS,
  homeCheckAssetPreview,
  homeCheckLabelCorrection,
  homeCheckLabelDraft,
  homeCheckReviewLabels,
  homeCheckReviewResult,
  type HomeCheckLabelDraft,
} from '@/lib/homeCheckReview'
import {
  formatHomeCheckLocation,
  HOME_CHECK_PHOTOS,
  homeCheckFollowUpExplanation,
  type HomeCheckRole,
} from '@shared/homeCheck'
import { assertPilotAllows, pilotWorkflowGate } from '@shared/pilotGate'

type ListedHomeCheck = HomeCheckList['checks'][number] & {
  completed_at?: string | null
  confirmed_at?: string | null
  labels_readable?: boolean | null
  issue_ticket_id?: string | null
}

const PLATE_INPUT =
  'w-auto bg-transparent px-0 py-0.5 text-[13px] text-[#68717a] outline-none placeholder:text-[#94a3b8]'

function ManufactureDateFields(
  { draft, onChange }: { draft: HomeCheckLabelDraft; onChange: (next: HomeCheckLabelDraft) => void },
) {
  return (
    <div className='mt-1 space-y-1'>
      <div className='flex flex-wrap items-center gap-2'>
        <select
          aria-label='Manufacture month'
          value={draft.manufactureMonth}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onChange({ ...draft, manufactureMonth: event.target.value })}
          className={PLATE_INPUT}
        >
          <option value=''>Month unknown</option>
          {HOME_CHECK_MONTHS.map((name, index) => (
            <option key={name} value={String(index + 1)}>{name}</option>
          ))}
        </select>
        <input
          aria-label='Manufacture year'
          inputMode='numeric'
          placeholder='Year'
          value={draft.manufactureYear}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onChange({ ...draft, manufactureYear: event.target.value })}
          className={`${PLATE_INPUT} w-16`}
        />
      </div>
      <p className='text-[12px] leading-4 text-[#64748b]'>
        Age is calculated from the month and year on the plate. Leave either one blank when it is not readable.
      </p>
    </div>
  )
}

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
  const [labelEdits, setLabelEdits] = useState<Record<string, HomeCheckLabelDraft>>({})
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
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
      ).map((asset) => homeCheckLabelCorrection(asset.id, labelEdits[asset.id])) || []
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
        Records stay unverified until you confirm them. Age stays an estimate. Observation only;
        no repairs authorized.
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
        <div className='space-y-4'>
          {list.checks.map((check) => {
            const record = check as ListedHomeCheck
            const canReview = Boolean(record.completed_at && !record.confirmed_at && record.assets.length)
            const selectedHere = record.assets.filter((asset) =>
              selectedAssetIds.includes(asset.id) && !asset.verified
            )
            const confirmBlocked = busy || record.assets.length !== 2 || record.photos.some((photo) =>
              photo.state === 'queued' || photo.state === 'analyzing'
            ) || record.assets.some((asset) =>
              asset.labelReadability?.retakeRequested && !labelEdits[asset.id]
            )
            return (
              <section key={record.id} aria-label={`${record.reference} results`}>
                <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
                  <div>
                    <p className='text-[13px] font-semibold text-[#334155]'>Assets from Home Check</p>
                    <p className='text-[12px] text-[#64748b]'>
                      {formatHomeCheckLocation(record.property_label, record.unit_label)} · {record.reference}
                      {record.labels_readable ? ' · Labels readable' : record.assets.length
                        ? ' · Label details need review'
                        : ` · ${record.status}`}
                    </p>
                  </div>
                  {canReview && (
                    <div className='flex flex-wrap gap-2'>
                      <button
                        type='button'
                        disabled={selectedHere.length === 0 || busy}
                        onClick={() => {
                          setLabelEdits((previous) => {
                            const next = { ...previous }
                            for (const asset of selectedHere) {
                              if (!next[asset.id]) next[asset.id] = homeCheckLabelDraft(asset)
                            }
                            return next
                          })
                        }}
                        className='rounded-[10px] border border-[#cbd5e1] bg-white px-4 py-2 text-[13px] font-semibold text-[#334155] disabled:opacity-40'
                      >
                        Edit selected{selectedHere.length ? ` (${selectedHere.length})` : ''}
                      </button>
                      <button
                        type='button'
                        disabled={confirmBlocked}
                        onClick={() => void confirm(record.id)}
                        className='rounded-[10px] bg-[#186179] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40'
                      >
                        Confirm asset records
                      </button>
                    </div>
                  )}
                </div>
                {record.assets.length > 0 && (
                  <InspectionAssessmentTable
                    rows={record.assets.map((asset) => {
                      const draft = !asset.verified ? labelEdits[asset.id] : undefined
                      const labels = homeCheckReviewLabels(asset)
                      const result = homeCheckReviewResult(asset, draft)
                      return {
                        id: asset.id,
                        previewUrl: homeCheckAssetPreview(asset.system, record.photos),
                        editable: Boolean(draft),
                        labelFieldsOnly: true,
                        categoryLabel: labels.categoryLabel,
                        conditionLabel: labels.conditionLabel,
                        actionLabel: labels.actionLabel,
                        result: labels.actionLabel === 'Details verified'
                          ? { ...result, labelReadability: undefined }
                          : result,
                        descriptionExtra: draft
                          ? (
                            <ManufactureDateFields
                              draft={draft}
                              onChange={(next) =>
                                setLabelEdits((previous) => ({ ...previous, [asset.id]: next }))}
                            />
                          )
                          : (
                            <p className='mt-1 text-[12px] leading-4 text-[#64748b]'>
                              {labels.manufactureLabel}
                            </p>
                          ),
                      }
                    })}
                    checkedIds={canReview ? selectedAssetIds : undefined}
                    onCheckedIdsChange={canReview ? setSelectedAssetIds : undefined}
                    onChangeRow={(id, result) => {
                      setLabelEdits((previous) => {
                        const current = previous[id]
                        if (!current) return previous
                        return {
                          ...previous,
                          [id]: {
                            ...current,
                            modelNumber: result.identifiedItem.modelNumber ?? '',
                            serialNumber: result.identifiedItem.serialNumber ?? '',
                          },
                        }
                      })
                    }}
                  />
                )}
                {record.issue_ticket_id && (
                  <p className='mt-3 text-sm text-[#92400e]'>
                    {homeCheckFollowUpExplanation({
                      warningSigns: record.answers?.warningSigns,
                      warningDetails: record.answers?.warningDetails,
                      detectedWarning: record.detected_warning,
                    })}
                  </p>
                )}
              </section>
            )
          })}
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
