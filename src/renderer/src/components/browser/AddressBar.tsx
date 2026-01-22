/**
 * URL address bar with navigation input.
 * Shows current URL and handles navigation.
 * Features history-based autocomplete suggestions.
 */

import { useState, useEffect, FormEvent, useRef } from 'react'
import { Lock, Star, Loader2, Clock, History } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settings'
import { useBookmarksStore } from '@/stores/bookmarks'
import { useTabsStore } from '@/stores/tabs'
import { cn } from '@/lib/utils'
import tonIcon from '@/assets/ton.png'
import { useTranslation } from 'react-i18next'

interface HistorySuggestion {
  id: string
  url: string
  title: string
  visitedAt: number
  visitCount: number
}

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
  const { t } = useTranslation('browser')
  const { currentUrl, isLoading } = useSettingsStore()
  const { bookmarks, addBookmark, removeBookmark } = useBookmarksStore()
  const { navigateActiveTab, tabs, activeTabId } = useTabsStore()
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<HistorySuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

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

  // Fetch history suggestions when input changes
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!input.trim() || !isFocused || input === currentUrl || input === stripHttpPrefix(currentUrl)) {
        setSuggestions([])
        setShowSuggestions(false)
        return
      }

      try {
        const results = await window.electron.history.search(input.trim(), 5)
        setSuggestions(results)
        setShowSuggestions(results.length > 0)
        setSelectedIndex(-1)
      } catch (error) {
        setSuggestions([])
        setShowSuggestions(false)
      }
    }

    const debounce = setTimeout(fetchSuggestions, 200)
    return () => clearTimeout(debounce)
  }, [input, isFocused, currentUrl])

  // Handle click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()

    // If suggestion is selected, use it
    if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
      const suggestion = suggestions[selectedIndex]
      navigateActiveTab(suggestion.url)
      setShowSuggestions(false)
      return
    }

    let navigateUrl = input.trim()

    if (!navigateUrl) return

    // Hide suggestions
    setShowSuggestions(false)

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
        break
      case 'Escape':
        setShowSuggestions(false)
        setSelectedIndex(-1)
        break
      case 'Enter':
        // handleSubmit will handle the selected suggestion
        break
    }
  }

  const handleSuggestionClick = (suggestion: HistorySuggestion) => {
    navigateActiveTab(suggestion.url)
    setShowSuggestions(false)
    setInput(stripHttpPrefix(suggestion.url))
  }

  const toggleBookmark = () => {
    if (isBookmarked) {
      const bookmark = bookmarks.find((b) => b.url === currentUrl)
      if (bookmark) {
        removeBookmark(bookmark.id)
      }
    } else {
      // Get favicon from active tab
      const activeTab = tabs.find((t) => t.id === activeTabId)
      const favicon = activeTab?.favicon

      // Use hostname as bookmark name (e.g., "example.ton")
      addBookmark(currentUrl, getHostname(currentUrl), null, favicon)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-1 min-w-[400px] no-drag" role="search">
      <div className="relative flex-1">
        <div
          className="relative flex items-center rounded-full bg-surface border border-surface-hover backdrop-blur-[20px]"
        >
          {/* TON site badge */}
          {isTonSite && !isLoading ? (
            <div className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-tonsite text-white" aria-hidden="true">
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
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={(e) => {
              e.target.select()
              setIsFocused(true)
            }}
            onBlur={() => {
              // Delay to allow suggestion click to register
              setTimeout(() => setIsFocused(false), 200)
            }}
            onKeyDown={handleKeyDown}
            className={cn(
              'pr-10 h-8 bg-transparent border-0 rounded-full focus:ring-0 focus:outline-none',
              isTonSite && !isLoading ? 'pl-24' : 'pl-10'
            )}
            placeholder={t('addressBar.placeholder')}
            aria-label={t('addressBar.ariaLabel')}
            aria-autocomplete="list"
            aria-controls={showSuggestions ? 'history-suggestions' : undefined}
            aria-expanded={showSuggestions}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full"
            onClick={toggleBookmark}
            disabled={!currentUrl || isInternalPage}
            title={isBookmarked ? t('addressBar.removeBookmarkTitle') : t('addressBar.addBookmarkTitle')}
            aria-label={isBookmarked ? t('addressBar.removeBookmarkAria') : t('addressBar.addBookmarkAria')}
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

        {/* History suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            id="history-suggestions"
            role="listbox"
            className="absolute top-full left-0 right-0 mt-2 bg-surface border border-surface-hover rounded-lg shadow-lg backdrop-blur-[20px] overflow-hidden z-50"
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onClick={() => handleSuggestionClick(suggestion)}
                className={cn(
                  'w-full px-3 py-2 flex items-center gap-3 text-left transition-colors',
                  'hover:bg-surface-hover',
                  index === selectedIndex && 'bg-surface-hover'
                )}
              >
                <History className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{suggestion.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{stripHttpPrefix(suggestion.url)}</div>
                </div>
                {suggestion.visitCount > 1 && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1 flex-shrink-0">
                    <Clock className="h-3 w-3" />
                    <span>{suggestion.visitCount}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </form>
  )
}
