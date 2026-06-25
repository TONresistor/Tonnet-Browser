/**
 * Header réutilisable pour les sections de paramètres — grand titre style iOS.
 */

interface SectionHeaderProps {
  title: string
  description?: string
}

export function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div className="mb-6">
      <h3 className="text-[26px] font-bold tracking-tight text-foreground">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}
