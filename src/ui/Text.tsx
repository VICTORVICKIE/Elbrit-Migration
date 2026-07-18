import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export function SectionLabel({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('text-[11px] font-semibold tracking-[0.08em] text-text-faint uppercase', className)}
      {...props}
    />
  )
}

export function Muted({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('text-text-muted', className)} {...props} />
}

export function Faint({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('text-text-faint', className)} {...props} />
}

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}
