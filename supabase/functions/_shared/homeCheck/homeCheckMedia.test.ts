import { describe, expect, it } from 'vitest'
import {
  gateHomeCheckSmsMedia,
  isHomeCheckAcceptedMediaType,
  isHomeCheckVideoMediaType,
  HOME_CHECK_IMAGE_MAX_BYTES,
  HOME_CHECK_VIDEO_MAX_BYTES,
} from './homeCheckMedia.ts'

describe('homeCheckMedia', () => {
  it('accepts still photos and common phone-camera videos', () => {
    expect(isHomeCheckAcceptedMediaType('image/jpeg')).toBe(true)
    expect(isHomeCheckAcceptedMediaType('image/png')).toBe(true)
    expect(isHomeCheckAcceptedMediaType('image/webp')).toBe(true)
    expect(isHomeCheckAcceptedMediaType('video/mp4')).toBe(true)
    expect(isHomeCheckAcceptedMediaType('video/quicktime')).toBe(true)
    expect(isHomeCheckAcceptedMediaType('video/3gpp')).toBe(true)
    expect(isHomeCheckAcceptedMediaType('video/webm')).toBe(true)
    expect(isHomeCheckAcceptedMediaType('application/pdf')).toBe(false)
    expect(isHomeCheckVideoMediaType('video/mp4')).toBe(true)
    expect(isHomeCheckVideoMediaType('image/jpeg')).toBe(false)
  })

  it('gates size by media kind', () => {
    expect(
      gateHomeCheckSmsMedia({ contentType: 'video/mp4', sizeBytes: 12 * 1024 * 1024 }),
    ).toMatchObject({ ok: true, isVideo: true })
    expect(
      gateHomeCheckSmsMedia({
        contentType: 'video/quicktime',
        sizeBytes: HOME_CHECK_VIDEO_MAX_BYTES,
      }),
    ).toMatchObject({ ok: true })
    expect(
      gateHomeCheckSmsMedia({
        contentType: 'image/jpeg',
        sizeBytes: HOME_CHECK_IMAGE_MAX_BYTES + 1,
      }),
    ).toMatchObject({ ok: false })
    expect(
      gateHomeCheckSmsMedia({
        contentType: 'video/mp4',
        sizeBytes: HOME_CHECK_VIDEO_MAX_BYTES + 1,
      }).ok,
    ).toBe(false)
  })

  it('does not use the old JPEG-only reject for phone video', () => {
    const rejected = gateHomeCheckSmsMedia({
      contentType: 'application/pdf',
      sizeBytes: 1000,
    })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.reply).not.toBe('Please send a JPEG, PNG or WebP photo under 10 MB.')
      expect(rejected.reply.toLowerCase()).toMatch(/photo|video/)
    }
    expect(
      gateHomeCheckSmsMedia({ contentType: 'video/mp4', sizeBytes: 2_000_000 }),
    ).toEqual({
      ok: true,
      mime: 'video/mp4',
      maxBytes: HOME_CHECK_VIDEO_MAX_BYTES,
      isVideo: true,
    })
  })
})
