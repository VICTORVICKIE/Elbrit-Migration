import { Select as BaseSelect } from '@base-ui/react/select'
import { cn } from './cn'

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
  className?: string
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
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon className="text-text-faint">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-100 outline-none" sideOffset={4}>
          <BaseSelect.Popup className="max-h-64 overflow-auto rounded-md border border-border bg-surface py-1 shadow-[var(--shadow-panel)] outline-none">
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
