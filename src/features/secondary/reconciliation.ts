// Ecubix (sheet) vs ERPNext reconciliation for the browse view — same
// validation pipeline as ecubixBatch.ts (buildRowFromEcubixDoc + validateRow +
// one fetchErpSnapshot per HQ), just run read-only and without creating a
// Batch. Snapshots are fetched per leaf (not combined across leaves): a
// combined `distributor in [...]` filter across every HQ in scope blows up
// the query string for the Secondary Data Entry list call, which some
// ERPNext deployments reject before ever sending CORS headers back — the
// browser then reports that as an opaque "Failed to fetch"/CORS error.
// Concurrency is capped for the same reason: an unfiltered "All
// departments/All HQs" scope can mean dozens of leaves at once.

import { buildMasterMap } from '../../data/appStore'
import { normalizeItemName } from '../../engine/resolveItem'
import { groupKey, validateRow } from '../../engine/validateRow'
import { getHqRawRows } from '../../lib/ecubix/reads'
import type { ErpNextClient } from '../../lib/erpnext/client'
import type { ErpSecondaryDoc, HeaderMapEntry, MasterMapEntry, MigrationRow, RegexMapEntry } from '../../types'
import { buildRowFromEcubixDoc } from './ecubixBatch'
import { fetchErpSnapshot } from './erpActions'

export interface ReconciliationLeafKey {
  month: string // YYYYMM (ecubix collection key)
  department: string
  hq: string // Firestore collection name, e.g. "HQ-Ernakulam"
}

export function reconciliationKey(l: ReconciliationLeafKey): string {
  return `${l.month}|${l.department}|${l.hq}`
}

export interface LeafReconciliation {
  rows: number
  conflicts: number
  customers: Set<string> // ebsCode
  unmappedCustomers: Set<string>
  items: Set<string> // itemName
  unmappedItems: Set<string>
  deptHqMismatchCustomers: Set<string>
  sheetSalesValue: number
  erpSalesValue: number
  sheetClosingValue: number
  erpClosingValue: number
  sheetSalesQty: number
  erpSalesQty: number
  sheetClosingQty: number
  erpClosingQty: number
  matchedEqualValue: number
}

function reconciliationFromRows(rows: MigrationRow[], erpExisting: Map<string, ErpSecondaryDoc>): LeafReconciliation {
  const customers = new Set<string>()
  const unmappedCustomers = new Set<string>()
  const items = new Set<string>()
  const unmappedItems = new Set<string>()
  const deptHqMismatchCustomers = new Set<string>()
  let conflicts = 0
  let sheetSalesValue = 0
  let erpSalesValue = 0
  let sheetClosingValue = 0
  let erpClosingValue = 0
  let sheetSalesQty = 0
  let erpSalesQty = 0
  let sheetClosingQty = 0
  let erpClosingQty = 0
  let matchedEqualValue = 0

  for (const r of rows) {
    if (r.ebsCode) {
      customers.add(r.ebsCode)
      if (!r.resolved.distributor) unmappedCustomers.add(r.ebsCode)
      if (r.issues.some((i) => i.code === 'HQ_UNMAPPED' || i.code === 'MULTI_DEPT')) deptHqMismatchCustomers.add(r.ebsCode)
    }
    if (r.itemName) {
      items.add(r.itemName)
      if (!r.resolved.item) unmappedItems.add(r.itemName)
    }
    if (r.state === 'conflict') conflicts++

    sheetSalesValue += r.values.sales_value ?? 0
    sheetClosingValue += r.values.closing_balance ?? 0
    sheetSalesQty += r.values.sales_qty ?? 0
    sheetClosingQty += r.values.closing_qty ?? 0
    const doc = r.resolved.distributor ? erpExisting.get(groupKey(r.resolved.distributor, r.resolved.date)) : undefined
    const line = doc && r.resolved.item
      ? doc.items.find((i) => normalizeItemName(i.item) === normalizeItemName(r.resolved.item!))
      : undefined
    if (line) {
      erpSalesValue += line.sales_value ?? 0
      erpClosingValue += line.closing_balance ?? 0
      erpSalesQty += line.sales_qty ?? 0
      erpClosingQty += line.closing_qty ?? 0
      if (r.diff.length === 0) matchedEqualValue += r.values.sales_value ?? 0
    }
  }

  return {
    rows: rows.length,
    conflicts,
    customers,
    unmappedCustomers,
    items,
    unmappedItems,
    deptHqMismatchCustomers,
    sheetSalesValue,
    erpSalesValue,
    sheetClosingValue,
    erpClosingValue,
    sheetSalesQty,
    erpSalesQty,
    sheetClosingQty,
    erpClosingQty,
    matchedEqualValue,
  }
}

