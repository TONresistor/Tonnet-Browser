/**
 * Site favicon with a Globe fallback.
 * Renders the favicon image when present and hides it on load error (matching
 * the previous inline behavior); renders a Globe icon when no favicon is set.
 */

import { Globe } from 'lucide-react'

interface FaviconProps {
  src?: string | null
  alt?: string
  /** Classes for the <img>. */
  className?: string
  /** Classes for the fallback Globe (defaults to `className`). */
  fallbackClassName?: string
}

export function Favicon({ src, alt = '', className, fallbackClassName }: FaviconProps) {
  if (!src) {
    return <Globe className={fallbackClassName ?? className} />
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
    />
  )
}
