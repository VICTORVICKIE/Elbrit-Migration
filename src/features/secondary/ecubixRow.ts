// Shared MigrationRow-building helpers for the Ecubix ingestion path.

import type { MigrationRow } from '../../types'

/** Subtotal/footer rows: "EBS626 Total", "Kurnool Total", "Grand Total". */
export function isSubtotalRow(raw: Record<string, string | number | null>): boolean {
  const cells = [raw['state'], raw['ebsCode'], raw['hq'], raw['customerName']]
  return cells.some((c) => typeof c === 'string' && /(^|\s)(grand\s+)?total$/i.test(c.trim()))
}

/** Build one MigrationRow from an already-coerced `raw` record (keyed by HeaderMapField). */
export function buildMigrationRowFromRaw(
  raw: Record<string, string | number | null>,
  rowIndex: number,
  opts: { hq: string; date: string },
): MigrationRow {
  const num = (f: string) => (typeof raw[f] === 'number' ? (raw[f] as number) : null)
  return {
    id: `row-${rowIndex}`,
    rowIndex,
    raw,
    ebsCode: String(raw['ebsCode'] ?? '').trim(),
    customerName: String(raw['customerName'] ?? '').trim(),
    // Ecubix pads product names with trailing dots/spaces
    itemName: String(raw['itemName'] ?? '').trim().replace(/[.\s]+$/, ''),
    hq: opts.hq,
    resolved: {
      distributor: null,
      item: null,
      date: opts.date,
      roleProfile: null,
      department: null,
      erpHq: null,
    },
    values: {
      sales_qty: num('sales_qty'),
      sales_value: num('sales_value'),
      closing_qty: num('closing_qty'),
      closing_balance: num('closing_balance'),
    },
    state: 'new',
    issues: [],
    diff: [],
    erpDocName: null,
    resolution: null,
    push: { attempts: 0, lastError: null, lastAt: null },
    validate: { ok: null, mismatches: [], at: null },
  }
}
