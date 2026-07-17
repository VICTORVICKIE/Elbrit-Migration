import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { cn } from './cn'

interface Option {
  value: string
  label: string
}

/** Searchable single-select dropdown — same look/API shape as Select, but filterable by typing. */
export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  options: Option[]
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const selected = options.find((o) => o.value === value) ?? null

  return (
    <BaseCombobox.Root
      items={options}
      value={selected}
      onValueChange={(item) => onValueChange((item as Option | null)?.value ?? '')}
      itemToStringLabel={(item) => (item as Option).label}
      // Default filter is startsWith, which misses dotted paths like
      // "distributor.customer_name" when searching "customer" — use
      // substring matching instead.
      filter={(item, query) => (item as Option).label.toLowerCase().includes(query.toLowerCase())}
      disabled={disabled}
    >
      <BaseCombobox.InputGroup
        className={cn(
          'flex w-full items-center gap-1 rounded-md border border-border-strong bg-surface px-2 py-1.5 has-[input:disabled]:opacity-50',
          className,
        )}
      >
        <BaseCombobox.Input
          placeholder={placeholder}
          className="w-full min-w-0 border-0 bg-transparent p-0 text-left outline-none placeholder:text-text-faint"
        />
        <BaseCombobox.Trigger className="shrink-0 text-text-faint" aria-label="Open list">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </BaseCombobox.Trigger>
      </BaseCombobox.InputGroup>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner className="z-100 outline-none" sideOffset={4}>
          <BaseCombobox.Popup className="w-[var(--anchor-width)] max-h-64 overflow-auto rounded-md border border-border bg-surface py-1 shadow-[var(--shadow-panel)] outline-none">
            <BaseCombobox.Empty className="px-3 py-2 text-[12.5px] text-text-faint">No matches</BaseCombobox.Empty>
            <BaseCombobox.List>
              {(item: Option) => (
                <BaseCombobox.Item
                  key={item.value}
                  value={item}
                  className="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-[13px] outline-none data-[highlighted]:bg-bg"
                >
                  <span>{item.label}</span>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  )
}

/** Searchable multi-select dropdown — same look as SearchableSelect, but picks a chip list of values. */
export function SearchableMultiSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
}: {
  value: string[]
  onValueChange: (value: string[]) => void
  options: Option[]
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const selected = options.filter((o) => value.includes(o.value))

  return (
    <BaseCombobox.Root
      items={options}
      multiple
      value={selected}
      onValueChange={(items) => onValueChange((items as Option[]).map((i) => i.value))}
      itemToStringLabel={(item) => (item as Option).label}
      filter={(item, query) => (item as Option).label.toLowerCase().includes(query.toLowerCase())}
      disabled={disabled}
    >
      <BaseCombobox.InputGroup
        className={cn(
          'inline-flex max-w-full flex-wrap items-center gap-1 rounded-md border border-border-strong bg-surface px-2 py-1.5 has-[input:disabled]:opacity-50',
          className,
        )}
      >
        <BaseCombobox.Chips className="flex flex-wrap items-center gap-1">
          <BaseCombobox.Value>
            {(items: Option[]) => (
              <>
                {items.map((item) => (
                  <BaseCombobox.Chip
                    key={item.value}
                    className="mono flex items-center gap-1 rounded bg-bg px-1.5 py-0.5 text-[11.5px] outline-none data-[highlighted]:bg-border"
                    aria-label={item.label}
                  >
                    {item.label}
                    <BaseCombobox.ChipRemove
                      className="flex items-center justify-center text-text-faint hover:text-text"
                      aria-label={`Remove ${item.label}`}
                    >
                      ×
                    </BaseCombobox.ChipRemove>
                  </BaseCombobox.Chip>
                ))}
                <BaseCombobox.Input
                  placeholder={items.length > 0 ? '' : placeholder}
                  size={items.length > 0 ? 1 : undefined}
                  className="min-w-12 border-0 bg-transparent p-0 text-left outline-none placeholder:text-text-faint"
                />
              </>
            )}
          </BaseCombobox.Value>
        </BaseCombobox.Chips>
        <BaseCombobox.Trigger className="shrink-0 text-text-faint" aria-label="Open list">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </BaseCombobox.Trigger>
      </BaseCombobox.InputGroup>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner className="z-100 outline-none" sideOffset={4}>
          <BaseCombobox.Popup className="w-[var(--anchor-width)] max-h-64 overflow-auto rounded-md border border-border bg-surface py-1 shadow-[var(--shadow-panel)] outline-none">
            <BaseCombobox.Empty className="px-3 py-2 text-[12.5px] text-text-faint">No matches</BaseCombobox.Empty>
            <BaseCombobox.List>
              {(item: Option) => (
                <BaseCombobox.Item
                  key={item.value}
                  value={item}
                  className="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-[13px] outline-none data-[highlighted]:bg-bg"
                >
                  <span>{item.label}</span>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  )
}
