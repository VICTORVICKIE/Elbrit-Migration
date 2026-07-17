import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'
import { cn } from './cn'

const base = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium border'

export function Chip({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn(base, 'border-transparent', className)} {...props} />
}

export function OutlineChip({
  active,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { active?: boolean }) {
  return (
    <span
      className={cn(
        base,
        active
          ? 'border-accent bg-accent-soft text-accent-text'
          : 'border-border-strong bg-surface text-text-muted',
        className,
      )}
      {...props}
    />
  )
}

export function OutlineChipButton({
  active,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        base,
        'cursor-pointer',
        active
          ? 'border-accent bg-accent-soft text-accent-text'
          : 'border-border-strong bg-surface text-text-muted',
        className,
      )}
      {...props}
    />
  )
}
