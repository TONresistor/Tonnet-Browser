/**
 * Ligne de paramètre réutilisable
 */

interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
}

export function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-border last:border-0">
      <div className="flex-1 pr-4">
        <p className="text-foreground font-medium">{label}</p>
        {description && <p className="text-muted-foreground text-sm mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
