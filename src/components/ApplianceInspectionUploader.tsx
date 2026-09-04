import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  confirmInspectionPhoto,
  createInspectionAssessment,
  listInspectionAssets,
  listInspectionPhotos,
  retryInspectionPhoto,
  uploadAndAnalyzeInspectionPhoto,
  type InspectionAssetSummary,
} from '@/api/inspectionAssetAssess'
import { ApplianceAssessmentReviewCard } from '@/components/ApplianceAssessmentReviewCard'
import { InspectionCaptureChooser } from '@/components/InspectionCaptureChooser'
import { InspectionPhoneCaptureModal } from '@/components/InspectionPhoneCaptureModal'
import type { InspectionCapturePhoto } from '@/api/inspectionCapture'
import { notifyAssetRegistryChanged } from '@/lib/assetRegistry'
import { compressImageForVision } from '@/lib/imageCompress'
import { getErrorMessage } from '@/lib/errorMessage'
import type {
  ApplianceVisionResult,
  InspectionPhotoRow,
  InspectionPhotoStatus,
  VisionHintCategory,
} from '@/lib/vision/types'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.pdf'
const CAMERA_ACCEPT = 'image/*'
const MAX_FILES = 20
const MAX_BYTES = 10 * 1024 * 1024
const CONCURRENCY = 3

function statusLabel(status: InspectionPhotoStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'analyzing':
      return 'Analyzing'
    case 'needs_review':
      return 'Needs review'
    case 'confirmed':
      return 'Confirmed'
    case 'error':
      return 'Error'
    default:
      return status
  }
}

function statusClass(status: InspectionPhotoStatus): string {
  switch (status) {
    case 'confirmed':
      return 'bg-[#ecfdf5] text-[#059669]'
    case 'needs_review':
      return 'bg-[#eff6ff] text-[#2563eb]'
    case 'analyzing':
    case 'queued':
      return 'bg-[#fffbeb] text-[#d97706]'
    case 'error':
      return 'bg-[#fef2f2] text-[#b91c1c]'
    default:
      return 'bg-[#f1f5f9] text-[#64748b]'
  }
}

type LocalJob = {
  localId: string
  file: File
  previewUrl: string
  hintCategory: VisionHintCategory | null
  mode: 'photo' | 'document'
}

type ApplianceInspectionUploaderProps = {
  building: string
}

