import type { HeaderMapEntry, HeaderMapField, SecondaryConfig, Credentials, UserPrefs } from '../types'

/** Fixed set of parsed fields — the Header → ERP field map table always has exactly one row per entry. */
export const FIXED_HEADER_FIELDS: { field: HeaderMapField; label: string; type: HeaderMapEntry['type']; required: boolean }[] = [
  { field: 'customerName', label: 'Customer name', type: 'string', required: true },
  { field: 'ebsCode', label: 'EBS code', type: 'string', required: true },
  { field: 'itemName', label: 'Item name', type: 'string', required: true },
  { field: 'sales_qty', label: 'Secondary qty', type: 'int', required: false },
  { field: 'sales_value', label: 'Secondary value', type: 'currency', required: false },
  { field: 'closing_qty', label: 'Closing qty', type: 'int', required: false },
  { field: 'closing_balance', label: 'Closing value', type: 'currency', required: false },
]

// Header map is a fixed set of rows (see FIXED_HEADER_FIELDS) — only the
// Ecubix header, ERP field(s), type and required flag are configurable.
export const EMPTY_SECONDARY_CONFIG: SecondaryConfig = {
  headerMap: FIXED_HEADER_FIELDS.map((f) => ({
    field: f.field,
    ecubixHeader: '',
    erpFields: [],
    type: f.type,
    required: f.required,
  })),
}

/**
 * Reconcile a loaded SecondaryConfig against the fixed row set — old/partial
 * saved configs (missing a row, or carrying leftover fields from before the
 * header map was fixed) get patched to exactly FIXED_HEADER_FIELDS, keeping
 * whatever ecubixHeader/erpFields/required each field already had.
 */
const VALID_TYPES = new Set(['string', 'int', 'currency', 'date'])

export function normalizeHeaderMap(headerMap: HeaderMapEntry[]): HeaderMapEntry[] {
  const byField = new Map(headerMap.map((h) => [h.field, h]))
  return FIXED_HEADER_FIELDS.map((f) => {
    const existing = byField.get(f.field)
    return {
      field: f.field,
      ecubixHeader: existing?.ecubixHeader ?? '',
      erpFields: Array.isArray(existing?.erpFields) ? existing.erpFields : [],
      type: existing && VALID_TYPES.has(existing.type) ? existing.type : f.type,
      required: existing?.required ?? f.required,
    }
  })
}

export const EMPTY_CREDENTIALS: Credentials = {
  erpnext: { baseUrl: '', apiKey: '', apiSecret: '' },
}

export const DEFAULT_PREFS: UserPrefs = {
  accent: '#1e40af',
  density: 'comfortable',
  issueHints: true,
}

export const ACCENT_CHOICES = ['#1e40af', '#0f766e', '#6d28d9', '#b91c1c']
