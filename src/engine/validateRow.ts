import type {
  CustomerProfile,
  ErpSecondaryDoc,
  ErpSecondaryItem,
  FieldDiff,
  MigrationRow,
  RegexMapEntry,
  RowIssue,
  RowState,
  ValueField,
} from '../types'
import { VALUE_FIELDS } from '../types'
import { normalizeItemName } from './resolveItem'

function norm(s: string): string {
  return s.trim().toLowerCase()
}

function normHq(hq: string | null | undefined): string {
  return norm(hq || '').replace(/^hq-/, '')
}

/**
 * A distributor's document can carry item lines for more than one
 * department/HQ (beat) — e.g. two sales reps on different role profiles
 * both selling to the same distributor on the same date. A batch is scoped
 * to one department+HQ, so lines belonging to a different one must never be
 * pulled into this batch's comparison, even if the item name matches.
 */
export interface ErpLineScope {
  department?: string | null
  hq?: string | null
}

// Excludes a line only when it has an explicit, differing department/HQ tag
// — an untagged line (no custom_department/custom_hq at all, e.g. older
// docs or test fixtures) is treated as scope-agnostic rather than assumed
// to belong to a different beat.
function matchesScope(item: ErpSecondaryItem, scope?: ErpLineScope): boolean {
  if (scope?.department && item.custom_department && norm(item.custom_department) !== norm(scope.department)) return false
  if (scope?.hq && item.custom_hq && normHq(item.custom_hq) !== normHq(scope.hq)) return false
  return true
}

/**
 * ERP itself sometimes carries more than one item line for the same item on
 * one doc (e.g. two "CARTITAB C2" lines, each a separate real transaction).
 * For AGGREGATE totals (a whole item's expected quantity/value for this
 * distributor+date), sum every matching line — pass no `ecubixValues`.
 * For PER-ROW comparison (does *this* Ecubix row's own line exist in ERP),
 * pass `ecubixValues`: if one of the matching lines is an exact value match
 * for this specific row, pair with it instead of the pooled sum, so two
 * Ecubix rows that each cleanly correspond to their own ERP line don't both
 * get falsely diffed against the other's combined total. Only falls back to
 * the summed line when no exact per-row pairing exists (a genuine mismatch).
 * `scope` restricts matches to lines tagged for this batch's own
 * department/HQ — see ErpLineScope.
 */
export function findErpLine(
  doc: ErpSecondaryDoc,
  itemName: string,
  scope?: ErpLineScope,
  ecubixValues?: Partial<Record<(typeof VALUE_FIELDS)[number], number | null>>,
): ErpSecondaryItem | undefined {
  const target = normalizeItemName(itemName)
  const matches = doc.items.filter((i) => normalizeItemName(i.item) === target && matchesScope(i, scope))
  if (matches.length <= 1) return matches[0]
  if (ecubixValues) {
    const exact = matches.find((m) => VALUE_FIELDS.every((f) => numbersEqual(ecubixValues[f] ?? null, m[f])))
    if (exact) return exact
  }
  const merged: ErpSecondaryItem = { ...matches[0] }
  for (const f of VALUE_FIELDS) {
    const vals = matches.map((m) => m[f]).filter((v): v is number => typeof v === 'number')
    merged[f] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null
  }
  return merged
}

/**
 * Per-row ERP-line pairing for diffRow: when an item has multiple ERP lines
 * and multiple Ecubix rows this validation pass, each row should claim its
 * own distinct line instead of every row comparing against the same pooled
 * total — otherwise two Ecubix rows that individually reconcile perfectly
 * (e.g. 60↔60, 15↔15) would both show as false conflicts against a merged
 * 75. `pool` is shared and mutated across the whole pass (see
 * ValidationContext.erpLinePool); a row that finds no unclaimed line left
 * (more Ecubix rows for this item than ERP has lines) gets `undefined` —
 * a genuine, real mismatch, not a bug.
 */
