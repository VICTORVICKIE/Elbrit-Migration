import { describe, expect, it } from 'vitest'
import type { ErpSecondaryDoc, MigrationRow } from '../types'
import { normalizeItemName } from './resolveItem'
import { buildDocPayload, buildPushGroups } from './buildPayload'
import { roundTripCompare } from './roundTrip'
import { countRows, diffRow, validateRow, type ValidationContext } from './validateRow'

function makeRow(overrides: Partial<MigrationRow> = {}): MigrationRow {
  return {
    id: 'r1',
    rowIndex: 2,
    raw: {},
    ebsCode: 'E-1001',
    customerName: 'Kochi Pharma Distributors',
    itemName: 'Elbrit 500mg Tab',
    hq: 'Kochi',
    resolved: { distributor: null, item: null, date: '2026-06-01', roleProfile: null, department: null, erpHq: null },
    values: {
      opening_qty: 10,
      primary_sales: 1000,
      rate: 55.5,
      sales_qty: 5,
      sales_value: 277.5,
      closing_qty: 5,
      closing_balance: 277.5,
    },
    state: 'new',
    issues: [],
    diff: [],
    erpDocName: null,
    resolution: null,
    push: { attempts: 0, lastError: null, lastAt: null },
    validate: { ok: null, mismatches: [], at: null },
    ...overrides,
  }
}

const masterMap = new Map<string, Map<string, string>>([
  ['distributor', new Map([['e-1001', 'CUST-0001']])],
])

const customerProfiles = new Map([
  ['CUST-0001', [{ roleProfile: 'RP-1', department: 'Sales', hq: 'Kochi' }]],
])

const erpItemsIndex = new Map<string, string>([
  [normalizeItemName('Elbrit 500mg Tab'), 'ITEM-ELB-500'],
  [normalizeItemName('Proxima Syrup 100ml'), 'ITEM-PRX-100'],
])

function erpDoc(overrides: Partial<ErpSecondaryDoc> = {}): ErpSecondaryDoc {
  return {
    name: 'CUST-0001-2026-06-01',
    distributor: 'CUST-0001',
    date: '2026-06-01',
    items: [
      {
        item: 'ITEM-ELB-500',
        opening_qty: 10,
        primary_sales: 1000,
        rate: 55.5,
        sales_qty: 5,
        sales_value: 277.5,
        closing_qty: 5,
        closing_balance: 277.5,
      },
    ],
    ...overrides,
  }
}

describe('validateRow', () => {
  const baseCtx: ValidationContext = {
    masterMap,
    erpItemsIndex,
    erpCustomersIndex: new Map(),
    erpExisting: new Map(),
    customerProfiles,
    hasErpSnapshot: true,
  }

  it('unmapped customer → error with CUSTOMER_UNMAPPED', () => {
    const row = validateRow(makeRow({ ebsCode: 'E-9999' }), baseCtx)
    expect(row.state).toBe('error')
    expect(row.issues.some((i) => i.code === 'CUSTOMER_UNMAPPED')).toBe(true)
  })

  it('unmapped item → error with ITEM_UNMAPPED', () => {
    const row = validateRow(makeRow({ itemName: 'Unknown Med 10mg' }), baseCtx)
    expect(row.state).toBe('error')
    expect(row.issues.some((i) => i.code === 'ITEM_UNMAPPED')).toBe(true)
  })

  it('item override via masterMap resolves an otherwise-unmapped name', () => {
    const ctx: ValidationContext = {
      ...baseCtx,
      masterMap: new Map([...masterMap, ['item', new Map([[normalizeItemName('Elbrit-CV 625'), 'ITEM-ELB-500']])]]),
    }
    const row = validateRow(makeRow({ itemName: 'Elbrit-CV 625' }), ctx)
    expect(row.issues.some((i) => i.code === 'ITEM_UNMAPPED')).toBe(false)
    expect(row.resolved.item).toBe('ITEM-ELB-500')
  })

  it('clean row with no ERP doc → new', () => {
    const row = validateRow(makeRow(), baseCtx)
    expect(row.state).toBe('new')
    expect(row.resolved.distributor).toBe('CUST-0001')
    expect(row.resolved.item).toBe('ITEM-ELB-500')
  })

  it('identical ERP doc → matched with empty diff', () => {
    const ctx = { ...baseCtx, erpExisting: new Map([['CUST-0001|2026-06-01', erpDoc()]]) }
    const row = validateRow(makeRow(), ctx)
    expect(row.state).toBe('matched')
    expect(row.diff).toEqual([])
    expect(row.erpDocName).toBe('CUST-0001-2026-06-01')
  })

  it('differing ERP doc → conflict with field diff', () => {
    const doc = erpDoc()
    doc.items[0].sales_qty = 99
    const ctx = { ...baseCtx, erpExisting: new Map([['CUST-0001|2026-06-01', doc]]) }
    const row = validateRow(makeRow(), ctx)
    expect(row.state).toBe('conflict')
    expect(row.diff).toEqual([{ field: 'sales_qty', sheet: 5, erp: 99 }])
  })

  it('currency tolerance ±0.01 does not create conflicts', () => {
    const doc = erpDoc()
    doc.items[0].sales_value = 277.505
    const ctx = { ...baseCtx, erpExisting: new Map([['CUST-0001|2026-06-01', doc]]) }
    const row = validateRow(makeRow(), ctx)
    expect(row.state).toBe('matched')
  })

  it('resolved conflict stays matched (push honors resolution)', () => {
    const doc = erpDoc()
    doc.items[0].sales_qty = 99
    const ctx = { ...baseCtx, erpExisting: new Map([['CUST-0001|2026-06-01', doc]]) }
    const row = validateRow(makeRow({ resolution: 'use-sheet' }), ctx)
    expect(row.state).toBe('matched')
    expect(row.diff.length).toBeGreaterThan(0)
  })

  it('skipped rows are left untouched', () => {
    const row = validateRow(makeRow({ state: 'skipped' }), baseCtx)
    expect(row.state).toBe('skipped')
  })

  it('negative value is a warning, not a blocker', () => {
    const row = validateRow(makeRow({ values: { ...makeRow().values, closing_qty: -2 } }), baseCtx)
    expect(row.state).toBe('new')
    expect(row.issues.some((i) => i.code === 'NEGATIVE_VALUE' && i.severity === 'warning')).toBe(true)
  })
})