/** Multi-photo AI appliance / systems assessment for Smart Inspection Report. */
export function ApplianceInspectionUploader({ building }: ApplianceInspectionUploaderProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [assessmentId, setAssessmentId] = useState<string | null>(null)
  const [photos, setPhotos] = useState<InspectionPhotoRow[]>([])
  const [assets, setAssets] = useState<InspectionAssetSummary[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [phoneCaptureOpen, setPhoneCaptureOpen] = useState(false)
  const previewByIdRef = useRef<Record<string, string>>({})

  const refreshAssets = useCallback(async () => {
    if (!building) return
    try {
      const rows = await listInspectionAssets(building)
      setAssets(rows)
    } catch {
      // best-effort
    }
  }, [building])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      if (!building) return
      setError(null)
      try {
        const { id } = await createInspectionAssessment(building)
        if (cancelled) return
        setAssessmentId(id)
        const listed = await listInspectionPhotos(id)
        if (!cancelled) setPhotos(listed)
        await refreshAssets()
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'Could not start assessment session.'))
        }
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [building, refreshAssets])

  async function processQueue(jobs: LocalJob[], sessionId: string) {
    setBusy(true)
    setError(null)
    let index = 0

    async function worker() {
      while (index < jobs.length) {
        const current = index
        index += 1
        const job = jobs[current]!
        const optimisticId = `local-${job.localId}`
        setPhotos((prev) => [
          ...prev,
          {
            id: optimisticId,
            assessmentId: sessionId,
            storagePath: null,
            hintCategory: job.hintCategory,
            status: 'queued',
            aiResult: null,
            confirmedResult: null,
            provider: null,
            errorMessage: null,
            latencyMs: null,
            fileName: job.file.name,
            previewUrl: job.previewUrl,
          },
        ])

        try {
          setPhotos((prev) =>
            prev.map((p) =>
              p.id === optimisticId ? { ...p, status: 'analyzing' as const } : p,
            ),
          )
          const compressed = await compressImageForVision(job.file)
          const uploaded = await uploadAndAnalyzeInspectionPhoto({
            assessmentId: sessionId,
            imageBase64: compressed.base64,
            contentType: compressed.contentType,
            fileName: compressed.fileName,
            hintCategory: job.hintCategory,
            mode: job.mode,
            previewUrl: job.previewUrl,
          })
          setPhotos((prev) =>
            prev.map((p) => (p.id === optimisticId ? { ...uploaded, previewUrl: job.previewUrl } : p)),
          )
          if (uploaded.id) previewByIdRef.current[uploaded.id] = job.previewUrl
          if (uploaded.status === 'needs_review') {
            setReviewId((prev) => prev ?? uploaded.id)
          }
        } catch (err) {
          const message = getErrorMessage(err, 'Upload failed')
          setPhotos((prev) =>
            prev.map((p) =>
              p.id === optimisticId
                ? {
                    ...p,
                    status: 'error' as const,
                    errorMessage: message,
                  }
                : p,
            ),
          )
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker())
    await Promise.all(workers)
    setBusy(false)
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length || !assessmentId) return
    const remaining = MAX_FILES - photos.length
    if (remaining <= 0) {
      setError('Maximum 20 files per session.')
      return
    }

    const jobs: LocalJob[] = []
    for (const file of Array.from(fileList).slice(0, remaining)) {
      if (file.size > MAX_BYTES) {
        setError(`${file.name} is larger than 10MB.`)
        continue
      }
      const ok =
        /\.(jpe?g|png|webp|heic|heif|pdf)$/i.test(file.name) ||
        file.type.startsWith('image/') ||
        file.type === 'application/pdf'
      if (!ok) {
        setError('Use JPG, PNG, WEBP, HEIC, or PDF.')
        continue
      }
      const mode = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'document' : 'photo'
      jobs.push({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl: mode === 'photo' ? URL.createObjectURL(file) : '',
        hintCategory: null,
        mode,
      })
    }
    if (jobs.length === 0) return
    await processQueue(jobs, assessmentId)
    if (inputRef.current) inputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  function openInspectionChooser() {
    setChooserOpen(true)
  }

  function onUseThisComputer() {
    setChooserOpen(false)
    cameraInputRef.current?.click()
  }

  async function mergeCapturePhotos(capturePhotos: InspectionCapturePhoto[]) {
    if (!assessmentId) return
    for (const photo of capturePhotos) {
      if (photo.inspectionPhotoId && photo.previewUrl) {
        previewByIdRef.current[photo.inspectionPhotoId] = photo.previewUrl
      }
    }
    try {
      const listed = await listInspectionPhotos(assessmentId)
      setPhotos((prev) => {
        for (const p of prev) {
          if (p.previewUrl && !p.id.startsWith('local-')) {
            previewByIdRef.current[p.id] = p.previewUrl
          }
        }
        const localOnly = prev.filter((p) => p.id.startsWith('local-'))
        const merged = listed.map((p) => ({
          ...p,
          previewUrl: previewByIdRef.current[p.id] ?? p.previewUrl ?? null,
        }))
        return [...merged, ...localOnly]
      })
      const needsReview = listed.find((p) => p.status === 'needs_review')
      if (needsReview) setReviewId((prev) => prev ?? needsReview.id)
    } catch {
      // polling / realtime retry
    }
  }

  async function onRetry(photo: InspectionPhotoRow) {
    if (photo.id.startsWith('local-')) return
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === photo.id ? { ...p, status: 'analyzing', errorMessage: null } : p,
      ),
    )
    try {
      const updated = await retryInspectionPhoto(photo.id)
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id ? { ...updated, previewUrl: p.previewUrl } : p,
        ),
      )
      if (updated.status === 'needs_review') setReviewId(updated.id)
    } catch (err) {
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id
            ? {
                ...p,
                status: 'error',
                errorMessage: getErrorMessage(err, 'Retry failed'),
              }
            : p,
        ),
      )
    }
  }

  async function onConfirm(photoId: string, result: ApplianceVisionResult) {
    setConfirmingId(photoId)
    try {
      await confirmInspectionPhoto({ photoId, result })
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId
            ? { ...p, status: 'confirmed', confirmedResult: result, aiResult: result }
            : p,
        ),
      )
      setReviewId((prev) => (prev === photoId ? null : prev))
      notifyAssetRegistryChanged(building)
      await refreshAssets()
    } finally {
      setConfirmingId(null)
    }
  }

  const reviewPhoto = photos.find((p) => p.id === reviewId && p.status === 'needs_review')
  const reviewResult = reviewPhoto?.aiResult ?? null

  const safetyAssets = assets.filter((a) => {
    const defs = a.metadata?.deficiencies
    return (
      Array.isArray(defs) &&
      defs.some(
        (d) =>
          d &&
          typeof d === 'object' &&
          (d as { severity?: string }).severity === 'safety_hazard',
      )
    )
  })

  return (
    <div className="flex min-h-[220px] min-w-0 flex-col">
      {error ? <p className="mb-2 text-[12px] text-[#b91c1c]">{error}</p> : null}

      <div
        className={[
          'flex min-h-[160px] flex-1 flex-col rounded-[10px] border border-dashed bg-[#f8fafc] p-px',
          dragging ? 'border-[#0d0f11]' : 'border-[#cbd5e1]',
        ].join(' ')}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void onFilesSelected(e.dataTransfer.files)
        }}
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-7 text-center">
          <p className="text-[14px] font-semibold text-[#0d0f11]">
            Take photos of appliances or systems
          </p>
          <p className="text-[12px] text-[#64748b]">
            Opens the camera to take a photo · JPG, PNG, WEBP, or HEIC · max 10MB
          </p>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            onChange={(e) => void onFilesSelected(e.target.files)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept={CAMERA_ACCEPT}
            capture="environment"
            className="sr-only"
            onChange={(e) => void onFilesSelected(e.target.files)}
          />
          <button
            type="button"
            disabled={!assessmentId || busy}
            onClick={openInspectionChooser}
            className="mt-1 flex size-10 items-center justify-center rounded-[10px] bg-transparent text-[#186179] outline-none hover:text-[#0f4a5c] focus-visible:ring-2 focus-visible:ring-[#186179] disabled:text-[#94a3b8]"
            aria-label={busy ? 'Analyzing photos' : 'Take photos'}
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {chooserOpen ? (
        <InspectionCaptureChooser
          onClose={() => setChooserOpen(false)}
          onUseComputer={onUseThisComputer}
          onUsePhone={() => {
            setChooserOpen(false)
            setPhoneCaptureOpen(true)
          }}
        />
      ) : null}

      {phoneCaptureOpen && assessmentId ? (
        <InspectionPhoneCaptureModal
          assessmentId={assessmentId}
          onClose={() => setPhoneCaptureOpen(false)}
          onPhotosSynced={(photos) => {
            void mergeCapturePhotos(photos)
          }}
        />
      ) : null}

      {photos.length > 0 ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo) => (
            <li
              key={photo.id}
              className="overflow-hidden rounded-[10px] border border-[#e2e8f0] bg-white"
            >
              <div className="relative aspect-[4/3] bg-[#f1f5f9]">
                {photo.previewUrl ? (
                  <img
                    src={photo.previewUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-[12px] text-[#94a3b8]">
                    {photo.fileName?.endsWith('.pdf') ? 'PDF' : 'No preview'}
                  </div>
                )}
                <span
                  className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(photo.status)}`}
                >
                  {statusLabel(photo.status)}
                </span>
              </div>
              <div className="space-y-2 p-3">
                <p className="truncate text-[12px] font-medium text-[#0f172a]">
                  {photo.fileName || 'Photo'}
                </p>
                {photo.errorMessage ? (
                  <p className="text-[11px] text-[#b91c1c]">{photo.errorMessage}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {photo.status === 'needs_review' ? (
                    <button
                      type="button"
                      onClick={() => setReviewId(photo.id)}
                      className="pd-btn pd-btn-ghost rounded px-1 py-0.5 text-[12px] font-semibold"
                    >
                      Review
                    </button>
                  ) : null}
                  {photo.status === 'error' && !photo.id.startsWith('local-') ? (
                    <button
                      type="button"
                      onClick={() => void onRetry(photo)}
                      className="pd-btn pd-btn-ghost rounded px-1 py-0.5 text-[12px] font-semibold"
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {reviewPhoto && reviewResult ? (
        <div className="mt-5">
          <ApplianceAssessmentReviewCard
            key={reviewPhoto.id}
            photoId={reviewPhoto.id}
            fileName={reviewPhoto.fileName}
            previewUrl={reviewPhoto.previewUrl}
            initial={reviewResult}
            confirming={confirmingId === reviewPhoto.id}
            onConfirm={(result) => onConfirm(reviewPhoto.id, result)}
          />
        </div>
      ) : null}

      {safetyAssets.length > 0 ? (
        <div className="mt-5 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3">
          <p className="text-[13px] font-semibold text-[#991b1b]">Safety hazards flagged</p>
          <ul className="mt-1 space-y-1 text-[12px] text-[#b91c1c]">
            {safetyAssets.map((a) => (
              <li key={a.id}>{a.appliance_label || a.appliance_type}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {assets.length > 0 ? (
        <div className="mt-5">
          <p className="text-[13px] font-semibold text-[#0f172a]">Assets from inspection</p>
          <ul className="mt-2 divide-y divide-[#e2e8f0] rounded-[10px] border border-[#e2e8f0] bg-white">
            {assets.slice(0, 12).map((asset) => {
              const rating =
                asset.metadata && typeof asset.metadata.conditionRating === 'string'
                  ? asset.metadata.conditionRating
                  : null
              return (
                <li
                  key={asset.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[13px]"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-[#0f172a]">
                      {asset.appliance_label || asset.appliance_type}
                    </p>
                    <p className="text-[11px] text-[#64748b]">
                      Age {asset.estimated_age_years}y
                      {rating ? ` · ${rating}` : ''}
                      {asset.brand ? ` · ${asset.brand}` : ''}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#64748b]">
                    {asset.replacement_urgency}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export default ApplianceInspectionUploader
