// Ecubix vs ERPNext reconciliation for the browse view — same
// validation pipeline as ecubixBatch.ts (buildRowFromEcubixDoc + validateRow),
// just run read-only and without creating a Batch. computeReconciliation runs
// in three phases: fetch+build every leaf's rows from Firestore, fetch the
// ENTIRE ERP side (catalog + distributor resolution + existing docs + role
// profiles) in ONE call for every leaf's EBS codes combined (via the
// migration_secondary Server Script — see
// fetchReconciliationSnapshot in erpActions.ts), then validate each leaf
// against that shared snapshot. Falls back to the older two-call REST path
// (fetchStaticErpIndex + a per-leaf fetchErpSnapshot) if that call fails
// (e.g. the script isn't deployed on this ERPNext instance yet).

import { buildMasterMap } from '../../data/appStore'
import { normalizeItemName } from '../../engine/resolveItem'
import { groupKey, validateRow } from '../../engine/validateRow'
import { getHqRawRows } from '../../lib/ecubix/reads'
import type { ErpNextClient } from '../../lib/erpnext/client'
import type { CustomerProfile, ErpSecondaryDoc, HeaderMapEntry, MasterMapEntry, MigrationRow, RegexMapEntry } from '../../types'
import { buildRowFromEcubixDoc } from './ecubixBatch'
import { fetchErpSnapshot, fetchReconciliationSnapshot, fetchStaticErpIndex, type ReconciliationSnapshot } from './erpActions'

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
  ecubixSalesValue: number
  erpSalesValue: number
  ecubixClosingValue: number
  erpClosingValue: number
  ecubixSalesQty: number
  erpSalesQty: number
  ecubixClosingQty: number
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
  let ecubixSalesValue = 0
  let erpSalesValue = 0
  let ecubixClosingValue = 0
  let erpClosingValue = 0
  let ecubixSalesQty = 0
  let erpSalesQty = 0
  let ecubixClosingQty = 0
  let erpClosingQty = 0
  let matchedEqualValue = 0
  // Two Ecubix rows for the same distributor+date+item resolve to the same
  // ERP item line — count that line's values only once, or the ERP-side
  // total gets multiplied by however many Ecubix rows share it.
  const erpCounted = new Set<string>()

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

    ecubixSalesValue += r.values.sales_value ?? 0
    ecubixClosingValue += r.values.closing_balance ?? 0
    ecubixSalesQty += r.values.sales_qty ?? 0
    ecubixClosingQty += r.values.closing_qty ?? 0
    const doc = r.resolved.distributor ? erpExisting.get(groupKey(r.resolved.distributor, r.resolved.date)) : undefined
    const line = doc && r.resolved.item
      ? doc.items.find((i) => normalizeItemName(i.item) === normalizeItemName(r.resolved.item!))
      : undefined
    if (line) {
      if (r.diff.length === 0) matchedEqualValue += r.values.sales_value ?? 0
      const erpKey = `${r.resolved.distributor}|${r.resolved.date}|${r.resolved.item}`
      if (!erpCounted.has(erpKey)) {
        erpCounted.add(erpKey)
        erpSalesValue += line.sales_value ?? 0
        erpClosingValue += line.closing_balance ?? 0
        erpSalesQty += line.sales_qty ?? 0
        erpClosingQty += line.closing_qty ?? 0
      }
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
    ecubixSalesValue,
    erpSalesValue,
    ecubixClosingValue,
    erpClosingValue,
    ecubixSalesQty,
    erpSalesQty,
    ecubixClosingQty,
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
    ecubixSalesValue: 0,
    erpSalesValue: 0,
    ecubixClosingValue: 0,
    erpClosingValue: 0,
    ecubixSalesQty: 0,
    erpSalesQty: 0,
    ecubixClosingQty: 0,
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
    out.ecubixSalesValue += r.ecubixSalesValue
    out.erpSalesValue += r.erpSalesValue
    out.ecubixClosingValue += r.ecubixClosingValue
    out.erpClosingValue += r.erpClosingValue
    out.ecubixSalesQty += r.ecubixSalesQty
    out.erpSalesQty += r.erpSalesQty
    out.ecubixClosingQty += r.ecubixClosingQty
    out.erpClosingQty += r.erpClosingQty
    out.matchedEqualValue += r.matchedEqualValue
  }
  return out
}

/** Fetches raw ecubix rows for one leaf and builds them into MigrationRows — the Firestore-only half of a leaf's work. */
async function loadLeafRows(leaf: ReconciliationLeafKey, headerMap: HeaderMapEntry[]): Promise<MigrationRow[]> {
  const monthYyyyMm = `${leaf.month.slice(0, 4)}-${leaf.month.slice(4, 6)}`
  const raw = await getHqRawRows(leaf.month, leaf.department, leaf.hq)
  return raw.map((r, i) => buildRowFromEcubixDoc(r, i + 1, headerMap, monthYyyyMm)).filter((r): r is MigrationRow => r !== null)
}

