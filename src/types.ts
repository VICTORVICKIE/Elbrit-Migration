// Core domain types shared by engine, data repos and UI.

export type Datatype = 'secondary' | 'visit' | 'service' | 'support'

export type RowState =
  | 'new' // will create in ERP
  | 'matched' // exists in ERP, Ecubix matches → update is a no-op
  | 'error' // validation error, blocked from push
  | 'conflict' // exists in ERP with differing values
  | 'synced' // pushed & verified
  | 'skipped' // user excluded

export type IssueSeverity = 'error' | 'warning'

export interface RowIssue {
  code:
    | 'CUSTOMER_UNMAPPED'
    | 'ITEM_UNMAPPED'
    | 'HQ_UNMAPPED'
    | 'MULTI_DEPT'
    | 'FIELD_MISSING'
    | 'FIELD_INVALID'
    | 'DATE_INVALID'
    | 'NEGATIVE_VALUE'
    | 'PUSH_FAILED'
    | 'POST_PUSH_MISMATCH'
  message: string
  field?: string
  severity: IssueSeverity
}

export interface FieldDiff {
  field: string
  ecubix: string | number | null
  erp: string | number | null
}

/** One Ecubix row (one distributor × item line) as stored per batch. */
export interface MigrationRow {
  id: string
  rowIndex: number // original Ecubix row number, user-facing
  raw: Record<string, string | number | null>
  ebsCode: string
  customerName: string // as written in Ecubix
  itemName: string // as written in Ecubix
  hq: string // Ecubix HQ column (e.g. "Kurnool")
  resolved: {
    distributor: string | null // ERP Customer name
    item: string | null // ERP Item
    date: string // yyyy-mm-dd
    // ST-HQ auto mapping (mirrors ERP AutoMapping: Customer → Role Profile)
    roleProfile: string | null
    department: string | null
    erpHq: string | null // Territory
  }
  values: {
    sales_qty: number | null
    sales_value: number | null
    closing_qty: number | null
    closing_balance: number | null
  }
  state: RowState
  issues: RowIssue[]
  diff: FieldDiff[]
  /**
   * The actual paired ERP line's own field values — populated whenever a
   * line was found (matched or conflicting), `null` when none was (item
   * missing from ERP / scoped out). `diff` only lists mismatches, so
   * display code needing a field's real ERP value even when it matches
   * must read this rather than falling back to the Ecubix value and
   * assuming equality — the two can differ within CURRENCY_TOLERANCE.
   */
  erpValues: Partial<Record<ValueField, number | null>> | null
  erpDocName: string | null
  resolution: 'use-ecubix' | 'keep-erp' | null
  push: { attempts: number; lastError: string | null; lastAt: string | null }
  validate: { ok: boolean | null; mismatches: FieldDiff[]; at: string | null }
}

export type BatchStatus =
  | 'parsing'
  | 'checking'
  | 'ready'
  | 'pushing'
  | 'validating'
  | 'done'
  | 'error'

export interface BatchCounts {
  total: number
  new: number
  matched: number
  error: number
  conflict: number
  synced: number
  skipped: number
}

export interface Batch {
  id: string
  datatype: Datatype
  sourceId: string
  label: string
  sourceUpdatedAt: string
  department: string // ERP Department
  hq: string
  month: string // yyyy-mm
  status: BatchStatus
  counts: BatchCounts
  createdBy: string
  createdAt: string
  lastRunAt: string | null
}

/**
 * Global Ecubix-value → ERP-value mapping, the single source of truth for
 * every "EBS/Ecubix → ERP" resolution: the built-in `distributor` (EBS code →
 * ERP Customer) and `item` (Ecubix item name → ERP Item) fields. Populated
 * automatically when a fuzzy match is confirmed (or overridden) in
 * Secondary, or added by hand in Mappings → Secondary mappings. Reused across
 * every batch — a confirmed mapping here short-circuits future matches for
 * that field + Ecubix value.
 */
export interface MasterMapEntry {
  id: string
  field: string
  /** Trimmed/lowercased — the lookup key against the Ecubix value for this field. */
  ecubixValue: string
  /** Original casing, for display. */
  displayEcubixValue: string
  erpValue: string
  source: 'fuzzy' | 'manual'
  /** Free-text note — why this mapping exists, e.g. "confirmed by ops, see EBS ticket #4021". */
  comment: string
  createdBy: string
  createdAt: string
}

/**
 * Regex-based override for Product/Item master data: when `pattern` matches
 * an Ecubix product name, resolve straight to `value` (an ERP Item docname),
 * bypassing exact/fuzzy matching entirely. Takes precedence over the normal
 * item-matching path — see Mappings → Regex. `value` supports capture-group
 * substitution (`$1`, `$&`, `$<name>`), same syntax as `String.replace`.
 */
export interface RegexMapEntry {
  id: string
  pattern: string
  value: string
  enabled: boolean
  createdBy: string
  createdAt: string
}

/** Fixed row identity for the Header → ERP field map — key into MigrationRow.raw / values. */
export type HeaderMapField =
  | 'customerName'
  | 'ebsCode'
  | 'itemName'
  | 'sales_qty'
  | 'sales_value'
  | 'closing_qty'
  | 'closing_balance'

export interface HeaderMapEntry {
  field: HeaderMapField
  ecubixHeader: string
  /** ERPNext field name(s) this Ecubix column's value should be written to. */
  erpFields: string[]
  type: 'string' | 'int' | 'currency' | 'date'
  required: boolean
}

export interface SecondaryConfig {
  headerMap: HeaderMapEntry[]
}

/** Role-profile link on a Customer (ERP AutoMapping source). */
export interface CustomerProfile {
  roleProfile: string
  department: string
  hq: string // Territory
}

/** One row of an ERP Item's custom_department_details child table. */
export interface ItemDepartment {
  department: string // elbrit_department
  validFrom: string | null
  validTo: string | null
}

export interface Credentials {
  erpnext: { baseUrl: string; apiKey: string; apiSecret: string }
}

export interface UserPrefs {
  accent: string
  density: 'comfortable' | 'compact'
  issueHints: boolean
}

/** ERP "Secondary Data Entry" document shape (subset we care about). */
export interface ErpSecondaryDoc {
  name: string
  distributor: string
  date: string
  items: ErpSecondaryItem[]
}

export interface ErpSecondaryItem {
  item: string
  sales_qty: number | null
  sales_value: number | null
  closing_qty: number | null
  closing_balance: number | null
  custom_role_profile?: string | null
  custom_department?: string | null
  custom_hq?: string | null
}

export const VALUE_FIELDS = [
  'sales_qty',
  'sales_value',
  'closing_qty',
  'closing_balance',
] as const

export type ValueField = (typeof VALUE_FIELDS)[number]
