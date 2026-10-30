import { useEffect, useState } from 'react'
import { homeCheckRequest, type HomeCheckList } from '@/api/homeCheck'
import { homeCheckPhotoObservations } from '@/lib/homeCheckPhotoReview'
import { HOME_CHECK_PHOTOS } from '@shared/homeCheck'

type Review = { id: string; property_id: string; property_label: string; detected_warning: string }
type ReviewPhoto = HomeCheckList['checks'][number]['photos'][number]
type Decision = 'looks_fine' | 'repair' | 'closer_photo'

function reviewPhotos(photos: ReviewPhoto[] | undefined): ReviewPhoto[] {
  const ready = (photos ?? []).filter((photo) => photo.previewUrl)
  const order = new Map<string, number>(HOME_CHECK_PHOTOS.map((photo, index) => [photo.slot, index]))
  return [...ready].sort((a, b) => (order.get(a.slot) ?? 99) - (order.get(b.slot) ?? 99))
}

/** Photo observations the landlord can accept, turn into a repair, or ask to retake. */
export function PmHomeCheckPhotoReviews({ propertyId, portfolio = false }: { propertyId?: string | null; portfolio?: boolean }) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [error, setError] = useState('')
  const [photos, setPhotos] = useState<Record<string, ReviewPhoto[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const [closerAsked, setCloserAsked] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let cancelled = false
    setReviews([])
    setPhotos({})
    setError('')
    if (!portfolio && !propertyId) return
    void homeCheckRequest<{ reviews?: Review[] }>({ action: 'photo_reviews', propertyId, portfolio })
      .then(async ({ reviews: loaded }) => {
        const rows = (Array.isArray(loaded) ? loaded : []).filter(row => row.detected_warning?.trim())
        if (cancelled) return
        setReviews(rows)
        try {
          const propertyIds = [...new Set(rows.map(row => row.property_id))]
          const next: Record<string, ReviewPhoto[]> = {}
          await Promise.all(propertyIds.map(async (id) => {
            const result = await homeCheckRequest<HomeCheckList>({ action: 'list', propertyId: id })
            const checks = Array.isArray(result.checks) ? result.checks : []
            for (const review of rows.filter(row => row.property_id === id)) {
              const check = checks.find(row => row.id === review.id)
              if (check) next[review.id] = check.photos
            }
          }))
          if (!cancelled) setPhotos(next)
        } catch {
          if (!cancelled) setError('Could not load these photos. Please try again.')
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load Home Check photo reviews. Refresh to try again.')
      })
    return () => { cancelled = true }
  }, [propertyId, portfolio])

  async function loadPhotos(review: Review) {
    setLoadingId(review.id)
    setError('')
    try {
      const result = await homeCheckRequest<HomeCheckList>({ action: 'list', propertyId: review.property_id })
      const check = (Array.isArray(result.checks) ? result.checks : []).find(row => row.id === review.id)
      if (!check) throw new Error('Check missing')
      setPhotos(previous => ({ ...previous, [review.id]: check.photos }))
    } catch {
      setError('Could not load these photos. Please try again.')
    } finally { setLoadingId(null) }
  }

  async function decide(review: Review, decision: Decision) {
    setActing(`${review.id}:${decision}`)
    setError('')
    try {
      await homeCheckRequest({ action: 'photo_review', id: review.id, decision })
      if (decision === 'closer_photo') {
        setCloserAsked(previous => ({ ...previous, [review.id]: true }))
      } else {
        setReviews(previous => previous.filter(row => row.id !== review.id))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That action did not go through. Please try again.')
    } finally { setActing(null) }
  }

  if (!reviews.length && !error) return null
  return <section className='rounded-[10px] border border-amber-200 bg-amber-50 p-4' aria-label='Home Check photo reviews'>
    <h3 className='text-sm font-semibold text-[#0a0a0a]'>Photo review needed</h3>
    {error && <p role='alert' className='mt-2 text-sm text-red-700'>{error}</p>}
    {reviews.map(review => {
      const lines = homeCheckPhotoObservations(review.detected_warning)
      const busy = acting?.startsWith(`${review.id}:`)
      const thumbs = reviewPhotos(photos[review.id])
      return <div key={review.id} className='mt-3 flex items-start justify-between gap-4 border-t border-amber-200 pt-3 text-sm text-[#0a0a0a]'>
        <div className='min-w-0 flex-1'>
          <p>Ulo spotted something in a photo.</p>
          {lines.length ? (
            <ul className='mt-1 list-disc space-y-1 pl-5'>
              {lines.map(line => <li key={line}>{line}</li>)}
            </ul>
          ) : null}
          <div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-2'>
            <div className='inline-grid grid-cols-2 gap-2'>
              <button type='button' disabled={busy} onClick={() => void decide(review, 'repair')} className='w-full rounded-[10px] bg-[#186179] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40'>Create repair request</button>
              <button type='button' disabled={busy} onClick={() => void decide(review, 'looks_fine')} className='w-full rounded-[10px] border border-[#cbd5e1] bg-white px-3 py-2 text-[13px] font-semibold text-[#334155] disabled:opacity-40'>Looks fine</button>
            </div>
            <button type='button' disabled={busy || closerAsked[review.id]} onClick={() => void decide(review, 'closer_photo')} className='px-1 py-2 text-[13px] font-semibold text-[#611879] underline-offset-2 enabled:hover:underline disabled:text-[#64748b] disabled:opacity-40'>{closerAsked[review.id] ? 'Closer photo requested' : 'Request closer photo'}</button>
          </div>
          {!thumbs.length ? (
            <button type='button' className='mt-2 text-[13px] underline' disabled={loadingId === review.id} onClick={() => void loadPhotos(review)}>{loadingId === review.id ? 'Loading photos…' : 'Review photos'}</button>
          ) : null}
          {photos[review.id] && !thumbs.length ? <p className='mt-2'>No photo previews are available. Try again to refresh the links.</p> : null}
        </div>
        {thumbs.length ? (
          <div className='flex shrink-0 flex-nowrap justify-end gap-2'>
            {thumbs.map(photo => (
              <a key={photo.slot} href={photo.previewUrl!} target='_blank' rel='noreferrer'>
                <img src={photo.previewUrl!} alt={photo.slot.replaceAll('_', ' ')} className='h-28 w-28 rounded-[10px] object-cover' />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    })}
  </section>
}
