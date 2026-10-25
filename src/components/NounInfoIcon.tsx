import infoIcon from '@/assets/noun_Info_6553140.svg'

export function NounInfoIcon({ className = 'size-3.5' }: { className?: string }) {
  return <img src={infoIcon} alt="" aria-hidden className={className} />
}
