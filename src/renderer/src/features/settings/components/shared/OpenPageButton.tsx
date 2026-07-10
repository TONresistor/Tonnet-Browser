import type { ReactNode } from 'react'

interface OpenPageButtonProps {
  icon: ReactNode
  label: string
  onClick: () => void
}

export function OpenPageButton({ icon, label, onClick }: OpenPageButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-surface-hover border border-border-medium text-foreground hover:bg-surface-active"
    >
      {icon}
      {label}
    </button>
  )
}
