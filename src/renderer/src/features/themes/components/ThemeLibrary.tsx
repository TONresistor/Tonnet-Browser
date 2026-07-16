import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FileUp, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { hslToHex } from '@/lib/theme-utils'
import type { ThemeType } from '@shared/defaults'
import type { ThemeChoice } from './types'
import { useTranslation } from 'react-i18next'

interface ThemeLibraryProps {
  choices: ThemeChoice[]
  selectedTheme: ThemeType
  activeTheme: ThemeType
  onSelect: (theme: ThemeType) => void
  onCreate: () => void
  onImport: () => void
  disabled?: boolean
}

export function ThemeLibrary({
  choices,
  selectedTheme,
  activeTheme,
  onSelect,
  onCreate,
  onImport,
  disabled = false,
}: ThemeLibraryProps) {
  const { t } = useTranslation('settings')
  const listboxRef = useRef<HTMLDivElement>(null)
  const activeChoice = choices.find((choice) => choice.value === activeTheme)
  const builtIn = choices.filter((choice) => !choice.customTheme && choice.value !== activeTheme)
  const custom = choices.filter((choice) => choice.customTheme && choice.value !== activeTheme)
  const [focusTarget, setFocusTarget] = useState<ThemeType>(selectedTheme)

  useEffect(() => {
    setFocusTarget((current) => {
      if (choices.some((choice) => choice.value === selectedTheme)) return selectedTheme
      if (choices.some((choice) => choice.value === current)) return current
      return choices[0]?.value ?? current
    })
  }, [choices, selectedTheme])

  const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return

    const options = Array.from(
      listboxRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []
    )
    if (options.length === 0) return

    event.preventDefault()
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex: number
    if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = options.length - 1
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length
    else nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length

    const nextOption = options[nextIndex]
    const nextValue = nextOption.dataset.themeValue as ThemeType | undefined
    if (nextValue) setFocusTarget(nextValue)
    nextOption.focus()
  }

  const renderChoice = (choice: ThemeChoice, index: number) => {
    const selected = choice.value === selectedTheme
    const palette = [choice.colors.background, choice.colors.primary, choice.colors.accent, choice.colors.success]

    return (
      <button
        key={choice.value}
        type="button"
        role="option"
        data-theme-value={choice.value}
        aria-selected={selected}
        tabIndex={!disabled && choice.value === focusTarget ? 0 : -1}
        onFocus={() => setFocusTarget(choice.value)}
        onClick={() => onSelect(choice.value)}
        disabled={disabled}
        className={cn(
          'flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          index > 0 && 'border-t border-border-subtle',
          selected ? 'bg-[hsl(var(--primary)/0.14)]' : 'hover:bg-surface-hover'
        )}
      >
        <span className="grid h-8 w-8 shrink-0 grid-cols-2 overflow-hidden rounded-full border border-border-medium">
          {palette.map((color, paletteIndex) => (
            <span key={paletteIndex} style={{ backgroundColor: hslToHex(color) }} />
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-foreground">{choice.name}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="truncate">
              {choice.isDark ? t('themeEditor.list.darkTheme') : t('themeEditor.list.lightTheme')}
            </span>
          </span>
        </span>
      </button>
    )
  }

  return (
    <aside
      className={cn(
        'theme-library m-3 flex w-[288px] shrink-0 flex-col overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 p-3 shadow-panel transition-opacity',
        disabled && 'opacity-60'
      )}
      aria-disabled={disabled}
    >
      <header className="mb-4 flex items-center justify-between gap-2 px-1">
        <h2 className="min-w-0 truncate text-[22px] font-bold tracking-tight text-heading">
          {t('appearance.theme.label')}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onImport}
            disabled={disabled}
            className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
          >
            <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
            {t('common:buttons.import')}
          </Button>
          <Button
            type="button"
            size="icon"
            onClick={onCreate}
            disabled={disabled}
            title={t('themePage.newTheme')}
            aria-label={t('themePage.newTheme')}
            className="h-8 w-8 shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div
        ref={listboxRef}
        role="listbox"
        aria-label={t('appearance.theme.label')}
        aria-disabled={disabled}
        onKeyDown={handleListboxKeyDown}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-1"
      >
        {activeChoice && (
          <section role="group" aria-labelledby="active-theme-heading">
            <h3
              id="active-theme-heading"
              className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t('themePage.activeTheme')}
            </h3>
            <div className="overflow-hidden rounded-group bg-elevation-2">{renderChoice(activeChoice, 0)}</div>
          </section>
        )}

        {builtIn.length > 0 && (
          <section role="group" aria-labelledby="built-in-themes-heading">
            <h3
              id="built-in-themes-heading"
              className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t('themePage.builtInThemes')}
            </h3>
            <div className="overflow-hidden rounded-group bg-elevation-2">{builtIn.map(renderChoice)}</div>
          </section>
        )}

        {custom.length > 0 && (
          <section role="group" aria-labelledby="custom-themes-heading">
            <h3
              id="custom-themes-heading"
              className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t('appearance.customThemes.title')}
            </h3>
            <div className="overflow-hidden rounded-group bg-elevation-2">{custom.map(renderChoice)}</div>
          </section>
        )}
      </div>
    </aside>
  )
}
