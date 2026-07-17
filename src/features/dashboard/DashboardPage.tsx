'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAppStore } from '../../data/appStore'
import { Card } from '../../ui/Card'
import { cn } from '../../ui/cn'
import { Faint, Muted, PageHead, SectionLabel } from '../../ui/Text'

const STEPS = [
  { n: 1, title: 'Download from Ecubix', desc: 'Export the monthly sheet to the Drive migration folder' },
  { n: 2, title: 'Check & fix', desc: 'Resolve unmapped codes, item names and conflicts' },
  { n: 3, title: 'Push to ERPNext', desc: 'Creates new records, updates matched ones' },
  { n: 4, title: 'Validate', desc: 'Every ERP record is compared back against the sheet' },
]

const SOON_TYPES = ['Visit', 'Service', 'Support']

function statusSummary(counts: { synced: number; error: number; conflict: number; new: number; matched: number }) {
  const parts: string[] = []
  if (counts.synced) parts.push(`${counts.synced} synced`)
  const pending = counts.new + counts.matched
  if (pending) parts.push(`${pending} pending`)
  if (counts.error) parts.push(`${counts.error} errors`)
  if (counts.conflict) parts.push(`${counts.conflict} conflicts`)
  return parts.join(' · ') || '—'
}

export function DashboardPage() {
  const router = useRouter()
  const batches = useAppStore((s) => s.batches)
  const secondaryBatches = batches.filter((b) => b.datatype === 'secondary')
  const active = secondaryBatches.find((b) => b.status !== 'done') ?? secondaryBatches[0]

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div>
      <PageHead
        title="Migration overview"
        subtitle={`Ecubix → ERPNext${active ? ` · ${new Date(active.month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} cycle` : ''}`}
        actions={
          <div className="flex items-center gap-2.5">
            <Faint className="text-[12.5px]">{today}</Faint>
          </div>
        }
      />

      {/* pipeline cards */}
      <div className="mb-5.5 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
        <Card className="p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="font-semibold">Secondary</span>
            <span className="rounded-full bg-active-badge-bg px-2.5 py-0.5 text-[10.5px] font-medium tracking-[0.06em] text-active-badge">
              ACTIVE
            </span>
          </div>
          {active ? (
            <>
              <div className="mb-2">
                <span className="text-2xl font-semibold">{active.counts.synced}</span>
                <Muted> / {active.counts.total} rows synced</Muted>
              </div>
              <div className="mb-2 h-1.5 rounded bg-border">
                <div
                  className="h-full rounded bg-accent"
                  style={{ width: `${active.counts.total ? (active.counts.synced / active.counts.total) * 100 : 0}%` }}
                />
              </div>
              <Muted className="mb-2.5 block text-[12.5px]">
                {active.counts.error} errors · {active.counts.conflict} conflicts need attention
              </Muted>
              <Link href={`/secondary/${active.id}`} className="text-[13px] font-semibold">
                Open check &amp; fix →
              </Link>
            </>
          ) : (
            <Muted>No batches yet — open Secondary to start.</Muted>
          )}
        </Card>

        {SOON_TYPES.map((t) => (
          <Card key={t} className="border-dashed bg-transparent p-4">
            <div className="mb-2.5 font-semibold text-text-muted">{t}</div>
            <Faint className="block text-[12.5px]">Not configured yet</Faint>
            <Faint className="mt-7.5 block text-xs">Add a config in Settings to enable</Faint>
          </Card>
        ))}
      </div>

      {/* recent batches */}
      <Card className="mb-5.5">
        <div className="p-3.5 px-4 font-semibold">Recent batches</div>
        <div className="table-scroll">
          <table className="table-data">
            <thead>
              <tr>
                <th>Sheet</th>
                <th>Department</th>
                <th>Rows</th>
                <th>Status</th>
                <th>Last run</th>
              </tr>
            </thead>
            <tbody>
              {secondaryBatches.map((b) => (
                <tr key={b.id} className="clickable" onClick={() => router.push(`/secondary/${b.id}`)}>
                  <td className="mono text-[12.5px]">{b.fileName}</td>
                  <td>{b.department}</td>
                  <td>{b.counts.total}</td>
                  <td className="text-[12.5px] text-text-muted">{statusSummary(b.counts)}</td>
                  <td className="text-[12.5px] text-text-muted">
                    {b.lastRunAt ? new Date(b.lastRunAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                </tr>
              ))}
              {secondaryBatches.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-7 text-center text-text-muted">
                    No batches yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 4-step process */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
        {STEPS.map((s) => (
          <Card key={s.n} className="p-4">
            <SectionLabel className={cn('mb-1.5 block text-accent-text')}>STEP {s.n}</SectionLabel>
            <div className="mb-1 font-semibold">{s.title}</div>
            <Muted className="m-0 text-[12.5px]">{s.desc}</Muted>
          </Card>
        ))}
      </div>
    </div>
  )
}
