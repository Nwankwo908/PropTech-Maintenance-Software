/** Shared chrome for admin overview / property right rails. */

export type AdminRightRailStackedPosition = 'left' | 'right'

const PANEL_BASE =
  'sa-rail relative flex h-full max-h-dvh w-full flex-col overflow-hidden border border-[#e5e7eb] bg-white shadow-[0px_8px_24px_rgba(0,0,0,0.12)]'

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

export const ADMIN_RIGHT_RAIL_SCRIM = 'sa-scrim absolute inset-0 bg-black/40'

/** Inline attention-row action (Overview + Needs Your Attention rail). */
export const ADMIN_ATTENTION_ACTION_CLASS =
  'sa-press shrink-0 rounded-[10px] px-4 py-2 text-[13px] font-medium leading-5 text-[#0A4D38] hover:opacity-80'

/** Right-rail footer shell — stacked full-width actions. */
export const ADMIN_RAIL_FOOTER_CLASS =
  'flex shrink-0 flex-col gap-2 border-t border-[#e5e7eb] px-6 py-4'

export const ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS =
  'sa-press inline-flex min-h-[44px] w-full items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-[13px] font-medium text-[#364153] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50'

export const ADMIN_RAIL_FOOTER_PRIMARY_BUTTON_CLASS =
  'sa-press inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] bg-[#0a4d38] px-4 py-2.5 text-[13px] font-medium text-white outline-none hover:bg-[#083828] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50'

export const ADMIN_RAIL_FOOTER_DARK_PRIMARY_BUTTON_CLASS =
  'sa-press inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] bg-[#0a0a0a] px-4 py-2.5 text-[13px] font-medium text-white outline-none hover:bg-[#1f2937] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50'

export const ADMIN_RAIL_FOOTER_DANGER_BUTTON_CLASS =
  'sa-press inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] bg-[#fb2c36] px-4 py-2.5 text-[13px] font-medium text-white outline-none hover:bg-[#e11d48] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50'

export const ADMIN_RAIL_FOOTER_DANGER_STROKE_BUTTON_CLASS =
  'sa-press inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] border border-[#DA4951] bg-white px-4 py-2.5 text-[13px] font-medium text-[#DA4951] outline-none hover:bg-[#DA4951]/8 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50'
