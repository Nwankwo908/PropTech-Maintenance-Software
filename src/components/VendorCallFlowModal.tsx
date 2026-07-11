import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { openPhoneDialer } from '@/lib/phoneLinks'
import {
  buildVendorCallLocationLine,
  buildVendorCallReasonLine,
  formatCallDuration,
  vendorInitials,
  type VendorCallContext,
} from '@/lib/vendorCallFlow'

type CallPhase = 'dialing' | 'active'

export type VendorCallFlowModalProps = {
  open: boolean
  onClose: () => void
  vendorName: string
  vendorPhone: string
  context: VendorCallContext
  /** Override the default “Calling re: …” line (e.g. lease renewal). */
  reasonLine?: string
  quickNotesPlaceholder?: string
}

function SpinnerIcon() {
  return (
    <svg className="size-4 animate-spin text-[#60a5fa]" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" className="opacity-25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="opacity-90"
      />
    </svg>
  )
}

function MuteIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M16 8.5V6a4 4 0 0 0-8 0v8" strokeLinecap="round" />
      <path d="M12 19v3M8 11v2a4 4 0 0 0 8 0v-2" strokeLinecap="round" />
      <path d="M3 3l18 18" strokeLinecap="round" />
    </svg>
  )
}

function SpeakerIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M11 5L6 9H3v6h3l5 4V5z" strokeLinejoin="round" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12" strokeLinecap="round" />
    </svg>
  )
}

function HoldIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  )
}

function HangUpIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11l-1.27 1.27a16 16 0 0 0 2.6 3.41"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CallControlButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-w-0 flex-1 flex-col items-center gap-2 rounded-[14px] border px-2 py-3 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#121826] ${
        active
          ? 'border-[#60a5fa] bg-[#1e3a5f] text-white'
          : 'border-[#334155] bg-[#1e293b] text-[#cbd5e1] hover:bg-[#243044]'
      }`}
    >
      {children}
      {label}
    </button>
  )
}

/** In-app call UI — dialing and active call (vendor or tenant). */
export function VendorCallFlowModal({
  open,
  onClose,
  vendorName,
  vendorPhone,
  context,
  reasonLine: reasonLineProp,
  quickNotesPlaceholder = 'e.g. Vendor confirmed ETA 30 min, COI being emailed…',
}: VendorCallFlowModalProps) {
  const titleId = useId()
  const [phase, setPhase] = useState<CallPhase>('dialing')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [muted, setMuted] = useState(false)
  const [speaker, setSpeaker] = useState(false)
  const [onHold, setOnHold] = useState(false)
  const [quickNotes, setQuickNotes] = useState('')
  const activeStartedAtRef = useRef<number | null>(null)
  const dialerOpenedRef = useRef(false)

  const reasonLine = reasonLineProp ?? buildVendorCallReasonLine(context)
  const locationLine = buildVendorCallLocationLine(context)
  const initials = vendorInitials(vendorName)

  useEffect(() => {
    if (!open) return
    setPhase('dialing')
    setElapsedSeconds(0)
    setMuted(false)
    setSpeaker(false)
    setOnHold(false)
    setQuickNotes('')
    activeStartedAtRef.current = null
    dialerOpenedRef.current = false
  }, [open, vendorName, vendorPhone])

  useEffect(() => {
    if (!open || phase !== 'dialing') return
    if (!dialerOpenedRef.current) {
      dialerOpenedRef.current = true
      openPhoneDialer(vendorPhone)
    }
    const connectTimer = window.setTimeout(() => {
      activeStartedAtRef.current = Date.now()
      setPhase('active')
    }, 2400)
    return () => window.clearTimeout(connectTimer)
  }, [open, phase, vendorPhone])

  useEffect(() => {
    if (!open || phase !== 'active') return
    const tick = window.setInterval(() => {
      const started = activeStartedAtRef.current
      if (!started) return
      setElapsedSeconds(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(tick)
  }, [open, phase])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const durationLabel = formatCallDuration(elapsedSeconds)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div role="presentation" className="absolute inset-0" aria-hidden onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[360px] rounded-[20px] bg-[#121826] px-6 py-8 shadow-[0px_24px_48px_rgba(0,0,0,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <span className="inline-flex size-[72px] items-center justify-center rounded-full bg-[#2563eb] text-[22px] font-bold text-white">
              {initials}
            </span>
            {phase === 'active' ? (
              <span
                className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2 border-[#121826] bg-[#22c55e]"
                aria-hidden
              />
            ) : null}
          </div>

          <h2 id={titleId} className="mt-4 text-[17px] font-semibold leading-6 text-white">
            {vendorName}
          </h2>
          <p className="mt-1 text-[14px] leading-5 text-[#94a3b8]">{vendorPhone}</p>

          {phase === 'dialing' ? (
            <div className="mt-4 inline-flex items-center gap-2 text-[13px] text-[#94a3b8]">
              <SpinnerIcon />
              Calling…
            </div>
          ) : (
            <p className="mt-4 text-[15px] font-semibold tabular-nums text-[#34d399]">{durationLabel}</p>
          )}
        </div>

        <div className="mt-6 rounded-[14px] bg-[#1e293b] px-4 py-3 text-center">
          <p className="text-[12px] leading-[18px] text-[#e2e8f0]">{reasonLine}</p>
          <p className="mt-1 text-[11px] leading-4 text-[#94a3b8]">{locationLine}</p>
        </div>

        {phase === 'active' ? (
          <>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <CallControlButton label="Mute" active={muted} onClick={() => setMuted((v) => !v)}>
                <MuteIcon />
              </CallControlButton>
              <CallControlButton label="Speaker" active={speaker} onClick={() => setSpeaker((v) => !v)}>
                <SpeakerIcon />
              </CallControlButton>
              <CallControlButton label="Hold" active={onHold} onClick={() => setOnHold((v) => !v)}>
                <HoldIcon />
              </CallControlButton>
            </div>

            <div className="mt-5">
              <label htmlFor="vendor-call-quick-notes" className="text-[11px] font-medium text-[#94a3b8]">
                Quick notes
              </label>
              <textarea
                id="vendor-call-quick-notes"
                value={quickNotes}
                onChange={(e) => setQuickNotes(e.target.value)}
                rows={3}
                placeholder={quickNotesPlaceholder}
                className="mt-1.5 w-full resize-none rounded-[12px] border border-[#334155] bg-[#0f172a] px-3.5 py-2.5 text-[12px] leading-5 text-[#e2e8f0] outline-none placeholder:text-[#64748b] focus-visible:border-[#475569] focus-visible:ring-2 focus-visible:ring-[#334155]"
              />
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#ef4444] px-4 py-3.5 text-[14px] font-semibold text-white outline-none transition-colors hover:bg-[#dc2626] focus-visible:ring-2 focus-visible:ring-[#fca5a5] focus-visible:ring-offset-2 focus-visible:ring-offset-[#121826]"
            >
              <HangUpIcon />
              End Call
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}

export default VendorCallFlowModal
