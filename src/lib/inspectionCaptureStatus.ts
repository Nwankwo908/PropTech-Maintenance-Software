export type InspectionCaptureSessionStatus =
  | 'waiting'
  | 'connected'
  | 'active'
  | 'completed'
  | 'expired'
  | 'revoked'

/**
 * On phones / coarse-pointer devices the user is already mobile — skip the
 * desktop “scan QR / use your phone” handoff and open the camera directly.
 */
export function prefersDirectEquipmentCameraCapture(
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0,
  coarsePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches,
): boolean {
  if (/iPhone|iPad|iPod|Android|Mobile|webOS|Silk/i.test(userAgent)) return true
  if (maxTouchPoints > 1 && /Mac/i.test(userAgent)) return true
  return Boolean(coarsePointer)
}

export function inspectionCaptureDesktopStatusLabel(
  status: InspectionCaptureSessionStatus | string,
  photoCount: number,
): { headline: string; detail: string } {
  if (status === 'completed' || status === 'revoked') {
    return {
      headline: photoCount > 0 ? `${photoCount} photos received` : 'Session ended',
      detail: 'You can continue the inspection on this computer.',
    }
  }
  if (status === 'expired') {
    return {
      headline: 'Session expired',
      detail: 'Start a new phone capture if you still need photos.',
    }
  }
  if (photoCount > 0 || status === 'active') {
    return {
      headline: 'Receiving photos',
      detail: `${photoCount} photo${photoCount === 1 ? '' : 's'} received`,
    }
  }
  if (status === 'connected') {
    return {
      headline: 'Phone connected',
      detail: 'Photos you take will appear here automatically.',
    }
  }
  return {
    headline: 'Waiting for phone',
    detail: 'Photos you take will appear here automatically.',
  }
}
