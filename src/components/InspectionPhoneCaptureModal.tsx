import { useCallback, useEffect, useRef, useState } from 'react'
import {
  completeInspectionCaptureSession,
  createInspectionCaptureSession,
  listInspectionCapturePhotos,
  type InspectionCapturePhoto,
  type InspectionCaptureSession,
} from '@/api/inspectionCapture'
import { InspectionCaptureQr } from '@/components/InspectionCaptureQr'
import { getErrorMessage } from '@/lib/errorMessage'
import { inspectionCaptureDesktopStatusLabel } from '@/lib/inspectionCaptureStatus'
import { supabase } from '@/lib/supabase'
import { uloAppUrl } from '@/lib/uloAppUrl'

type InspectionPhoneCaptureModalProps = {
  assessmentId: string
  onClose: () => void
  onPhotosSynced: (photos: InspectionCapturePhoto[]) => void
}

export function InspectionPhoneCaptureModal({
  assessmentId,
  onClose,
  onPhotosSynced,
}: InspectionPhoneCaptureModalProps) {
  const [session, setSession] = useState<InspectionCaptureSession | null>(null)
  const [token, setToken] = useState('')
  const [photos, setPhotos] = useState<InspectionCapturePhoto[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [ending, setEnding] = useState(false)

  const onPhotosSyncedRef = useRef(onPhotosSynced)
  onPhotosSyncedRef.current = onPhotosSynced

  const refresh = useCallback(async (sessionId: string) => {
    const listed = await listInspectionCapturePhotos(sessionId)
    setSession(listed.session)
    setPhotos(listed.photos)
    onPhotosSyncedRef.current(listed.photos)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const created = await createInspectionCaptureSession(assessmentId)
        if (cancelled) return
        setSession(created.session)
        setToken(created.token)
        await refresh(created.session.id)
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, 'Could not start phone capture.'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [assessmentId, refresh])

  useEffect(() => {
    if (!session?.id || !supabase) return
    const sessionId = session.id
    const assessmentFilter = session.assessmentId
    let channel = supabase
      .channel(`inspection-capture-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inspection_capture_photos',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          void refresh(sessionId)
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inspection_capture_sessions',
          filter: `id=eq.${sessionId}`,
        },
        () => {
          void refresh(sessionId)
        },
      )
    if (assessmentFilter) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'property_inspection_photos',
          filter: `assessment_id=eq.${assessmentFilter}`,
        },
        () => {
          void refresh(sessionId)
        },
      )
    }
    channel.subscribe()
    const poll = window.setInterval(() => {
      void refresh(sessionId)
    }, 3000)
    return () => {
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [session?.id, session?.assessmentId, refresh])

  const captureUrl = session && token ? uloAppUrl.inspectionCapture(session.id, token) : ''
  const status = inspectionCaptureDesktopStatusLabel(session?.status ?? 'waiting', photos.length)

  async function onCopy() {
    if (!captureUrl) return
    try {
      await navigator.clipboard.writeText(captureUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy the link. Select it from the address after opening it.')
    }
  }

  async function onEnd() {
    if (!session) {
      onClose()
      return
    }
    setEnding(true)
    try {
      await completeInspectionCaptureSession(session.id)
    } catch {
      // still close
    } finally {
      setEnding(false)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d0f11]/40 p-4">
      <div
        role="dialog"
        aria-labelledby="inspection-phone-capture-title"
        className="w-full max-w-[440px] rounded-[14px] bg-white p-5 shadow-xl"
      >
        <h2 id="inspection-phone-capture-title" className="text-[16px] font-semibold text-[#0d0f11]">
          Scan with your phone
        </h2>
        <p className="mt-1 text-[13px] text-[#64748b]">
          Photos you take will appear here automatically.
        </p>

        {error ? <p className="mt-3 text-[12px] text-[#b91c1c]">{error}</p> : null}

        <div className="mt-4 flex justify-center">
          {captureUrl ? (
            <InspectionCaptureQr url={captureUrl} />
          ) : (
            <div className="flex size-[240px] items-center justify-center rounded-[10px] bg-[#f8fafc] text-[12px] text-[#64748b]">
              Preparing link…
            </div>
          )}
        </div>

        <div className="mt-4 rounded-[10px] bg-[#f8fafc] px-3 py-2">
          <p className="text-[13px] font-semibold text-[#0d0f11]">{status.headline}</p>
          <p className="text-[12px] text-[#64748b]">{status.detail}</p>
        </div>

        {photos.length > 0 ? (
          <ul className="mt-3 grid grid-cols-4 gap-2">
            {photos.map((photo) => (
              <li key={photo.id} className="overflow-hidden rounded-[8px] bg-[#f1f5f9]">
                {photo.previewUrl ? (
                  <img src={photo.previewUrl} alt="" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="aspect-square" />
                )}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="pd-btn pd-btn-ghost text-[13px] font-semibold"
            onClick={() => void onCopy()}
            disabled={!captureUrl}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button
            type="button"
            className="pd-btn pd-btn-primary rounded-[10px] px-3 py-1.5 text-[13px] font-semibold"
            onClick={() => void onEnd()}
            disabled={ending}
          >
            End session
          </button>
        </div>
      </div>
    </div>
  )
}
