export function serialReviewInput(body: Record<string, unknown>): { serial: string | null; unknown: boolean } {
  if (typeof body.unknown !== 'boolean') throw new Error('Choose whether the serial is readable or unknown.')
  if (body.unknown) return { serial: null, unknown: true }
  if (typeof body.serial !== 'string') throw new Error('Enter the serial number visible on the label.')
  const serial = body.serial.trim()
  if (!serial || serial.length > 80 || /[?\[\]{}\r\n/]/.test(serial)) throw new Error('Enter only the serial number visible on the label.')
  return { serial, unknown: false }
}
