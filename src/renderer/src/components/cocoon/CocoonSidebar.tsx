/**
 * Compact Cocoon AI sidebar — mirrors the ton://cocoon page branches.
 *
 * Once setup is complete and the runner is ready, the chat runs inline using
 * the same <CocoonChat /> component as the full page (history is shared via
 * `useCocoonChatStore`). For setup or unavailability, the sidebar redirects
 * to the full page rather than shrinking the wizard into 320px.
 */

import { useCallback } from 'react'
import { ExternalLink, X } from 'lucide-react'
import Lottie from 'lottie-react'
import cocoonIcon from '@/assets/cocoon.png'
import cocoonAnimation from '@/assets/cocoon.json'
import { useTabsStore } from '@/stores/tabs'
import { useCocoonChatStore, selectActiveMessages } from '@/stores/cocoon-chat'
import { Button } from '@/components/ui/button'
import { useCocoonSession, unstakedHeaderKey } from '@/hooks/useCocoonSession'
import { CocoonChat } from './CocoonChat'
import { useTranslation } from 'react-i18next'

const COCOON_PAGE = 'ton://cocoon'

interface CocoonSidebarProps {
  onClose: () => void
}

export function CocoonSidebar({ onClose }: CocoonSidebarProps) {
  const { phase, retryStart } = useCocoonSession()
  const openOrSwitchToTab = useTabsStore((s) => s.openOrSwitchToTab)
  const messagesCount = useCocoonChatStore((s) => selectActiveMessages(s).length)
  const clearMessages = useCocoonChatStore((s) => s.clearActive)

  const openFullPage = useCallback(() => {
    openOrSwitchToTab(COCOON_PAGE)
    onClose()
  }, [openOrSwitchToTab, onClose])

  const showChatControls = phase.kind === 'ready'

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--elevation-1))] border-l border-border">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <img src={cocoonIcon} alt="" className="h-5 w-5 brightness-0 invert shrink-0" />
          <span className="text-xl font-bold text-foreground truncate">Cocoon Ai</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {showChatControls && messagesCount > 0 && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clearMessages}>
              Clear
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <SidebarBody phase={phase} openFullPage={openFullPage} retryStart={retryStart} />
    </div>
  )
}

function SidebarBody({
  phase,
  openFullPage,
  retryStart,
}: {
  phase: ReturnType<typeof useCocoonSession>['phase']
  openFullPage: () => void
  retryStart: () => void
}) {
  const { t } = useTranslation('settings')
  switch (phase.kind) {
    case 'loading':
    case 'resumePending':
    case 'availabilityLoading':
      return <CenteredHint label="Loading…" />

    case 'walletError':
      return <CenteredHint label="Cocoon wallet error" sublabel={phase.error} />

    case 'needsSetup':
      return (
        <SetupCallout
          title="Confidential AI on TON"
          description="Generate a wallet and stake to start chatting."
          ctaLabel="Setup Cocoon AI"
          onCta={openFullPage}
        />
      )

    case 'resumeSetup':
      return (
        <SetupCallout
          title="Finish setup"
          description={
            phase.resumeStep === 4
              ? 'Your wallet is funded. Stake to activate Cocoon.'
              : 'Fund your wallet to continue setup.'
          }
          ctaLabel="Resume setup"
          onCta={openFullPage}
        />
      )

    case 'availabilityError':
    case 'unavailable':
      return (
        <CenteredHint
          label="Cocoon AI not available"
          sublabel={phase.kind === 'unavailable' ? phase.message : phase.error}
        />
      )

    case 'unstaked': {
      // Stake management lives on ton://cocoon. From the sidebar we open the
      // full page rather than mixing Cocoon controls into the wallet panel.
      const key = unstakedHeaderKey(phase.stakeInfo?.status ?? null, phase.pendingWithdraw)
      return (
        <SetupCallout
          title={t(`cocoon.unstake.${key}.title`)}
          description={t(`cocoon.unstake.${key}.description`)}
          ctaLabel={t('cocoon.unstake.cta')}
          onCta={openFullPage}
        />
      )
    }

    case 'ready':
      return (
        <>
          <div className="flex-1 min-h-0 flex flex-col">
            <CocoonChat state={phase.state} startError={phase.startError} onRetryStart={retryStart} compact />
          </div>
          <button
            type="button"
            onClick={openFullPage}
            className="px-4 py-2.5 border-t border-border flex items-center justify-center gap-1.5
                       text-xs text-primary hover:text-primary/80 transition-colors font-medium shrink-0"
          >
            <ExternalLink className="h-3 w-3" />
            Open full page
          </button>
        </>
      )
  }
}

function CenteredHint({ label, sublabel }: { label: string; sublabel?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 gap-2 text-center">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
    </div>
  )
}

function SetupCallout({
  title,
  description,
  ctaLabel,
  onCta,
}: {
  title: string
  description: string
  ctaLabel: string
  onCta: () => void
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4 text-center">
      <Lottie animationData={cocoonAnimation} className="h-32 w-32" loop autoplay />
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      <Button type="button" onClick={onCta} className="w-full max-w-[200px]">
        {ctaLabel}
      </Button>
    </div>
  )
}
