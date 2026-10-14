import { EQUIPMENT_PHOTO_TIPS } from '@shared/vision/equipmentLabel'
import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { type HomeCheckPublic, homeCheckRequest } from '@/api/homeCheck'
import { compressImageForVision } from '@/lib/imageCompress'
import {
  HOME_CHECK_PHOTOS,
  type HomeCheckAnswers,
  homeCheckComplete,
  type HomeCheckSlot,
} from '@shared/homeCheck'

/** Same upload-only page for all three roles. Role/scope come from the server's
 * token binding, never from query parameters or client-entered addresses. */
export function HomeCheckCapturePage() {
  const { checkId = '' } = useParams<{ checkId: string }>()
  const token = useLocation().hash.slice(1)
  return <HomeCheckCaptureForm key={`${checkId}:${token}`} checkId={checkId} token={token} />
}

function HomeCheckCaptureForm({ checkId, token }: { checkId: string; token: string }) {
  const [check, setCheck] = useState<HomeCheckPublic | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<HomeCheckSlot | 'answers' | null>(null)
  const [answers, setAnswers] = useState<HomeCheckAnswers>({
    warningSigns: null,
    warningDetails: '',
    lastService: '',
    lastFilterChange: '',
  })
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let cancelled = false
    homeCheckRequest<HomeCheckPublic>({ action: 'open', id: checkId, token }, true).then(
      (result) => {
        if (!cancelled) setCheck(result)
      },
    ).catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Could not open this Home Check.')
      }
    })
    return () => {
      cancelled = true
    }
  }, [checkId, token])
  async function upload(slot: HomeCheckSlot, file: File | undefined) {
    if (!file || busy) return
    setError('')
    setBusy(slot)
    try {
      const image = await compressImageForVision(file)
      const result = await homeCheckRequest<HomeCheckPublic>({
        action: 'upload',
        id: checkId,
        token,
        slot,
        imageBase64: image.base64,
        contentType: image.contentType,
      }, true)
      setCheck(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setBusy(null)
    }
  }
  async function saveAnswers() {
    setError('')
    setBusy('answers')
    try {
      await homeCheckRequest({ action: 'answers', id: checkId, token, answers }, true)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your answers.')
    } finally {
      setBusy(null)
    }
  }
  const complete = homeCheckComplete(check?.slots || [])
  return (
    <div className='min-h-dvh bg-[#f8fafc] px-4 py-8 text-[#0d0f11]'>
      <main className='mx-auto max-w-lg space-y-5 rounded-xl border border-[#e2e8f0] bg-white p-6'>
        <header>
          <p className='text-sm font-semibold text-[#186179]'>Ulo · Home Check</p>
          <h1 className='mt-2 text-xl font-semibold'>
            {check?.location || 'Opening your Home Check…'}
          </h1>
          {check && (
            <p className='mt-2 text-sm text-[#64748b]'>
              {check.role === 'tenant'
                ? 'Requested by your landlord'
                : check.role === 'contractor'
                ? 'Contractor capture'
                : 'Landlord capture'} · {check.reference}
            </p>
          )}
        </header>
        <p className='text-sm'>
          Take four quick photos of the water heater and furnace or boiler. Observation only: don’t
          open covers, touch wiring, operate valves or attempt repairs.
        </p>
        <ul className='space-y-1 text-sm text-[#64748b]'>
          {EQUIPMENT_PHOTO_TIPS.map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
        <p className='text-sm text-[#64748b]'>
          If you smell gas, see smoke or feel unsafe, leave the area and contact emergency services
          or your utility. Don’t approach equipment to take a photo.
        </p>
        {error && <p role='alert' className='text-sm text-red-700'>{error}</p>}
        {check && (
          <>
            <p className='text-sm font-medium'>
              {check.slots.length} of 4 photos received · Link expires{' '}
              {new Date(check.expiresAt).toLocaleString()}
            </p>
            <ol className='space-y-4'>
              {HOME_CHECK_PHOTOS.map((photo, index) => (
                <li key={photo.slot} className='rounded-lg border border-[#e2e8f0] p-4'>
                  <p className='font-semibold'>{index + 1}. {photo.title}</p>
                  <p className='mt-1 text-sm text-[#64748b]'>{photo.detail}</p>
                  {check.feedback?.filter((feedback) =>
                    feedback.slot === photo.slot
                  ).map((feedback) => (
                    <div key={feedback.slot} className='mt-2 text-sm text-amber-800' role='status'>
                      {feedback.state === 'queued'
                        ? (
                          <p>
                            Add the whole equipment photo and the label close-up to read this
                            system.
                          </p>
                        )
                        : feedback.state === 'error'
                        ? <p>Photo reading is unavailable. Please retry later.</p>
                        : feedback.retakeMessage
                        ? <p>{feedback.retakeMessage}</p>
                        : null}
                      {feedback.uncertainCharacters.map((char, index) => (
                        <p key={index}>
                          {char.field === 'modelNumber' ? 'Model' : 'Serial'} character{' '}
                          {char.index + 1}: {char.alternatives.join(' / ')}. Please check the label.
                        </p>
                      ))}
                      {feedback.formatWarnings.map((warning, index) => (
                        <p key={index}>{warning}</p>
                      ))}
                    </div>
                  ))}
                  <label className='mt-3 block text-sm font-medium text-[#186179]'>
                    {busy === photo.slot
                      ? 'Reading photo…'
                      : check.slots.includes(photo.slot)
                      ? 'Photo received · Replace photo'
                      : 'Take or choose photo'}
                    <input
                      aria-label={photo.title}
                      type='file'
                      accept='image/jpeg,image/png,image/webp,image/heic,image/heif'
                      capture='environment'
                      disabled={!!busy}
                      className='mt-2 block w-full text-sm'
                      onChange={(event) => {
                        void upload(photo.slot, event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                  </label>
                </li>
              ))}
            </ol>
            <fieldset className='space-y-3' disabled={!!busy}>
              <legend className='font-semibold'>5. Leaks, odd noises or smells?</legend>
              {(['Yes', 'No'] as const).map((label) => (
                <label key={label} className='mr-5 inline-flex items-center gap-2'>
                  <input
                    type='radio'
                    name='warnings'
                    checked={answers.warningSigns === (label === 'Yes')}
                    onChange={() => {
                      setSaved(false)
                      setAnswers({ ...answers, warningSigns: label === 'Yes' })
                    }}
                  />
                  {label}
                </label>
              ))}
              {answers.warningSigns && (
                <label className='block text-sm'>
                  What did you notice?<textarea
                    className='mt-1 w-full rounded border p-2'
                    value={answers.warningDetails}
                    maxLength={2000}
                    onChange={(event) => {
                      setSaved(false)
                      setAnswers({ ...answers, warningDetails: event.target.value })
                    }}
                  />
                </label>
              )}
              <p className='font-semibold'>6. Last service and last filter change (if known)</p>
              <label className='block text-sm'>
                Water heater last service<input
                  className='mt-1 w-full rounded border p-2'
                  value={answers.waterHeaterLastService || ''}
                  placeholder='Leave blank if unknown'
                  maxLength={160}
                  onChange={(event) => {
                    setSaved(false)
                    setAnswers({ ...answers, waterHeaterLastService: event.target.value })
                  }}
                />
              </label>
              <label className='block text-sm'>
                Furnace or boiler last service<input
                  className='mt-1 w-full rounded border p-2'
                  value={answers.heatingLastService || ''}
                  placeholder='Leave blank if unknown'
                  maxLength={160}
                  onChange={(event) => {
                    setSaved(false)
                    setAnswers({ ...answers, heatingLastService: event.target.value })
                  }}
                />
              </label>
              <label className='block text-sm'>
                Last filter change<input
                  className='mt-1 w-full rounded border p-2'
                  value={answers.lastFilterChange}
                  placeholder='Leave blank if unknown or not applicable'
                  maxLength={160}
                  onChange={(event) => {
                    setSaved(false)
                    setAnswers({ ...answers, lastFilterChange: event.target.value })
                  }}
                />
              </label>
              <button
                type='button'
                className='rounded bg-[#186179] px-4 py-2 text-white disabled:opacity-50'
                disabled={!!busy || answers.warningSigns == null}
                onClick={() => void saveAnswers()}
              >
                {busy === 'answers' ? 'Saving…' : 'Save observations'}
              </button>
            </fieldset>
            {saved && (
              <p role='status' className='text-sm text-emerald-700'>
                Observations saved.{answers.warningSigns
                  ? ' A linked follow-up has been opened for landlord review.'
                  : ''}
              </p>
            )}
            {complete && (
              <p role='status' className='rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800'>
                All four photos received. The asset records are waiting for landlord
                confirmation.{!saved && ' Please also save your observations above.'}
              </p>
            )}
            <p className='text-xs text-[#64748b]'>
              This link uploads only to this Home Check. It shows no other property data. Every
              upload is recorded.
            </p>
          </>
        )}
      </main>
    </div>
  )
}
