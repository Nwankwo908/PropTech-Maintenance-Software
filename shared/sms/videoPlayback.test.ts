import { describe, expect, it } from 'vitest'
import { playbackSiblingPath } from './media.ts'
import {
  browserPlaybackFfmpegArgs,
  choosePlaybackPreview,
  conversionAccessDecision,
  inputHasAudioStream,
  outputPlaybackCheck,
  playbackStatusPath,
  shouldStartPlaybackJob,
} from './videoPlayback.ts'

const HEATER = 'sms/97b9b057-950d-4ce2-97af-e5ebc69cea1e/a42f19df-5c14-4dcf-93aa-8135fd081f77/1793733659659-0.3gp'
const OTHER = 'de300000-0000-4000-8000-000000000004'

describe('sms video playback', () => {
  it('keeps the playable copy beside the original', () => {
    expect(playbackSiblingPath(HEATER)).toBe(
      'sms/97b9b057-950d-4ce2-97af-e5ebc69cea1e/a42f19df-5c14-4dcf-93aa-8135fd081f77/1793733659659-0.playback.mp4',
    )
    expect(playbackStatusPath(HEATER)).toBe(
      'sms/97b9b057-950d-4ce2-97af-e5ebc69cea1e/a42f19df-5c14-4dcf-93aa-8135fd081f77/1793733659659-0.playback.json',
    )
  })

  it('denies another account and accepts the owning account', () => {
    expect(conversionAccessDecision({
      path: HEATER,
      conversationFound: true,
      resourceLandlordId: 'de300000-0000-4000-8000-000000000003',
      mode: 'user',
      userCanAccess: false,
    })).toEqual({ ok: false, status: 403, error: 'You do not have access to this conversation.' })

    expect(conversionAccessDecision({
      path: HEATER,
      conversationFound: true,
      resourceLandlordId: OTHER,
      mode: 'user',
      userCanAccess: true,
    }).ok).toBe(true)

    expect(conversionAccessDecision({
      path: 'sms/not-a-conversation/clip.3gp',
      conversationFound: false,
      resourceLandlordId: null,
      mode: 'service',
      userCanAccess: false,
    }).ok).toBe(false)
  })

  it('does not start a second encode while one is fresh, and retries a failed one', () => {
    const now = Date.parse('2026-11-04T22:00:00.000Z')
    expect(shouldStartPlaybackJob({
      status: 'processing',
      updatedAt: '2026-11-04T21:59:30.000Z',
    }, false, now)).toBe('wait')
    expect(shouldStartPlaybackJob({
      status: 'failed',
      updatedAt: '2026-11-04T21:00:00.000Z',
    }, false, now)).toBe('start')
    expect(shouldStartPlaybackJob({
      status: 'ready',
      updatedAt: '2026-11-04T21:00:00.000Z',
    }, true, now)).toBe('skip-ready')
    expect(shouldStartPlaybackJob(null, false, now)).toBe('start')
  })

  it('asks for H.264 and keeps AAC when the original has audio', () => {
    const withAudio = browserPlaybackFfmpegArgs('in.3gp', 'out.mp4', true)
    expect(withAudio).toContain('libx264')
    expect(withAudio).toContain('aac')
    expect(browserPlaybackFfmpegArgs('in.3gp', 'out.mp4', false)).toContain('-an')
    const info = 'Stream #0:0[0x1](eng): Video: h263\nStream #0:1[0x2](eng): Audio: amr_nb'
    expect(inputHasAudioStream(info)).toBe(true)
    expect(outputPlaybackCheck('Stream #0:0[0x1](und): Video: h264\nStream #0:1[0x2](und): Audio: aac', true).ok).toBe(true)
    expect(outputPlaybackCheck('Stream #0:0: Video: h264', true).ok).toBe(false)
  })

  it('shows a captionless video even when the preview is not ready', () => {
    expect(choosePlaybackPreview({
      needsConversion: true,
      playbackReady: false,
      playbackUrl: '',
      downloadUrl: 'https://signed.example/original.3gp',
      status: null,
    })).toMatchObject({ previewStatus: 'unavailable', downloadUrl: 'https://signed.example/original.3gp' })
    expect(choosePlaybackPreview({
      needsConversion: true,
      playbackReady: false,
      playbackUrl: '',
      downloadUrl: 'https://signed.example/original.3gp',
      status: 'failed',
    }).previewStatus).toBe('failed')
    expect(choosePlaybackPreview({
      needsConversion: true,
      playbackReady: true,
      playbackUrl: 'https://signed.example/play.mp4',
      downloadUrl: 'https://signed.example/original.3gp',
      status: 'ready',
    })).toMatchObject({
      previewStatus: 'ready',
      url: 'https://signed.example/play.mp4',
      downloadUrl: 'https://signed.example/original.3gp',
    })
    expect(choosePlaybackPreview({
      needsConversion: true,
      playbackReady: false,
      playbackUrl: 'https://signed.example/play.mp4',
      downloadUrl: 'https://signed.example/original.3gp',
      status: 'ready',
    })).toMatchObject({
      previewStatus: 'ready',
      url: 'https://signed.example/play.mp4',
    })
  })
})