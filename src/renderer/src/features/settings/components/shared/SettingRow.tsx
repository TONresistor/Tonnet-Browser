/**
 * Ligne de paramètre réutilisable — style iOS (label/description ⟷ contrôle, hairline inset).
 */

interface SettingRowProps {
  label: string
  description?: React.ReactNode
  children: React.ReactNode
}

export function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border-subtle py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-card-foreground">{label}</p>
        {description &&
          (typeof description === 'string' ? (
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</p>
          ) : (
            <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</div>
          ))}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