function resolveErpLine(
  doc: ErpSecondaryDoc,
  itemName: string,
  scope: ErpLineScope,
  ecubixValues: Partial<Record<ValueField, number | null>>,
  pool: Map<string, ErpSecondaryItem[]>,
): ErpSecondaryItem | undefined {
  const target = normalizeItemName(itemName)
  const poolKey = `${doc.name}::${target}::${norm(scope.department || '')}::${normHq(scope.hq)}`
  if (!pool.has(poolKey)) {
    pool.set(poolKey, doc.items.filter((i) => normalizeItemName(i.item) === target && matchesScope(i, scope)))
  }
  const available = pool.get(poolKey)!
  if (available.length === 0) return undefined
  if (available.length === 1) return available.splice(0, 1)[0]

  let idx = available.findIndex((m) => VALUE_FIELDS.every((f) => numbersEqual(ecubixValues[f] ?? null, m[f])))
  if (idx === -1) {
    // No exact pairing — claim whichever remaining line is numerically
    // closest, so a genuine partial mismatch still compares against the
    // most plausible counterpart rather than an arbitrary one.
    idx = 0
    let bestDist = Infinity
    available.forEach((m, i) => {
      const dist = VALUE_FIELDS.reduce((acc, f) => acc + Math.abs((ecubixValues[f] ?? 0) - (m[f] ?? 0)), 0)
      if (dist < bestDist) {
        bestDist = dist
        idx = i
      }
    })
  }
  return available.splice(idx, 1)[0]
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
  /** Confirmed Ecubix-value → ERP-value mappings, by field (`distributor`, `item`, or any custom master field). See MasterMapEntry. */
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
   * Fallback HQ for the ST-HQ AutoMapping step (2b) when a row's own Ecubix HQ
   * column is blank — the batch's tagged HQ (chosen when the ecubix batch was
   * created), since every row in a batch shares it. Optional so existing
   * callers/tests don't need updating.
   */
  batchHq?: string
  /**
   * Fallback department for the ST-HQ AutoMapping step (2b) — the batch's
   * tagged department (chosen alongside HQ when the batch was created). Several role
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
  /**
   * Shared, mutable across one whole validation pass (one `rows.map(r =>
   * validateRow(r, ctx))` call) — tracks which specific ERP item lines have
   * already been paired to an Ecubix row this pass, so when an item has
   * multiple lines (e.g. two "CARTITAB C2" transactions) and multiple Ecubix
   * rows for it, each row pairs to its own distinct line instead of every
   * row comparing against the same (or a pooled) value. Optional so
   * existing callers/tests that validate a single row in isolation don't
   * need updating — diffRow falls back to a fresh, unshared pool per call.
   */
  erpLinePool?: Map<string, ErpSecondaryItem[]>
}

export const CURRENCY_TOLERANCE = 0.01

export function groupKey(distributor: string, date: string): string {
  return `${distributor}|${date}`
}

/**
 * ERP sometimes has more than one "Secondary Data Entry" doc for the same
 * distributor+date (a duplicate-entry data issue on the ERP side) — building
 * the existing-docs map by groupKey alone would silently keep only the last
 * one seen and drop the other doc's item lines entirely. Concatenate items
 * from every doc sharing a key instead, so findErpLine's item-name merge
 * still sees every line, no matter which doc it came from.
 */
export function addExistingDoc(existing: Map<string, ErpSecondaryDoc>, doc: ErpSecondaryDoc): void {
  const key = groupKey(doc.distributor, doc.date)
  const prev = existing.get(key)
  existing.set(key, prev ? { ...prev, items: [...prev.items, ...doc.items] } : doc)
}

function numbersEqual(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return Math.abs(a - b) <= CURRENCY_TOLERANCE
}

export interface RowDiffResult {
  diffs: FieldDiff[]
  /** The paired ERP line's own field values — null when no line was found at all (see MigrationRow.erpValues). */
  erpValues: Partial<Record<ValueField, number | null>> | null
}

