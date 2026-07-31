import { useState } from 'react'
import type {
  AgeConfidence,
  ApplianceVisionResult,
  ConditionRating,
  DeficiencySeverity,
  RecommendationUrgency,
} from '@/lib/vision/types'
import { getErrorMessage } from '@/lib/errorMessage'

const CONDITION_OPTIONS: ConditionRating[] = ['good', 'fair', 'poor', 'unsafe']
const SEVERITY_OPTIONS: DeficiencySeverity[] = [
  'cosmetic',
  'monitor',
  'repair_recommended',
  'safety_hazard',
]
const URGENCY_OPTIONS: RecommendationUrgency[] = ['routine', 'near_term', 'immediate']

function confidenceBadgeClass(c: AgeConfidence): string {
  if (c === 'high') return 'bg-[#ecfdf5] text-[#059669]'
  if (c === 'medium') return 'bg-[#eff6ff] text-[#2563eb]'
  return 'bg-[#fffbeb] text-[#d97706]'
}

type ApplianceAssessmentReviewCardProps = {
  photoId: string
  fileName?: string | null
  previewUrl?: string | null
  initial: ApplianceVisionResult
  confirming?: boolean
  onConfirm: (result: ApplianceVisionResult) => Promise<void> | void
}

/** Editable human-in-the-loop review of AI vision output before graph write. */
export function ApplianceAssessmentReviewCard({
  fileName,
  previewUrl,
  initial,
  confirming = false,
  onConfirm,
}: ApplianceAssessmentReviewCardProps) {
  const [draft, setDraft] = useState<ApplianceVisionResult>(initial)
  const [error, setError] = useState<string | null>(null)

  function updateItem(patch: Partial<ApplianceVisionResult['identifiedItem']>) {
    setDraft((prev) => ({
      ...prev,
      identifiedItem: { ...prev.identifiedItem, ...patch },
    }))
  }

  async function handleConfirm() {
    setError(null)
    if (!draft.identifiedItem.type.trim()) {
      setError('Item type is required before saving.')
      return
    }
    try {
      await onConfirm(draft)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save assessment.'))
    }
  }

  return (
    <div className="rounded-[12px] border border-[#e2e8f0] bg-white p-4 shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[#0f172a]">Review assessment</p>
          {fileName ? (
            <p className="mt-0.5 truncate text-[12px] text-[#64748b]">{fileName}</p>
          ) : null}
        </div>
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="size-16 rounded-[8px] object-cover border border-[#e2e8f0]"
          />
        ) : null}
      </div>

      {(draft.estimatedAge.confidence === 'low' || draft.rawConfidenceNotes) && (
        <div className="mt-3 rounded-[8px] border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[12px] text-[#92400e]">
          {draft.estimatedAge.confidence === 'low' ? (
            <p className="font-semibold">Low confidence age estimate</p>
          ) : null}
          {draft.rawConfidenceNotes ? <p className="mt-0.5">{draft.rawConfidenceNotes}</p> : null}
          <p className="mt-0.5 text-[#a16207]">Basis: {draft.estimatedAge.basis}</p>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#64748b]">
            Category
          </span>
          <select
            value={draft.category}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                category: e.target.value as ApplianceVisionResult['category'],
              }))
            }
            className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[13px] outline-none focus:border-[#94a3b8]"
          >
            <option value="appliance">Appliance</option>
            <option value="hvac">HVAC</option>
            <option value="water_heater">Water heater</option>
            <option value="boiler">Boiler</option>
            <option value="roof">Roof</option>
            <option value="other">Other</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#64748b]">
            Item type
          </span>
          <input
            value={draft.identifiedItem.type}
            onChange={(e) => updateItem({ type: e.target.value })}
            className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[13px] outline-none focus:border-[#94a3b8]"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#64748b]">
            Brand
          </span>
          <input
            value={draft.identifiedItem.brand ?? ''}
            onChange={(e) => updateItem({ brand: e.target.value })}
            className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[13px] outline-none focus:border-[#94a3b8]"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#64748b]">
            Model
          </span>
          <input
            value={draft.identifiedItem.modelNumber ?? ''}
            onChange={(e) => updateItem({ modelNumber: e.target.value })}
            className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[13px] outline-none focus:border-[#94a3b8]"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#64748b]">
            Serial
          </span>
          <input
            value={draft.identifiedItem.serialNumber ?? ''}
            onChange={(e) => updateItem({ serialNumber: e.target.value })}
            className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[13px] outline-none focus:border-[#94a3b8]"
          />
        </label>
        {draft.category === 'boiler' ? (
          <>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#64748b]">
                Fuel type
              </span>
              <select
                value={draft.identifiedItem.fuelType ?? ''}
                onChange={(e) =>
                  updateItem({
                    fuelType: (e.target.value || undefined) as
                      | ApplianceVisionResult['identifiedItem']['fuelType']
                      | undefined,
                  })
                }
                className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[13px] outline-none focus:border-[#94a3b8]"
              >
                <option value="">Select fuel</option>
                <option value="gas">Gas</option>
                <option value="oil">Oil</option>
                <option value="electric">Electric</option>
                <option value="propane">Propane</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#64748b]">
                BTU output
              </span>
              <input
                type="number"
                min={0}
                step={1000}
                value={draft.identifiedItem.btuOutput ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value)
                  updateItem({
                    btuOutput: v != null && Number.isFinite(v) ? v : null,
                  })
                }}
                placeholder="e.g. 80000"
                className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[13px] outline-none focus:border-[#94a3b8]"
              />
            </label>
          </>
        ) : null}
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#64748b]">
            Estimated age (years)
          </span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={0.5}
              value={draft.estimatedAge.value ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value)
                setDraft((prev) => ({
                  ...prev,
                  estimatedAge: {
                    ...prev.estimatedAge,
                    value: v != null && Number.isFinite(v) ? v : null,
                  },
                }))
              }}
              className="w-full rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[13px] outline-none focus:border-[#94a3b8]"
            />
            <span
              className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${confidenceBadgeClass(draft.estimatedAge.confidence)}`}
              title={draft.estimatedAge.basis}
            >
              {draft.estimatedAge.confidence}
            </span>
          </div>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#64748b]">
            Condition
          </span>
          <select
            value={draft.condition.rating}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                condition: {
                  ...prev.condition,
                  rating: e.target.value as ConditionRating,
                },
              }))
            }
            className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[13px] outline-none focus:border-[#94a3b8]"
          >
            {CONDITION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#64748b]">
            Condition summary
          </span>
          <textarea
            rows={2}
            value={draft.condition.summary}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                condition: { ...prev.condition, summary: e.target.value },
              }))
            }
            className="mt-1 w-full rounded-[8px] border border-[#e2e8f0] px-3 py-2 text-[13px] outline-none focus:border-[#94a3b8]"
          />
        </label>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold text-[#0f172a]">Deficiencies</p>
          <button
            type="button"
            className="pd-btn pd-btn-ghost rounded px-1 py-0.5 text-[12px] font-semibold"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                deficiencies: [
                  ...prev.deficiencies,
                  { description: '', severity: 'monitor' as const },
                ],
              }))
            }
          >
            Add
          </button>
        </div>
        <ul className="mt-2 space-y-2">
          {draft.deficiencies.map((d, idx) => (
            <li
              key={`def-${idx}`}
              className="grid gap-2 rounded-[8px] border border-[#f1f5f9] bg-[#f8fafc] p-2 sm:grid-cols-[1fr_160px_auto]"
            >
              <input
                value={d.description}
                onChange={(e) =>
                  setDraft((prev) => {
                    const next = [...prev.deficiencies]
                    next[idx] = { ...d, description: e.target.value }
                    return { ...prev, deficiencies: next }
                  })
                }
                placeholder="Description"
                className="rounded-[6px] border border-[#e2e8f0] bg-white px-2 py-1.5 text-[12px] outline-none"
              />
              <select
                value={d.severity}
                onChange={(e) =>
                  setDraft((prev) => {
                    const next = [...prev.deficiencies]
                    next[idx] = { ...d, severity: e.target.value as DeficiencySeverity }
                    return { ...prev, deficiencies: next }
                  })
                }
                className="rounded-[6px] border border-[#e2e8f0] bg-white px-2 py-1.5 text-[12px] outline-none"
              >
                {SEVERITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="pd-btn pd-btn-ghost rounded px-1 py-0.5 text-[11px] font-medium"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    deficiencies: prev.deficiencies.filter((_, i) => i !== idx),
                  }))
                }
              >
                Remove
              </button>
            </li>
          ))}
          {draft.deficiencies.length === 0 ? (
            <li className="text-[12px] text-[#94a3b8]">No deficiencies listed.</li>
          ) : null}
        </ul>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold text-[#0f172a]">Maintenance recommendations</p>
          <button
            type="button"
            className="pd-btn pd-btn-ghost rounded px-1 py-0.5 text-[12px] font-semibold"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                maintenanceRecommendations: [
                  ...prev.maintenanceRecommendations,
                  {
                    action: '',
                    urgency: 'routine' as const,
                    suggestedIntervalMonths: 12,
                  },
                ],
              }))
            }
          >
            Add
          </button>
        </div>
        <ul className="mt-2 space-y-2">
          {draft.maintenanceRecommendations.map((r, idx) => (
            <li
              key={`rec-${idx}`}
              className="grid gap-2 rounded-[8px] border border-[#f1f5f9] bg-[#f8fafc] p-2 sm:grid-cols-[1fr_120px_80px_auto]"
            >
              <input
                value={r.action}
                onChange={(e) =>
                  setDraft((prev) => {
                    const next = [...prev.maintenanceRecommendations]
                    next[idx] = { ...r, action: e.target.value }
                    return { ...prev, maintenanceRecommendations: next }
                  })
                }
                placeholder="Action"
                className="rounded-[6px] border border-[#e2e8f0] bg-white px-2 py-1.5 text-[12px] outline-none"
              />
              <select
                value={r.urgency}
                onChange={(e) =>
                  setDraft((prev) => {
                    const next = [...prev.maintenanceRecommendations]
                    next[idx] = { ...r, urgency: e.target.value as RecommendationUrgency }
                    return { ...prev, maintenanceRecommendations: next }
                  })
                }
                className="rounded-[6px] border border-[#e2e8f0] bg-white px-2 py-1.5 text-[12px] outline-none"
              >
                {URGENCY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                title="Interval (months)"
                value={r.suggestedIntervalMonths ?? ''}
                onChange={(e) =>
                  setDraft((prev) => {
                    const next = [...prev.maintenanceRecommendations]
                    const months =
                      e.target.value === '' ? undefined : Number(e.target.value)
                    next[idx] = {
                      ...r,
                      suggestedIntervalMonths:
                        months != null && Number.isFinite(months) ? months : undefined,
                    }
                    return { ...prev, maintenanceRecommendations: next }
                  })
                }
                placeholder="mo"
                className="rounded-[6px] border border-[#e2e8f0] bg-white px-2 py-1.5 text-[12px] outline-none"
              />
              <button
                type="button"
                className="pd-btn pd-btn-ghost rounded px-1 py-0.5 text-[11px] font-medium"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    maintenanceRecommendations: prev.maintenanceRecommendations.filter(
                      (_, i) => i !== idx,
                    ),
                  }))
                }
              >
                Remove
              </button>
            </li>
          ))}
          {draft.maintenanceRecommendations.length === 0 ? (
            <li className="text-[12px] text-[#94a3b8]">No recommendations listed.</li>
          ) : null}
        </ul>
      </div>

      {error ? <p className="mt-3 text-[12px] text-[#b91c1c]">{error}</p> : null}

      <button
        type="button"
        disabled={confirming}
        onClick={() => void handleConfirm()}
        className="pd-btn pd-btn-primary mt-4 rounded-[10px] px-4 py-2.5 text-[13px] font-semibold"
      >
        {confirming ? 'Saving…' : 'Confirm & Save to Report'}
      </button>
    </div>
  )
}

export default ApplianceAssessmentReviewCard
