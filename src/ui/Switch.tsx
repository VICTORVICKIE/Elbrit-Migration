import { Switch as BaseSwitch } from '@base-ui/react/switch'
import type { ComponentProps } from 'react'
import { cn } from './cn'

export function Switch({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseSwitch.Root>, 'className'> & { className?: string }) {
  return (
    <BaseSwitch.Root
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-border-strong transition-colors data-[checked]:bg-status-synced',
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb className="block size-3.5 translate-x-[3px] rounded-full bg-white shadow-sm transition-transform data-[checked]:translate-x-[19px]" />
    </BaseSwitch.Root>
  )
}
