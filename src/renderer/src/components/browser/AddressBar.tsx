/**
 * URL address bar with navigation input.
 * Shows current URL and handles navigation.
 */

import { useState, useEffect, FormEvent } from 'react'
import { Lock, Star, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settings'
import { useBookmarksStore } from '@/stores/bookmarks'
import { useTabsStore } from '@/stores/tabs'
import { cn } from '@/lib/utils'
import tonIcon from '@/assets/ton.png'

// Helper to strip http:// prefix for display
const stripHttpPrefix = (url: string) => url.replace(/^https?:\/\//, '')

// Helper to extract hostname from URL for bookmark name
const getHostname = (url: string): string => {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    // Fallback: strip protocol and get first segment
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}

export function AddressBar() {
  const { currentUrl, isLoading } = useSettingsStore()
  const { bookmarks, addBookmark, removeBookmark } = useBookmarksStore()
  const { navigateActiveTab } = useTabsStore()
  const [input, setInput] = useState('')

  const isBookmarked = bookmarks.some((b) => b.url === currentUrl)
  const isTonSite = currentUrl.includes('.ton') || currentUrl.includes('.adnl') || currentUrl.includes('.t.me')
  const isInternalPage = currentUrl.startsWith('ton://')

  // Display URL without http:// for TON sites
  useEffect(() => {
    if (isTonSite) {
      setInput(stripHttpPrefix(currentUrl))
    } else {
      setInput(currentUrl)
    }
  }, [currentUrl, isTonSite])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    let navigateUrl = input.trim()

    if (!navigateUrl) return

    // Internal pages - pass through unchanged
    if (navigateUrl.startsWith('ton://')) {
      navigateActiveTab(navigateUrl)
      return
    }

    // Remove protocol to analyze the domain
    const urlWithoutProtocol = navigateUrl.replace(/^https?:\/\//, '')

    // Split into host and path
    const slashIndex = urlWithoutProtocol.indexOf('/')
    const hostPart = slashIndex >= 0 ? urlWithoutProtocol.slice(0, slashIndex) : urlWithoutProtocol
    const pathPart = slashIndex >= 0 ? urlWithoutProtocol.slice(slashIndex) : ''

    // If no dot in hostname, append .ton (e.g., "example" → "example.ton")
    const finalHost = hostPart.includes('.') ? hostPart : `${hostPart}.ton`

    // Navigate with http://
    navigateActiveTab(`http://${finalHost}${pathPart}`)
  }

  const toggleBookmark = () => {
    if (isBookmarked) {
      const bookmark = bookmarks.find((b) => b.url === currentUrl)
      if (bookmark) {
        removeBookmark(bookmark.id)
      }
    } else {
      // Use hostname as bookmark name (e.g., "example.ton")
      addBookmark(currentUrl, getHostname(currentUrl))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-1 min-w-[400px] no-drag" role="search">
      <div
        className="relative flex-1 flex items-center rounded-full bg-surface border border-surface-hover backdrop-blur-[20px]"
      >
        {/* TON site badge */}
        {isTonSite && !isLoading ? (
          <div className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-primary text-primary-foreground" aria-hidden="true">
            <Lock className="h-3 w-3" />
            <span>tonsite://</span>
          </div>
        ) : (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10" aria-hidden="true">
            {isLoading ? (
              <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
            ) : (
              <img src={tonIcon} alt="" className="h-4 w-4" />
            )}
          </div>
        )}

        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={(e) => e.target.select()}
          className={cn(
            'pr-10 h-8 bg-transparent border-0 rounded-full focus:ring-0 focus:outline-none',
            isTonSite && !isLoading ? 'pl-24' : 'pl-10'
          )}
          placeholder="Enter .ton address..."
          aria-label="Enter URL or TON address"
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full"
          onClick={toggleBookmark}
          disabled={!currentUrl || isInternalPage}
          title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
          aria-label={isBookmarked ? 'Remove from bookmarks' : 'Add to bookmarks'}
          aria-pressed={isBookmarked}
        >
          <Star
            className={cn(
              'h-3.5 w-3.5',
              isBookmarked ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground'
            )}
            aria-hidden="true"
          />
        </Button>
      </div>
    </form>
  )
}
