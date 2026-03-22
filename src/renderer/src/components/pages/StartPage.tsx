/**
 * Start page - new tab homepage.
 * Quick access to search and popular sites.
 */

import { useState, FormEvent } from 'react'
import Lottie from 'lottie-react'
import explorerAnimation from '@/assets/explorer.json'
import explorerYellowAnimation from '@/assets/explorer-yellow.json'
import tonIcon from '@/assets/ton.png'
import { APP_VERSION } from '@shared/constants'
import { processNavigationInput } from '@/lib/url-utils'
import { usePreferences } from '@/stores/preferences'
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
    window.electron.navigate(url)
  }

  return (
    <div className="relative flex flex-col items-center justify-center h-full w-full bg-background-secondary">
      <Lottie animationData={currentExplorerAnimation} className="w-[280px] h-[280px] mb-8" loop autoplay />

      <p className="text-foreground text-2xl font-bold mb-8">{t('start.subtitle')}</p>

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
            className="w-14 h-14 flex items-center justify-center rounded-full text-2xl font-medium transition-all duration-200 hover:scale-105 bg-tonsite text-white backdrop-blur-[10px] shadow-[var(--glass-shadow)]"
            aria-label={t('start.searchButton')}
          >
            →
          </button>
        </div>
      </form>

      <div className="absolute bottom-8 text-muted-foreground/50 text-xs">v{APP_VERSION}</div>
    </div>
  )
}
