import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import type { ComponentProps } from 'react'
import { cn } from './cn'

export function Checkbox({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseCheckbox.Root>, 'className'> & { className?: string }) {
  return (
    <BaseCheckbox.Root
      className={cn(
        'flex size-4 items-center justify-center rounded border border-border-strong bg-surface data-[checked]:border-accent data-[checked]:bg-accent',
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator className="flex text-white data-[unchecked]:hidden">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  )
}
