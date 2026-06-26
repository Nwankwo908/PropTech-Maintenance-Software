import { useEffect, useRef, type ChangeEventHandler } from 'react'

const CHECKBOX_STATE_CLASS =
  'shrink-0 rounded border border-black/10 bg-[#f3f3f5] shadow-sm accent-[#0030b5] transition-[background-color,border-color,box-shadow,opacity] duration-150 outline-none enabled:cursor-pointer hover:enabled:border-black/15 hover:enabled:bg-[#e8eaee] hover:enabled:shadow-sm active:enabled:border-black/20 active:enabled:bg-[#dcdde3] focus:border-[#0030b5]/45 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0030b5]/30 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-black/10 disabled:hover:bg-[#f3f3f5] disabled:focus:ring-0 disabled:active:bg-[#f3f3f5]'

/** Shared checkbox styling with hover, active, focus, and disabled states. */
export const checkboxInputClassName = `size-4 ${CHECKBOX_STATE_CLASS}`

export const checkboxInputClassNameLg = `size-5 ${CHECKBOX_STATE_CLASS}`

/** @deprecated Use `checkboxInputClassName` */
export const TABLE_CHECKBOX_CLASS = checkboxInputClassName

export function TableCheckbox({
  'aria-label': ariaLabel,
  disabled = false,
  className = '',
  checked,
  onChange,
  indeterminate = false,
}: {
  'aria-label': string
  disabled?: boolean
  className?: string
  checked?: boolean
  onChange?: ChangeEventHandler<HTMLInputElement>
  indeterminate?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el) el.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      ref={inputRef}
      type="checkbox"
      disabled={disabled}
      aria-label={ariaLabel}
      checked={checked}
      onChange={onChange}
      className={`${checkboxInputClassName} ${className}`.trim()}
    />
  )
}