export function sumReconciliation(list: LeafReconciliation[]): LeafReconciliation {
  const out: LeafReconciliation = {
    rows: 0,
    conflicts: 0,
    customers: new Set(),
    unmappedCustomers: new Set(),
    items: new Set(),
    unmappedItems: new Set(),
    deptHqMismatchCustomers: new Set(),
    sheetSalesValue: 0,
    erpSalesValue: 0,
    sheetClosingValue: 0,
    erpClosingValue: 0,
    sheetSalesQty: 0,
    erpSalesQty: 0,
    sheetClosingQty: 0,
    erpClosingQty: 0,
    matchedEqualValue: 0,
  }
  for (const r of list) {
    out.rows += r.rows
    out.conflicts += r.conflicts
    r.customers.forEach((c) => out.customers.add(c))
    r.unmappedCustomers.forEach((c) => out.unmappedCustomers.add(c))
    r.items.forEach((i) => out.items.add(i))
    r.unmappedItems.forEach((i) => out.unmappedItems.add(i))
    r.deptHqMismatchCustomers.forEach((c) => out.deptHqMismatchCustomers.add(c))
    out.sheetSalesValue += r.sheetSalesValue
    out.erpSalesValue += r.erpSalesValue
    out.sheetClosingValue += r.sheetClosingValue
    out.erpClosingValue += r.erpClosingValue
    out.sheetSalesQty += r.sheetSalesQty
    out.erpSalesQty += r.erpSalesQty
    out.sheetClosingQty += r.sheetClosingQty
    out.erpClosingQty += r.erpClosingQty
    out.matchedEqualValue += r.matchedEqualValue
  }
  return out
}

/** Runs one leaf's raw-rows fetch + ERP snapshot + validation, mirroring openOrCreateEcubixBatch's ERP step exactly. */
async function computeLeafReconciliation(
  leaf: ReconciliationLeafKey,
  erp: ErpNextClient,
  headerMap: HeaderMapEntry[],
  masterMapCtx: Map<string, Map<string, string>>,
  regexMap: RegexMapEntry[],
): Promise<LeafReconciliation> {
  const monthYyyyMm = `${leaf.month.slice(0, 4)}-${leaf.month.slice(4, 6)}`
  const erpHq = leaf.hq.replace(/^HQ-/i, '')

  const raw = await getHqRawRows(leaf.month, leaf.department, leaf.hq)
  const rows = raw
    .map((r, i) => buildRowFromEcubixDoc(r, i + 1, headerMap, monthYyyyMm))
    .filter((r): r is MigrationRow => r !== null)

  const confirmedDistributors = Object.fromEntries(masterMapCtx.get('distributor') ?? [])
  const ebsCodeErpFields = headerMap.find((h) => h.field === 'ebsCode')?.erpFields ?? []
  const ebsCodes = [...new Set(rows.map((r) => r.ebsCode).filter(Boolean))]

  const snapshot = await fetchErpSnapshot(erp, ebsCodes, ebsCodeErpFields, confirmedDistributors, monthYyyyMm)
  const ctx = {
    masterMap: masterMapCtx,
    regexMap,
    erpItemsIndex: snapshot.items,
    erpCustomersIndex: snapshot.customers,
    erpExisting: snapshot.existing,
    customerProfiles: snapshot.customerProfiles,
    batchHq: erpHq,
    batchDepartment: leaf.department,
    hasErpSnapshot: true,
  }
  const validated = rows.map((r) => validateRow(r, ctx))
  return reconciliationFromRows(validated, snapshot.existing)
}

const MAX_CONCURRENT_LEAVES = 3

export interface ReconciliationBatchResult {
  results: Map<string, LeafReconciliation>
  /** Leaves whose fetch/validate threw — kept separate so one bad HQ doesn't discard the rest of the batch. */
  failed: { leaf: ReconciliationLeafKey; error: unknown }[]
}

/**
 * Runs the full sheet-vs-ERP check for a set of (month, department, hq)
 * leaves, one ERP snapshot per leaf (see computeLeafReconciliation), a few at
 * a time. A leaf that fails doesn't abort the rest — it's reported in
 * `failed` so the caller can decide whether to retry it. Callers own scoping
 * (which leaves to pass) and caching (this always re-fetches) — see
 * EcubixBrowser's `once()`-style request-dedup ref.
 */
export async function computeReconciliation(
  leaves: ReconciliationLeafKey[],
  erp: ErpNextClient,
  headerMap: HeaderMapEntry[],
  masterMap: MasterMapEntry[],
  regexMap: RegexMapEntry[],
): Promise<ReconciliationBatchResult> {
  const results = new Map<string, LeafReconciliation>()
  const failed: { leaf: ReconciliationLeafKey; error: unknown }[] = []
  if (leaves.length === 0) return { results, failed }
  const masterMapCtx = buildMasterMap(masterMap)

  const queue = [...leaves]
  async function worker() {
    let leaf: ReconciliationLeafKey | undefined
    while ((leaf = queue.shift())) {
      try {
        results.set(reconciliationKey(leaf), await computeLeafReconciliation(leaf, erp, headerMap, masterMapCtx, regexMap))
      } catch (error) {
        failed.push({ leaf, error })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_LEAVES, leaves.length) }, worker))
  return { results, failed }
}
