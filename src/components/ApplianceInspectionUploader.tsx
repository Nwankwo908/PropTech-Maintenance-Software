import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  confirmInspectionPhoto,
  listInspectionAssets,
  loadBuildingInspectionSession,
  signInspectionUploadUrls,
  removeInspectionAsset,
  removeInspectionPhoto,
  retryInspectionPhoto,
  updateInspectionAssetDetails,
  uploadAndAnalyzeInspectionPhoto,
  type InspectionAssetSummary,
} from '@/api/inspectionAssetAssess'
import { ApplianceAssessmentReviewCard } from '@/components/ApplianceAssessmentReviewCard'
import { InspectionAssessmentTable } from '@/components/InspectionAssessmentTable'
import { InspectionCaptureChooser } from '@/components/InspectionCaptureChooser'
import { InspectionPhoneCaptureModal } from '@/components/InspectionPhoneCaptureModal'
import type { InspectionCapturePhoto } from '@/api/inspectionCapture'
import { notifyAssetRegistryChanged } from '@/lib/assetRegistry'
import { compressImageForVision } from '@/lib/imageCompress'
import { getErrorMessage } from '@/lib/errorMessage'
import { visionResultFromSavedInspectionAsset } from '@/lib/inspectionAssessmentTable'
import {
  hideInspectionItems,
  isHiddenInspectionPhoto,
} from '@/lib/inspectionHiddenItems'
import {
  INSPECTION_SESSION_CHANGED_EVENT,
  inspectionPhotosForDisplay,
  notifyInspectionSessionChanged,
} from '@/lib/inspectionSession'
import type {
  ApplianceVisionResult,
  InspectionPhotoRow,
  InspectionPhotoStatus,
  VisionHintCategory,
} from '@/lib/vision/types'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.pdf'
const CAMERA_ACCEPT = 'image/*'
const MAX_FILES = 20
const MAX_BYTES = 25 * 1024 * 1024
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

function ScanEquipmentIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="size-8 text-[#94a3b8]" aria-hidden>
      <path
        d="M11.5 8.5 12.6 6.5h6.8l1.1 2H23.5A2.5 2.5 0 0 1 26 11v11.5A2.5 2.5 0 0 1 23.5 25h-15A2.5 2.5 0 0 1 6 22.5V11a2.5 2.5 0 0 1 2.5-2.5h3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16.5" r="4.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
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
  leading?: ReactNode
  trailing?: ReactNode
}

