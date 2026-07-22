import type { ErpSecondaryItem, MigrationRow } from '../types'
import { groupKey } from './validateRow'

export interface PushGroup {
  key: string // `${distributor}|${date}`
  distributor: string
  date: string
  erpDocName: string | null
  rows: MigrationRow[]
}

/**
 * Group pushable rows into one ERP payload per (distributor, date).
 * Pushable: new, or matched/conflict resolved as use-sheet with a non-empty diff.
 */
export function buildPushGroups(rows: MigrationRow[]): PushGroup[] {
  const groups = new Map<string, PushGroup>()
  for (const row of rows) {
    const pushable =
      row.state === 'new' ||
      (row.state === 'matched' && row.diff.length > 0) ||
      (row.state === 'conflict' && row.resolution === 'use-sheet')
    if (!pushable) continue
    if (!row.resolved.distributor || !row.resolved.item) continue

    const key = groupKey(row.resolved.distributor, row.resolved.date)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        distributor: row.resolved.distributor,
        date: row.resolved.date,
        erpDocName: row.erpDocName,
        rows: [],
      }
      groups.set(key, group)
    }
    group.rows.push(row)
    if (row.erpDocName) group.erpDocName = row.erpDocName
  }
  return [...groups.values()]
}

/** Sheet-owns-doc policy: the payload's items are exactly the sheet's rows for that group. */
export function buildDocPayload(group: PushGroup): {
  distributor: string
  date: string
  items: ErpSecondaryItem[]
} {
  return {
    distributor: group.distributor,
    date: group.date,
    items: group.rows.map((r) => ({
      item: r.resolved.item!,
      primary_sales: r.values.primary_sales,
      rate: r.values.rate,
      sales_qty: r.values.sales_qty,
      sales_value: r.values.sales_value,
      closing_qty: r.values.closing_qty,
      closing_balance: r.values.closing_balance,
      // ST-HQ auto mapping (same fields ERP's AutoMapping sets)
      custom_role_profile: r.resolved.roleProfile,
      custom_department: r.resolved.department,
      custom_hq: r.resolved.erpHq,
    })),
  }
}
