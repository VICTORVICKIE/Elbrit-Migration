// Turns an ecubix HQ collection into the Batch/MigrationRow shape the
// existing check-and-fix page (SecondaryPage) expects — rows come straight
// from Firestore.

import { buildMasterMap, useAppStore } from '../../data/appStore'
import { slugify } from '../../data/slug'
import { validateRow } from '../../engine/validateRow'
import { getHqRawRows } from '../../lib/ecubix/reads'
import { buildMigrationRowFromRaw, isSubtotalRow } from './ecubixRow'
import type { Batch, HeaderMapEntry, MigrationRow } from '../../types'
import { erpClientFrom, fetchErpSnapshot } from './erpActions'

export function ecubixBatchId(month: string, department: string, hqCollection: string): string {
  return ['batch', 'ecubix', slugify(department), slugify(hqCollection), month].join('-')
}

function coerce(value: string | number | null, type: HeaderMapEntry['type']): string | number | null {
  if (value === null || value === undefined || value === '') return null
  switch (type) {
    case 'int': {
      const n = typeof value === 'number' ? value : parseInt(String(value).replace(/,/g, ''), 10)
      return Number.isNaN(n) ? null : n
    }
    case 'currency': {
      const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''))
      return Number.isNaN(n) ? null : Math.round(n * 100) / 100
    }
    case 'date':
      return value === null ? null : String(value)
    default:
      return String(value).trim()
  }
}

/** One ecubix Firestore row (keyed by Ecubix header, e.g. "Stockist Code") -> MigrationRow, using the header map already configured in Settings for Ecubix exports. Returns null for subtotal/footer rows. */
export function buildRowFromEcubixDoc(
  ecubixRow: Record<string, string | number | null>,
  rowIndex: number,
  headerMap: HeaderMapEntry[],
  monthYyyyMm: string,
): MigrationRow | null {
  const mapped = headerMap.filter((h) => h.ecubixHeader.trim())
  const raw: Record<string, string | number | null> = {}
  for (const entry of mapped) {
    raw[entry.field] = coerce(ecubixRow[entry.ecubixHeader] ?? null, entry.type)
  }
  if (isSubtotalRow(raw)) return null
  const hq = String(ecubixRow['HQ'] ?? '').trim()
  const date = typeof ecubixRow['dateISO'] === 'string' ? ecubixRow['dateISO'] : `${monthYyyyMm}-01`
  return buildMigrationRowFromRaw(raw, rowIndex, { hq, date })
}

/**
 * Open the batch for one ecubix HQ collection, creating it (and converting
 * its raw rows) on first open; later opens just reopen the same batch id —
 * no reconversion. Returns the batch id to navigate to.
 */
export async function openOrCreateEcubixBatch(month: string, department: string, hqCollection: string): Promise<string> {
  const id = ecubixBatchId(month, department, hqCollection)
  const state = useAppStore.getState()
  const existing = state.batches.find((b) => b.id === id)
  if (existing) {
    await state.openBatch(id)
    return id
  }

  const monthYyyyMm = `${month.slice(0, 4)}-${month.slice(4, 6)}`
  // Firestore collection is named "HQ-<Territory>"; the ERP-facing HQ/Territory value drops that prefix.
  const erpHq = hqCollection.replace(/^HQ-/i, '')

  const ecubixRows = await getHqRawRows(month, department, hqCollection)
  let rows = ecubixRows
    .map((r, i) => buildRowFromEcubixDoc(r, i + 1, state.secondaryConfig.headerMap, monthYyyyMm))
    .filter((r): r is MigrationRow => r !== null)

  const erp = erpClientFrom(state.credentials)
  if (erp) {
    const masterMapCtx = buildMasterMap(state.masterMap)
    const confirmedDistributors = Object.fromEntries(masterMapCtx.get('distributor') ?? [])
    const ebsCodeErpFields = state.secondaryConfig.headerMap.find((h) => h.field === 'ebsCode')?.erpFields ?? []
    const ebsCodes = [...new Set(rows.map((r) => r.ebsCode).filter((c): c is string => Boolean(c)))]
    const snapshot = await fetchErpSnapshot(erp, ebsCodes, ebsCodeErpFields, confirmedDistributors, monthYyyyMm)
    state.setErpSnapshot(snapshot.items, snapshot.customers, snapshot.existing, snapshot.customerProfiles)
    const ctx = {
      masterMap: masterMapCtx,
      regexMap: state.regexMap,
      erpItemsIndex: snapshot.items,
      erpCustomersIndex: snapshot.customers,
      erpExisting: snapshot.existing,
      customerProfiles: snapshot.customerProfiles,
      batchHq: erpHq,
      batchDepartment: department,
      hasErpSnapshot: true,
      erpLinePool: new Map(),
    }
    rows = rows.map((r) => validateRow(r, ctx))
  }

  const batch: Batch = {
    id,
    datatype: 'secondary',
    sourceId: `ecubix:${month}:${department}:${hqCollection}`,
    label: `${hqCollection} — ${department}`,
    sourceUpdatedAt: new Date().toISOString(),
    department,
    hq: erpHq,
    month: monthYyyyMm,
    status: 'checking',
    counts: { total: 0, new: 0, matched: 0, error: 0, conflict: 0, synced: 0, skipped: 0 },
    createdBy: state.uid,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
  }
  await state.saveBatch(batch)
  await state.putRows(id, rows, true)
  await state.openBatch(id)
  return id
}
