/** Shown only after the landlord has entered something that was actually saved. */
export function OnboardingProgressSavedNote({ className }: { className?: string }) {
  return (
    <p
      role="status"
      className={[
        'onb-progress-saved inline-flex items-center gap-1.5 text-[13px] leading-5 text-[#6a7282]',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className="onb-progress-saved-icon size-3.5 shrink-0"
        aria-hidden
      >
        <path
          className="onb-progress-saved-check"
          d="M3.5 8.25 6.5 11.25 12.5 4.75"
          stroke="#186179"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Your progress has been saved.
    </p>
  )
}
