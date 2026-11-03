import { getActiveLandlordId } from '@/lib/activeLandlord'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import homeCheckInspectionArt from '@/assets/Technician against orchid coral backdrop.png'
import waterHeaterLabelExample from '@/assets/water-heater-label-example.jpg'
import wholeWaterHeaterExample from '@/assets/whole-water-heater-example.png'
import heatingSystemLabelExample from '@/assets/heating-system-label-example.png'
import wholeHeatingSystemExample from '@/assets/whole-heating-system-example.jpg'
import {
  listInspectionAssets,
  loadBuildingInspectionSession,
  signInspectionUploadUrls,
  removeInspectionAsset,
  removeInspectionPhoto,
  retryInspectionPhoto,
  uploadAndAnalyzeInspectionPhoto,
  type InspectionAssetSummary,
} from '@/api/inspectionAssetAssess'
import { HomeCheckPanel } from '@/components/HomeCheckPanel'
import { HomeCheckRequestModal } from '@/components/HomeCheckRequestModal'
import { InspectionCaptureChooser } from '@/components/InspectionCaptureChooser'
import { InspectionPhoneCaptureModal } from '@/components/InspectionPhoneCaptureModal'
import type { InspectionCapturePhoto } from '@/api/inspectionCapture'
import { notifyAssetRegistryChanged } from '@/lib/assetRegistry'
import {
  partitionPropertyIntelligenceFiles,
  savePropertyIntelligencePhotos,
} from '@/lib/propertyIntelligenceUpload'
import { prepareInspectionDocumentUpload } from '@/lib/prepareInspectionDocumentUpload'
import { getErrorMessage } from '@/lib/errorMessage'
import { visionResultFromSavedInspectionAsset } from '@/lib/inspectionAssessmentTable'
import {
  hideInspectionItems,
  isHiddenInspectionPhoto,
} from '@/lib/inspectionHiddenItems'
import {
  INSPECTION_SESSION_CHANGED_EVENT,
  inspectionPhotosForDisplay,
  isInspectionReportPhoto,
  notifyInspectionSessionChanged,
} from '@/lib/inspectionSession'
import type {
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
  nameplateFile?: File
}

type ApplianceInspectionUploaderProps = {
  building: string
  propertyId?: string | null
  leading?: ReactNode
  trailing?: ReactNode
}

/** Multi-photo AI appliance / systems assessment for Smart Inspection Report. */
export function ApplianceInspectionUploader(props: ApplianceInspectionUploaderProps) {
  return <ScopedApplianceInspectionUploader key={`${getActiveLandlordId()}:${props.propertyId || props.building}`} {...props} />
}

