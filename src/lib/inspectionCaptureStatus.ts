export type InspectionCaptureSessionStatus =
  | 'waiting'
  | 'connected'
  | 'active'
  | 'completed'
  | 'expired'
  | 'revoked'

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
