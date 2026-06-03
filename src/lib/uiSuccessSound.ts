import uiSuccessSoundUrl from '@/assets/ui-success.wav'

const SUCCESS_PLAY_SECONDS = 3

let successAudio: HTMLAudioElement | null = null

function playForSeconds(audio: HTMLAudioElement, seconds: number): void {
  const stopAtLimit = () => {
    if (audio.currentTime >= seconds) {
      audio.pause()
      audio.currentTime = 0
      audio.removeEventListener('timeupdate', stopAtLimit)
    }
  }

  audio.removeEventListener('timeupdate', stopAtLimit)
  audio.currentTime = 0
  audio.addEventListener('timeupdate', stopAtLimit)
  void audio.play().catch(() => {})
}

/** Preload success clip for waitlist confirmation. */
export function primeWaitlistSuccessSound(): void {
  if (typeof window === 'undefined' || successAudio) return
  successAudio = new Audio(uiSuccessSoundUrl)
  successAudio.preload = 'auto'
  successAudio.load()
}

/** Play the first three seconds of the waitlist success sound. */
export function playWaitlistSuccessSound(): void {
  if (typeof window === 'undefined') return

  if (!successAudio) {
    primeWaitlistSuccessSound()
  }

  if (successAudio) {
    playForSeconds(successAudio, SUCCESS_PLAY_SECONDS)
    return
  }

  const oneShot = new Audio(uiSuccessSoundUrl)
  oneShot.volume = 1
  playForSeconds(oneShot, SUCCESS_PLAY_SECONDS)
}
