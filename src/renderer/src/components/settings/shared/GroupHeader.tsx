/** In-card group sub-header — distinct from the page-level SectionHeader. */

interface GroupHeaderProps {
  title: string
  description?: string
}

export function GroupHeader({ title, description }: GroupHeaderProps) {
  return (
    <div className="py-4 border-b border-border">
      <p className="text-foreground font-medium">{title}</p>
      {description && <p className="text-muted-foreground text-sm mt-0.5">{description}</p>}
    </div>
  )
}
