/**
 * Cocoon AI page at ton://cocoon.
 * Owns the entire Cocoon flow: setup, activation/stake, recovery and chat.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { CocoonChat } from '../cocoon/CocoonChat'
import { CocoonConversationsRail } from '../cocoon/CocoonConversationsRail'
import { useCocoonSession } from '@/hooks/useCocoonSession'
import { SetupWizard } from '../cocoon/SetupWizard'
import { CocoonWalletView } from '../cocoon/CocoonWalletView'

function CocoonChatPage() {
  const { phase, refresh, retryStart } = useCocoonSession()
  const [activeView, setActiveView] = useState<'chat' | 'wallet'>('chat')
  const previousPhaseRef = useRef(phase.kind)

  useEffect(() => {
    const previousPhase = previousPhaseRef.current
    if (phase.kind === 'ready' && previousPhase !== 'ready') {
      setActiveView('chat')
    }
    previousPhaseRef.current = phase.kind
  }, [phase.kind])

  if (phase.kind === 'loading' || phase.kind === 'resumePending' || phase.kind === 'availabilityLoading') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (phase.kind === 'walletError') {
    return <CenteredNotice title="Cocoon wallet error" description={phase.error} />
  }

  if (phase.kind === 'needsSetup') {
    return <SetupWizard onComplete={refresh} />
  }

  if (phase.kind === 'resumeSetup') {
    return (
      <SetupWizard
        onComplete={refresh}
        resumeFrom={{
          initialStep: phase.resumeStep,
          ownerAddress: phase.walletInfo.ownerAddress,
          nodeAddress: phase.walletInfo.nodeAddress,
        }}
      />
    )
  }

  if (phase.kind === 'availabilityError') {
    return <CenteredNotice title="Cocoon availability error" description={phase.error} />
  }

  if (phase.kind === 'unavailable') {
    return <CenteredNotice title="Cocoon AI not available" description={phase.message} />
  }

  if (phase.kind === 'unstaked') {
    return <CocoonWalletView />
  }

  // Active stake → render the chat surface using the existing session hook
  // (which handles runner state + auto-start).
  if (phase.kind !== 'ready') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full">
      <CocoonConversationsRail
        activeView={activeView}
        onSelectChat={() => setActiveView('chat')}
        onSelectWallet={() => setActiveView('wallet')}
      />
      {activeView === 'wallet' ? (
        <CocoonWalletView />
      ) : (
        <div className="flex-1 min-w-0 flex flex-col">
          <CocoonChat state={phase.state} startError={phase.startError} onRetryStart={retryStart} />
        </div>
      )}
    </div>
  )
}

function CenteredNotice({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-md mx-auto space-y-4 text-center">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  )
}

export default CocoonChatPage
