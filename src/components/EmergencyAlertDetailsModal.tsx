import { useEffect, useId } from 'react'

const ALERT_MESSAGE_LIST: { bold: string; rest: string }[] = [
  { bold: 'Do not use any open flames', rest: ' or operate electrical switches' },
  { bold: 'If you smell gas:', rest: ' Evacuate immediately and call 911' },
  { bold: 'Keep windows open', rest: ' for proper ventilation' },
  { bold: 'Avoid using elevators', rest: ' - use stairs instead' },
  { bold: 'Do not return', rest: ' until authorities confirm it is safe' },
]

const SOURCE_LINES = [
  'Alert ID: PGE-2026-03-25-14:00-GL-SF-94103',
  'Severity: CRITICAL',
  'Location: San Francisco, CA 94103',
  'Affected Radius: 0.5 miles',
  'Status: Active',
] as const

function HeaderAlertGlyph({ className = 'size-5 shrink-0 text-[#c10007]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

function SmallAlertGlyph({ className = 'size-3 shrink-0 text-[#c10007]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 9v4M12 17h.01M10.3 4.8 2.2 16A2 2 0 004 17.8h16a2 2 0 001.8-1.8l-8.1-12a2 2 0 00-3.4 0z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  )
}

function SourceDocIcon({ className = 'size-4 shrink-0 text-[#c2410c]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

export type EmergencyAlertDetailsPresentation = 'modal' | 'rail'

/** Full-screen review for PG&E gas leak alert (Figma 89:15459). */
export function EmergencyAlertDetailsModal({
  open,
  onClose,
  onSendNow,
  onSchedule,
  presentation = 'modal',
}: {
  open: boolean
  onClose: () => void
  /** After user confirms send from this review screen. */
  onSendNow: () => void
  /** Opens override flow to schedule / customize notification distribution (Figma 117:10300). */
  onSchedule: () => void
  /** `rail` = full-height panel from the right; `modal` = centered dialog. */
  presentation?: EmergencyAlertDetailsPresentation
}) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const isRail = presentation === 'rail'

  return (
    <div
      className={
        isRail
          ? 'fixed inset-0 z-50 flex justify-end'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'
      }
    >
      <div
        role="presentation"
        className={isRail ? 'absolute inset-0 bg-black/40' : 'absolute inset-0'}
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          isRail
            ? 'relative flex h-full max-h-dvh w-full max-w-[min(100vw,900px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]'
            : 'relative flex max-h-[min(92dvh,920px)] w-full max-w-[900px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]'
        }
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#e5e7eb] px-6 py-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#ffe2e2]">
              <HeaderAlertGlyph />
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#101828]">
                Emergency Alert Details
              </h2>
              <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">PG&amp;E Gas Leak Advisory</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-[#6a7282] outline-none hover:bg-black/5 hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
          <div className="flex flex-col gap-6">
            <div className="rounded-[10px] border border-[#ffc9c9] bg-[#fef2f2] p-[17px]">
              <div className="flex gap-3">
                <svg className="mt-0.5 size-5 shrink-0 text-[#e7000b]" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
                  <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
                </svg>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#82181a]">
                      Urgent Action Required
                    </span>
                    <span className="inline-flex rounded px-2 py-0.5 text-[12px] font-medium leading-4 bg-[#e7000b] text-white">
                      URGENT
                    </span>
                  </div>
                  <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#9f0712]">
                    This emergency alert was detected 2 hours ago and has not been sent to residents yet. Immediate
                    action is recommended.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-3 text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">
                  Alert Information
                </h3>
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-[14px] leading-5 text-[#6a7282]">Source</p>
                    <p className="mt-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                      PG&amp;E Emergency Alert System
                    </p>
                  </div>
                  <div>
                    <p className="text-[14px] leading-5 text-[#6a7282]">Alert Type</p>
                    <p className="mt-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                      Gas Leak Advisory
                    </p>
                  </div>
                  <div>
                    <p className="text-[14px] leading-5 text-[#6a7282]">Detection Time</p>
                    <p className="mt-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                      March 25, 2026 at 2:00 PM
                    </p>
                  </div>
                  <div>
                    <p className="text-[14px] leading-5 text-[#6a7282]">Priority Level</p>
                    <span className="mt-1 inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12px] font-medium leading-4 bg-[#ffe2e2] text-[#c10007]">
                      <SmallAlertGlyph />
                      Critical - Immediate Action
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">
                  Distribution Details
                </h3>
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-[14px] leading-5 text-[#6a7282]">Recipients</p>
                    <p className="mt-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                      All Residents (142 units)
                    </p>
                  </div>
                  <div>
                    <p className="text-[14px] leading-5 text-[#6a7282]">Delivery Channels</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <span className="inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 bg-[#dbeafe] text-[#1447e6]">
                        Email
                      </span>
                      <span className="inline-flex rounded px-2 py-1 text-[12px] font-medium leading-4 bg-[#dcfce7] text-[#008236]">
                        SMS
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[14px] leading-5 text-[#6a7282]">AI Confidence Score</p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[#e5e7eb]">
                        <div className="h-full w-[98%] rounded-full bg-[#e7000b]" />
                      </div>
                      <span className="shrink-0 text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">98%</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[14px] leading-5 text-[#6a7282]">Estimated Delivery Time</p>
                    <p className="mt-1 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                      ~2-3 minutes
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <section>
              <h3 className="mb-3 text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">
                Alert Message
              </h3>
              <div className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-4 text-[14px] leading-5 tracking-[-0.1504px] text-[#364153]">
                <p className="font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">
                  ⚠️ URGENT: Gas Leak Advisory in Your Area
                </p>
                <p className="mt-3">Dear Residents,</p>
                <p className="mt-3">
                  PG&amp;E has issued an emergency gas leak advisory for the area surrounding our property. Please take
                  the following safety precautions immediately:
                </p>
                <ul className="mt-3 list-none space-y-1 pl-0">
                  {ALERT_MESSAGE_LIST.map((item) => (
                    <li key={item.bold} className="pl-0">
                      <span className="font-bold">{item.bold}</span>
                      {item.rest}
                    </li>
                  ))}
                </ul>
                <p className="mt-4">
                  PG&amp;E emergency crews are currently on-site working to resolve the issue. We will provide updates as
                  more information becomes available.
                </p>
                <p className="mt-3">
                  For immediate assistance or questions, contact our emergency line:{' '}
                  <span className="font-bold">(555) 123-4567</span>
                </p>
                <p className="mt-3">Thank you for your cooperation and stay safe.</p>
                <p className="mt-3 text-[#4a5565]">— Property Management Team</p>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">
                Source Data
              </h3>
              <div className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-[17px]">
                <div className="flex gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded bg-[#ffedd4]">
                    <SourceDocIcon />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#101828]">
                      PG&amp;E Emergency Alert System
                    </p>
                    <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">Automated detection from verified source</p>
                    <pre className="mt-3 whitespace-pre-wrap rounded border border-[#e5e7eb] bg-white p-2 font-mono text-[12px] leading-4 text-[#4a5565]">
                      {SOURCE_LINES.join('\n')}
                    </pre>
                  </div>
                </div>
              </div>
            </section>

            <div className="border-t border-[#e5e7eb] pt-6">
              <h3 className="mb-4 text-[16px] font-semibold leading-6 tracking-[-0.3125px] text-[#101828]">Actions</h3>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onSendNow()
                  }}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-[#e7000b] px-4 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none hover:bg-[#c10007] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 sm:min-w-[200px]"
                >
                  <svg className="size-4 text-white" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
                    <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
                  </svg>
                  Send Now
                </button>
                <button
                  type="button"
                  onClick={onSchedule}
                  className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-black/10 bg-white px-4 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 sm:min-w-[200px]"
                >
                  Schedule
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 sm:min-w-[200px]"
                >
                  <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
