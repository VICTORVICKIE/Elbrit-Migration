import type {
  CustomerProfile,
  ErpSecondaryDoc,
  FieldDiff,
  MigrationRow,
  RegexMapEntry,
  RowIssue,
  RowState,
} from '../types'
import { VALUE_FIELDS } from '../types'
import { normalizeItemName } from './resolveItem'

function norm(s: string): string {
  return s.trim().toLowerCase()
}

/** Regex from user input can be malformed — never let a bad pattern break validation. */
function execPattern(pattern: string, value: string): RegExpMatchArray | null {
  try {
    return value.match(new RegExp(pattern, 'i'))
  } catch {
    return null
  }
}

/** Substitutes `$1`.."$99", `$&` (whole match) and `$<name>` (named group) in `template` — same syntax as `String.replace`'s replacement patterns. */
function substituteCaptures(template: string, match: RegExpMatchArray): string {
  return template.replace(/\$(\$|&|<[^>]+>|\d{1,2})/g, (_full, spec: string) => {
    if (spec === '$') return '$'
    if (spec === '&') return match[0]
    if (spec.startsWith('<')) return match.groups?.[spec.slice(1, -1)] ?? ''
    return match[Number(spec)] ?? ''
  })
}

/**
 * First enabled rule whose pattern matches `itemName`, in list order — see
 * Mappings → Regex. `value` supports capture-group substitution, e.g.
 * pattern `^BRUFEN-(\d+)MG$` with value `ITEM-BRUFEN-$1`.
 */
export function resolveRegexOverride(itemName: string, regexMap: RegexMapEntry[]): string | null {
  for (const r of regexMap) {
    if (!r.enabled || !r.pattern) continue
    const match = execPattern(r.pattern, itemName)
    if (match) return substituteCaptures(r.value, match)
  }
  return null
}

export interface ValidationContext {
  /** Confirmed sheet-value → ERP-value mappings, by field (`distributor`, `item`, or any custom master field). See MasterMapEntry. */
  masterMap: Map<string, Map<string, string>>
  erpItemsIndex: Map<string, string> // normalized item name → ERP Item — fast path, no confirmation needed
  /** Normalized EBS code → ERP Customer docname — exact-match fast path, same idea as erpItemsIndex. */
  erpCustomersIndex: Map<string, string>
  erpExisting: Map<string, ErpSecondaryDoc> // key: `${distributor}|${date}`
  /** Product/Item master-data regex overrides — see Mappings → Regex. Optional so existing callers/tests don't need updating. */
  regexMap?: RegexMapEntry[]
  /**
   * ST-HQ AutoMapping source (ERP: Customer.custom_role_profile → Role
   * Profile.custom_department/custom_territory). Key: ERP Customer docname.
   */
  customerProfiles: Map<string, CustomerProfile[]>
  /**
   * Fallback HQ for the ST-HQ AutoMapping step (2b) when a row's own sheet HQ
   * column is blank — the batch's tagged HQ (chosen when the file was opened
   * in SheetPicker), since every row in a batch shares it. Optional so
   * existing callers/tests don't need updating.
   */
  batchHq?: string
  /**
   * Fallback department for the ST-HQ AutoMapping step (2b) — the batch's
   * tagged department (chosen alongside HQ in SheetPicker). Several role
   * profiles on the same distributor can share one Territory but differ by
   * department, so HQ alone doesn't always disambiguate.
   */
  batchDepartment?: string
  /**
   * False when no ERP snapshot has been fetched (demo mode / ERP not yet
   * configured). Then item existence can't be verified and ERP-relative
   * states (matched/conflict/synced) must be preserved, not recomputed.
   */
  hasErpSnapshot: boolean
}

export const CURRENCY_TOLERANCE = 0.01

export function groupKey(distributor: string, date: string): string {
  return `${distributor}|${date}`
}

function numbersEqual(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return Math.abs(a - b) <= CURRENCY_TOLERANCE
}

