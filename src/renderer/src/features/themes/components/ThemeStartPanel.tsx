import { ArrowLeft, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RESISTANCE_DOG_COLORS, UTYA_DUCK_COLORS } from '@/lib/theme-utils'
import { useTranslation } from 'react-i18next'
import type { BuiltInTheme } from '@shared/defaults'

interface ThemeStartPanelProps {
  onChoose: (base: BuiltInTheme) => void
  onBack: () => void
}

export function ThemeStartPanel({ onChoose, onBack }: ThemeStartPanelProps) {
  const { t } = useTranslation('settings')
  const choices = [
    {
      value: 'resistance-dog' as const,
      icon: Moon,
      title: t('appearance.theme.resistanceDog'),
      description: t('appearance.theme.resistanceDogDesc'),
      colors: RESISTANCE_DOG_COLORS,
    },
    {
      value: 'utya-duck' as const,
      icon: Sun,
      title: t('appearance.theme.utyaDuck'),
      description: t('appearance.theme.utyaDuckDesc'),
      colors: UTYA_DUCK_COLORS,
    },
  ]

  return (
    <section className="mx-auto w-full max-w-[960px]">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="-ml-3 mb-6 gap-2 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('themePage.backToLibrary')}
      </Button>
      <h1 className="text-xl font-bold tracking-tight text-heading">{t('themePage.newTheme')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('themePage.chooseBase')}</p>
      <div className="theme-base-grid mt-6 grid gap-4">
        {choices.map((choice) => {
          const Icon = choice.icon
          return (
            <button
              key={choice.value}
              onClick={() => onChoose(choice.value)}
              className="overflow-hidden rounded-card border border-border-subtle bg-elevation-1 text-left transition-colors hover:border-primary/60 hover:bg-elevation-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className="block border-b border-border-subtle p-4"
                style={{ backgroundColor: `hsl(${choice.colors.backgroundSecondary})` }}
                aria-hidden="true"
              >
                <span
                  className="block overflow-hidden rounded-card border p-3"
                  style={{
                    backgroundColor: `hsl(${choice.colors.background})`,
                    borderColor: `hsl(${choice.colors.border})`,
                  }}
                >
                  <span className="mb-3 flex gap-1.5">
                    <span
                      className="h-5 w-16 rounded-full"
                      style={{ backgroundColor: `hsl(${choice.colors.primary})` }}
                    />
                    <span
                      className="h-5 w-10 rounded-full"
                      style={{ backgroundColor: `hsl(${choice.colors.accent})` }}
                    />
                  </span>
                  <span
                    className="block h-14 rounded-control border"
                    style={{
                      backgroundColor: `hsl(${choice.colors.card})`,
                      borderColor: `hsl(${choice.colors.border})`,
                    }}
                  />
                </span>
              </span>
              <span className="flex items-start gap-3 p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-hover text-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-base font-semibold text-foreground">{choice.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{choice.description}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
