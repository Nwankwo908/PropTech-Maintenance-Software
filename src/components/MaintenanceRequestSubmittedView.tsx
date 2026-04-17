import { useCallback, useState } from 'react'
import checkmarkIcon from '@/assets/Checkmark Icon.svg'
import homeIcon from '@/assets/Home Icon.svg'
import { appendMaintenanceTicketComment } from '@/api/appendMaintenanceTicketComment'
import { useTicketTimelineStatus } from '@/hooks/useTicketTimelineStatus'
import {
  stepIsActive,
  stepIsDone,
  TICKET_TIMELINE_STEPS,
} from '@/lib/maintenanceTicketTimeline'
import { getCurrentResidentSession } from '@/lib/residentAuth'
import { MaintenancePortalPageHeader } from '@/components/MaintenancePortalPageHeader'

export type MaintenanceRequestSubmittedViewProps = {
  /** Friendly reference shown on the success screen (e.g. MNT-…). */
  requestId: string
  /** Server ticket id for follow-up API calls. */
  ticketId: string
  onSubmitAnother: () => void
  onLogOut: () => void | Promise<void>
}

type ThreadEntry = {
  id: string
  text: string
  at: number
}

function SuccessCheckIllustration() {
  return (
    <div
      className="flex size-20 shrink-0 items-center justify-center rounded-full bg-[#dcfce7]"
      aria-hidden
    >
      <svg
        className="size-10 text-[#16a34a]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20 6L9 17l-5-5"
        />
      </svg>
    </div>
  )
}

function SidebarCheckIcon() {
  return (
    <img
      src={checkmarkIcon}
      alt=""
      className="size-5 shrink-0"
      aria-hidden
    />
  )
}

/** Injected here so Tailwind/Lightning cannot drop it as “unused” CSS from index.css. */
const UNDER_REVIEW_STEP_STYLE = `
@keyframes mnt-success-under-review-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.22); opacity: 0.7; }
}
.mnt-success-under-review-pulse {
  animation: mnt-success-under-review-pulse 1.25s ease-in-out infinite;
  will-change: transform, opacity;
}
@media (prefers-reduced-motion: reduce) {
  .mnt-success-under-review-pulse {
    animation: none;
    will-change: auto;
    opacity: 1;
  }
}
`

function TrackStepConnector({ tightTop }: { tightTop: boolean }) {
  return (
    <div
      className={`${tightTop ? 'mt-0.5' : 'mt-1'} w-0.5 flex-1 min-h-[8px] bg-[#d1d5dc]`}
    />
  )
}

function TrackStepDoneGlyph() {
  return (
    <div className="flex size-8 items-center justify-center rounded-full bg-[#00c950]">
      <svg
        className="size-5 text-white"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 10l3 3 7-7"
        />
      </svg>
    </div>
  )
}

function TrackStepActiveGlyph() {
  return (
    <div className="mnt-success-under-review-pulse flex size-8 origin-center items-center justify-center rounded-full border-2 border-[#2b7fff] bg-[#dbeafe]">
      <span className="size-2 shrink-0 rounded-full bg-[#2b7fff] opacity-80" />
    </div>
  )
}

function TrackStepPendingGlyph() {
  return (
    <div className="size-3.5 shrink-0 rounded-full border-2 border-[#d1d5dc] bg-[#d1d5dc]" />
  )
}