function ScopedApplianceInspectionUploader({
  building,
  propertyId,
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
  const [assetCheckedIds, setAssetCheckedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [waterHeaterLabelExampleOpen, setWaterHeaterLabelExampleOpen] = useState(false)
  const [wholeWaterHeaterExampleOpen, setWholeWaterHeaterExampleOpen] = useState(false)
  const [heatingSystemLabelExampleOpen, setHeatingSystemLabelExampleOpen] = useState(false)
  const [wholeHeatingSystemExampleOpen, setWholeHeatingSystemExampleOpen] = useState(false)
  const [phoneCaptureOpen, setPhoneCaptureOpen] = useState(false)
  const [homeCheckRequestOpen, setHomeCheckRequestOpen] = useState(false)
  const [equipmentInstructionsOpen, setEquipmentInstructionsOpen] = useState(false)
  const [homeCheckRequestNote, setHomeCheckRequestNote] = useState<string | null>(null)
  const previewByIdRef = useRef<Record<string, string>>({})
  const removedIdsRef = useRef(new Set<string>())
  const inflightRef = useRef(0)

  const refreshAssets = useCallback(async () => {
    if (!building) return
    try {
      const rows = (await listInspectionAssets(building)).filter((asset) => !asset.metadata?.homeCheck)
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
        setPhotos(inspectionPhotosForDisplay(building, session.photos.filter((photo) => !photo.homeCheckId), isHiddenInspectionPhoto))
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
          setPhotos(inspectionPhotosForDisplay(building, session.photos.filter((photo) => !photo.homeCheckId), isHiddenInspectionPhoto))
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
          const compressed = await prepareInspectionDocumentUpload(job.file)
          const nameplate = job.nameplateFile
            ? await prepareInspectionDocumentUpload(job.nameplateFile)
            : null
          const uploaded = await uploadAndAnalyzeInspectionPhoto({
            assessmentId: sessionId,
            blob: compressed.blob,
            imageBase64: compressed.base64 || undefined,
            contentType: compressed.contentType,
            fileName: compressed.fileName,
            hintCategory: job.hintCategory,
            mode: job.mode,
            previewUrl: job.previewUrl,
            pageImages: compressed.pageImages,
            pageTexts: compressed.pageTexts,
            nameplateBase64: nameplate?.base64 || undefined,
            nameplateContentType: nameplate?.contentType,
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
          ...inspectionPhotosForDisplay(building, session.photos.filter((photo) => !photo.homeCheckId), isHiddenInspectionPhoto),
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

    const selected = Array.from(fileList).slice(0, remaining)
    const { reports, photos: equipmentPhotos, rejected } = partitionPropertyIntelligenceFiles(
      selected,
      MAX_BYTES,
    )
    if (rejected.length) setError(rejected[0] ?? 'Use JPG, PNG, WEBP, HEIC, or PDF.')
    if (equipmentPhotos.length && !propertyId) {
      setError('Choose a property before uploading equipment photos.')
    } else if (equipmentPhotos.length && propertyId) {
      setBusy(true)
      setError(null)
      setSuccess(null)
      try {
        const saved = await savePropertyIntelligencePhotos(propertyId, equipmentPhotos)
        setSuccess(saved === 1 ? 'Equipment photo saved' : `${saved} equipment photos saved`)
      } catch (err) {
        setError(getErrorMessage(err, 'Could not analyze that equipment photo.'))
      } finally {
        setBusy(false)
      }
    }
    const jobs: LocalJob[] = reports.map((file) => ({
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      previewUrl: '',
      hintCategory: null,
      mode: 'document' as const,
    }))
    if (jobs.length) await processQueue(jobs, assessmentId)
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
        const merged = session.photos.filter((photo) => !photo.homeCheckId)
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

  const equipmentPhotos = photos.filter((photo) => !isInspectionReportPhoto(photo))

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
    equipmentPhotos.some((photo) => photo.status === 'error') || safetyAssets.length > 0
  const equipmentRows = assets.map((asset) => ({
    id: asset.id,
    result: visionResultFromSavedInspectionAsset(asset),
    previewUrl: assetPreviewById[asset.id] ?? null,
    editable: false,
  }))
  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <section
        className="flex items-center justify-between gap-6 rounded-[10px] border border-[#e5e7eb] px-5 py-4"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(224, 242, 239, 0.6) 0%, rgba(224, 242, 239, 0) 100%)',
        }}
      >
        <div className="flex min-w-0 flex-col items-start gap-2">
          <h3 className="text-[18px] font-semibold leading-6 text-[#0d0f11]">Request home check</h3>
          <p className="max-w-[420px] text-[13px] leading-5 text-[#64748b]">
            Have a trusted professional capture your water heating system, and appliance details for you.
          </p>
          <button
            type="button"
            disabled={!propertyId}
            onClick={() => {
              setHomeCheckRequestNote(null)
              setHomeCheckRequestOpen(true)
            }}
            className="pd-btn pd-btn-primary mt-1 rounded-[10px] px-4 py-2.5 text-[13px] font-semibold"
          >
            Request home check
          </button>
          {homeCheckRequestNote ? (
            <p className="text-[12px] leading-5 text-[#334155]">{homeCheckRequestNote}</p>
          ) : null}
        </div>
        <img
          src={homeCheckInspectionArt}
          alt=""
          className="h-[160px] w-[200px] shrink-0 object-contain"
        />
      </section>
      <h3 className="text-[18px] font-semibold leading-6 text-[#0d0f11]">Or add information yourself</h3>
      {propertyId ? (
        <HomeCheckRequestModal
          open={homeCheckRequestOpen}
          propertyId={propertyId}
          location={building}
          onClose={() => setHomeCheckRequestOpen(false)}
          onRequested={setHomeCheckRequestNote}
        />
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch [&>*]:min-w-0">
        {leading}
        <div className="flex h-full min-h-[220px] min-w-0 flex-col">
      <div
        className={[
          'sa-dropzone flex h-full min-h-[220px] flex-1 cursor-pointer flex-col rounded-[10px] border border-dashed bg-[#f8fafc] p-px',
          dragging ? 'is-dragging' : 'border-[#cbd5e1]',
        ].join(' ')}
        data-dragging={dragging ? 'true' : 'false'}
        role="button"
        tabIndex={assessmentId ? 0 : -1}
        onClick={() => {
          if (assessmentId) openInspectionChooser()
        }}
        onKeyDown={(e) => {
          if (!assessmentId) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openInspectionChooser()
          }
        }}
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
            Appliance equipment upload
          </p>
          <p className="text-[12px] text-[#64748b]">
            Connect your phone to upload two photos per appliance: one of the whole appliance and one close-up of the model and serial number label. Keep the label clear and avoid glare.
          </p>
          <p className="text-[12px] leading-[18px] text-[#64748b]">
            JPG
          </p>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => void onFilesSelected(e.target.files)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept={CAMERA_ACCEPT}
            capture="environment"
            className="sr-only"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => void onFilesSelected(e.target.files)}
          />
          <button
            type="button"
            disabled={!assessmentId}
            onClick={(e) => {
              e.stopPropagation()
              openInspectionChooser()
            }}
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

      <section className="rounded-[10px] border border-[#e2e8f0] bg-white">
        <button
          type="button"
          aria-expanded={equipmentInstructionsOpen}
          onClick={() => setEquipmentInstructionsOpen((open) => !open)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#186179]"
        >
          <span className="flex size-8 shrink-0 items-center justify-center text-[#186179]" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" className="size-5">
              {equipmentInstructionsOpen ? (
                <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
          </span>
          <span className="text-[14px] font-semibold text-[#0d0f11]">Add appliance equipment instructions.</span>
        </button>
        {equipmentInstructionsOpen ? (
          <div className="border-t border-[#e2e8f0] px-4 py-4 text-[13px] leading-5 text-[#334155]">
            <h3 className="text-[14px] font-semibold text-[#0d0f11]">Add equipment photos</h3>
            <p className="mt-2 text-[#64748b]">Upload these photos in this exact order:</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>
                <button
                  type="button"
                  aria-pressed={waterHeaterLabelExampleOpen}
                  onClick={() => setWaterHeaterLabelExampleOpen((open) => !open)}
                  className={[
                    'font-semibold text-[#0d0f11] underline decoration-[#186179] underline-offset-2',
                    waterHeaterLabelExampleOpen ? 'text-[#186179]' : '',
                  ].join(' ')}
                >
                  Water heater label:
                </button>{' '}
                A clear close-up showing the model and serial number. Avoid glare.
                {waterHeaterLabelExampleOpen ? (
                  <figure className="mt-3 max-w-xl">
                    <img
                      src={waterHeaterLabelExample}
                      alt="Example of a water heater label"
                      className="w-full rounded-[10px] border border-[#e2e8f0] object-contain"
                    />
                    <figcaption className="mt-2 text-[13px] leading-5 text-[#64748b]">
                      Here is an example of a water heater label.
                    </figcaption>
                  </figure>
                ) : null}
              </li>
              <li>
                <button
                  type="button"
                  aria-pressed={wholeWaterHeaterExampleOpen}
                  onClick={() => setWholeWaterHeaterExampleOpen((open) => !open)}
                  className={[
                    'font-semibold text-[#0d0f11] underline decoration-[#186179] underline-offset-2',
                    wholeWaterHeaterExampleOpen ? 'text-[#186179]' : '',
                  ].join(' ')}
                >
                  Whole water heater:
                </button>{' '}
                Include the entire unit and its base.
                {wholeWaterHeaterExampleOpen ? (
                  <figure className="mt-3 max-w-xl">
                    <img
                      src={wholeWaterHeaterExample}
                      alt="Example of a whole water heater"
                      className="w-full rounded-[10px] border border-[#e2e8f0] object-contain"
                    />
                    <figcaption className="mt-2 text-[13px] leading-5 text-[#64748b]">
                      Here is an example of a whole water heater.
                    </figcaption>
                  </figure>
                ) : null}
              </li>
              <li>
                <button
                  type="button"
                  aria-pressed={heatingSystemLabelExampleOpen}
                  onClick={() => setHeatingSystemLabelExampleOpen((open) => !open)}
                  className={[
                    'font-semibold text-[#0d0f11] underline decoration-[#186179] underline-offset-2',
                    heatingSystemLabelExampleOpen ? 'text-[#186179]' : '',
                  ].join(' ')}
                >
                  Heating system label:
                </button>{' '}
                A clear close-up of the furnace or boiler&apos;s model and serial number.
                {heatingSystemLabelExampleOpen ? (
                  <figure className="mt-3 max-w-xl">
                    <img
                      src={heatingSystemLabelExample}
                      alt="Example of a heating system label"
                      className="w-full rounded-[10px] border border-[#e2e8f0] object-contain"
                    />
                    <figcaption className="mt-2 text-[13px] leading-5 text-[#64748b]">
                      Here is an example of a heating system label.
                    </figcaption>
                  </figure>
                ) : null}
              </li>
              <li>
                <button
                  type="button"
                  aria-pressed={wholeHeatingSystemExampleOpen}
                  onClick={() => setWholeHeatingSystemExampleOpen((open) => !open)}
                  className={[
                    'font-semibold text-[#0d0f11] underline decoration-[#186179] underline-offset-2',
                    wholeHeatingSystemExampleOpen ? 'text-[#186179]' : '',
                  ].join(' ')}
                >
                  Whole heating system:
                </button>{' '}
                Step back to capture the entire unit.
                {wholeHeatingSystemExampleOpen ? (
                  <figure className="mt-3 max-w-xl">
                    <img
                      src={wholeHeatingSystemExample}
                      alt="Example of a whole heating system"
                      className="w-full rounded-[10px] border border-[#e2e8f0] object-contain"
                    />
                    <figcaption className="mt-2 text-[13px] leading-5 text-[#64748b]">
                      Here is an example of a whole heating system.
                    </figcaption>
                  </figure>
                ) : null}
              </li>
            </ol>
            <p className="mt-3">
              <span className="font-semibold text-[#0d0f11]">File requirements:</span>{' '}
              JPG, PNG, WEBP, or HEIC, under 25 MB per photo. PDFs are processed as inspection reports, not equipment photos.
            </p>
          </div>
        ) : null}
      </section>

      <HomeCheckPanel
        key={propertyId || building}
        building={building}
        propertyId={propertyId}
        equipmentRows={equipmentRows}
        equipmentCheckedIds={assetCheckedIds}
        onEquipmentCheckedIdsChange={setAssetCheckedIds}
      />

      {hasFollowUp ? (
      <div className="min-w-0 w-full">
      {equipmentPhotos.some((photo) => photo.status === 'error') ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {equipmentPhotos
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
