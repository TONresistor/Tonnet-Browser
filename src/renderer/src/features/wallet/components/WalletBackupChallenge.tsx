import { Input } from '@/components/ui/input'

export function WalletBackupChallenge({
  indexes,
  answers,
  onChange,
}: {
  indexes: number[]
  answers: Record<number, string>
  onChange: (index: number, value: string) => void
}) {
  return (
    <div className="space-y-2 rounded-card border border-border-subtle bg-elevation-2 p-4">
      <p className="text-xs text-muted-foreground">Confirm these recovery words before continuing.</p>
      {indexes.map((index) => (
        <Input
          key={index}
          value={answers[index] ?? ''}
          onChange={(event) => onChange(index, event.target.value.trim().toLowerCase())}
          placeholder={`Word #${index + 1}`}
          autoComplete="off"
          spellCheck={false}
        />
      ))}
    </div>
  )
}