/** Validates one leaf's already-fetched rows against the shared ERP snapshot/bundle. */
function validateLeafRows(
  leaf: ReconciliationLeafKey,
  rows: MigrationRow[],
  masterMapCtx: Map<string, Map<string, string>>,
  regexMap: RegexMapEntry[],
  snapshot: { items: Map<string, string>; customers: Map<string, string>; existing: Map<string, ErpSecondaryDoc>; customerProfiles: Map<string, CustomerProfile[]> },
): LeafReconciliation {
  const erpHq = leaf.hq.replace(/^HQ-/i, '')
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

const MAX_CONCURRENT_LEAVES = 6

export interface ReconciliationBatchResult {
  results: Map<string, LeafReconciliation>
  /** Leaves whose fetch/validate threw — kept separate so one bad HQ doesn't discard the rest of the batch. */
  failed: { leaf: ReconciliationLeafKey; error: unknown }[]
}

/**
 * Runs the full Ecubix-vs-ERP check for a set of (month, department, hq)
 * leaves in three phases:
 *  1. Fetch + build every leaf's raw ecubix rows from Firestore, a few at a
 *     time (independent per leaf — this part doesn't change with scope size).
 *  2. Union every leaf's raw EBS codes and fetch the ENTIRE ERP side in ONE
 *     call for the whole batch — Item/Customer catalog, EBS-code→distributor
 *     resolution, existing docs, and role profiles, all computed server-side
 *     by the `migration_secondary` Server Script (see
 *     `fetchReconciliationSnapshot` in erpActions.ts). This is what collapses
 *     what used to be a catalog fetch plus per-HQ ERP round-trips down to a
 *     single HTTP call regardless of how many HQs are in scope.
 *  3. Validate each leaf's rows against that shared snapshot (pure CPU, no
 *     further network calls).
 * Falls back to the older two-call REST path (fetchStaticErpIndex + a
 * per-leaf fetchErpSnapshot) if step 2 fails — e.g. the
 * `migration_secondary` script hasn't been deployed yet.
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
  const confirmedDistributors = Object.fromEntries(masterMapCtx.get('distributor') ?? [])
  const ebsCodeErpFields = headerMap.find((h) => h.field === 'ebsCode')?.erpFields ?? []

  // Phase 1 — Firestore reads, a few leaves at a time.
  const rowsByLeaf = new Map<string, MigrationRow[]>()
  const queue = [...leaves]
  async function rowWorker() {
    let leaf: ReconciliationLeafKey | undefined
    while ((leaf = queue.shift())) {
      try {
        rowsByLeaf.set(reconciliationKey(leaf), await loadLeafRows(leaf, headerMap))
      } catch (error) {
        failed.push({ leaf, error })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_LEAVES, leaves.length) }, rowWorker))

  const okLeaves = leaves.filter((l) => rowsByLeaf.has(reconciliationKey(l)))
  if (okLeaves.length === 0) return { results, failed }

  // Phase 2 — one ERP call for the whole batch. All leaves passed in from
  // EcubixBrowser share one selected month, so a single snapshot call (keyed
  // on the first leaf's month) covers every leaf.
  const monthYyyyMm = `${okLeaves[0].month.slice(0, 4)}-${okLeaves[0].month.slice(4, 6)}`
  const allEbsCodes = [
    ...new Set(okLeaves.flatMap((l) => rowsByLeaf.get(reconciliationKey(l))!.map((r) => r.ebsCode)).filter(Boolean)),
  ]
  let snapshot: ReconciliationSnapshot | null = null
  try {
    snapshot = await fetchReconciliationSnapshot(erp, allEbsCodes, ebsCodeErpFields, confirmedDistributors, monthYyyyMm)
  } catch {
    snapshot = null // Server Script not deployed/reachable — fall back to the older per-leaf REST path below
  }

  // Phase 3 — validate. If the snapshot came through, this is pure CPU (no
  // more network calls at all). Otherwise fall back to the old two-call path.
  if (snapshot) {
    for (const leaf of okLeaves) {
      try {
        results.set(reconciliationKey(leaf), validateLeafRows(leaf, rowsByLeaf.get(reconciliationKey(leaf))!, masterMapCtx, regexMap, snapshot))
      } catch (error) {
        failed.push({ leaf, error })
      }
    }
    return { results, failed }
  }

  const staticIndex = await fetchStaticErpIndex(erp, ebsCodeErpFields)
  const fallbackQueue = [...okLeaves]
  async function fallbackWorker() {
    let leaf: ReconciliationLeafKey | undefined
    while ((leaf = fallbackQueue.shift())) {
      try {
        const rows = rowsByLeaf.get(reconciliationKey(leaf))!
        const ebsCodes = [...new Set(rows.map((r) => r.ebsCode).filter(Boolean))]
        const leafMonthYyyyMm = `${leaf.month.slice(0, 4)}-${leaf.month.slice(4, 6)}`
        const snapshot = await fetchErpSnapshot(erp, ebsCodes, ebsCodeErpFields, confirmedDistributors, leafMonthYyyyMm, staticIndex)
        results.set(reconciliationKey(leaf), validateLeafRows(leaf, rows, masterMapCtx, regexMap, snapshot))
      } catch (error) {
        failed.push({ leaf, error })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_LEAVES, okLeaves.length) }, fallbackWorker))
  return { results, failed }
}
