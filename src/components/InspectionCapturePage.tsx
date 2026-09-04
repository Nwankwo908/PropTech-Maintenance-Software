import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  getInspectionCaptureSession,
  uploadInspectionCapturePhoto,
  type InspectionCaptureSession,
} from '@/api/inspectionCapture'
import { getErrorMessage } from '@/lib/errorMessage'
import { compressImageForVision } from '@/lib/imageCompress'

type Stage = 'loading' | 'ready' | 'review' | 'sending' | 'sent' | 'error'

export function InspectionCapturePage() {
  const { sessionId: sessionIdParam } = useParams<{ sessionId: string }>()
  const [params] = useSearchParams()
  const sessionId = sessionIdParam?.trim() ?? ''
  const token = params.get('token')?.trim() ?? ''

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const libraryRef = useRef<HTMLInputElement>(null)

  const [session, setSession] = useState<InspectionCaptureSession | null>(null)
  const [stage, setStage] = useState<Stage>('loading')
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [sentCount, setSentCount] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraReady(false)
  }, [])

  const startCamera = useCallback(async () => {
    stopCamera()
    if (!navigator.mediaDevices?.getUserMedia) {
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
        },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => undefined)
      }
      setCameraReady(true)
    } catch {
      setCameraReady(false)
    }
  }, [stopCamera])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!sessionId || !token) {
        setError('This capture link is invalid or has expired.')
        setStage('error')
        return
      }
      try {
        const next = await getInspectionCaptureSession({ sessionId, token })
        if (cancelled) return
        setSession(next)
        setSentCount(next.photoCount)
        setStage('ready')
      } catch (err) {
        if (cancelled) return
        setError(getErrorMessage(err, 'This capture link is invalid or has expired.'))
        setStage('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, token])

  useEffect(() => {
    if (stage !== 'ready') return
    void startCamera()
    return () => stopCamera()
  }, [stage, startCamera, stopCamera])

  useEffect(() => () => stopCamera(), [stopCamera])

  function setReviewFile(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const url = URL.createObjectURL(file)
    setPendingFile(file)
    setPreviewUrl(url)
    setStage('review')
    stopCamera()
  }

  function onTakePhoto() {
    const video = videoRef.current
    if (!video || video.videoWidth < 2) {
      libraryRef.current?.click()
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        setReviewFile(new File([blob], `inspection-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  }

  function onRetake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPendingFile(null)
    setStage('ready')
  }

  async function onKeep() {
    if (!pendingFile || !sessionId || !token) return
    setStage('sending')
    setError(null)
    try {
      const compressed = await compressImageForVision(pendingFile)
      const result = await uploadInspectionCapturePhoto({
        sessionId,
        token,
        imageBase64: compressed.base64,
        contentType: compressed.contentType,
        fileName: compressed.fileName,
      })
      setSentCount(result.photoCount)
      setStage('sent')
    } catch (err) {
      setError(getErrorMessage(err, 'Could not send this photo.'))
      setStage('review')
    }
  }

  function onTakeAnother() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPendingFile(null)
    setStage('ready')
  }

  const propertyTitle = session?.propertyName || 'Property inspection'
  const propertyAddress = session?.propertyAddress ?? ''

  return (
    <div className="min-h-dvh bg-[#f8fafc] text-[#0d0f11]">
      <header className="border-b border-[#e2e8f0] bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
          Property inspection
        </p>
        <h1 className="text-[18px] font-semibold">{propertyTitle}</h1>
        {propertyAddress ? (
          <p className="text-[13px] text-[#64748b]">{propertyAddress}</p>
        ) : null}
      </header>

      <main className="mx-auto max-w-md px-4 py-5">
        <p className="text-[14px] text-[#334155]">
          Take photos of appliances and home systems. They’ll appear automatically on your computer.
        </p>

        {error && stage !== 'error' ? (
          <p className="mt-3 text-[13px] text-[#b91c1c]">{error}</p>
        ) : null}

        {stage === 'loading' ? (
          <p className="mt-6 text-[13px] text-[#64748b]">Opening camera…</p>
        ) : null}

        {stage === 'error' ? (
          <p className="mt-6 text-[14px] text-[#b91c1c]">{error}</p>
        ) : null}

        {stage === 'ready' ? (
          <div className="mt-4 space-y-3">
            <div className="overflow-hidden rounded-[12px] bg-[#0d0f11]">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="aspect-[3/4] w-full object-cover"
              />
            </div>
            {!cameraReady ? (
              <p className="text-[12px] text-[#64748b]">
                Camera unavailable. You can still choose a photo from your library.
              </p>
            ) : null}
            <button
              type="button"
              className="pd-btn pd-btn-primary w-full rounded-[10px] py-3 text-[15px] font-semibold"
              onClick={onTakePhoto}
            >
              Take photo
            </button>
            <button
              type="button"
              className="pd-btn pd-btn-ghost w-full py-2 text-[14px] font-semibold"
              onClick={() => libraryRef.current?.click()}
            >
              Choose from library
            </button>
            <input
              ref={libraryRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) setReviewFile(file)
              }}
            />
          </div>
        ) : null}

        {stage === 'review' && previewUrl ? (
          <div className="mt-4 space-y-3">
            <img src={previewUrl} alt="" className="w-full rounded-[12px] object-cover" />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="pd-btn pd-btn-ghost rounded-[10px] py-3 text-[14px] font-semibold"
                onClick={onRetake}
              >
                Retake
              </button>
              <button
                type="button"
                className="pd-btn pd-btn-primary rounded-[10px] py-3 text-[14px] font-semibold"
                onClick={() => void onKeep()}
              >
                Keep photo
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'sending' ? (
          <p className="mt-6 text-[14px] font-medium text-[#186179]">Sending photo…</p>
        ) : null}

        {stage === 'sent' ? (
          <div className="mt-6 space-y-3">
            <p className="text-[16px] font-semibold">Photos sent</p>
            <p className="text-[14px] text-[#334155]">
              You can return to your computer to continue the inspection.
            </p>
            {sentCount > 0 ? (
              <p className="text-[12px] text-[#64748b]">
                {sentCount} photo{sentCount === 1 ? '' : 's'} in this session.
              </p>
            ) : null}
            <button
              type="button"
              className="pd-btn pd-btn-primary w-full rounded-[10px] py-3 text-[15px] font-semibold"
              onClick={onTakeAnother}
            >
              Take another
            </button>
          </div>
        ) : null}
      </main>
    </div>
  )
}

export default InspectionCapturePage