export function MaintenanceRequestSubmittedView({
  requestId,
  ticketId,
  onSubmitAnother,
  onLogOut,
}: MaintenanceRequestSubmittedViewProps) {
  const { phase, activeStepDetail, statusError } = useTicketTimelineStatus(ticketId)
  const [copyHint, setCopyHint] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [thread, setThread] = useState<ThreadEntry[]>([])
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [commentOk, setCommentOk] = useState<string | null>(null)

  const copyId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(requestId)
      setCopyHint('Copied to clipboard')
      window.setTimeout(() => setCopyHint(null), 2000)
    } catch {
      setCopyHint('Could not copy')
      window.setTimeout(() => setCopyHint(null), 2000)
    }
  }, [requestId])

  const submitComment = useCallback(async () => {
    const text = commentDraft.trim()
    if (!text || commentBusy) return
    setCommentError(null)
    setCommentOk(null)
    setCommentBusy(true)
    try {
      const session = await getCurrentResidentSession()
      await appendMaintenanceTicketComment({
        ticketId,
        comment: text,
        auth: session
          ? {
              accessToken: session.accessToken,
              residentUserId: session.userId,
            }
          : undefined,
      })
      setThread((prev) => [
        ...prev,
        { id: `${Date.now()}-${prev.length}`, text, at: Date.now() },
      ])
      setCommentDraft('')
      setCommentOk('Your update was added to this request.')
      window.setTimeout(() => setCommentOk(null), 4000)
    } catch (e) {
      setCommentError(
        e instanceof Error ? e.message : 'Could not add your comment.',
      )
    } finally {
      setCommentBusy(false)
    }
  }, [commentBusy, commentDraft, ticketId])

  const canSubmitComment = commentDraft.trim().length > 0 && !commentBusy

  return (
    <>
      <style>{UNDER_REVIEW_STEP_STYLE}</style>
      <main className="min-h-dvh w-full bg-[#f9fafb] font-sans">
        <div className="flex min-h-dvh w-full min-w-0 flex-col overflow-x-hidden rounded-none border-0 bg-white shadow-none lg:flex-row">
          <div className="flex min-h-dvh min-w-0 flex-1 flex-col lg:flex-row">
            <div
              className="hidden w-[8px] shrink-0 self-stretch bg-[#944c73] lg:block"
              aria-hidden
            />

            <div className="w-full min-w-0 flex-1">
              <MaintenancePortalPageHeader sticky="always" step="submitted" />
              <div className="px-6 pb-6 sm:px-8 lg:px-10 lg:pb-12">
                <div className="ml-0 flex w-full min-w-0 flex-col items-center pl-[36px] pt-8 sm:pt-10 lg:ml-[48px] lg:items-stretch lg:pl-0">
                <div className="flex w-full max-w-full flex-col items-center gap-4 lg:max-w-[898px] lg:items-center">
              <SuccessCheckIllustration />

              <div className="flex flex-col items-center gap-[24px]">
                <h1 className="text-center text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
                  Request Submitted Successfully!
                </h1>
                <p className="text-center text-[16px] font-normal leading-6 tracking-[-0.3125px] text-[#4a5565]">
                  Your maintenance request has been received and assigned a
                  tracking ID.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void copyId()}
                className="w-full max-w-full rounded-[10px] border-2 border-[#e5e7eb] bg-[#f9fafb] px-6 py-6 text-center transition-colors hover:border-[#d1d5dc] lg:max-w-full"
              >
                <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#6a7282]">
                  Request ID
                </p>
                <p className="mt-2 break-all font-mono text-[30px] font-bold leading-9 tracking-[0.75px] text-[#101828]">
                  {requestId}
                </p>
                <p className="mt-2 text-[12px] font-normal leading-4 text-[#6a7282]">
                  {copyHint ?? 'Tap to copy this ID to track your request status'}
                </p>
              </button>

              <div className="w-full max-w-full rounded-[10px] border border-[#e5e7eb] bg-white px-6 pb-5 pt-6 lg:max-w-full">
                <h2 className="text-center text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                  Add Comments or Additional Info
                </h2>
                <div className="mt-4 flex flex-col gap-3">
                  <textarea
                    name="followUpComment"
                    rows={3}
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    placeholder="Provide additional information or updates about your request..."
                    disabled={commentBusy}
                    className="w-full resize-y rounded-lg border border-transparent bg-[#f3f3f5] px-3 py-2 text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a] placeholder:text-[#717182] outline-none ring-[#944c73] focus:ring-2 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={!canSubmitComment}
                    onClick={() => void submitComment()}
                    className="h-9 w-full rounded-lg bg-[#101828] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white transition-colors hover:bg-black disabled:pointer-events-none disabled:opacity-50"
                  >
                    {commentBusy ? 'Adding…' : 'Add Comment'}
                  </button>
                </div>
                {commentError && (
                  <p
                    className="mt-3 text-center text-[12px] font-normal leading-4 text-red-600"
                    role="alert"
                  >
                    {commentError}
                  </p>
                )}
                {commentOk && (
                  <p
                    className="mt-3 text-center text-[12px] font-normal leading-4 text-[#00a63e]"
                    role="status"
                  >
                    {commentOk}
                  </p>
                )}
                {thread.length > 0 && (
                  <div className="mt-4 border-t border-[#e5e7eb] pt-4">
                    <p className="text-[12px] font-semibold leading-4 tracking-[-0.1504px] text-[#101828]">
                      Your updates on this request
                    </p>
                    <ul className="mt-3 flex max-h-48 flex-col gap-3 overflow-y-auto">
                      {thread.map((entry) => (
                        <li
                          key={entry.id}
                          className="rounded-lg bg-[#f9fafb] px-3 py-2 text-left"
                        >
                          <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                            {new Date(entry.at).toLocaleString(undefined, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#364153]">
                            {entry.text}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-3 text-center text-[12px] font-normal leading-4 text-[#6a7282]">
                  Your comments will be shared with the maintenance team
                </p>
              </div>

              <div className="w-full max-w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-[25px] lg:max-w-full">
                <h2 className="text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]">
                  Track Request Status
                </h2>
                <div
                  className="mt-6 flex flex-col gap-1"
                  aria-live="polite"
                  aria-label="Request status timeline"
                >
                  {TICKET_TIMELINE_STEPS.map((step, i) => {
                    const done = stepIsDone(i, phase)
                    const active = stepIsActive(i, phase)
                    const pending = !done && !active
                    const last = i === TICKET_TIMELINE_STEPS.length - 1
                    const subtitle =
                      phase === 'resolved' && i === 4
                        ? 'Resolved'
                        : active && activeStepDetail
                          ? activeStepDetail
                          : step.defaultSub

                    return (
                      <div key={step.title} className="flex gap-3">
                        <div className="flex w-8 shrink-0 flex-col items-center">
                          {done ? (
                            <TrackStepDoneGlyph />
                          ) : active ? (
                            <TrackStepActiveGlyph />
                          ) : (
                            <TrackStepPendingGlyph />
                          )}
                          {!last ? (
                            <TrackStepConnector tightTop={i === 0} />
                          ) : null}
                        </div>
                        <div
                          className={`min-w-0 pb-2 ${pending ? 'pt-0.5' : 'pt-1'}`}
                        >
                          <p
                            className={
                              pending
                                ? 'text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#6a7282]'
                                : 'text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]'
                            }
                          >
                            {step.title}
                          </p>
                          <p
                            className={
                              pending
                                ? 'text-[12px] font-normal leading-4 text-[#99a1af]'
                                : 'text-[12px] font-normal leading-4 text-[#6a7282]'
                            }
                          >
                            {subtitle}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {statusError ? (
                  <p
                    className="mt-2 text-center text-[12px] font-normal leading-4 text-red-600"
                    role="alert"
                  >
                    {statusError}
                  </p>
                ) : null}

                <div className="mt-4 border-t border-[#e5e7eb] pt-4">
                  <p className="text-[12px] font-normal leading-4 text-[#6a7282]">
                    You&apos;ll receive email updates at each stage
                  </p>
                </div>
              </div>

              <div className="hidden w-full max-w-full flex-col items-stretch gap-4 lg:flex lg:max-w-full">
                <div className="h-px w-full bg-[#e5e7eb]" />

                <button
                  type="button"
                  onClick={onSubmitAnother}
                  className="h-9 w-full rounded-lg bg-[#101828] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white transition-colors hover:bg-black"
                >
                  Submit Another Request
                </button>
                <button
                  type="button"
                  onClick={() => void onLogOut()}
                  className="h-9 w-full rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a] transition-colors hover:bg-[#f9fafb]"
                >
                  Log Out
                </button>
              </div>
                </div>
                </div>
              </div>
            </div>

            <aside className="hidden w-full shrink-0 bg-white px-6 pb-10 pt-6 lg:flex lg:w-[300px] lg:border-l lg:border-[#e5e7eb] lg:px-8 lg:pb-12 lg:pt-10">
              <div className="h-fit w-full min-w-0">
                <div className="flex flex-col items-center text-center">
                  <div className="flex size-12 items-center justify-center rounded-[10px] bg-[#101828]">
                    <img
                      src={homeIcon}
                      alt=""
                      className="size-12 object-contain"
                    />
                  </div>
                  <h2 className="mt-4 text-[20px] font-semibold leading-7 tracking-[-0.4492px] text-[#0a0a0a]">
                    Property Management
                  </h2>
                  <p className="mt-1 text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
                    Quick Maintenance Request
                  </p>
                </div>

                <ul className="mt-6 flex flex-col gap-4">
                  <li className="flex items-center gap-2">
                    <SidebarCheckIcon />
                    <span className="text-left text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
                      Provide Request Details
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <SidebarCheckIcon />
                    <span className="text-left text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
                      Submit & Confirm Request
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <SidebarCheckIcon />
                    <span className="text-left text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
                      Track request status
                    </span>
                  </li>
                </ul>

                <div className="mt-6 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#101828] text-white">
                  <svg
                    className="size-4 shrink-0"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.333 4L6 11.333 2.667 8"
                    />
                  </svg>
                  <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px]">
                    Submitted!
                  </span>
                </div>
                <p className="mt-3 text-center text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#00a63e]">
                  Your request has been received!
                </p>
              </div>
            </aside>
          </div>

          <div className="border-t border-[#e5e7eb] bg-white px-4 py-4 sm:px-6 lg:hidden">
            <button
              type="button"
              onClick={onSubmitAnother}
              className="h-9 w-full rounded-lg bg-[#101828] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white transition-colors hover:bg-black"
            >
              Submit Another Request
            </button>
            <button
              type="button"
              onClick={() => void onLogOut()}
              className="mt-2 h-9 w-full rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a] transition-colors hover:bg-[#f9fafb]"
            >
              Log Out
            </button>
          </div>
        </div>
      </main>
    </>
  )
}
