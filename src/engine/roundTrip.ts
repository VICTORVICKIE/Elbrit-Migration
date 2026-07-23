import type { ErpSecondaryDoc, ErpSecondaryItem, FieldDiff, MigrationRow } from '../types'
import { diffRow } from './validateRow'

export interface RoundTripResult {
  rowId: string
  ok: boolean
  mismatches: FieldDiff[]
}

/**
 * Step 4 — compare freshly fetched ERP docs against Ecubix rows.
 * Returns one result per row that participated in a push group.
 */
export function roundTripCompare(
  rows: MigrationRow[],
  fetched: Map<string, ErpSecondaryDoc>, // key: doc name
): RoundTripResult[] {
  // Shared across every row in this pass so an item with multiple ERP lines
  // pairs each row to its own distinct line — same reasoning as
  // ValidationContext.erpLinePool.
  const pool = new Map<string, ErpSecondaryItem[]>()
  return rows
    .filter((r) => r.erpDocName)
    .map((row) => {
      const doc = fetched.get(row.erpDocName!)
      if (!doc) {
        return {
          rowId: row.id,
          ok: false,
          mismatches: [{ field: 'document', ecubix: row.erpDocName, erp: null }],
        }
      }
      const mismatches = diffRow(row, doc, pool)
      return { rowId: row.id, ok: mismatches.length === 0, mismatches }
    })
}
