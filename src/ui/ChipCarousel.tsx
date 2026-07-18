'use client'

import { useRef } from 'react'
import { cn } from './cn'
import { OutlineChipButton } from './Chip'

export interface CarouselBadge {
  text: string
  /** 'issue' → red, 'ok' → green, 'neutral' → same tone as the chip itself. */
  tone: 'issue' | 'ok' | 'neutral'
}

interface CarouselItem {
  value: string
  label: string
  badge?: CarouselBadge
}

function ChipBadge({ badge, active }: { badge: CarouselBadge; active?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-4 items-center justify-center rounded-full px-1.5 py-0.5 text-[9.5px] font-bold leading-none',
        badge.tone === 'issue' && 'bg-status-error-bg text-status-error',
        badge.tone === 'ok' && 'bg-status-synced-bg text-status-synced',
        badge.tone === 'neutral' && (active ? 'bg-white/20 text-white' : 'bg-border text-text-muted'),
      )}
    >
      {badge.text}
    </span>
  )
}

/**
 * A chip row that turns into a horizontally-scrollable strip with
 * prev/next arrows once there are more than a handful of options, instead
 * of wrapping into an ever-taller wall of buttons as the option count grows.
 */
export function ChipCarousel({
  items,
  value,
  onChange,
  allLabel,
  allBadge,
}: {
  items: CarouselItem[]
  value: string | null
  onChange: (value: string | null) => void
  allLabel: string
  allBadge?: CarouselBadge
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // +1 for the always-present "All X" chip, so the threshold counts total visible chips, not just the specific options.
  const showArrows = items.length + 1 > 5

  function scrollBy(delta: number) {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      {showArrows && (
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-[11px] leading-none text-text-muted hover:bg-bg"
          onClick={() => scrollBy(-220)}
          aria-label="Scroll left"
        >
          ‹
        </button>
      )}
      <div
        ref={scrollRef}
        className="scrollbar-none flex min-w-0 items-center gap-1.5 overflow-x-auto scroll-smooth"
        style={showArrows ? { maxWidth: '17rem' } : undefined}
      >
        <OutlineChipButton active={!value} onClick={() => onChange(null)} className="shrink-0">
          {allLabel}
          {allBadge && <ChipBadge badge={allBadge} active={!value} />}
        </OutlineChipButton>
        {items.map((item) => (
          <OutlineChipButton key={item.value} active={value === item.value} onClick={() => onChange(item.value)} className="shrink-0">
            {item.label}
            {item.badge && <ChipBadge badge={item.badge} active={value === item.value} />}
          </OutlineChipButton>
        ))}
      </div>
      {showArrows && (
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-[11px] leading-none text-text-muted hover:bg-bg"
          onClick={() => scrollBy(220)}
          aria-label="Scroll right"
        >
          ›
        </button>
      )}
    </div>
  )
}