describe('buildPushGroups / buildDocPayload', () => {
  const groupCtx: ValidationContext = {
    masterMap,
    erpItemsIndex,
    erpCustomersIndex: new Map(),
    erpExisting: new Map(),
    customerProfiles,
    hasErpSnapshot: true,
  }

  it('groups rows by distributor|date and builds child items', () => {
    const r1 = validateRow(makeRow({ id: 'a' }), groupCtx)
    const r2 = validateRow(makeRow({ id: 'b', itemName: 'Proxima Syrup 100ml' }), groupCtx)
    const groups = buildPushGroups([r1, r2])
    expect(groups).toHaveLength(1)
    expect(groups[0].rows).toHaveLength(2)
    const payload = buildDocPayload(groups[0])
    expect(payload.distributor).toBe('CUST-0001')
    expect(payload.items.map((i) => i.item)).toEqual(['ITEM-ELB-500', 'ITEM-PRX-100'])
  })

  it('excludes error/skipped/synced and unresolved conflicts', () => {
    const rows = [
      makeRow({ id: 'a', state: 'error' }),
      makeRow({ id: 'b', state: 'skipped' }),
      makeRow({ id: 'c', state: 'synced' }),
      makeRow({
        id: 'd',
        state: 'conflict',
        resolution: null,
        resolved: { distributor: 'CUST-0001', item: 'ITEM-ELB-500', date: '2026-06-01', roleProfile: null, department: null, erpHq: null },
      }),
    ]
    expect(buildPushGroups(rows)).toHaveLength(0)
  })
})

describe('roundTripCompare', () => {
  it('flags missing docs and mismatched fields', () => {
    const pushed = validateRow(makeRow(), {
      masterMap,
      erpItemsIndex,
      erpCustomersIndex: new Map(),
      erpExisting: new Map([['CUST-0001|2026-06-01', erpDoc()]]),
      customerProfiles,
      hasErpSnapshot: true,
    })
    const okResult = roundTripCompare([pushed], new Map([[pushed.erpDocName!, erpDoc()]]))
    expect(okResult[0].ok).toBe(true)

    const missing = roundTripCompare([pushed], new Map())
    expect(missing[0].ok).toBe(false)

    const changed = erpDoc()
    changed.items[0].rate = 60
    const mismatch = roundTripCompare([pushed], new Map([[pushed.erpDocName!, changed]]))
    expect(mismatch[0].ok).toBe(false)
    expect(mismatch[0].mismatches[0].field).toBe('rate')
  })
})

describe('no ERP snapshot (demo / not configured)', () => {
  const noSnapshotCtx: ValidationContext = {
    masterMap,
    erpItemsIndex: new Map<string, string>(),
    erpCustomersIndex: new Map<string, string>(),
    erpExisting: new Map(),
    customerProfiles,
    hasErpSnapshot: false,
  }

  it('does not flag items unmapped and preserves ERP-relative states', () => {
    const conflictRow = makeRow({
      state: 'conflict',
      resolved: { distributor: 'CUST-0001', item: 'Elbrit-CV 625 Tablet', date: '2026-06-01', roleProfile: null, department: null, erpHq: null },
      diff: [{ field: 'sales_qty', sheet: 8, erp: 6 }],
      erpDocName: 'CUST-0001-2026-06-01',
    })
    const out = validateRow(conflictRow, noSnapshotCtx)
    expect(out.state).toBe('conflict')
    expect(out.diff).toEqual(conflictRow.diff)
    expect(out.issues.some((i) => i.code === 'ITEM_UNMAPPED')).toBe(false)
  })

  it('recovered error rows become new after customer is mapped', () => {
    const errorRow = makeRow({
      state: 'error',
      issues: [{ code: 'CUSTOMER_UNMAPPED', message: 'x', severity: 'error' }],
    })
    const out = validateRow(errorRow, noSnapshotCtx)
    expect(out.state).toBe('new')
    expect(out.resolved.distributor).toBe('CUST-0001')
  })
})

describe('diffRow / countRows', () => {
  it('missing item line in ERP doc reports item diff', () => {
    const row = validateRow(makeRow(), {
      masterMap,
      erpItemsIndex,
      erpCustomersIndex: new Map(),
      erpExisting: new Map(),
      customerProfiles,
      hasErpSnapshot: true,
    })
    const doc = erpDoc({ items: [] })
    expect(diffRow(row, doc)).toEqual([{ field: 'item', sheet: 'ITEM-ELB-500', erp: null }])
  })
  it('counts states', () => {
    const counts = countRows([makeRow({ state: 'new' }), makeRow({ state: 'error' }), makeRow({ state: 'error' })])
    expect(counts).toMatchObject({ total: 3, new: 1, error: 2 })
  })
})
