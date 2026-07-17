import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import type { ComponentProps } from 'react'
import { cn } from './cn'

export const TabsRoot = BaseTabs.Root

export function TabsList({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseTabs.List>, 'className'> & { className?: string }) {
  return <BaseTabs.List className={cn('mb-4 flex gap-1.5', className)} {...props} />
}

export function TabsTab({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseTabs.Tab>, 'className'> & { className?: string }) {
  return (
    <BaseTabs.Tab
      className={cn(
        'cursor-pointer rounded-full border border-border-strong bg-surface px-2.5 py-0.5 text-xs font-medium text-text-muted transition-colors',
        'data-[active]:border-accent data-[active]:bg-accent data-[active]:text-white data-[active]:font-semibold',
        className,
      )}
      {...props}
    />
  )
}

export const TabsPanel = BaseTabs.Panel
