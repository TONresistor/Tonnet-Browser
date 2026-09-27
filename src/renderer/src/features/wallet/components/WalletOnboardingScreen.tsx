import { useCallback, useState } from 'react'
import { LoaderCircle, Plus, Upload, Wallet, ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Lottie from 'lottie-react'
import explorerAnimation from '@/assets/explorer.json'
import { ActionButton } from '@/components/ui/ios/ActionButton'
import { Button } from '@/components/ui/button'
import { WalletPasswordFields } from './WalletPasswordFields'
import { WalletAccountCandidates } from './WalletAccountCandidates'
import {
  WalletVersionSelect,
  pickDefaultAccount,
  type WalletVersionOption,
} from './WalletVersionSelect'
import type { WalletAccountCandidate } from '@shared/ipc-contract/wallet'
import { cn } from '@/lib/utils'

type OnboardingMode = 'home' | 'create' | 'import' | 'unlock'

function parseWords(text: string): string[] {
  return text
    .trim()
    .split(/[\s,]+/)
    .filter((word) => word.length > 0)
}

export function WalletOnboardingScreen({
  compact = false,
  hasPersistedWallet,
  isLoading,
  error,
  onCreate,
  onImport,
  onReloadPersisted,
  onUnlock,
  onDiscoverAccounts,
}: {
  compact?: boolean
  hasPersistedWallet: boolean
  isLoading: boolean
  error: string | null
  onCreate: (password: string, replace: boolean) => Promise<string[] | null>
  onImport: (mnemonic: string[], password: string, version: WalletVersionOption) => Promise<void>
  onReloadPersisted: () => Promise<void>
  onUnlock: (password: string) => Promise<void>
  onDiscoverAccounts: (mnemonic: string[]) => Promise<WalletAccountCandidate[]>
}) {
  const { t } = useTranslation('wallet')
  const [mode, setMode] = useState<OnboardingMode>('home')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [recoveryInput, setRecoveryInput] = useState('')
  const [preferredVersion, setPreferredVersion] = useState<WalletVersionOption>('v5R1')
  const [candidates, setCandidates] = useState<WalletAccountCandidate[]>([])
  const [selectedAccount, setSelectedAccount] = useState<WalletAccountCandidate | null>(null)

  const resetForm = useCallback(() => {
    setPassword('')
    setConfirmation('')
    setLocalError(null)
    setRecoveryInput('')
    setCandidates([])
    setSelectedAccount(null)
    setPreferredVersion('v5R1')
  }, [])

  const goHome = useCallback(() => {
    resetForm()
    setMode('home')
  }, [resetForm])

  const validatePassword = (): boolean => {
    if (password.length < 10 || password !== confirmation) {
      setLocalError('Choose and confirm a wallet password of at least 10 characters.')
      return false
    }
    return true
  }

  const handleCreate = async () => {
    if (!validatePassword()) return
    setLocalError(null)
    try {
      await onCreate(password, hasPersistedWallet)
      resetForm()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleImport = async () => {
    const words = parseWords(recoveryInput)
    if (words.length !== 24) {
      setLocalError(t('import.error'))
      return
    }
    if (!validatePassword()) return
    setLocalError(null)
    try {
      const version = selectedAccount?.version ?? preferredVersion
      await onImport(words, password, version)
      resetForm()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDiscover = async () => {
    const words = parseWords(recoveryInput)
    if (words.length !== 24) {
      setLocalError(t('import.error'))
      return
    }
    setLocalError(null)
    try {
      const discovered = await onDiscoverAccounts(words)
      setCandidates(discovered)
      setSelectedAccount(pickDefaultAccount(discovered))
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleReload = async () => {
    setLocalError(null)
    try {
      await onReloadPersisted()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleUnlockExisting = async () => {
    if (password.length < 1) {
      setLocalError('Enter your wallet password.')
      return
    }
    setLocalError(null)
    try {
      await onReloadPersisted()
      await onUnlock(password)
      resetForm()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const wordCount = parseWords(recoveryInput).length
  const displayError = localError ?? error

  const shellClass = compact
    ? 'flex flex-1 flex-col items-center justify-center p-4'
    : 'flex flex-col items-center justify-center gap-4 py-10 text-center'

  if (mode === 'home') {
    return (
      <div className={shellClass}>
        {!compact && <Lottie animationData={explorerAnimation} className="mb-1 h-24 w-24" loop autoplay />}
        <div>
          <h2 className="text-base font-semibold text-heading">
            {hasPersistedWallet
              ? t('onboarding.foundTitle', { defaultValue: 'Wallet found on this device' })
              : t('page.noWalletTitle')}
          </h2>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {hasPersistedWallet
              ? t('onboarding.foundDesc', {
                  defaultValue: 'Use the wallet already stored here, import a different one, or create a new wallet.',
                })
              : t('page.noWalletDesc')}
          </p>
        </div>
        {displayError && <p className="text-sm text-destructive">{displayError}</p>}
        <div className="flex w-full max-w-xs flex-col gap-2">
          {hasPersistedWallet && (
            <ActionButton
              variant="filled"
              className="w-full"
              icon={<Wallet className="h-4 w-4" aria-hidden="true" />}
              onClick={() => {
                resetForm()
                setMode('unlock')
              }}
            >
              {t('onboarding.useExisting', { defaultValue: 'Use existing wallet' })}
            </ActionButton>
          )}
          <ActionButton
            variant={hasPersistedWallet ? 'tinted' : 'filled'}
            className="w-full"
            icon={<Upload className="h-4 w-4" aria-hidden="true" />}
            onClick={() => {
              resetForm()
              setMode('import')
            }}
          >
            {t('import.button', { defaultValue: 'Import Wallet' })}
          </ActionButton>
          <ActionButton
            variant="tinted"
            className="w-full"
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            onClick={() => {
              resetForm()
              setMode('create')
            }}
          >
            {t('page.createWallet')}
          </ActionButton>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(shellClass, 'w-full max-w-xs mx-auto text-left')}>
      <Button type="button" variant="ghost" size="sm" onClick={goHome} className="-ml-2 text-muted-foreground">
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Back
      </Button>

      <div className="w-full space-y-4">
        <div>
          <h2 className="text-base font-semibold text-heading">
            {mode === 'create'
              ? t('create.title')
              : mode === 'import'
                ? t('import.title')
                : t('onboarding.useExisting', { defaultValue: 'Use existing wallet' })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === 'create'
              ? hasPersistedWallet
                ? t('onboarding.createReplaceDesc', {
                    defaultValue: 'Creating a new wallet replaces the unreadable wallet file on this device.',
                  })
                : t('create.description')
              : mode === 'import'
                ? t('import.description')
                : t('onboarding.unlockDesc', {
                    defaultValue: 'Load the wallet stored on this device, then unlock it with your password.',
                  })}
          </p>
        </div>

        {mode === 'import' && (
          <>
            <textarea
              className="h-24 w-full resize-none rounded-lg border bg-background p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={t('import.placeholder')}
              value={recoveryInput}
              onChange={(event) => {
                setRecoveryInput(event.target.value)
                setLocalError(null)
                setCandidates([])
                setSelectedAccount(null)
              }}
              spellCheck={false}
              autoComplete="off"
            />
            <div className="flex items-center justify-between text-xs">
              <span className={wordCount === 24 ? 'text-success' : 'text-muted-foreground'}>{wordCount} words</span>
            </div>
            <WalletVersionSelect value={preferredVersion} onChange={setPreferredVersion} disabled={isLoading} />
            <WalletAccountCandidates
              candidates={candidates}
              selected={selectedAccount}
              onSelect={setSelectedAccount}
            />
          </>
        )}

        <WalletPasswordFields
          password={password}
          confirmation={mode === 'unlock' ? undefined : confirmation}
          onPasswordChange={setPassword}
          onConfirmationChange={mode === 'unlock' ? undefined : setConfirmation}
          disabled={isLoading}
        />

        {displayError && (
          <p role="alert" className="text-xs text-destructive">
            {displayError}
          </p>
        )}

        {mode === 'create' && (
          <ActionButton
            variant="filled"
            className="w-full"
            disabled={isLoading}
            icon={
              isLoading ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )
            }
            onClick={() => void handleCreate()}
          >
            {isLoading ? t('create.creating') : t('page.createWallet')}
          </ActionButton>
        )}

        {mode === 'import' && (
          <div className="flex flex-col gap-2">
            <ActionButton
              variant="tinted"
              className="w-full"
              disabled={isLoading || wordCount !== 24}
              onClick={() => void handleDiscover()}
            >
              {candidates.length === 0 ? 'Find wallet accounts' : 'Scan accounts again'}
            </ActionButton>
            <ActionButton
              variant="filled"
              className="w-full"
              disabled={isLoading || wordCount !== 24}
              icon={
                isLoading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-4 w-4" aria-hidden="true" />
                )
              }
              onClick={() => void handleImport()}
            >
              {isLoading
                ? t('import.importing')
                : candidates.length === 0
                  ? `Import as ${preferredVersion}`
                  : 'Import selected account'}
            </ActionButton>
          </div>
        )}

        {mode === 'unlock' && (
          <div className="flex flex-col gap-2">
            <ActionButton variant="tinted" className="w-full" disabled={isLoading} onClick={() => void handleReload()}>
              Load wallet from this device
            </ActionButton>
            <ActionButton
              variant="filled"
              className="w-full"
              disabled={isLoading}
              onClick={() => void handleUnlockExisting()}
            >
              Unlock with password
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  )
}