/** Field-level diff between a sheet row's values and the matching ERP item line. */
export function diffRow(row: MigrationRow, erpDoc: ErpSecondaryDoc): FieldDiff[] {
  const erpLine = row.resolved.item
    ? erpDoc.items.find((i) => normalizeItemName(i.item) === normalizeItemName(row.resolved.item!))
    : undefined
  if (!erpLine) {
    // Doc exists but this item line doesn't → everything sheet-side is "new in doc"
    return [{ field: 'item', sheet: row.resolved.item, erp: null }]
  }
  const diffs: FieldDiff[] = []
  for (const f of VALUE_FIELDS) {
    if (!numbersEqual(row.values[f], erpLine[f])) {
      diffs.push({ field: f, sheet: row.values[f], erp: erpLine[f] })
    }
  }
  return diffs
}

/**
 * Full validation of one row. Pure: same inputs → same outputs.
 * Re-run whenever mappings/rules change; caller persists only changed rows.
 */
export function validateRow(row: MigrationRow, ctx: ValidationContext): MigrationRow {
  // Skipped rows and user-resolved conflicts keep their state unless data changed.
  if (row.state === 'skipped') return row

  const issues: RowIssue[] = []

  // 1. customer via EBS code — a confirmed mapping (see MasterMapEntry field
  // 'distributor') takes precedence, then an exact match against ERP
  // Customer's configured field(s) (erpCustomersIndex, same fast path as
  // items); EBS codes don't resemble ERP customer names, so there's no fuzzy
  // fallback — only exact or confirmed.
  const distributor = row.ebsCode
    ? (ctx.masterMap.get('distributor')?.get(norm(row.ebsCode)) ??
      ctx.erpCustomersIndex.get(normalizeItemName(row.ebsCode)) ??
      null)
    : null
  if (!row.ebsCode) {
    issues.push({
      code: 'FIELD_MISSING',
      field: 'ebsCode',
      message: 'EBS code missing in sheet row',
      severity: 'error',
    })
  } else if (!distributor) {
    issues.push({
      code: 'CUSTOMER_UNMAPPED',
      field: 'ebsCode',
      message: `EBS code ${row.ebsCode} has no ERP customer mapping`,
      severity: 'error',
    })
  }

  // 2. item — a regex override (Mappings → Regex) takes precedence, since an
  // admin-configured pattern is a stronger signal than automatic matching;
  // then exact match against the ERP item index (fast path, no confirmation
  // needed); then a confirmed mapping override (see MasterMapEntry field
  // 'item') for sheet names that don't match verbatim.
  const normItem = normalizeItemName(row.itemName)
  let erpItem =
    resolveRegexOverride(row.itemName, ctx.regexMap ?? []) ??
    ctx.masterMap.get('item')?.get(normItem) ??
    ctx.erpItemsIndex.get(normItem) ??
    null
  if (!ctx.hasErpSnapshot) {
    // Can't verify against ERP: trust a prior resolution.
    erpItem = row.resolved.item ?? erpItem
  }
  if (!row.itemName) {
    issues.push({
      code: 'FIELD_MISSING',
      field: 'itemName',
      message: 'Item name missing in sheet row',
      severity: 'error',
    })
  } else if (ctx.hasErpSnapshot && !erpItem) {
    issues.push({
      code: 'ITEM_UNMAPPED',
      field: 'itemName',
      message: `"${row.itemName}" does not match any ERP item`,
      severity: 'error',
    })
  }

  // 2b. ST-HQ auto mapping (port of ERP AutoMapping): pick the distributor's
  // role profile whose Territory + Department match the batch's tags (chosen
  // when the file was opened in SheetPicker — sheets don't carry per-row HQ
  // or department columns). Several role profiles on one distributor can
  // share a Territory but differ by department, so both are needed to land
  // on exactly one match → mapped; none → HQ_UNMAPPED; still ambiguous → MULTI_DEPT.
  let roleProfile: string | null = row.resolved.roleProfile
  let department: string | null = row.resolved.department
  let erpHq: string | null = row.resolved.erpHq
  if (distributor && ctx.hasErpSnapshot) {
    const profiles = ctx.customerProfiles.get(distributor) ?? []
    const wantedHq = (ctx.batchHq || '').trim().toLowerCase()
    const wantedDept = (ctx.batchDepartment || '').trim().toLowerCase()
    const byHq = wantedHq ? profiles.filter((p) => p.hq.trim().toLowerCase() === wantedHq) : profiles
    const matches =
      wantedDept && byHq.length > 1 ? byHq.filter((p) => p.department.trim().toLowerCase() === wantedDept) : byHq
    if (matches.length === 1) {
      roleProfile = matches[0].roleProfile
      department = matches[0].department
      erpHq = matches[0].hq
    } else if (matches.length === 0) {
      roleProfile = department = erpHq = null
      issues.push({
        code: 'HQ_UNMAPPED',
        field: 'hq',
        message: profiles.length
          ? `Batch HQ "${ctx.batchHq ?? ''}" / department "${ctx.batchDepartment ?? ''}" doesn't match any role profile of ${distributor} (has: ${profiles.map((p) => `${p.department} / ${p.hq}`).join(', ')})`
          : `${distributor} has no role-profile mapping in ERP (Customer → Role Profile)`,
        severity: 'error',
      })
    } else {
      roleProfile = department = erpHq = null
      issues.push({
        code: 'MULTI_DEPT',
        field: 'hq',
        message: `Multiple mappings for HQ "${ctx.batchHq ?? ''}": ${matches.map((m) => m.department).join(', ')}`,
        severity: 'error',
      })
    }
  }

  // 3. field sanity
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.resolved.date)) {
    issues.push({
      code: 'DATE_INVALID',
      field: 'date',
      message: `Invalid date "${row.resolved.date}"`,
      severity: 'error',
    })
  }
  for (const f of VALUE_FIELDS) {
    const v = row.values[f]
    if (v !== null && v < 0) {
      issues.push({
        code: 'NEGATIVE_VALUE',
        field: f,
        message: `${f} is negative (${v})`,
        severity: 'warning',
      })
    }
  }

  const resolved = {
    ...row.resolved,
    distributor,
    item: erpItem,
    roleProfile,
    department,
    erpHq,
  }

  const hasErrors = issues.some((i) => i.severity === 'error')
  let state: RowState
  let diff: FieldDiff[] = row.diff
  let erpDocName = row.erpDocName

  if (hasErrors) {
    state = 'error'
  } else if (!ctx.hasErpSnapshot) {
    // No ERP snapshot: keep ERP-relative states; recovered error rows become new.
    state = row.state === 'error' ? 'new' : row.state
  } else {
    diff = []
    const existing = ctx.erpExisting.get(groupKey(distributor!, row.resolved.date))
    if (!existing) {
      state = 'new'
      erpDocName = null
    } else {
      erpDocName = existing.name
      diff = diffRow({ ...row, resolved }, existing)
      if (diff.length === 0) {
        // Already in ERP and identical → nothing to push
        state = row.state === 'synced' ? 'synced' : 'matched'
      } else if (row.resolution === 'use-sheet' || row.resolution === 'keep-erp') {
        // user already resolved this conflict; keep matched so push logic honors resolution
        state = 'matched'
      } else {
        state = 'conflict'
      }
    }
  }

  return { ...row, resolved, state, issues, diff, erpDocName }
}

/** Recompute batch counts from rows. */
export function countRows(rows: MigrationRow[]) {
  const counts = { total: rows.length, new: 0, matched: 0, error: 0, conflict: 0, synced: 0, skipped: 0 }
  for (const r of rows) counts[r.state]++
  return counts
}
