/**
 * Header réutilisable pour toutes les sections de paramètres
 */

interface SectionHeaderProps {
  title: string
  description?: string
}

export function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div className="mb-6">
      <h3 className="text-xl font-semibold text-foreground mb-1">{title}</h3>
      {description && <p className="text-muted-foreground text-sm">{description}</p>}
    </div>
  )
}
