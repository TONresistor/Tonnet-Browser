/**
 * URL address bar with navigation input.
 * Shows current URL and handles navigation.
 * Features history-based autocomplete suggestions.
 */

import { useState, useEffect, FormEvent, useRef, useMemo, memo, useCallback } from 'react'
import { Lock, Star, LoaderCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useBrowserStore } from '@/stores/browser'
import { useBookmarksStore } from '@/stores/bookmarks'
import { useTabsStore } from '@/stores/tabs'
import { cn } from '@/lib/utils'
import { processNavigationInput, stripHttpPrefix, getHostname } from '@/lib/url-utils'
import tonIcon from '@/assets/ton.png'
import { useTranslation } from 'react-i18next'
import { useOverlay } from '@/hooks/useOverlay'
import { TipButton } from './TipButton'
import { useWalletStore, formatTonAmount } from '@/stores/wallet'

interface HistorySuggestion {
  id: string
  url: string
  title: string
  visitedAt: number
  visitCount: number
}

export const AddressBar = memo(function AddressBar() {
  const { t } = useTranslation('browser')
  const currentUrl = useBrowserStore((s) => s.currentUrl)
  const isLoading = useBrowserStore((s) => s.isLoading)
  const bookmarks = useBookmarksStore((s) => s.bookmarks)
  const addBookmark = useBookmarksStore((s) => s.addBookmark)
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark)
  const navigateActiveTab = useTabsStore((s) => s.navigateActiveTab)
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<HistorySuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleOverlayAction = useCallback(
    (actionType: string, data: unknown) => {
      if (actionType === 'select') {
        const { url } = data as { url: string }
        navigateActiveTab(url)
        setShowSuggestions(false)
        setInput(stripHttpPrefix(url))
      } else if (actionType === 'dismiss') {
        setShowSuggestions(false)
      }
    },
    [navigateActiveTab]
  )

  const overlay = useOverlay('suggestions', handleOverlayAction)
  const { show: overlayShow, hide: overlayHide } = overlay

  const inputContextMenuRef = useRef<{ hide: () => void } | null>(null)

  const handleInputContextAction = useCallback((actionType: string) => {
    inputContextMenuRef.current?.hide()
    if (actionType === 'dismiss') return
    inputRef.current?.focus()
    setTimeout(() => {
      document.execCommand(actionType === 'select-all' ? 'selectAll' : actionType)
    }, 50)
  }, [])

  const inputContextMenu = useOverlay('input-context-menu', handleInputContextAction)
  inputContextMenuRef.current = inputContextMenu

  const handleInputContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const sel = window.getSelection()
      const hasSelection = !!(sel && sel.toString().length > 0)
      const items: Array<{ id: string; label: string; separator?: boolean; disabled?: boolean }> = [
        { id: 'cut', label: t('addressBar.cut'), disabled: !hasSelection },
        { id: 'copy', label: t('addressBar.copy'), disabled: !hasSelection },
        { id: 'paste', label: t('addressBar.paste') },
        { id: '_sep', label: '', separator: true },
        { id: 'select-all', label: t('addressBar.selectAll') },
      ]
      const menuW = 180
      const menuH = 4 * 36 + 1 * 9 + 8
      const menuX = Math.max(4, Math.min(e.clientX, window.innerWidth - menuW - 4))
      const menuY = Math.max(4, Math.min(e.clientY, window.innerHeight - menuH - 4))
      inputContextMenu.show({ x: menuX, y: menuY, width: menuW, height: menuH }, { type: 'menu', items })
    },
    [inputContextMenu, t]
  )

  const isBookmarked = useMemo(() => bookmarks.some((b) => b.url === currentUrl), [bookmarks, currentUrl])
  const isInternalPage = useMemo(() => currentUrl.startsWith('ton://'), [currentUrl])
  const hostname = useMemo(() => getHostname(currentUrl), [currentUrl])
  const isTonSite = useMemo(() => {
    const supportedTLDs = [
      '.ton',
      '.adnl',
      '.t.me',
      '.eth',
      '.sol',
      '.crypto',
      '.x',
      '.wallet',
      '.nft',
      '.dao',
      '.blockchain',
      '.bitcoin',
      '.zil',
      '.bnb',
      '.btc',
    ]
    return supportedTLDs.some((tld) => hostname.endsWith(tld))
  }, [hostname])
  const isTonDomain = useMemo(() => hostname.endsWith('.ton'), [hostname])
  const walletCreated = useWalletStore((s) => s.isCreated)
  const pending402Notification = useWalletStore((s) => s.pending402Notification)
  const approvePending402 = useWalletStore((s) => s.approvePending402)
  const rejectPending402 = useWalletStore((s) => s.rejectPending402)
  const notificationStyle = useWalletStore((s) => s.notificationStyle)
  const { t: tw } = useTranslation('wallet')
  const show402 = useMemo(() => {
    if (!pending402Notification) return false
    if (notificationStyle !== 'addressbar') return false
    return hostname === pending402Notification.domain || hostname.endsWith('.' + pending402Notification.domain)
  }, [pending402Notification, hostname, notificationStyle])

  const showTipButton = isTonDomain && walletCreated && !show402

  // Display URL without http:// for TON sites, and friendly names for bag files
  useEffect(() => {
    // File browser (data: URL with bag ID in title)
    if (currentUrl.startsWith('data:text/html')) {
      const bagMatch = currentUrl.match(/bag-id%22%3E([a-fA-F0-9]{8})%.{3}([a-fA-F0-9]{8})/)
      const fullBagMatch = currentUrl.match(/storage%2F([a-fA-F0-9]{64})/) || currentUrl.match(/"([a-fA-F0-9]{64})"/)
      if (fullBagMatch) {
        setInput(`${fullBagMatch[1]}.bag`)
      } else if (bagMatch) {
        setInput(`${bagMatch[1]}...${bagMatch[2]}.bag`)
      } else {
        setInput(t('addressBar.fileBrowser'))
      }
    }
    // Local bag file (file:// URL from storage)
    else if (currentUrl.startsWith('file:///') && currentUrl.includes('/storage/')) {
      const match = currentUrl.match(/storage\/([a-fA-F0-9]{64})\/[^/]+\/(.+)$/)
      if (match) {
        setInput(`${match[1]}.bag/${decodeURIComponent(match[2])}`)
      } else {
        const fileName = decodeURIComponent(currentUrl.split('/').pop() || '')
        setInput(fileName)
      }
    } else if (isTonSite) {
      setInput(stripHttpPrefix(currentUrl))
    } else {
      setInput(currentUrl)
    }
  }, [currentUrl, isTonSite, t])

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
      } catch {
        setSuggestions([])
        setShowSuggestions(false)
      }
    }

    const debounce = setTimeout(fetchSuggestions, 200)
    return () => clearTimeout(debounce)
  }, [input, isFocused, currentUrl])

  // Show/hide overlay when suggestions change
  useEffect(() => {
    if (showSuggestions && suggestions.length > 0 && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      overlayShow(
        {
          x: Math.round(rect.left),
          y: Math.round(rect.bottom + 8),
          width: Math.round(rect.width),
          height: Math.min(suggestions.length * 52 + 8, 220),
        },
        { type: 'suggestions', items: suggestions, selectedIndex },
        { autoDismiss: false }
      )
    } else {
      overlayHide()
    }
  }, [showSuggestions, suggestions, selectedIndex, overlayShow, overlayHide])

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault()

      // If suggestion is selected, use it
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        const suggestion = suggestions[selectedIndex]
        navigateActiveTab(suggestion.url)
        setShowSuggestions(false)
        return
      }

      const navigateUrl = input.trim()
      if (!navigateUrl) return

      // Hide suggestions
      setShowSuggestions(false)

      // Process navigation input (handles TON domain auto-completion)
      const finalUrl = processNavigationInput(navigateUrl)
      navigateActiveTab(finalUrl)
    },
    [selectedIndex, suggestions, navigateActiveTab, input]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    },
    [showSuggestions, suggestions.length]
  )

  const toggleBookmark = useCallback(() => {
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
  }, [isBookmarked, bookmarks, currentUrl, removeBookmark, tabs, activeTabId, addBookmark])

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-1 min-w-[400px] no-drag" role="search">
      <div ref={containerRef} className="relative flex-1">
        <div className="relative flex items-center rounded-full glass-surface">
          {/* TON site badge */}
          {isTonSite && !isLoading ? (
            <div
              className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-tonsite text-white"
              aria-hidden="true"
            >
              <Lock className="h-3 w-3" />
              <span>tonsite://</span>
            </div>
          ) : (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10" aria-hidden="true">
              {isLoading ? (
                <LoaderCircle className="h-4 w-4 text-muted-foreground animate-spin" />
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
            onContextMenu={handleInputContextMenu}
            className={cn(
              'h-8 bg-transparent border-0 rounded-full focus:ring-0 focus:outline-none',
              showTipButton || show402 ? 'pr-2' : 'pr-10',
              isTonSite && !isLoading ? 'pl-24' : 'pl-10'
            )}
            placeholder={t('addressBar.placeholder')}
            aria-label={t('addressBar.ariaLabel')}
            aria-autocomplete="list"
            aria-controls={showSuggestions ? 'history-suggestions' : undefined}
            aria-expanded={showSuggestions}
          />

          {show402 && pending402Notification && (
            <div className="flex-shrink-0 flex items-center gap-1 mr-0.5 pr-0.5">
              <span className="text-[10px] text-muted-foreground/70 font-medium whitespace-nowrap">
                {tw('payment.required')}
              </span>
              <span className="text-[10px] text-foreground font-medium whitespace-nowrap">
                {formatTonAmount(pending402Notification.amount)} TON
              </span>
              <button
                type="button"
                onClick={approvePending402}
                aria-label={`${tw('payment.approve')}: ${formatTonAmount(pending402Notification.amount)} TON → ${pending402Notification.domain}`}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-green-600/50 hover:bg-green-600/75 text-white transition-colors whitespace-nowrap"
              >
                {tw('payment.approve')}
              </button>
              <button
                type="button"
                onClick={rejectPending402}
                aria-label={`${tw('payment.reject')}: ${pending402Notification.domain}`}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-600/50 hover:bg-red-600/75 text-white transition-colors whitespace-nowrap"
              >
                {tw('payment.reject')}
              </button>
            </div>
          )}

          {showTipButton && (
            <div className="flex-shrink-0 mr-0.5">
              <TipButton domain={hostname} />
            </div>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'h-6 w-6 rounded-full flex-shrink-0',
              showTipButton || show402 ? 'mr-1' : 'absolute right-1 top-1/2 -translate-y-1/2'
            )}
            onClick={toggleBookmark}
            disabled={!currentUrl || isInternalPage}
            title={isBookmarked ? t('addressBar.removeBookmarkTitle') : t('addressBar.addBookmarkTitle')}
            aria-label={isBookmarked ? t('addressBar.removeBookmarkAria') : t('addressBar.addBookmarkAria')}
            aria-pressed={isBookmarked}
          >
            <Star
              className={cn('h-3.5 w-3.5', isBookmarked ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground')}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>
    </form>
  )
})
