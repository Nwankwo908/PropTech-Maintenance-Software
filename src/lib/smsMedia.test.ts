import { describe, expect, it } from 'vitest'
import {
  inboxPreviewForSmsMessage,
  isProviderAuthMediaUrl,
  isStorageMediaPath,
  mediaKindFromContentType,
  mediaKindFromRef,
} from '@shared/sms/media.ts'

describe('sms media helpers', () => {
  it('treats storage object paths as durable refs', () => {
    expect(isStorageMediaPath('sms/conv/msg/0.jpg')).toBe(true)
    expect(isStorageMediaPath('sms/ticket/1.mp4')).toBe(true)
    expect(isStorageMediaPath('https://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME')).toBe(
      false,
    )
  })

  it('flags Twilio and Telnyx media as unsafe for the browser', () => {
    expect(
      isProviderAuthMediaUrl(
        'https://api.twilio.com/2010-04-01/Accounts/ACxx/Messages/MMxx/Media/MExx',
      ),
    ).toBe(true)
    expect(isProviderAuthMediaUrl('https://media.twilio.com/foo')).toBe(true)
    expect(isProviderAuthMediaUrl('https://api.telnyx.com/v2/media/abc')).toBe(true)
    expect(isProviderAuthMediaUrl('https://example.com/photo.jpg')).toBe(false)
  })

  it('detects image vs video from path, URL, and content type', () => {
    expect(mediaKindFromRef('sms/c/m/0.mp4')).toBe('video')
    expect(mediaKindFromRef('sms/c/m/0.MOV')).toBe('video')
    expect(mediaKindFromRef('sms/c/m/0.jpg')).toBe('image')
    expect(mediaKindFromRef('https://cdn.example/clip.webm')).toBe('video')
    expect(mediaKindFromContentType('video/mp4')).toBe('video')
    expect(mediaKindFromContentType('image/jpeg')).toBe('image')
    expect(mediaKindFromContentType('application/octet-stream')).toBeNull()
  })

  it('uses media copy when the SMS body is empty', () => {
    expect(inboxPreviewForSmsMessage('Leak under the sink', ['sms/c/m/0.jpg'])).toBe(
      'Leak under the sink',
    )
    expect(inboxPreviewForSmsMessage('', ['sms/c/m/0.jpg'])).toBe('Sent a photo')
    expect(inboxPreviewForSmsMessage('', ['sms/c/m/0.jpg', 'sms/c/m/1.png'])).toBe('Sent photos')
    expect(inboxPreviewForSmsMessage('', ['sms/c/m/0.mp4'])).toBe('Sent a video')
    expect(inboxPreviewForSmsMessage('', ['sms/c/m/0.jpg', 'sms/c/m/1.mp4'])).toBe(
      'Sent a photo and a video',
    )
    expect(inboxPreviewForSmsMessage('', [])).toBe('No messages yet.')
  })
})
