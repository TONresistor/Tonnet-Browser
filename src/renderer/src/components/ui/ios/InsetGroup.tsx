import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface InsetGroupProps {
  title?: string
  footer?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function InsetGroup({ title, footer, children, className, bodyClassName }: InsetGroupProps) {
  return (
    <section className={className}>
      {title && (
        <h3 className="mb-2 px-4 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      )}
      <div
        className={cn(
          'overflow-hidden rounded-card border border-border-subtle bg-card text-card-foreground',
          bodyClassName
        )}
      >
        {children}
      </div>
      {footer && <div className="mt-2 px-4 text-[13px] text-muted-foreground">{footer}</div>}
    </section>
  )
}
