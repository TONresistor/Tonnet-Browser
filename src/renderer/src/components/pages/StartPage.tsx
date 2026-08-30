/**
 * Start page - new tab homepage.
 * Quick access to search and popular sites.
 */

import { useState, FormEvent } from 'react'
import { browserClient } from '@/features/browser/client'
import Lottie from 'lottie-react'
import explorerAnimation from '@/assets/explorer.json'
import explorerYellowAnimation from '@/assets/explorer-yellow.json'
import tonIcon from '@/assets/ton.png'
import { processNavigationInput } from '@/lib/url-utils'
import { usePreferences } from '@/features/settings/preferences-store'
import { useTranslation } from 'react-i18next'

export function StartPage() {
  const { t } = useTranslation('pages')
  const [searchInput, setSearchInput] = useState('')
  const { theme } = usePreferences()
  const currentExplorerAnimation = theme === 'utya-duck' ? explorerYellowAnimation : explorerAnimation

  const handleSearch = (e: FormEvent) => {
    e.preventDefault()
    const input = searchInput.trim()
    if (!input) return

    // Process navigation input (handles TON domain auto-completion)
    const url = processNavigationInput(input)
    void browserClient.navigate(url)
  }

  return (
    <div className="relative flex flex-col items-center justify-center h-full w-full bg-background-secondary">
      <Lottie animationData={currentExplorerAnimation} className="w-[280px] h-[280px] mb-8" loop autoplay />

      <p className="text-heading text-2xl font-bold mb-8">{t('start.subtitle')}</p>

      <form onSubmit={handleSearch} className="w-full max-w-[700px] px-5">
        <div className="flex items-center rounded-full p-1.5 transition-all duration-300 glass-surface">
          <span className="px-4">
            <img src={tonIcon} alt="TON" className="w-6 h-6" />
          </span>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="flex-1 bg-transparent border-none text-foreground text-lg py-4 pr-5 outline-none placeholder:text-muted-foreground/50"
            placeholder={t('start.searchPlaceholder')}
            autoFocus
          />
          <button
            type="submit"
            className="w-14 h-14 flex items-center justify-center rounded-full text-2xl font-medium transition-all duration-200 hover:scale-105 bg-primary text-identity-foreground backdrop-blur-[10px] shadow-[var(--glass-shadow)]"
            aria-label={t('start.searchButton')}
          >
            →
          </button>
        </div>
      </form>
    </div>
  )
}