/** Multi-photo AI appliance / systems assessment for Smart Inspection Report. */
export function ApplianceInspectionUploader({
  building,
  leading,
  trailing,
}: ApplianceInspectionUploaderProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [assessmentId, setAssessmentId] = useState<string | null>(null)
  const [photos, setPhotos] = useState<InspectionPhotoRow[]>([])
  const [assets, setAssets] = useState<InspectionAssetSummary[]>([])
  const [assetPreviewById, setAssetPreviewById] = useState<Record<string, string>>({})
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [assetCheckedIds, setAssetCheckedIds] = useState<string[]>([])
  const [editingAssetIds, setEditingAssetIds] = useState<string[]>([])
  const [assetDrafts, setAssetDrafts] = useState<Record<string, ApplianceVisionResult>>({})
  const [savingAssetEdits, setSavingAssetEdits] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [phoneCaptureOpen, setPhoneCaptureOpen] = useState(false)
  const previewByIdRef = useRef<Record<string, string>>({})
  const removedIdsRef = useRef(new Set<string>())
  const inflightRef = useRef(0)

  const refreshAssets = useCallback(async () => {
    if (!building) return
    try {
      const rows = await listInspectionAssets(building)
      setAssets(rows)
      const paths = rows
        .map((row) => {
          const path = row.metadata?.sourcePhotoUrl
          return typeof path === 'string' ? path : ''
        })
        .filter((path) => path && !path.startsWith('http'))
      const urls = await signInspectionUploadUrls(paths)
      const next: Record<string, string> = {}
      for (const row of rows) {
        const path = row.metadata?.sourcePhotoUrl
        if (typeof path !== 'string' || !path) continue
        if (path.startsWith('http')) next[row.id] = path
        else {
          const signed = urls.get(path)
          if (signed) next[row.id] = signed
        }
      }
      setAssetPreviewById(next)
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
        const session = await loadBuildingInspectionSession(building)
        if (cancelled) return
        setAssessmentId(session.id)
        setPhotos(inspectionPhotosForDisplay(building, session.photos, isHiddenInspectionPhoto))
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

  useEffect(() => {
    if (!building) return
    function onSessionChanged(event: Event) {
      const detail = (event as CustomEvent<{ building?: string }>).detail
      if (detail?.building && detail.building !== building) return
      void loadBuildingInspectionSession(building)
        .then((session) => {
          setAssessmentId(session.id)
          setPhotos(inspectionPhotosForDisplay(building, session.photos, isHiddenInspectionPhoto))
        })
        .catch(() => {
          /* keep current session */
        })
      void refreshAssets()
    }
    window.addEventListener(INSPECTION_SESSION_CHANGED_EVENT, onSessionChanged)
    return () => window.removeEventListener(INSPECTION_SESSION_CHANGED_EVENT, onSessionChanged)
  }, [building, refreshAssets])

  async function processQueue(jobs: LocalJob[], sessionId: string) {
    inflightRef.current += 1
    setBusy(true)
    setError(null)
    setSuccess(null)
    let index = 0
    let persistedCount = 0
    let persistedDocuments = 0
    let failedCount = 0

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
            blob: compressed.blob,
            imageBase64: compressed.base64 || undefined,
            contentType: compressed.contentType,
            fileName: compressed.fileName,
            hintCategory: job.hintCategory,
            mode: job.mode,
            previewUrl: job.previewUrl,
          })
          if (
            removedIdsRef.current.has(optimisticId) ||
            removedIdsRef.current.has(uploaded.id)
          ) {
            if (!uploaded.id.startsWith('local-')) {
              try {
                await removeInspectionPhoto(uploaded.id)
              } catch {
                // already gone
              }
            }
            continue
          }
          const persisted =
            Boolean(uploaded.id) &&
            !uploaded.id.startsWith('local-') &&
            uploaded.status !== 'error'
          if (persisted) {
            persistedCount += 1
            if (job.mode === 'document') persistedDocuments += 1
          } else {
            failedCount += 1
          }
          setPhotos((prev) => {
            const next = prev.map((p) =>
              p.id === optimisticId ? { ...uploaded, previewUrl: job.previewUrl } : p,
            )
            if (next.some((p) => p.id === uploaded.id)) return next
            return [...prev.filter((p) => p.id !== optimisticId), { ...uploaded, previewUrl: job.previewUrl }]
          })
          if (uploaded.id) previewByIdRef.current[uploaded.id] = job.previewUrl
          notifyInspectionSessionChanged(building)
          if (uploaded.status === 'confirmed' || job.mode === 'document') {
            notifyAssetRegistryChanged(building)
            await refreshAssets()
          }
        } catch (err) {
          if (removedIdsRef.current.has(optimisticId)) continue
          failedCount += 1
          const message = getErrorMessage(err, 'Upload failed')
          if (job.mode === 'document') {
            setError(message)
            setPhotos((prev) => prev.filter((p) => p.id !== optimisticId))
            continue
          }
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
    try {
      const session = await loadBuildingInspectionSession(building)
      setAssessmentId(session.id)
      setPhotos((prev) => {
        const localOnly = prev.filter(
          (p) => p.id.startsWith('local-') && (p.status === 'queued' || p.status === 'analyzing' || p.status === 'error'),
        )
        return [
          ...inspectionPhotosForDisplay(building, session.photos, isHiddenInspectionPhoto),
          ...localOnly,
        ]
      })
      await refreshAssets()
    } catch {
      // keep in-memory rows; failed uploads stay retryable
    }
    if (persistedCount > 0 && failedCount === 0) {
      const appliances = persistedCount - persistedDocuments
      if (appliances > 0 && persistedDocuments === 0) {
        setSuccess(appliances === 1 ? 'Appliance saved' : `${appliances} appliances saved`)
      } else if (persistedDocuments > 0 && appliances === 0) {
        setSuccess(
          persistedDocuments === 1 ? 'Inspection report saved' : `${persistedDocuments} inspection reports saved`,
        )
      } else {
        setSuccess('Saved')
      }
    } else if (persistedCount > 0 && failedCount > 0) {
      setError('Some photos could not be saved. Retry the ones marked Error.')
    }
    inflightRef.current -= 1
    if (inflightRef.current <= 0) {
      inflightRef.current = 0
      setBusy(false)
    }
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length || !assessmentId) return
    const remaining =
      MAX_FILES -
      photos.filter((photo) => photo.assessmentId === assessmentId || photo.id.startsWith('local-'))
        .length
    if (remaining <= 0) {
      setError('Maximum 20 files per session.')
      return
    }

    const jobs: LocalJob[] = []
    for (const file of Array.from(fileList).slice(0, remaining)) {
      if (file.size > MAX_BYTES) {
        setError(`${file.name} is larger than 25MB.`)
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
    inputRef.current?.click()
  }

  async function mergeCapturePhotos(capturePhotos: InspectionCapturePhoto[]) {
    if (!assessmentId) return
    for (const photo of capturePhotos) {
      if (photo.inspectionPhotoId && photo.previewUrl) {
        previewByIdRef.current[photo.inspectionPhotoId] = photo.previewUrl
      }
    }
    try {
      const session = await loadBuildingInspectionSession(building)
      setAssessmentId(session.id)
      setPhotos((prev) => {
        for (const p of prev) {
          if (p.previewUrl && !p.id.startsWith('local-')) {
            previewByIdRef.current[p.id] = p.previewUrl
          }
        }
        const localOnly = prev.filter((p) => p.id.startsWith('local-'))
        const merged = session.photos
          .filter((p) => !removedIdsRef.current.has(p.id))
          .map((p) => ({
            ...p,
            previewUrl: previewByIdRef.current[p.id] ?? p.previewUrl ?? null,
          }))
        return [
          ...inspectionPhotosForDisplay(building, merged, isHiddenInspectionPhoto),
          ...localOnly,
        ]
      })
      await refreshAssets()
    } catch {
      // polling / realtime retry
    }
  }

  async function onRemove(photo: InspectionPhotoRow) {
    removedIdsRef.current.add(photo.id)
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
    setAssets((prev) =>
      prev.filter((asset) => {
        if (photo.unitAssetId && asset.id === photo.unitAssetId) return false
        return asset.metadata?.photoId !== photo.id
      }),
    )
    if (photo.id.startsWith('local-')) {
      hideInspectionItems(building, {
        photoIds: [photo.id],
        assetIds: photo.unitAssetId ? [photo.unitAssetId] : [],
      })
      if (photo.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(photo.previewUrl)
      return
    }
    try {
      await removeInspectionPhoto(photo.id)
      notifyInspectionSessionChanged(building)
      if (photo.unitAssetId) {
        try {
          await removeInspectionAsset(photo.unitAssetId)
        } catch {
          // hosted function may not support remove_asset yet
        }
      }
      hideInspectionItems(building, {
        photoIds: [photo.id],
        assetIds: photo.unitAssetId ? [photo.unitAssetId] : [],
      })
      if (photo.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(photo.previewUrl)
      delete previewByIdRef.current[photo.id]
    } catch (err) {
      removedIdsRef.current.delete(photo.id)
      setPhotos((prev) => (prev.some((p) => p.id === photo.id) ? prev : [...prev, photo]))
      setError(getErrorMessage(err, 'Could not remove that photo.'))
    }
  }

  async function onRetry(photo: InspectionPhotoRow) {
    if (photo.id.startsWith('local-')) return
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === photo.id ? { ...p, status: 'analyzing', errorMessage: null } : p,
      ),
    )
    setError(null)
    setSuccess(null)
    try {
      const updated = await retryInspectionPhoto(photo.id)
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id ? { ...updated, previewUrl: p.previewUrl } : p,
        ),
      )
      if (updated.id && !updated.id.startsWith('local-') && updated.status !== 'error') {
        setSuccess('Appliance saved')
        notifyInspectionSessionChanged(building)
      }
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
      const confirmed = await confirmInspectionPhoto({ photoId, result })
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId
            ? {
                ...p,
                status: 'confirmed',
                confirmedResult: result,
                aiResult: result,
                unitAssetId: confirmed.unitAssetId ?? p.unitAssetId,
              }
            : p,
        ),
      )
      setSuccess('Appliance saved')
      notifyAssetRegistryChanged(building)
      await refreshAssets()
    } finally {
      setConfirmingId(null)
    }
  }

  async function onDeletePhotos(photoIds: string[]) {
    setDeleting(true)
    setError(null)
    try {
      for (const id of photoIds) {
        const photo = photos.find((row) => row.id === id)
        if (photo) {
          await onRemove(photo)
          continue
        }
        removedIdsRef.current.add(id)
        setPhotos((prev) => prev.filter((row) => row.id !== id))
        if (!id.startsWith('local-')) {
          await removeInspectionPhoto(id)
        }
      }
      await refreshAssets()
    } finally {
      setDeleting(false)
    }
  }

  async function onSaveAssetEdits() {
    if (editingAssetIds.length === 0) return
    setSavingAssetEdits(true)
    setError(null)
    try {
      for (const id of editingAssetIds) {
        const asset = assets.find((row) => row.id === id)
        const result = assetDrafts[id] ?? (asset ? visionResultFromSavedInspectionAsset(asset) : null)
        if (!result) continue
        await updateInspectionAssetDetails({ assetId: id, result })
      }
      setEditingAssetIds([])
      setAssetCheckedIds([])
      setSuccess('Appliance saved')
      notifyAssetRegistryChanged(building)
      await refreshAssets()
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save the selected asset details.'))
    } finally {
      setSavingAssetEdits(false)
    }
  }

  async function onDeleteSavedAssets(assetIds: string[]) {
    setDeleting(true)
    setError(null)
    try {
      for (const id of assetIds) {
        const asset = assets.find((row) => row.id === id)
        const photoId =
          typeof asset?.metadata?.photoId === 'string' ? asset.metadata.photoId : null
        if (photoId) {
          const photo = photos.find((row) => row.id === photoId)
          if (photo) await onRemove(photo)
          else {
            removedIdsRef.current.add(photoId)
            try {
              await removeInspectionPhoto(photoId)
            } catch {
              // photo may already be gone
            }
          }
        }
        try {
          await removeInspectionAsset(id)
        } catch {
          // hosted function may not support remove_asset yet
        }
        setAssets((prev) => prev.filter((row) => row.id !== id))
        setAssetCheckedIds((prev) => prev.filter((rowId) => rowId !== id))
      }
      await refreshAssets()
    } finally {
      setDeleting(false)
    }
  }

  const reviewPhotos = photos.filter((p) => p.status !== 'error')

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

  const hasFollowUp =
    photos.length > 0 ||
    reviewPhotos.length > 0 ||
    safetyAssets.length > 0 ||
    assets.length > 0

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch [&>*]:min-w-0">
        {leading}
        <div className="flex h-full min-h-[220px] min-w-0 flex-col">
      <div
        className={[
          'sa-dropzone flex h-full min-h-[220px] flex-1 flex-col rounded-[10px] border border-dashed bg-[#f8fafc] p-px',
          dragging ? 'is-dragging' : 'border-[#cbd5e1]',
        ].join(' ')}
        data-dragging={dragging ? 'true' : 'false'}
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
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
          {error ? <p className="text-[12px] text-[#b91c1c]">{error}</p> : null}
          {success ? <p className="text-[12px] text-[#059669]">{success}</p> : null}
          <ScanEquipmentIcon />
          <p className="text-[14px] font-semibold text-[#0d0f11]">
            Scan property equipment ✨
          </p>
          <p className="text-[12px] text-[#64748b]">
            Take or upload photos and let AI identify appliances and home systems.
          </p>
          <p className="text-[12px] text-[#64748b]">
            Appliances · HVAC · Water heater · Roof
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
            disabled={!assessmentId}
            onClick={openInspectionChooser}
            className="mt-1 flex size-10 items-center justify-center rounded-[10px] bg-transparent text-[#186179] outline-none hover:text-[#0f4a5c] focus-visible:ring-2 focus-visible:ring-[#186179] disabled:text-[#94a3b8]"
            aria-label={busy ? 'Analyzing photos' : 'Scan property equipment'}
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-6" aria-hidden>
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
        </div>
      </div>

      {hasFollowUp ? (
      <div className="min-w-0 w-full">
      {photos.length > 0 ? (
        <>
      {photos.some((photo) => photo.status === 'error') ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos
            .filter((photo) => photo.status === 'error')
            .map((photo) => (
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
                <button
                  type="button"
                  onClick={() => void onRemove(photo)}
                  className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-[#0d0f11]/70 text-white outline-none hover:bg-[#0d0f11] focus-visible:ring-2 focus-visible:ring-white"
                  aria-label={`Remove ${photo.fileName || 'photo'}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" className="size-3.5" aria-hidden>
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
              <div className="space-y-2 p-3">
                <p className="truncate text-[12px] font-medium text-[#0f172a]">
                  {photo.fileName || 'Photo'}
                </p>
                {photo.errorMessage ? (
                  <p className="text-[11px] text-[#b91c1c]">{photo.errorMessage}</p>
                ) : null}
                {!photo.id.startsWith('local-') ? (
                  <button
                    type="button"
                    onClick={() => void onRetry(photo)}
                    className="pd-btn pd-btn-ghost rounded px-1 py-0.5 text-[12px] font-semibold"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
        </>
      ) : null}

      {reviewPhotos.length > 0 ? (
        <div className="mt-1 w-full">
          <ApplianceAssessmentReviewCard
            photos={reviewPhotos}
            confirming={Boolean(confirmingId)}
            deleting={deleting}
            onConfirm={onConfirm}
            onDeletePhotos={onDeletePhotos}
          />
        </div>
      ) : assets.length > 0 ? (
        <div className="mt-1 w-full">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[13px] font-semibold text-[#0f172a]">Assets from inspection</p>
            {assetCheckedIds.length > 0 || deleting || savingAssetEdits || editingAssetIds.length > 0 ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {assetCheckedIds.length > 0 ? (
                  <button
                    type="button"
                    disabled={deleting || savingAssetEdits}
                    onClick={() => {
                      setAssetDrafts((prev) => {
                        const next = { ...prev }
                        for (const id of assetCheckedIds) {
                          if (next[id]) continue
                          const asset = assets.find((row) => row.id === id)
                          if (asset) next[id] = visionResultFromSavedInspectionAsset(asset)
                        }
                        return next
                      })
                      setEditingAssetIds((prev) => [...new Set([...prev, ...assetCheckedIds])])
                    }}
                    className="pd-btn pd-btn-ghost rounded-[10px] px-4 py-2.5 text-[13px] font-semibold text-[#186179] hover:bg-[#eff6ff] disabled:text-[#94a3b8]"
                  >
                    Edit selected ({assetCheckedIds.length})
                  </button>
                ) : null}
                {editingAssetIds.length > 0 ? (
                  <button
                    type="button"
                    disabled={deleting || savingAssetEdits}
                    onClick={() => void onSaveAssetEdits()}
                    className="pd-btn pd-btn-primary rounded-[10px] px-4 py-2.5 text-[13px] font-semibold disabled:text-[#94a3b8]"
                  >
                    {savingAssetEdits ? 'Saving…' : 'Save edits'}
                  </button>
                ) : null}
                {assetCheckedIds.length > 0 || deleting ? (
                  <button
                    type="button"
                    disabled={deleting || savingAssetEdits}
                    onClick={() => void onDeleteSavedAssets(assetCheckedIds)}
                    className="pd-btn pd-btn-ghost rounded-[10px] px-4 py-2.5 text-[13px] font-semibold text-[#a03e3e] hover:bg-[#fef2f2] hover:text-[#991b1b] disabled:text-[#94a3b8]"
                  >
                    {deleting ? 'Deleting…' : `Delete selected (${assetCheckedIds.length})`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <InspectionAssessmentTable
            checkedIds={assetCheckedIds}
            onCheckedIdsChange={setAssetCheckedIds}
            onChangeRow={(id, result) => {
              setAssetDrafts((prev) => ({ ...prev, [id]: result }))
            }}
            rows={assets.map((asset) => ({
              id: asset.id,
              result: assetDrafts[asset.id] ?? visionResultFromSavedInspectionAsset(asset),
              previewUrl: assetPreviewById[asset.id] ?? null,
              editable: editingAssetIds.includes(asset.id),
            }))}
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

      </div>
      ) : null}

      {trailing}
    </div>
  )
}

export default ApplianceInspectionUploader
