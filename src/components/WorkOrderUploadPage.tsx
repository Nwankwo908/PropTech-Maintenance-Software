import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  completeJobWithPhotos,
  resolveCompletionJob,
  uploadCompletionPhotos,
  type CompletionJobContext,
} from '@/api/maintenanceCompletion'

/** Phase 4 / 4.4 — public before/after photo upload + complete at `/upload/:token`. */
export function WorkOrderUploadPage() {
  const { token } = useParams<{ token: string }>()
  const [ctx, setCtx] = useState<CompletionJobContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const t = token?.trim() ?? ''
  const back = t ? `/w/${encodeURIComponent(t)}` : '/vendor'

  useEffect(() => {
    let cancelled = false
    if (!t) {
      setError('This upload link is missing a token.')
      return
    }
    void (async () => {
      try {
        const job = await resolveCompletionJob(t)
        if (cancelled) return
        setCtx(job)
        if (job.alreadyCompleted) {
          setSuccess('This job is already marked complete.')
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load this job.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [t])

  useEffect(() => {
    const urls = pendingFiles.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => {
      for (const u of urls) URL.revokeObjectURL(u)
    }
  }, [pendingFiles])

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const list = e.target.files
    if (!list?.length) return
    const next = [...pendingFiles]
    for (const file of Array.from(list)) {
      if (!file.type.startsWith('image/')) continue
      if (next.length >= 12) break
      next.push(file)
    }
    setPendingFiles(next)
    e.target.value = ''
  }

  function removePending(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function onUpload() {
    if (!t || !pendingFiles.length) {
      setError('Choose at least one photo to upload.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await uploadCompletionPhotos(t, pendingFiles)
      setPendingFiles([])
      setSuccess(result.message)
      const job = await resolveCompletionJob(t)
      setCtx(job)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload photos.')
    } finally {
      setBusy(false)
    }
  }

  async function onComplete() {
    if (!t) return
    setBusy(true)
    setError(null)
    try {
      if (pendingFiles.length) {
        await uploadCompletionPhotos(t, pendingFiles)
        setPendingFiles([])
      }
      const result = await completeJobWithPhotos(t)
      setSuccess(result.message)
      const job = await resolveCompletionJob(t)
      setCtx(job)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete job.')
    } finally {
      setBusy(false)
    }
  }

  if (error && !ctx) {
    return (
      <Shell>
        <h1 className="text-[22px] font-semibold text-[#101828]">Couldn’t open upload</h1>
        <p className="mt-2 text-[14px] leading-6 text-[#475467]">{error}</p>
        <Link to={back} className="mt-6 inline-flex text-[14px] font-semibold text-[#186179] hover:underline">
          Back to job
        </Link>
      </Shell>
    )
  }

  if (!ctx) {
    return (
      <Shell>
        <p className="text-[14px] text-[#475467]">Loading…</p>
      </Shell>
    )
  }

  const done = ctx.alreadyCompleted

  return (
    <div className="min-h-dvh bg-[#f4f6f8] text-[#101828]">
      <header className="border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto max-w-lg px-4 py-4">
          <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#667085]">
            Photos &amp; completion
          </p>
          <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-semibold">
            {ctx.workOrderRef}
          </h1>
          <p className="mt-1 text-[14px] text-[#667085]">{ctx.unit || 'Unit'}</p>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 py-6 pb-16">
        {ctx.description ? (
          <section className="rounded-xl bg-white px-4 py-3 text-[13px] leading-5 text-[#475467]">
            {ctx.description}
          </section>
        ) : null}

        <div className="rounded-xl border border-[#d0d5dd] bg-white px-4 py-3 text-[13px] leading-5 text-[#475467]">
          Upload at least one before/after photo, then mark the job complete. The
          resident and property team get a completion notice with your photo count.
        </div>

        {success ? (
          <div className="rounded-xl border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-4 text-[14px] leading-6 text-[#065f46]">
            {success}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
            {error}
          </div>
        ) : null}

        {ctx.completionPhotoUrls.length > 0 ? (
          <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <p className="text-[13px] font-medium text-[#344054]">
              Uploaded ({ctx.completionPhotoCount})
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {ctx.completionPhotoUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg border border-[#e5e7eb]"
                >
                  <img src={url} alt="Completion" className="h-24 w-full object-cover" />
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {!done ? (
          <section className="space-y-3 rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <p className="text-[13px] font-medium text-[#344054]">Add photos</p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={onPick}
              disabled={busy}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="w-full rounded-[10px] border border-[#d0d5dd] px-4 py-2.5 text-[14px] font-semibold text-[#344054] hover:bg-[#f9fafb] disabled:opacity-50"
            >
              Choose photos
            </button>

            {previews.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {previews.map((url, i) => (
                  <div key={url} className="relative overflow-hidden rounded-lg border border-[#e5e7eb]">
                    <img src={url} alt="" className="h-24 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePending(i)}
                      className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <button
              type="button"
              disabled={busy || pendingFiles.length === 0}
              onClick={() => void onUpload()}
              className="w-full rounded-[10px] border border-[#186179] px-4 py-2.5 text-[14px] font-semibold text-[#186179] hover:bg-[#f0f7f9] disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Upload photos'}
            </button>

            <button
              type="button"
              disabled={busy || (ctx.completionPhotoCount < 1 && pendingFiles.length === 0)}
              onClick={() => void onComplete()}
              className="w-full rounded-[10px] bg-[#186179] px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-[#145066] disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Mark job complete'}
            </button>
          </section>
        ) : null}

        <Link
          to={back}
          className="inline-flex text-[14px] font-semibold text-[#186179] hover:underline"
        >
          Back to job details
        </Link>
      </main>
    </div>
  )
}

function Shell({ children }: { children: import('react').ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f4f6f8] px-4">
      <div className="w-full max-w-md text-center">{children}</div>
    </div>
  )
}
