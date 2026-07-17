import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { cn } from './cn'

export function SegmentedControl({
  value,
  onValueChange,
  options,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v) => {
        const next = v[0]
        if (next) onValueChange(next)
      }}
      className={cn('flex overflow-hidden rounded-md border border-border-strong', className)}
    >
      {options.map((o) => (
        <Toggle
          key={o.value}
          value={o.value}
          className="flex-1 border-none bg-surface px-0 py-1.5 text-xs data-[pressed]:bg-accent-soft data-[pressed]:font-semibold data-[pressed]:text-accent-text"
        >
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
