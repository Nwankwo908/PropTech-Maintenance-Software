import { useEffect, useId, useState } from 'react'

export type EditMessageModalInitial = {
  messageTitle: string
  messageContent: string
  targetAudience: string
  channelEmail: boolean
  channelSms: boolean
  channelPush: boolean
}

const AUDIENCE_OPTIONS = [
  'All Residents',
  'Building A',
  'Building B',
  'Building C',
] as const

function EditMessageChannelRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className={[
          'flex size-4 shrink-0 items-center justify-center rounded shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] peer-focus-visible:ring-2 peer-focus-visible:ring-[#944c73] peer-focus-visible:ring-offset-2',
          checked
            ? 'border border-[#030213] bg-[#030213]'
            : 'border border-black/10 bg-[#f3f3f5]',
        ].join(' ')}
      >
        {checked ? (
          <svg className="size-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">{label}</span>
    </label>
  )
}

export function EditMessageModal({
  open,
  onClose,
  initial,
}: {
  open: boolean
  onClose: () => void
  initial: EditMessageModalInitial | null
}) {
  const titleId = useId()
  const [messageTitle, setMessageTitle] = useState('')
  const [messageContent, setMessageContent] = useState('')
  const [audience, setAudience] = useState<string>(AUDIENCE_OPTIONS[0])
  const [channelEmail, setChannelEmail] = useState(true)
  const [channelSms, setChannelSms] = useState(true)
  const [channelPush, setChannelPush] = useState(false)

  const initialKey =
    open && initial
      ? `${initial.messageTitle}\n${initial.messageContent}\n${initial.targetAudience}`
      : ''
  const [prevInitialKey, setPrevInitialKey] = useState(initialKey)
  if (initialKey !== prevInitialKey) {
    setPrevInitialKey(initialKey)
    if (initialKey && initial) {
      setMessageTitle(initial.messageTitle)
      setMessageContent(initial.messageContent)
      setAudience(initial.targetAudience)
      setChannelEmail(initial.channelEmail)
      setChannelSms(initial.channelSms)
      setChannelPush(initial.channelPush)
    }
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !initial) return null

  const charCount = messageContent.length
  const channelsOk = channelEmail || channelSms || channelPush
  const formValid =
    messageTitle.trim().length > 0 &&
    messageContent.trim().length > 0 &&
    audience.trim().length > 0 &&
    channelsOk

  const audienceSelectOptions = [...new Set([...AUDIENCE_OPTIONS, audience])]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="presentation"
        className="absolute inset-0"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(92dvh,820px)] w-full max-w-[657px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#e5e7eb] px-6 py-5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[20px] font-semibold leading-7 tracking-[-0.4492px] text-[#101828]"
            >
              Edit Message
            </h2>
            <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
              Update and resend your broadcast message
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-[#6a7282] outline-none transition-colors hover:bg-black/5 hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-6">
            <div>
              <label
                htmlFor="edit-msg-title"
                className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
              >
                Message Title <span className="text-[#c10007]">*</span>
              </label>
              <input
                id="edit-msg-title"
                type="text"
                value={messageTitle}
                onChange={(e) => setMessageTitle(e.target.value)}
                className="h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                placeholder="Message title"
              />
            </div>

            <div>
              <label
                htmlFor="edit-msg-content"
                className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
              >
                Message Content <span className="text-[#c10007]">*</span>
              </label>
              <textarea
                id="edit-msg-content"
                value={messageContent}
                onChange={(e) => setMessageContent(e.target.value)}
                placeholder="Enter your message content"
                rows={6}
                className="w-full resize-y rounded-lg border border-[#d1d5dc] px-3 py-2 text-[16px] leading-6 tracking-[-0.3125px] text-[#0a0a0a] outline-none placeholder:text-[rgba(10,10,10,0.5)] focus:border-[#944c73]/45 focus:ring-2 focus:ring-[#944c73]/30"
              />
              <p className="mt-2 text-[12px] leading-4 text-[#6a7282]">{charCount} characters</p>
            </div>

            <div>
              <label
                htmlFor="edit-msg-audience"
                className="mb-2 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]"
              >
                Target Audience <span className="text-[#c10007]">*</span>
              </label>
              <div className="relative">
                <select
                  id="edit-msg-audience"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  className="h-9 w-full appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#944c73]/45 focus:bg-white focus:ring-2 focus:ring-[#944c73]/30"
                >
                  {audienceSelectOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </div>
            </div>

            <fieldset>
              <legend className="mb-3 block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Delivery Channels <span className="text-[#c10007]">*</span>
              </legend>
              <div className="flex flex-col gap-2">
                <EditMessageChannelRow
                  id="edit-ch-email"
                  label="📧 Email"
                  checked={channelEmail}
                  onChange={setChannelEmail}
                />
                <EditMessageChannelRow
                  id="edit-ch-sms"
                  label="📱 SMS"
                  checked={channelSms}
                  onChange={setChannelSms}
                />
                <EditMessageChannelRow
                  id="edit-ch-push"
                  label="🔔 Push Notification"
                  checked={channelPush}
                  onChange={setChannelPush}
                />
              </div>
            </fieldset>

            <div className="flex gap-3 rounded-[10px] border border-[#fff085] bg-[#fefce8] px-3 py-3">
              <svg className="mt-0.5 size-5 shrink-0 text-[#ca8a04]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
              </svg>
              <div>
                <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#894b00]">Important:</p>
                <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#894b00]">
                  Editing this message will create a new message. The original message history will be preserved for
                  audit purposes.
                </p>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
            >
              Save as Draft
            </button>
            <button
              type="button"
              disabled={!formValid}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[#155dfc] px-4 text-[14px] font-medium tracking-[-0.1504px] text-white outline-none enabled:hover:bg-[#1249d6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
