'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '../ui/cn'

const migrate = [
  { to: '/', label: 'Dashboard', icon: '▦', soon: false },
  { to: '/secondary', label: 'Secondary', icon: '⊪', soon: false },
  { to: '/visit', label: 'Visit', icon: '◎', soon: true },
  { to: '/service', label: 'Service', icon: '▤', soon: true },
  { to: '/support', label: 'Support', icon: '◍', soon: true },
]

const system = [
  { to: '/mappings', label: 'Mappings', icon: '⇄', soon: false },
  { to: '/settings', label: 'Settings', icon: '⚙', soon: false },
]

const COLLAPSE_KEY = 'elbrit-migration-sidebar-collapsed'

function Item({ to, label, icon, soon, collapsed }: (typeof migrate)[number] & { collapsed: boolean }) {
  const pathname = usePathname()
  const isActive = to === '/' ? pathname === '/' : pathname.startsWith(to)
  return (
    <Link
      href={to}
      className={cn(
        'mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-sidebar-text hover:bg-white/5 hover:text-[#d7dee8]',
        isActive && 'bg-sidebar-active-bg text-sidebar-active-text hover:text-sidebar-active-text',
        soon && 'pointer-events-none opacity-55',
      )}
      title={collapsed ? label : undefined}
    >
      <span className="w-4 text-center text-[13px]">{icon}</span>
      {!collapsed && <span>{label}</span>}
      {!collapsed && soon && (
        <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em]">
          SOON
        </span>
      )}
    </Link>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1')
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      return next
    })
  }

  return (
    <>
      <button
        className="fixed top-3.5 left-3.5 z-210 hidden size-9 items-center justify-center rounded-lg border border-border-strong bg-surface shadow-[var(--shadow-card)] max-[860px]:flex"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label="Toggle navigation"
      >
        ☰
      </button>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-150 hidden bg-[rgba(16,27,45,0.45)] max-[860px]:block"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          'sticky top-0 flex h-screen shrink-0 flex-col bg-sidebar-bg px-3 py-5 text-sidebar-text transition-[width] duration-150',
          collapsed ? 'w-14 px-2' : 'w-54',
          'max-[860px]:fixed max-[860px]:z-200 max-[860px]:w-54 max-[860px]:-translate-x-full max-[860px]:px-3 max-[860px]:transition-transform max-[860px]:duration-200',
          mobileOpen && 'max-[860px]:translate-x-0',
        )}
      >
        <button
          className="absolute top-6 -right-3 z-10 flex size-6 items-center justify-center rounded-full border border-border-strong bg-surface text-text-muted shadow-[var(--shadow-card)] hover:bg-bg hover:text-text max-[860px]:hidden"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="px-2.5 pb-4.5">
          <div className="text-base font-semibold tracking-[0.28em] text-white">{collapsed ? 'E' : 'ELBRIT'}</div>
          {!collapsed && <div className="mt-0.5 text-[10px] tracking-[0.18em] text-sidebar-heading">DATA MIGRATION</div>}
        </div>

        {!collapsed && (
          <div className="px-2.5 pt-4 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-sidebar-heading">
            MIGRATE
          </div>
        )}
        {migrate.map((i) => (
          <Item key={i.to} {...i} collapsed={collapsed} />
        ))}

        {!collapsed && (
          <div className="px-2.5 pt-4 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-sidebar-heading">
            SYSTEM
          </div>
        )}
        {system.map((i) => (
          <Item key={i.to} {...i} collapsed={collapsed} />
        ))}

        <div className="mt-auto flex items-center gap-1.5 pt-3 px-2.5 text-[11.5px] text-sidebar-heading">
          <span className="size-1.5 rounded-full bg-[#22c55e]" />
          {!collapsed && 'Firebase · connected'}
        </div>
      </aside>
    </>
  )
}
