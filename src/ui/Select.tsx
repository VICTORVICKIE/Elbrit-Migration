import { Select as BaseSelect } from '@base-ui/react/select'
import type { ReactNode } from 'react'
import { cn } from './cn'

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  icon,
}: {
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Optional leading icon (e.g. a calendar glyph) rendered before the selected value. */
  icon?: ReactNode
}) {
  return (
    <BaseSelect.Root
      items={options}
      value={value || null}
      onValueChange={(v) => onValueChange((v as string | null) ?? '')}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-left disabled:opacity-50',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <BaseSelect.Value placeholder={placeholder} />
        </span>
        <BaseSelect.Icon className="shrink-0 text-text-faint">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-100 outline-none" side="bottom" align="start" sideOffset={4} alignItemWithTrigger={false}>
          <BaseSelect.Popup className="w-[var(--anchor-width)] max-h-64 overflow-auto rounded-md border border-border bg-surface py-1 shadow-[var(--shadow-panel)] outline-none">
            <BaseSelect.List>
              {options.map((o) => (
                <BaseSelect.Item
                  key={o.value}
                  value={o.value}
                  className="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-[13px] data-[highlighted]:bg-bg"
                >
                  <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
