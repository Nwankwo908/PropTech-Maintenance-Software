export const HOME_CHECK_CHANGED_EVENT = 'ulo:home-check-changed'

export function notifyHomeCheckChanged(propertyId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(HOME_CHECK_CHANGED_EVENT, { detail: { propertyId } }),
  )
}
