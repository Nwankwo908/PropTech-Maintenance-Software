type IconProps = { className?: string }

export function IconArrowRight({ className = 'size-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 8h9M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconChevronRight({ className = 'size-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconSparkle({ className = 'size-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5l1 3.5 3.5 1-3.5 1L8 10.5 6.5 7 3 6l3.5-1L8 1.5z"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconMessage({ className = 'size-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 3.5h11v7h-3.5L6 13.5V10.5H2.5v-7z"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconCpu({ className = 'size-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth={1.3} />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2M4 2v2M12 2v2M4 12v2M12 12v2" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
    </svg>
  )
}

export function IconUsers({ className = 'size-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="6" cy="5.5" r="2" stroke="currentColor" strokeWidth={1.3} />
      <path d="M2.5 13c0-2 1.6-3.5 3.5-3.5S9.5 11 9.5 13" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <circle cx="11" cy="6" r="1.5" stroke="currentColor" strokeWidth={1.2} />
      <path d="M10 13c.2-1.4 1-2.2 2.2-2.2" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
    </svg>
  )
}

export function IconLayout({ className = 'size-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth={1.3} />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth={1.3} />
      <rect x="2" y="9" width="12" height="5" rx="1" stroke="currentColor" strokeWidth={1.3} />
    </svg>
  )
}

export function IconExcel({ className = 'size-5' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 25 28" fill="none" aria-hidden>
      <path
        d="M4 2h12l5 5v19a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z"
        fill="#107C41"
      />
      <path d="M16 2v5h5" fill="#33C481" />
      <path
        d="M7 10h6M7 14h6M7 18h4"
        stroke="white"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    </svg>
  )
}

type FileBadgeIconProps = IconProps & {
  bannerColor: string
  label: string
}

function FileBadgeIcon({ className = 'size-5', bannerColor, label }: FileBadgeIconProps) {
  const fontSize = label.length > 4 ? 4.1 : 5

  return (
    <svg className={className} viewBox="0 0 25 28" fill="none" aria-hidden>
      <path
        d="M4 2h12l5 5v19a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z"
        fill="white"
        stroke="#d1d5db"
        strokeWidth={0.6}
      />
      <path d="M16 2v5h5" fill="#e5e7eb" />
      <path d="M6 7h9M6 10h9" stroke="#e5e7eb" strokeWidth={0.8} strokeLinecap="round" />
      <rect x="3" y="15" width="19" height="9" rx="1.5" fill={bannerColor} />
      <text
        x="12.5"
        y="21.5"
        textAnchor="middle"
        fill="white"
        fontSize={fontSize}
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {label}
      </text>
    </svg>
  )
}

export function IconPdf({ className = 'size-5' }: IconProps) {
  return <FileBadgeIcon className={className} bannerColor="#E5252A" label="PDF" />
}

export function IconGoogleDocs({ className = 'size-5' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 25 28" fill="none" aria-hidden>
      <path
        d="M4 2h12l5 5v19a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z"
        fill="#4285F4"
      />
      <path d="M16 2v5h5" fill="#669DF6" />
      <path d="M7 9h6M7 12h6M7 15h4" stroke="white" strokeWidth={1.2} strokeLinecap="round" />
    </svg>
  )
}

export function IconHeic({ className = 'size-5' }: IconProps) {
  return <FileBadgeIcon className={className} bannerColor="#2563EB" label="HEIC" />
}

export function IconJpg({ className = 'size-5' }: IconProps) {
  return <FileBadgeIcon className={className} bannerColor="#38BDF8" label="JPG" />
}

export function IconPng({ className = 'size-5' }: IconProps) {
  return <FileBadgeIcon className={className} bannerColor="#7C3AED" label="PNG" />
}

export function IconTif({ className = 'size-5' }: IconProps) {
  return <FileBadgeIcon className={className} bannerColor="#7C3AED" label="TIF" />
}

export function IconTiff({ className = 'size-5' }: IconProps) {
  return <FileBadgeIcon className={className} bannerColor="#3B82F6" label="TIFF" />
}

export const LANDING_DOCUMENT_IMPORT_ICONS = [
  IconExcel,
  IconPdf,
  IconGoogleDocs,
  IconHeic,
  IconJpg,
  IconPng,
  IconTif,
  IconTiff,
] as const

export function IconMenu({ className = 'size-5' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M3 5h14M3 10h14M3 15h14"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  )
}

export function IconClose({ className = 'size-5' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  )
}
