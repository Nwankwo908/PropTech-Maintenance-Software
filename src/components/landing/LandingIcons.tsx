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

/** Noun Project graph icon — property / workflow graph. */
export function IconGraph({ className = 'size-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 2 24 20" fill="currentColor" aria-hidden>
      <path d="m 20,4 c -1.098645,0 -2,0.901355 -2,2 0,0.567469 0.241077,1.0820884 0.625,1.4472656 L 15.503906,13.064453 C 15.342741,13.022111 15.173833,13 15,13 c -0.369014,0 -0.715852,0.102602 -1.013672,0.279297 L 10.720703,10.013672 C 10.897398,9.7158523 11,9.3690136 11,9 11,7.901355 10.098645,7 9,7 7.901355,7 7,7.901355 7,9 7,9.5674689 7.2410769,10.082088 7.625,10.447266 L 4.5039062,16.064453 C 4.3427405,16.022111 4.1738331,16 4,16 2.901355,16 2,16.901355 2,18 2,19.098645 2.901355,20 4,20 5.098645,20 6,19.098645 6,18 6,17.432531 5.7589231,16.917912 5.375,16.552734 L 8.4960938,10.935547 C 8.6572595,10.977889 8.8261669,11 9,11 c 0.3690136,0 0.7158523,-0.102602 1.013672,-0.279297 l 3.265625,3.265625 C 13.102602,14.284148 13,14.630986 13,15 c 0,1.098645 0.901355,2 2,2 1.098645,0 2,-0.901355 2,-2 0,-0.567469 -0.241077,-1.082088 -0.625,-1.447266 L 19.496094,7.9355469 C 19.657259,7.977889 19.826167,8 20,8 21.098645,8 22,7.098645 22,6 22,4.901355 21.098645,4 20,4 Z m 0,1 c 0.558206,0 1,0.4417941 1,1 0,0.5582059 -0.441794,1 -1,1 C 19.441794,7 19,6.5582059 19,6 19,5.4417941 19.441794,5 20,5 Z M 9,8 c 0.5582059,0 1,0.4417941 1,1 0,0.5582059 -0.4417941,1 -1,1 C 8.4417941,10 8,9.5582059 8,9 8,8.4417941 8.4417941,8 9,8 Z m 6,6 c 0.172194,0 0.332169,0.04266 0.472656,0.117188 a 0.5,0.5 0 0 0 0.01367,0.0098 0.5,0.5 0 0 0 0.01172,0.0039 C 15.799062,14.301897 16,14.62433 16,15 c 0,0.558206 -0.441794,1 -1,1 -0.558206,0 -1,-0.441794 -1,-1 0,-0.558206 0.441794,-1 1,-1 z M 4,17 c 0.5582059,0 1,0.441794 1,1 0,0.558206 -0.4417941,1 -1,1 -0.5582059,0 -1,-0.441794 -1,-1 0,-0.558206 0.4417941,-1 1,-1 z" />
    </svg>
  )
}

/** Noun Project focus icon — Features section label. */
export function IconFocusFeature({ className = 'size-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8,16a8,8,0,1,1,8-8A8.009,8.009,0,0,1,8,16ZM8,1a7,7,0,1,0,7,7A7.008,7.008,0,0,0,8,1Z" />
      <path d="M6,11H4.5a.5.5,0,0,1-.5-.5v-5A.5.5,0,0,1,4.5,5H6A.5.5,0,0,1,6,6H5v4H6a.5.5,0,0,1,0,1Z" />
      <path d="M11.5,11H10a.5.5,0,0,1,0-1h1V6H10a.5.5,0,0,1,0-1h1.5a.5.5,0,0,1,.5.5v5A.5.5,0,0,1,11.5,11Z" />
    </svg>
  )
}

/** Noun Project roadmap icon — How it works label. */
export function IconRoadmap({ className = 'size-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 100 90" fill="currentColor" aria-hidden>
      <path d="m21.875 52.082h13.707c0.66797 4.668 3.5547 8.7188 7.7422 10.879 4.1875 2.1602 9.1641 2.1602 13.352 0 4.1875-2.1602 7.0742-6.2109 7.7422-10.879h13.707c6.3281 0 12.172-3.375 15.336-8.8516 3.1641-5.4805 3.1641-12.23 0-17.711-3.1641-5.4766-9.0078-8.8516-15.336-8.8516h-44.957c-0.71094-4.9141-3.8672-9.125-8.3828-11.188-4.5117-2.0586-9.7656-1.6797-13.938 1.0039-4.1758 2.6836-6.6992 7.3047-6.6992 12.266s2.5234 9.582 6.6992 12.266c4.1719 2.6836 9.4258 3.0625 13.938 1.0039 4.5156-2.0625 7.6719-6.2734 8.3828-11.188h44.957c7.4805 0 13.543 6.0625 13.543 13.543s-6.0625 13.543-13.543 13.543h-13.707c-0.66797-4.668-3.5547-8.7188-7.7422-10.879-4.1875-2.1602-9.1641-2.1602-13.352 0-4.1875 2.1602-7.0742 6.2109-7.7422 10.879h-13.707c-6.3281 0-12.172 3.375-15.336 8.8516-3.1641 5.4805-3.1641 12.23 0 17.711 3.1641 5.4766 9.0078 8.8516 15.336 8.8516h44.957c0.71094 4.9141 3.8672 9.125 8.3828 11.188 4.5117 2.0586 9.7656 1.6797 13.938-1.0039 4.1758-2.6836 6.6992-7.3047 6.6992-12.266s-2.5234-9.582-6.6992-12.266c-4.1719-2.6836-9.4258-3.0625-13.938-1.0039-4.5156 2.0625-7.6719 6.2734-8.3828 11.188h-44.957c-7.4805 0-13.543-6.0625-13.543-13.543s6.0625-13.543 13.543-13.543zm-3.125-22.914c-4.2148 0-8.0117-2.5391-9.625-6.4336-1.6094-3.8906-0.71875-8.3711 2.2578-11.352 2.9805-2.9766 7.4609-3.8672 11.352-2.2578 3.8945 1.6133 6.4336 5.4102 6.4336 9.625-0.007813 5.75-4.668 10.41-10.418 10.418zm31.25 10.418v-0.003907c4.2148 0 8.0117 2.5391 9.625 6.4336 1.6094 3.8906 0.71875 8.3711-2.2578 11.352-2.9805 2.9766-7.4609 3.8672-11.352 2.2578-3.8945-1.6133-6.4336-5.4102-6.4336-9.625 0.007813-5.75 4.668-10.41 10.418-10.418zm31.25 31.246c4.2148 0 8.0117 2.5391 9.625 6.4336 1.6094 3.8906 0.71875 8.3711-2.2578 11.352-2.9805 2.9766-7.4609 3.8672-11.352 2.2578-3.8945-1.6133-6.4336-5.4102-6.4336-9.625 0.007813-5.75 4.668-10.41 10.418-10.418z" />
    </svg>
  )
}
