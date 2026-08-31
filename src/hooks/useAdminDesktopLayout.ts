import { useEffect, useState } from 'react'

/** Tailwind `lg` breakpoint — admin chrome switches from mobile to desktop here. */
export const ADMIN_DESKTOP_MEDIA = '(min-width: 1024px)'

/** True when the viewport is desktop admin layout (`lg` and up). */
export function useAdminDesktopLayout(): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(ADMIN_DESKTOP_MEDIA).matches : true,
  )

  useEffect(() => {
    const mq = window.matchMedia(ADMIN_DESKTOP_MEDIA)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return matches
}
