import uiClickSoundUrl from '@/assets/ui-click.mp3'

let clickAudio: HTMLAudioElement | null = null

function playFirstHalf(audio: HTMLAudioElement): void {
  const stopAtHalf = () => {
    if (!Number.isFinite(audio.duration)) return
    if (audio.currentTime >= audio.duration / 2) {
      audio.pause()
      audio.currentTime = 0
      audio.removeEventListener('timeupdate', stopAtHalf)
    }
  }

  audio.removeEventListener('timeupdate', stopAtHalf)
  audio.currentTime = 0
  audio.addEventListener('timeupdate', stopAtHalf)
  void audio.play().catch(() => {})
}

/** Preload the click clip so the first button press can play immediately. */
export function primeUiClickSound(): void {
  if (typeof window === 'undefined' || clickAudio) return
  clickAudio = new Audio(uiClickSoundUrl)
  clickAudio.preload = 'auto'
  clickAudio.load()
}

export function playUiClickSound(): void {
  if (typeof window === 'undefined') return

  if (!clickAudio) {
    primeUiClickSound()
  }

  if (clickAudio) {
    playFirstHalf(clickAudio)
    return
  }

  const oneShot = new Audio(uiClickSoundUrl)
  oneShot.volume = 1
  playFirstHalf(oneShot)
}
