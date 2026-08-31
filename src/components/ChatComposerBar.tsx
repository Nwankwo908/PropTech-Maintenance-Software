import { type ReactNode, type RefObject } from 'react'

type ChatComposerBarProps = {
  id: string
  label: string
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  canSend: boolean
  sending?: boolean
  disabled?: boolean
  placeholder?: string
  inputRef?: RefObject<HTMLTextAreaElement | null>
  leftSlot?: ReactNode
  /** Play the Smart Animate enter on mount. Off when a parent already animates in. */
  animateEnter?: boolean
}

/** Ask Ulo–style composer chrome. Callers own what Send does. */
export function ChatComposerBar({
  id,
  label,
  draft,
  onDraftChange,
  onSend,
  canSend,
  sending = false,
  disabled = false,
  placeholder = 'Write your message...',
  inputRef,
  leftSlot,
  animateEnter = true,
}: ChatComposerBarProps) {
  const locked = disabled || sending

  return (
    <div
      className={[
        'w-full rounded-[18px] border border-[#e5e7eb] bg-white p-4 shadow-[0px_8px_30px_rgba(16,24,40,0.06)]',
        animateEnter ? 'sa-enter-scale' : '',
      ].join(' ')}
    >
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        ref={inputRef}
        rows={3}
        value={draft}
        disabled={locked}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (canSend && !locked) onSend()
          }
        }}
        placeholder={placeholder}
        className="min-h-[72px] w-full resize-none bg-transparent text-[15px] leading-6 tracking-[-0.15px] text-[#0a0a0a] outline-none placeholder:text-[#9ca3af] disabled:opacity-60"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">{leftSlot}</div>
        <button
          type="button"
          disabled={!canSend || locked}
          onClick={onSend}
          className="sa-press inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[#e5e7eb] text-[#9ca3af] outline-none transition-[background-color,color,transform,box-shadow] duration-150 enabled:cursor-pointer enabled:bg-[#d1d5db] enabled:text-white enabled:hover:bg-[#9ca3af] enabled:active:bg-[#6b7280] focus-visible:ring-2 focus-visible:ring-[#9ca3af] focus-visible:ring-offset-2 disabled:cursor-not-allowed"
          aria-label={sending ? 'Sending message' : 'Send message'}
        >
          {sending ? (
            <span className="size-4 animate-spin rounded-full border-2 border-[#e5e7eb] border-t-[#6b7280]" />
          ) : (
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
              <path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
