import { Button as BaseButton } from '@base-ui/react/button'
import type { ComponentProps, ReactElement } from 'react'
import { cn } from './cn'

type Variant = 'default' | 'primary' | 'danger'
type Size = 'md' | 'sm'

const base =
  'inline-flex items-center gap-1.5 rounded-md border font-medium disabled:opacity-50 disabled:cursor-not-allowed'

const sizes: Record<Size, string> = {
  md: 'px-3.5 py-1.5 text-[13.5px]',
  sm: 'px-2.5 py-1 text-xs',
}

const variants: Record<Variant, string> = {
  default: 'border-border-strong bg-surface text-text hover:bg-bg',
  primary: 'border-accent bg-accent text-white hover:brightness-110',
  danger: 'border-status-error text-status-error bg-surface hover:bg-bg',
}

export function buttonClasses(variant: Variant = 'default', size: Size = 'md', className?: string): string {
  return cn(base, sizes[size], variants[variant], className)
}

type BaseButtonProps = Omit<ComponentProps<typeof BaseButton>, 'className'> & {
  variant?: Variant
  size?: Size
  className?: string
}

export function Button({ variant = 'default', size = 'md', className, ...props }: BaseButtonProps) {
  return <BaseButton className={cn(base, sizes[size], variants[variant], className)} {...props} />
}

/** Renders the same styling on top of an arbitrary element (e.g. a Next `<Link>`) via Base UI's `render` prop. */
export function ButtonLink({
  variant = 'default',
  size = 'md',
  className,
  render,
  ...props
}: BaseButtonProps & { render: ReactElement }) {
  return (
    <BaseButton
      nativeButton={false}
      render={render}
      className={cn(base, sizes[size], variants[variant], className)}
      {...props}
    />
  )
}
