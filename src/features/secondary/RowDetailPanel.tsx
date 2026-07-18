'use client'

import Link from 'next/link'
import { StatusChip } from '../../components/StatusChip'
import type { MigrationRow } from '../../types'
import { Button, ButtonLink } from '../../ui/Button'
import { SidePanel } from '../../ui/Dialog'
import { Faint, Muted, SectionLabel } from '../../ui/Text'
import type { ReactElement } from 'react'

const FIELD_LABELS: Record<string, string> = {
  opening_qty: 'Op. Qty',
  primary_sales: 'Op. Value',
  rate: 'Rate',
  sales_qty: 'Sec. Qty',
  sales_value: 'Sec. Value',
  closing_qty: 'Clos. Qty',
  closing_balance: 'Clos. Value',
  item: 'Item',
  document: 'Document',
}

/** Slide-over panel: sheet-vs-ERP diff and per-status fix actions. */
export function RowDetailPanel({
  row,
  onClose,
  onMapCustomer,
  onUpdate,
}: {
  row: MigrationRow
  onClose: () => void
  onMapCustomer: () => void
  onUpdate: (row: MigrationRow) => void
}) {
  const diffs = row.validate.ok === false ? row.validate.mismatches : row.diff

  return (
    <SidePanel open onOpenChange={(open) => !open && onClose()}>
      <div className="mb-1 flex items-center justify-between">
        <h3>Row {row.rowIndex}</h3>
        <Button size="sm" onClick={onClose}>
          ✕
        </Button>
      </div>
      <div className="mb-3.5">
        <StatusChip state={row.state} />
        {row.erpDocName && <Faint className="mono ml-2 text-[11.5px]">{row.erpDocName}</Faint>}
      </div>

      <SectionLabel className="mb-1.5 block">Sheet row</SectionLabel>
      <table className="table-data mb-4">
        <tbody>
          <tr>
            <td className="text-text-muted">EBS code</td>
            <td className="mono">{row.ebsCode}</td>
          </tr>
          <tr>
            <td className="text-text-muted">Customer</td>
            <td>{row.customerName}</td>
          </tr>
          <tr>
            <td className="text-text-muted">ERP customer</td>
            <td>{row.resolved.distributor ?? '—'}</td>
          </tr>
          <tr>
            <td className="text-text-muted">Item (sheet)</td>
            <td>{row.itemName}</td>
          </tr>
          <tr>
            <td className="text-text-muted">Item (ERP)</td>
            <td>{row.resolved.item ?? '—'}</td>
          </tr>
          <tr>
            <td className="text-text-muted">Date</td>
            <td className="mono">{row.resolved.date}</td>
          </tr>
        </tbody>
      </table>

      {row.issues.length > 0 && (
        <>
          <SectionLabel className="mb-1.5 block">Issues</SectionLabel>
          <ul className="mt-0 mb-4 pl-4.5">
            {row.issues.map((i, n) => (
              <li
                key={n}
                className={`mb-1 text-[12.5px] ${i.severity === 'error' ? 'text-status-error' : 'text-status-conflict'}`}
              >
                {i.message}
              </li>
            ))}
          </ul>
        </>
      )}

      {diffs.length > 0 && (
        <>
          <SectionLabel className="mb-1.5 block">Sheet vs ERP</SectionLabel>
          <table className="table-data mb-4">
            <thead>
              <tr>
                <th className="text-left">Field</th>
                <th className="text-left">Sheet</th>
                <th className="text-left">ERP</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d, n) => (
                <tr key={n}>
                  <td>{FIELD_LABELS[d.field] ?? d.field}</td>
                  <td className="text-status-new">{d.sheet ?? '—'}</td>
                  <td className="text-status-conflict">{d.erp ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <SectionLabel className="mb-2 block">Fix actions</SectionLabel>
      <div className="flex flex-col gap-2">
        {row.issues.some((i) => i.code === 'CUSTOMER_UNMAPPED') && (
          <Button variant="primary" onClick={onMapCustomer}>
            Map to ERP customer…
          </Button>
        )}
        {row.issues.some((i) => i.code === 'ITEM_UNMAPPED') && (
          <ButtonLink
            render={
              <Link href={`/mappings?tab=regex&pattern=${encodeURIComponent(row.itemName)}`} /> as ReactElement
            }
          >
            Map item in Mappings →
          </ButtonLink>
        )}
        {row.state === 'conflict' && (
          <>
            <Button variant="primary" onClick={() => onUpdate({ ...row, resolution: 'use-sheet', state: 'matched' })}>
              Use sheet values (update ERP on push)
            </Button>
            <Button onClick={() => onUpdate({ ...row, resolution: 'keep-erp', state: 'synced' })}>
              Keep ERP values (mark as synced)
            </Button>
          </>
        )}
        {row.state !== 'skipped' && row.state !== 'synced' && (
          <Button onClick={() => onUpdate({ ...row, state: 'skipped' })}>Skip this row</Button>
        )}
        {row.state === 'skipped' && (
          <Button onClick={() => onUpdate({ ...row, state: 'new', resolution: null })}>Un-skip</Button>
        )}
      </div>

      {row.push.lastError && (
        <p className="mt-4 text-xs text-status-error">Last push error: {row.push.lastError}</p>
      )}
      {row.validate.at && (
        <Faint className="mt-3 block text-[11.5px]">
          Last validated {new Date(row.validate.at).toLocaleString('en-GB')} — {row.validate.ok ? 'OK' : 'mismatch'}
        </Faint>
      )}
    </SidePanel>
  )
}
