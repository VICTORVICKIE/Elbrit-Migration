import type { ReactNode } from 'react'
import { Card } from './Card'
import { cn } from './cn'

export function StatTile({
  label,
  value,
  valueClassName,
  sub,
  subClassName,
}: {
  label: string
  value: ReactNode
  valueClassName?: string
  sub?: ReactNode
  subClassName?: string
}) {
  return (
    <Card className="p-3.5">
      <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.06em] text-text-faint uppercase">{label}</div>
      <div className={cn('text-2xl font-semibold', valueClassName)}>{value}</div>
      {sub && <div className={cn('mt-1 text-[12px]', subClassName ?? 'text-text-muted')}>{sub}</div>}
    </Card>
  )
}
