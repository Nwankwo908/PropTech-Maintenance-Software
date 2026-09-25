/** Compact switch: send tenant welcome SMS when setup completes. */
export function OnboardingSendSwitch({
  enabled,
  onChange,
  disabled,
  id,
  'aria-label': ariaLabel = 'Send onboarding message when setup completes',
}: {
  enabled: boolean
  onChange: (enabled: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
}) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className="text-[11px] font-medium leading-none text-[#6a7282]">Onboard</span>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={enabled}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={[
          'relative h-6 w-11 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#186179]/30 focus-visible:ring-offset-2',
          disabled ? 'cursor-not-allowed opacity-50' : '',
          enabled ? 'bg-[#611879]' : 'bg-[#e5e7eb]',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span
          className={[
            'pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  )
}