/**
 * Field-level diff between an Ecubix row's values and its paired ERP item
 * line. `pool` (see ValidationContext.erpLinePool) should be shared across
 * one whole validation pass so items with multiple lines pair each Ecubix
 * row to its own distinct line instead of every row comparing against the
 * same one; omit it only for an isolated single-row call. Returns the
 * paired line's own values alongside the diff so callers never have to
 * infer a matched field's ERP value by assuming it equals the Ecubix one.
 */
export function diffRow(
  row: MigrationRow,
  erpDoc: ErpSecondaryDoc,
  pool: Map<string, ErpSecondaryItem[]> = new Map(),
): RowDiffResult {
  const scope: ErpLineScope = { department: row.resolved.department, hq: row.resolved.erpHq }
  const erpLine = row.resolved.item ? resolveErpLine(erpDoc, row.resolved.item, scope, row.values, pool) : undefined
  if (!erpLine) {
    // Doc exists but this item line doesn't → everything Ecubix-side is "new in doc"
    return { diffs: [{ field: 'item', ecubix: row.resolved.item, erp: null }], erpValues: null }
  }
  const diffs: FieldDiff[] = []
  const erpValues: Partial<Record<ValueField, number | null>> = {}
  for (const f of VALUE_FIELDS) {
    erpValues[f] = erpLine[f]
    if (!numbersEqual(row.values[f], erpLine[f])) {
      diffs.push({ field: f, ecubix: row.values[f], erp: erpLine[f] })
    }
  }
  return { diffs, erpValues }
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
      message: 'EBS code missing in Ecubix row',
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
  // 'item') for Ecubix names that don't match verbatim.
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
      message: 'Item name missing in Ecubix row',
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
  // when the batch was created — Ecubix rows don't carry per-row HQ or
  // department columns). Several role profiles on one distributor can
  // share a Territory but differ by department, so both are needed to land
  // on exactly one match → mapped; none → HQ_UNMAPPED; still ambiguous → MULTI_DEPT.
  let roleProfile: string | null = row.resolved.roleProfile
  let department: string | null = row.resolved.department
  let erpHq: string | null = row.resolved.erpHq
  if (distributor && ctx.hasErpSnapshot) {
    const profiles = ctx.customerProfiles.get(distributor) ?? []
    const wantedHq = (ctx.batchHq || '').trim().toLowerCase()
    const wantedDept = (ctx.batchDepartment || '').trim().toLowerCase()
    const byHq = wantedHq
      ? profiles.filter((p) => p.hq.trim().toLowerCase().replace(/^hq-/, '') === wantedHq)
      : profiles
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
  let erpValues = row.erpValues
  let erpDocName = row.erpDocName

  if (hasErrors) {
    state = 'error'
  } else if (!ctx.hasErpSnapshot) {
    // No ERP snapshot: keep ERP-relative states; recovered error rows become new.
    state = row.state === 'error' ? 'new' : row.state
  } else {
    diff = []
    erpValues = null
    const key = groupKey(distributor!, row.resolved.date)
    const existing = ctx.erpExisting.get(key)
    if (!existing) {
      state = 'new'
      erpDocName = null
    } else {
      erpDocName = existing.name
      const result = diffRow({ ...row, resolved }, existing, ctx.erpLinePool)
      diff = result.diffs
      erpValues = result.erpValues
      if (diff.length === 0) {
        // Already in ERP and identical → nothing to push
        state = row.state === 'synced' ? 'synced' : 'matched'
      } else if (row.resolution === 'use-ecubix' || row.resolution === 'keep-erp') {
        // user already resolved this conflict; keep matched so push logic honors resolution
        state = 'matched'
      } else {
        state = 'conflict'
      }
    }
  }

  return { ...row, resolved, state, issues, diff, erpValues, erpDocName }
}

/** Recompute batch counts from rows. */
export function countRows(rows: MigrationRow[]) {
  const counts = { total: rows.length, new: 0, matched: 0, error: 0, conflict: 0, synced: 0, skipped: 0 }
  for (const r of rows) counts[r.state]++
  return counts
}
