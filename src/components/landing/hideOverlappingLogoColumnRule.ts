const RULE_SELECTOR = '.landing-how-it-works-column-rule, .landing-hide-if-overlaps-how-it-works'
const STAGE_SELECTOR = '.landing-how-it-works-stage'

export function logoColumnOverlapsBox(line: DOMRect, box: DOMRect): boolean {
  if (line.width <= 0 && line.height <= 0) return false
  if (box.width <= 0 || box.height <= 0) return false
  const x = line.left + line.width / 2
  const overlapsX = x >= box.left && x <= box.right
  const overlapsY = line.bottom > box.top && line.top < box.bottom
  return overlapsX && overlapsY
}

function syncLogoColumnRules(root: ParentNode): void {
  const stage = root.querySelector(STAGE_SELECTOR)
  if (!(stage instanceof HTMLElement)) return
  const box = stage.getBoundingClientRect()
  root.querySelectorAll(RULE_SELECTOR).forEach((node) => {
    if (!(node instanceof HTMLElement)) return
    node.dataset.overlap = logoColumnOverlapsBox(node.getBoundingClientRect(), box) ? 'true' : 'false'
  })
}

/** Hide logo-column vertical rules that geometrically cross the How It Works card. */
export function bindHideOverlappingLogoColumnRules(root: ParentNode): () => void {
  let frame = 0
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      syncLogoColumnRules(root)
    })
  }

  schedule()

  const observer = new ResizeObserver(schedule)
  if (root instanceof Element) observer.observe(root)
  const stage = root.querySelector(STAGE_SELECTOR)
  if (stage) observer.observe(stage)
  observer.observe(document.documentElement)

  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, { passive: true })
  void document.fonts?.ready.then(schedule)

  return () => {
    if (frame) cancelAnimationFrame(frame)
    observer.disconnect()
    window.removeEventListener('resize', schedule)
    window.removeEventListener('scroll', schedule)
  }
}
