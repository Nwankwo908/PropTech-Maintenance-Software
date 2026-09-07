import { useEffect, useMemo, useState } from 'react'
import { InspectionAssessmentTable } from '@/components/InspectionAssessmentTable'
import type { ApplianceVisionResult, InspectionPhotoRow } from '@/lib/vision/types'
import { visionResultsFromInspectionPhoto } from '@/lib/inspectionAssessmentTable'
import { getErrorMessage } from '@/lib/errorMessage'

type ApplianceAssessmentReviewCardProps = {
  photos: InspectionPhotoRow[]
  confirming?: boolean
  deleting?: boolean
  onConfirm: (photoId: string, result: ApplianceVisionResult) => Promise<void>
  onDeletePhotos: (photoIds: string[]) => Promise<void>
}

/** Review AI findings and confirm them onto the asset registry / operations graph. */
export function ApplianceAssessmentReviewCard({
  photos,
  confirming = false,
  deleting = false,
  onConfirm,
  onDeletePhotos,
}: ApplianceAssessmentReviewCardProps) {
  const completed = useMemo(
    () =>
      photos.filter(
        (photo) =>
          photo.status !== 'queued' &&
          photo.status !== 'analyzing' &&
          Boolean(photo.confirmedResult ?? photo.aiResult),
      ),
    [photos],
  )

  const tableRows = useMemo(
    () =>
      photos.flatMap((photo) => {
        const extracting = photo.status === 'queued' || photo.status === 'analyzing'
        const results = visionResultsFromInspectionPhoto(photo)
        if (extracting && results.length === 0) {
          return [
            {
              id: photo.id,
              previewUrl: photo.previewUrl,
              extracting: true as const,
              extractComplete: false,
              editable: false,
            },
          ]
        }
        return results.map((result, index) => ({
          id: index === 0 ? photo.id : `${photo.id}:${index}`,
          result,
          previewUrl: index === 0 ? photo.previewUrl : null,
          editable: photo.status === 'needs_review' && index === 0,
        }))
      }),
    [photos],
  )

  const [drafts, setDrafts] = useState<Record<string, ApplianceVisionResult>>({})
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [editingIds, setEditingIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCheckedIds((prev) => prev.filter((id) => tableRows.some((row) => row.id === id)))
    setEditingIds((prev) => prev.filter((id) => tableRows.some((row) => row.id === id)))
  }, [tableRows])

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev }
      let changed = false
      for (const photo of completed) {
        const result = photo.confirmedResult ?? photo.aiResult
        if (result && !next[photo.id]) {
          next[photo.id] = result
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [completed])

  const recommendations = completed.flatMap((photo) => {
    const result = drafts[photo.id] ?? photo.confirmedResult ?? photo.aiResult
    return result?.maintenanceRecommendations ?? []
  })

  const saved =
    completed.length > 0 &&
    completed.every((photo) => photo.status === 'confirmed') &&
    !photos.some((photo) => photo.status === 'queued' || photo.status === 'analyzing')

  async function handleConfirm() {
    setError(null)
    const pending = completed.filter((photo) => photo.status === 'needs_review')
    if (pending.length === 0) {
      setError('Nothing left to save.')
      return
    }
    const missingType = pending.find((photo) => {
      const result = drafts[photo.id] ?? photo.aiResult
      return !result?.identifiedItem.type.trim()
    })
    if (missingType) {
      setError('Item type is required before saving.')
      return
    }
    try {
      for (const photo of pending) {
        const result = drafts[photo.id] ?? photo.aiResult
        if (!result) continue
        await onConfirm(photo.id, result)
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save assessment.'))
    }
  }

  async function handleDelete() {
    const photoIds = [...new Set(checkedIds.map((id) => id.split(':')[0] ?? id))]
    if (photoIds.length === 0) return
    setError(null)
    try {
      await onDeletePhotos(photoIds)
      setCheckedIds([])
    } catch (err) {
      setError(getErrorMessage(err, 'Could not delete the selected items.'))
    }
  }

  function handleEditSelected() {
    if (checkedIds.length === 0) return
    setDrafts((prev) => {
      const next = { ...prev }
      for (const id of checkedIds) {
        if (next[id]) continue
        const row = tableRows.find((item) => item.id === id)
        if (row?.result) next[id] = row.result
      }
      return next
    })
    setEditingIds((prev) => [...new Set([...prev, ...checkedIds])])
  }

  async function handleSaveEdits() {
    const ids = editingIds.filter((id) => !id.includes(':'))
    if (ids.length === 0) {
      setError('Choose the row with the photo thumbnail to save remaining details.')
      return
    }
    setError(null)
    try {
      for (const id of ids) {
        const photo = completed.find((item) => item.id === id)
        const result = drafts[id] ?? photo?.confirmedResult ?? photo?.aiResult
        if (!result) continue
        await onConfirm(id, result)
      }
      setEditingIds([])
      setCheckedIds([])
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save assessment.'))
    }
  }

  return (
    <div className="w-full min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-[#0f172a]">Assets from inspection</p>
        {checkedIds.length > 0 || deleting || editingIds.length > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {checkedIds.length > 0 ? (
              <button
                type="button"
                disabled={deleting || confirming}
                onClick={handleEditSelected}
                className="pd-btn pd-btn-ghost rounded-[10px] px-4 py-2.5 text-[13px] font-semibold text-[#186179] hover:bg-[#eff6ff] disabled:text-[#94a3b8]"
              >
                Edit selected ({checkedIds.length})
              </button>
            ) : null}
            {editingIds.length > 0 ? (
              <button
                type="button"
                disabled={deleting || confirming}
                onClick={() => void handleSaveEdits()}
                className="pd-btn pd-btn-primary rounded-[10px] px-4 py-2.5 text-[13px] font-semibold disabled:text-[#94a3b8]"
              >
                {confirming ? 'Saving…' : 'Save edits'}
              </button>
            ) : null}
            {checkedIds.length > 0 || deleting ? (
              <button
                type="button"
                disabled={deleting || confirming}
                onClick={() => void handleDelete()}
                className="pd-btn pd-btn-ghost rounded-[10px] px-4 py-2.5 text-[13px] font-semibold text-[#a03e3e] hover:bg-[#fef2f2] hover:text-[#991b1b] disabled:text-[#94a3b8]"
              >
                {deleting ? 'Deleting…' : `Delete selected (${checkedIds.length})`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <InspectionAssessmentTable
        checkedIds={checkedIds}
        onCheckedIdsChange={setCheckedIds}
        onChangeRow={(id, result) => {
          setDrafts((prev) => ({ ...prev, [id]: result }))
        }}
        rows={tableRows.map((row) => {
          if ('extracting' in row && row.extracting) return row
          const result = drafts[row.id] ?? row.result
          return { ...row, result, editable: Boolean(row.editable) || editingIds.includes(row.id) }
        })}
      />

      {error ? <p className="mt-3 text-[12px] text-[#b91c1c]">{error}</p> : null}

      {!saved ? (
        <div className="mt-4 rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
          <p className="text-[13px] font-semibold text-[#0f172a]">Maintenance recommendations</p>
          {recommendations.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-[#475569]">
              {recommendations.map((rec, idx) => (
                <li key={`${rec.action}-${idx}`}>
                  {rec.action}
                  {rec.suggestedIntervalMonths
                    ? ` · every ${rec.suggestedIntervalMonths} months`
                    : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] text-[#64748b]">No maintenance recommendations listed.</p>
          )}
        </div>
      ) : null}

      {!saved ? (
        <div className="mt-4 flex justify-start">
          <button
            type="button"
            disabled={confirming || deleting}
            onClick={() => void handleConfirm()}
            className="pd-btn pd-btn-primary rounded-[10px] px-4 py-2.5 text-[13px] font-semibold"
          >
            {confirming ? 'Saving…' : 'Confirm & Save to Report'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default ApplianceAssessmentReviewCard
