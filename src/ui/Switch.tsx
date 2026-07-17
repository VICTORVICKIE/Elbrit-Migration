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
        'relative h-5 w-8.5 rounded-full bg-border-strong transition-colors data-[checked]:bg-accent',
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[checked]:translate-x-[18px]" />
    </BaseSwitch.Root>
  )
}
