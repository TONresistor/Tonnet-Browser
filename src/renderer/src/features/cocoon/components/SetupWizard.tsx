import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Step1Welcome } from './wizard/Step1Welcome'
import { Step2Backup } from './wizard/Step2Backup'
import { Step3Fund } from './wizard/Step3Fund'
import { Step4Stake } from './wizard/Step4Stake'
import { StartOverControl } from './wizard/StartOverControl'

type StepNum = 1 | 2 | 3 | 4

const STEP_LABELS: Record<StepNum, string> = {
  1: 'Generate',
  2: 'Backup',
  3: 'Fund',
  4: 'Connect',
}

const STEPS: StepNum[] = [1, 2, 3, 4]

interface WalletCreated {
  ownerAddress: string
  nodeAddress: string
}

interface Props {
  onComplete: () => void
  /** Sidebar density: narrower paddings and no framed card-in-panel feel. */
  compact?: boolean
  /**
   * When the wizard resumes after a browser restart (wallet exists but setup
   * not completed), the parent passes the persisted addresses so we can skip
   * Step 1 (generate) and Step 2 (mnemonic backup, no longer in memory) and
   * land directly on Step 3 (fund) or Step 4 (stake).
   */
  resumeFrom?: {
    initialStep: 3 | 4
    ownerAddress: string
    nodeAddress: string
  }
}

export function SetupWizard({ onComplete, compact = false, resumeFrom }: Props) {
  const [step, setStep] = useState<StepNum>(resumeFrom?.initialStep ?? 1)
  const [wallet, setWallet] = useState<WalletCreated | null>(
    resumeFrom ? { ownerAddress: resumeFrom.ownerAddress, nodeAddress: resumeFrom.nodeAddress } : null
  )
  const [mnemonic, setMnemonic] = useState<string[] | null>(null)

  // Keep a ref to the mnemonic so we can wipe it on unmount even if state updates
  // are batched and the component is about to unmount.
  const mnemonicRef = useRef<string[] | null>(null)
  useEffect(() => {
    mnemonicRef.current = mnemonic
  }, [mnemonic])

  // Security: wipe mnemonic from memory on unmount regardless of step.
  useEffect(() => {
    return () => {
      mnemonicRef.current = null
    }
  }, [])

  const handleStep1Complete = (data: { ownerAddress: string; nodeAddress: string; mnemonic: string[] }) => {
    setWallet({ ownerAddress: data.ownerAddress, nodeAddress: data.nodeAddress })
    setMnemonic(data.mnemonic)
    setStep(2)
  }

  const handleStep2Complete = () => {
    // Wipe mnemonic from state now that the user has acknowledged backup.
    setMnemonic(null)
    setStep(3)
  }

  const handleStep3Complete = () => {
    setStep(4)
  }

  return (
    <div className={`flex-1 overflow-auto flex items-start justify-center ${compact ? 'p-3' : 'p-6'}`}>
      <div
        className={`w-full space-y-6 ${
          compact ? 'max-w-none p-1' : 'max-w-[600px] bg-elevation-1 border border-border-subtle rounded-panel p-6'
        }`}
      >
        {/* Progress indicator — each step is an equal column with the dot and its
            label centered together; connectors are absolute lines between dots. */}
        <div className="mx-auto flex w-full max-w-[300px]">
          {STEPS.map((s, i) => (
            <div key={s} className="flex flex-1 flex-col items-center gap-2">
              <div className="relative flex h-2.5 w-full items-center justify-center">
                {i > 0 && (
                  <span
                    className={`absolute left-0 right-1/2 top-1/2 h-0.5 -translate-y-1/2 transition-colors ${
                      step >= s ? 'bg-primary' : 'bg-border'
                    }`}
                  />
                )}
                {i < 3 && (
                  <span
                    className={`absolute left-1/2 right-0 top-1/2 h-0.5 -translate-y-1/2 transition-colors ${
                      step > s ? 'bg-primary' : 'bg-border'
                    }`}
                  />
                )}
                <div
                  className={`relative z-10 h-2.5 w-2.5 rounded-full border-2 transition-all ${
                    step === s
                      ? 'bg-primary border-primary ring-2 ring-primary/30'
                      : step > s
                        ? 'bg-primary border-primary'
                        : 'bg-transparent border-border'
                  }`}
                />
              </div>
              <span
                className={`text-center text-[10px] transition-colors ${
                  step === s ? 'text-primary font-medium' : 'text-muted-foreground'
                }`}
              >
                {STEP_LABELS[s]}
              </span>
            </div>
          ))}
        </div>

        {/* Step content */}
        {step === 1 && <Step1Welcome onComplete={handleStep1Complete} />}

        {step === 2 &&
          (mnemonic ? (
            <Step2Backup mnemonic={mnemonic} onComplete={handleStep2Complete} onBack={() => setStep(1)} />
          ) : (
            // Mnemonic already wiped (user navigated back after acknowledging)
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-heading">Step 2: Back up your recovery phrase</h2>
              <p className="text-sm text-muted-foreground">
                Recovery phrase already backed up. You can continue to fund your wallet.
              </p>
              <div className="flex justify-between pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setWallet(null)
                    setStep(1)
                  }}
                >
                  Restart
                </Button>
                <Button type="button" size="sm" onClick={() => setStep(3)}>
                  Continue
                </Button>
              </div>
            </div>
          ))}

        {step === 3 && wallet && (
          <Step3Fund
            ownerAddress={wallet.ownerAddress}
            onComplete={handleStep3Complete}
            // No back button when resuming: Step 1/2 are meaningless (wallet
            // already exists on disk and mnemonic is no longer in memory).
            onBack={resumeFrom ? undefined : () => setStep(2)}
          />
        )}

        {step === 4 && (
          <Step4Stake
            onComplete={onComplete}
            // Hide Back when resuming directly at Step 4: the cocoon wallet was
            // already funded on-chain, the owner is at gas reserve, and Step 3
            // would just trap the user waiting for a balance that will never
            // reach the threshold.
            onBack={resumeFrom?.initialStep === 4 ? undefined : () => setStep(3)}
            // When the wizard resumes directly at Step 4, the cocoon wallet
            // was already funded on-chain — re-funding would fail since the
            // owner only has the gas reserve left.
            initialFunded={resumeFrom?.initialStep === 4}
          />
        )}

        {/* Resume mode has no Back (Step 1/2 are meaningless on a restart): give
            the user an explicit escape to delete the unfinished wallet and
            start fresh. Balance-gated inside the control. */}
        {resumeFrom && <StartOverControl onReset={onComplete} />}
      </div>
    </div>
  )
}
