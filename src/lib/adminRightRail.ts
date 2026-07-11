/** Shared chrome for admin overview / property right rails. */

export type AdminRightRailStackedPosition = 'left' | 'right'

const PANEL_BASE =
  'relative flex h-full max-h-dvh w-full flex-col overflow-hidden border border-[#e5e7eb] bg-white shadow-[0px_8px_24px_rgba(0,0,0,0.12)]'

/** Solo or stacked panel shell (pass Tailwind max-width class). */
export function adminRightRailPanelClass(
  stackedPosition: AdminRightRailStackedPosition | undefined,
  maxWidthClass = 'max-w-[min(100vw,520px)]',
): string {
  const rounded =
    stackedPosition === 'left'
      ? 'rounded-l-[12px] rounded-r-none border-r-0'
      : stackedPosition === 'right'
        ? 'rounded-none border-l-0'
        : 'rounded-l-[12px]'
  return `${PANEL_BASE} ${maxWidthClass} ${rounded}`
}

/** Overlay host for a single rail (not used when panelOnly). */
export const ADMIN_RIGHT_RAIL_OVERLAY_HOST =
  'fixed inset-0 z-50 flex justify-end'

/** Overlay host when two rails are stacked side-by-side. */
export const ADMIN_RIGHT_RAIL_STACK_HOST =
  'fixed inset-0 z-[55] flex justify-end'

export const ADMIN_RIGHT_RAIL_SCRIM = 'absolute inset-0 bg-black/40'
