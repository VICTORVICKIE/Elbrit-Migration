'use client'

import { useEffect, useRef, useState } from 'react'
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
 * A chip row that shares available width with its siblings by content
 * (no forced equal split), and only turns into a horizontally-scrollable
 * strip with prev/next arrows once its chips actually no longer fit —
 * measured live, rather than guessed from a fixed item-count threshold.
 *
 * `grow` opts into an equal split with its sibling instead of a
 * content-sized share — the caller sets this once it knows both siblings
 * need to scroll anyway, since giving the bigger one more room at that
 * point just skews clicks without letting either show everything.
 */
export function ChipCarousel({
  items,
  value,
  onChange,
  allLabel,
  allBadge,
  grow,
  onNaturalWidthChange,
}: {
  items: CarouselItem[]
  value: string | null
  onChange: (value: string | null) => void
  allLabel: string
  allBadge?: CarouselBadge
  grow?: boolean
  onNaturalWidthChange?: (width: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showArrows, setShowArrows] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const checkOverflow = () => {
      setShowArrows(el.scrollWidth > el.clientWidth + 1)
      onNaturalWidthChange?.(el.scrollWidth)
    }
    checkOverflow()
    const observer = new ResizeObserver(checkOverflow)
    observer.observe(el)
    return () => observer.disconnect()
  }, [items, value, allLabel, allBadge, onNaturalWidthChange])

  function scrollBy(delta: number) {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1', grow && 'flex-1')}>
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
      <div ref={scrollRef} className="scrollbar-none flex min-w-0 items-center gap-1.5 overflow-x-auto scroll-smooth">
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
