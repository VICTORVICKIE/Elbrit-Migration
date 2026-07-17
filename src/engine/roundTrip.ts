import type { ErpSecondaryDoc, FieldDiff, MigrationRow } from '../types'
import { diffRow } from './validateRow'

export interface RoundTripResult {
  rowId: string
  ok: boolean
  mismatches: FieldDiff[]
}

/**
 * Step 4 — compare freshly fetched ERP docs against sheet rows.
 * Returns one result per row that participated in a push group.
 */
export function roundTripCompare(
  rows: MigrationRow[],
  fetched: Map<string, ErpSecondaryDoc>, // key: doc name
): RoundTripResult[] {
  return rows
    .filter((r) => r.erpDocName)
    .map((row) => {
      const doc = fetched.get(row.erpDocName!)
      if (!doc) {
        return {
          rowId: row.id,
          ok: false,
          mismatches: [{ field: 'document', sheet: row.erpDocName, erp: null }],
        }
      }
      const mismatches = diffRow(row, doc)
      return { rowId: row.id, ok: mismatches.length === 0, mismatches }
    })
}
