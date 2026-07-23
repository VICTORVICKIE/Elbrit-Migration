// ERP-facing workflows for the Secondary module: snapshot prefetch (for
// validation), push (step 3) and round-trip validate (step 4).

import { buildDocPayload, buildPushGroups, type PushGroup } from '../../engine/buildPayload'
import { roundTripCompare } from '../../engine/roundTrip'
import { normalizeItemName } from '../../engine/resolveItem'
import { addExistingDoc, resolveRegexOverride } from '../../engine/validateRow'
import { bestFuzzyMatch } from '../../lib/fuzzyMatch'
import { ErpApiError, ErpNextClient } from '../../lib/erpnext/client'
import type {
  Credentials,
  CustomerProfile,
  ErpSecondaryDoc,
  ErpSecondaryItem,
  ItemDepartment,
  MigrationRow,
  RegexMapEntry,
} from '../../types'

export const DOCTYPE = 'Secondary Data Entry'

export function erpClientFrom(credentials: Credentials): ErpNextClient | null {
  const { baseUrl, apiKey, apiSecret } = credentials.erpnext
  if (!baseUrl || !apiKey || !apiSecret) return null
  return new ErpNextClient({ baseUrl, apiKey, apiSecret })
}

export interface StaticErpIndex {
  items: Map<string, string>
  customers: Map<string, string> // normalized EBS code → ERP Customer docname — exact-match fast path
}

/**
 * The leaf-independent half of the ERP snapshot — the full Item and Customer
 * indexes, identical no matter which HQ/month is being checked. Fetch once
 * and reuse across every leaf in a reconciliation batch instead of re-fetching
 * the whole Item/Customer list per HQ (see `computeReconciliation`).
 */
export async function fetchStaticErpIndex(client: ErpNextClient, ebsCodeErpFields: string[]): Promise<StaticErpIndex> {
  const customerFields = targetFieldsFrom(ebsCodeErpFields, ['name'])
  const [itemDocs, customerRecords] = await Promise.all([
    client.listAll<{ name: string; item_name: string }>('Item', { fields: ['name', 'item_name'] }),
    fetchFieldValues(client, 'Customer', customerFields),
  ])

  const items = new Map<string, string>()
  for (const it of itemDocs) {
    items.set(normalizeItemName(it.item_name || it.name), it.name)
    items.set(normalizeItemName(it.name), it.name)
  }

  const customers = new Map<string, string>()
  for (const r of customerRecords) {
    // Same comma-separated-codes caveat as matchCustomersByEbsCode.
    for (const code of r.value.split(',').map((v) => v.trim()).filter(Boolean)) {
      customers.set(normalizeItemName(code), r.name)
    }
  }
  return { items, customers }
}

export interface ReconciliationSnapshot {
  items: Map<string, string>
  customers: Map<string, string> // normalized EBS code → ERP Customer docname — exact-match fast path
  existing: Map<string, ErpSecondaryDoc> // groupKey(distributor, date) → doc
  customerProfiles: Map<string, CustomerProfile[]>
}

/**
 * One-shot replacement for the ENTIRE per-leaf ERP fetch (fetchStaticErpIndex
 * + fetchErpSnapshot's existing-docs/role-profile halves), computed
 * server-side by the `migration_secondary` Server Script (paste the Python
 * below into ERPNext → Settings → Server Script, type "API", with the API
 * Method field set exactly to `migration_secondary` — must be a valid Python
 * identifier, since Frappe resolves API commands via `globals()[cmd]`; a
 * kebab-case name can never be found that way). One call covers every leaf
 * across the whole folder-summary scope — pass the union of every leaf's
 * raw EBS codes, not one leaf's.
 *
 * Why this needs a server script rather than more REST calls: the REST list/
 * getDoc endpoints enforce per-doctype read permissions (this is what the 403
 * came from — the API key isn't necessarily allowed to read `DocType`/
 * `Custom Field` metadata, which a client-side "resolve the child table name"
 * approach would need). `frappe.get_all` run *inside* a script executes
 * in-process and does not apply per-doctype permission checks, and
 * `frappe.get_meta` reads doctype metadata from the framework's own cache
 * with no REST permission gate at all. A POST body also has no query-string
 * length limit, so — unlike doing this via REST — a single call can cover
 * the whole Item/Customer catalog, EBS-code→distributor resolution, existing
 * docs, and role profiles for every HQ in scope at once, instead of one
 * catalog fetch plus a getDoc-per-doc/getDoc-per-distributor repeated per HQ.
 */
export async function fetchReconciliationSnapshot(
  client: ErpNextClient,
  ebsCodes: string[],
  ebsCodeErpFields: string[],
  confirmedDistributors: Record<string, string>, // normalized EBS code → ERP Customer docname
  month: string, // yyyy-mm
): Promise<ReconciliationSnapshot> {
  const customerFields = targetFieldsFrom(ebsCodeErpFields, ['name'])
  const raw = await client.call<{
    items: { name: string; item_name: string }[]
    customerRecords: { name: string; value: string }[]
    existing: { name: string; distributor: string; date: string; items: ErpSecondaryItem[] }[]
    customerProfiles: Record<string, CustomerProfile[]>
  }>('migration_secondary', {
    month,
    ebs_codes: JSON.stringify(ebsCodes),
    customer_fields: JSON.stringify(customerFields),
    confirmed_distributors: JSON.stringify(confirmedDistributors),
  })

  const items = new Map<string, string>()
  for (const it of raw.items) {
    items.set(normalizeItemName(it.item_name || it.name), it.name)
    items.set(normalizeItemName(it.name), it.name)
  }
  const customers = new Map<string, string>()
  for (const r of raw.customerRecords) customers.set(normalizeItemName(r.value), r.name)

  const existing = new Map<string, ErpSecondaryDoc>()
  for (const doc of raw.existing) addExistingDoc(existing, doc)

  return { items, customers, existing, customerProfiles: new Map(Object.entries(raw.customerProfiles ?? {})) }
}

/**
 * Prefetch the ERP snapshot validation needs: item index, customer index
 * (exact-match fast path, same as Master Data → Customer), existing docs for
 * the batch month, and each distributor's role profiles (ST-HQ mapping source:
 * Customer.custom_role_profile → Role Profile.custom_department/custom_territory).
 *
 * `ebsCodes` are resolved to ERP distributor names via `confirmedDistributors`
 * first, falling back to an exact match against ERP Customer's configured
 * field(s) — same precedence as `validateRow`'s distributor resolution.
 *
 * `staticIndex` lets a caller checking multiple leaves (e.g. the folder-summary
 * reconciliation's fallback path, used only if `fetchReconciliationSnapshot`
 * isn't available) fetch the Item/Customer index once and pass it in here for
 * every leaf, instead of each leaf re-fetching the whole Item/Customer list.
 */
export async function fetchErpSnapshot(
  client: ErpNextClient,
  ebsCodes: string[],
  ebsCodeErpFields: string[],
  confirmedDistributors: Record<string, string>, // normalized EBS code → ERP Customer docname
  month: string, // yyyy-mm
  staticIndex?: StaticErpIndex,
): Promise<{
  items: Map<string, string>
  customers: Map<string, string> // normalized EBS code → ERP Customer docname — exact-match fast path
  existing: Map<string, ErpSecondaryDoc>
  customerProfiles: Map<string, CustomerProfile[]>
}> {
  const { items, customers } = staticIndex ?? (await fetchStaticErpIndex(client, ebsCodeErpFields))

  const distributors = [
    ...new Set(
      ebsCodes
        .map((code) => {
          const norm = normalizeItemName(code)
          return confirmedDistributors[norm] ?? customers.get(norm)
        })
        .filter((d): d is string => Boolean(d)),
    ),
  ]

  const existing = new Map<string, ErpSecondaryDoc>()
  if (distributors.length > 0) {
    const [year, monthNum] = month.split('-').map(Number)
    const lastDay = new Date(year, monthNum, 0).getDate() // day 0 of next month = last day of this one
    const monthStart = `${month}-01`
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`
    const names = await client.list<{ name: string }>(DOCTYPE, {
      filters: [
        ['distributor', 'in', distributors],
        ['date', '>=', monthStart],
        ['date', '<=', monthEnd],
      ],
      fields: ['name'],
      limit: 500,
    })
    const docs = await Promise.all(names.map(({ name }) => client.getDoc<ErpSecondaryDoc>(DOCTYPE, name)))
    for (const doc of docs) addExistingDoc(existing, doc)
  }

  // ST-HQ mapping source: full Customer docs carry the custom_role_profile
  // child table; Role Profile holds department + territory (HQ).
  const customerProfiles = new Map<string, CustomerProfile[]>()
  const roleProfileNames = new Set<string>()
  const customerRoles = new Map<string, string[]>()
  await Promise.all(
    distributors.map(async (distributor) => {
      try {
        const cust = await client.getDoc<{ custom_role_profile?: { role_profile_list: string }[] }>(
          'Customer',
          distributor,
        )
        const roles = (cust.custom_role_profile ?? []).map((r) => r.role_profile_list)
        customerRoles.set(distributor, roles)
        roles.forEach((r) => roleProfileNames.add(r))
      } catch {
        customerRoles.set(distributor, [])
      }
    }),
  )
  const profiles = roleProfileNames.size
    ? await client.list<{ name: string; custom_department: string | null; custom_territory: string | null }>(
        'Role Profile',
        {
          filters: [['name', 'in', [...roleProfileNames]]],
          fields: ['name', 'custom_department', 'custom_territory'],
          limit: 500,
        },
      )
    : []
  const profileByName = new Map(profiles.map((p) => [p.name, p]))
  for (const [distributor, roles] of customerRoles) {
    customerProfiles.set(
      distributor,
      roles
        .map((r) => profileByName.get(r))
        .filter((p): p is NonNullable<typeof p> => Boolean(p?.custom_department))
        .map((p) => ({
          roleProfile: p.name,
          department: p.custom_department!,
          hq: p.custom_territory ?? '',
        })),
    )
  }

  return { items, customers, existing, customerProfiles }
}

/** All non-child, non-single doctype names — used for the "Master doctype" picker in Settings. */
export async function fetchDoctypeNames(client: ErpNextClient): Promise<string[]> {
  const doctypes = await client.listAll<{ name: string }>('DocType', {
    filters: [
      ['istable', '=', 0],
      ['issingle', '=', 0],
    ],
    fields: ['name'],
  })
  return doctypes.map((d) => d.name).sort((a, b) => a.localeCompare(b))
}

/** Department/Territory names for the batch-tagging dropdowns. */
export async function fetchDepartmentsAndTerritories(
  client: ErpNextClient,
): Promise<{ departments: string[]; territories: string[] }> {
  const [departments, territories] = await Promise.all([
    client.listAll<{ name: string }>('Department', { fields: ['name'] }),
    client.listAll<{ name: string }>('Territory', { fields: ['name'] }),
  ])
  return {
    departments: departments.map((d) => d.name).sort((a, b) => a.localeCompare(b)),
    territories: territories.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
  }
}

interface DocField {
  fieldname: string
  fieldtype: string
  options?: string
}

const NON_DATA_FIELDTYPES = new Set([
  'Section Break',
  'Column Break',
  'Tab Break',
  'HTML',
  'Button',
  'Heading',
])

/**
 * A doctype's own fields as stored on the DocType document only cover
 * standard fields — fields added via "Customize Form" live as separate
 * `Custom Field` records (linked via `dt`) and aren't merged into that
 * document by a plain GET. Fetch both and combine.
 */
async function fetchAllFields(client: ErpNextClient, doctype: string): Promise<DocField[]> {
  const [doc, customFields] = await Promise.all([
    client.getDoc<{ fields: DocField[] }>('DocType', doctype),
    client.list<DocField>('Custom Field', {
      filters: [['dt', '=', doctype]],
      fields: ['fieldname', 'fieldtype', 'options'],
      limit: 500,
    }),
  ])
  return [...(doc.fields ?? []), ...customFields]
}

/**
 * Field names for a doctype, its child-table doctype (e.g. Secondary Data
 * Entry's item rows), and — one level deep — every Link field's target
 * doctype, as `{linkField}.{targetField}` (Frappe's dotted-path convention).
 * Includes fields added via Customize Form at every level.
 */
export async function fetchDocTypeFieldNames(client: ErpNextClient, doctype: string): Promise<string[]> {
  const fields = await fetchAllFields(client, doctype)
  const table = fields.find((f) => f.fieldtype === 'Table' && f.options)
  const childFields = table ? await fetchAllFields(client, table.options!) : []

  const own = [...fields, ...childFields].filter((f) => f.fieldname && !NON_DATA_FIELDTYPES.has(f.fieldtype))

  const linkFields = own.filter((f) => (f.fieldtype === 'Link' || f.fieldtype === 'Dynamic Link') && f.options)
  const linkedNames = (
    await Promise.all(
      linkFields.map(async (linkField) => {
        try {
          const linkedFields = await fetchAllFields(client, linkField.options!)
          return linkedFields
            .filter((f) => f.fieldname && !NON_DATA_FIELDTYPES.has(f.fieldtype))
            .map((f) => `${linkField.fieldname}.${f.fieldname}`)
        } catch (e) {
          console.warn('[fetchDocTypeFieldNames] could not fetch linked doctype', linkField.options, e)
          return [] // linked doctype may not be readable by this user — skip, not fatal
        }
      }),
    )
  ).flat()

  return [...new Set([...own.map((f) => f.fieldname), ...linkedNames])]
}

export interface PushProgress {
  done: number
  total: number
  currentGroup: string
}

/**
 * Step 3 — push groups to ERP. Returns updated rows. Idempotent: a duplicate
 * on create switches to update against the existing doc.
 */
export async function pushRows(
  client: ErpNextClient,
  rows: MigrationRow[],
  onProgress?: (p: PushProgress) => void,
): Promise<MigrationRow[]> {
  const groups = buildPushGroups(rows)
  const updatedById = new Map<string, MigrationRow>()
  const now = () => new Date().toISOString()

  let done = 0
  for (const group of groups) {
    onProgress?.({ done, total: groups.length, currentGroup: group.key })
    const payload = buildDocPayload(group)

    const markGroup = (fn: (r: MigrationRow) => MigrationRow) => {
      for (const r of group.rows) updatedById.set(r.id, fn(updatedById.get(r.id) ?? r))
    }

    try {
      let docName = group.erpDocName
      if (docName) {
        await client.updateDoc(DOCTYPE, docName, payload)
      } else {
        try {
          const created = await client.createDoc<{ name: string }>(DOCTYPE, payload)
          docName = created.name
        } catch (e) {
          if (e instanceof ErpApiError && e.kind === 'duplicate') {
            // Autoname {distributor}-{date} collision → find and update instead.
            const found = await client.list<{ name: string }>(DOCTYPE, {
              filters: [
                ['distributor', '=', group.distributor],
                ['date', '=', group.date],
              ],
              fields: ['name'],
              limit: 1,
            })
            if (found.length === 0) throw e
            docName = found[0].name
            await client.updateDoc(DOCTYPE, docName, payload)
          } else {
            throw e
          }
        }
      }
      markGroup((r) => ({
        ...r,
        state: 'synced',
        erpDocName: docName!,
        push: { attempts: r.push.attempts + 1, lastError: null, lastAt: now() },
      }))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      markGroup((r) => ({
        ...r,
        state: 'error',
        issues: [
          ...r.issues.filter((i) => i.code !== 'PUSH_FAILED'),
          { code: 'PUSH_FAILED', message, severity: 'error' },
        ],
        push: { attempts: r.push.attempts + 1, lastError: message, lastAt: now() },
      }))
    }
    done++
  }
  onProgress?.({ done, total: groups.length, currentGroup: '' })
  return [...updatedById.values()]
}

/** Step 4 — round-trip validation. Returns updated rows with validate results. */
export async function validatePushed(
  client: ErpNextClient,
  rows: MigrationRow[],
): Promise<MigrationRow[]> {
  const docNames = [...new Set(rows.filter((r) => r.erpDocName).map((r) => r.erpDocName!))]
  const fetched = new Map<string, ErpSecondaryDoc>()
  for (const name of docNames) {
    try {
      fetched.set(name, await client.getDoc<ErpSecondaryDoc>(DOCTYPE, name))
    } catch {
      // missing doc → roundTripCompare reports it
    }
  }
  const results = roundTripCompare(rows, fetched)
  const byId = new Map(results.map((r) => [r.rowId, r]))
  const at = new Date().toISOString()

  return rows
    .filter((r) => byId.has(r.id))
    .map((r) => {
      const res = byId.get(r.id)!
      return {
        ...r,
        state: res.ok ? 'synced' : 'conflict',
        issues: res.ok
          ? r.issues.filter((i) => i.code !== 'POST_PUSH_MISMATCH')
          : [
              ...r.issues.filter((i) => i.code !== 'POST_PUSH_MISMATCH'),
              {
                code: 'POST_PUSH_MISMATCH' as const,
                message: 'ERP record differs from Ecubix after push',
                severity: 'error' as const,
              },
            ],
        validate: { ok: res.ok, mismatches: res.mismatches, at },
      }
    })
}

export interface MasterMatchResult {
  /** A confirmed value — the matched ERP record's docname. */
  erpValue: string | null
  /** An unconfirmed fuzzy suggestion (docname), awaiting explicit user confirmation before it counts as matched. */
  suggestion: string | null
  score: number | null
}

export interface MasterMatchOutcome {
  matches: Map<string, MasterMatchResult>
  /** Every matched doctype's docname — the option list for the ERP dropdown, letting the user override any match. */
  options: string[]
  /** Docname → every configured field's raw value found on that record (e.g. more than one EBS-code field on the same ERP Customer). */
  valuesByDoc?: Map<string, string[]>
}

/** Dotted-path (Frappe convention, e.g. `"distributor.whg_ebs_code"`) → the field on the linked doctype; bare paths match on `name`. */
function targetFieldsFrom(erpFields: string[], fallback: string[]): string[] {
  if (erpFields.length === 0) return fallback
  return erpFields.map((f) => f.split('.')[1] || 'name')
}

async function fetchFieldValues(
  client: ErpNextClient,
  doctype: string,
  fields: string[],
): Promise<{ name: string; value: string }[]> {
  const records = await client.listAll<Record<string, string>>(doctype, {
    fields: [...new Set(['name', ...fields])],
  })
  const out: { name: string; value: string }[] = []
  for (const r of records) {
    for (const f of fields) {
      if (r[f]) out.push({ name: r.name, value: r[f] })
    }
  }
  return out
}

/**
 * Exact-only match: Ecubix EBS codes against ERP Customer's configured
 * field(s) (Settings → Header → ERP field map → EBS code → ERP Field).
 * EBS codes don't resemble customer names, so no fuzzy fallback — an
 * unresolved code needs a manual pick from `options`, same as before.
 */
export async function matchCustomersByEbsCode(
  client: ErpNextClient,
  ebsCodes: string[],
  erpFields: string[],
  confirmed?: Record<string, string>,
): Promise<MasterMatchOutcome> {
  const norm = normalizeItemName
  const fields = targetFieldsFrom(erpFields, ['name'])
  const records = await fetchFieldValues(client, 'Customer', fields)
  const byValue = new Map<string, string>()
  const valuesByDoc = new Map<string, string[]>()
  for (const r of records) {
    // A single EBS-code field can itself hold several codes as one
    // comma-separated string (e.g. "EBS148,EBS015") — split so each code
    // matches individually and lists separately in the UI.
    const codes = r.value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
    for (const code of codes) {
      byValue.set(norm(code), r.name)
      const existing = valuesByDoc.get(r.name)
      if (existing) {
        if (!existing.includes(code)) existing.push(code)
      } else {
        valuesByDoc.set(r.name, [code])
      }
    }
  }

  const matches = new Map<string, MasterMatchResult>()
  for (const code of ebsCodes) {
    const alreadyConfirmed = confirmed?.[norm(code)]
    const exact = byValue.get(norm(code))
    matches.set(code, { erpValue: alreadyConfirmed ?? exact ?? null, suggestion: null, score: null })
  }
  const options = [...new Set(records.map((r) => r.name))].sort((a, b) => a.localeCompare(b))
  return { matches, options, valuesByDoc }
}

/**
 * Fuzzy match: Ecubix product names against ERP Item's configured field(s)
 * (Settings → Header → ERP field map → Item name → ERP Field), falling back
 * to `item_name`/`name` if none picked yet. A regex override (Mappings →
 * Regex) takes precedence over everything else, then an exact hit confirms
 * immediately, then near-misses surface as an unconfirmed `suggestion` the
 * user must accept — same precedence as validateRow's item resolution.
 */
export async function matchItemsByName(
  client: ErpNextClient,
  itemNames: string[],
  erpFields: string[],
  confirmed?: Record<string, string>,
  regexMap: RegexMapEntry[] = [],
): Promise<MasterMatchOutcome> {
  const norm = normalizeItemName
  const fields = targetFieldsFrom(erpFields, ['item_name', 'name'])
  const records = await fetchFieldValues(client, 'Item', fields)
  const byValue = new Map<string, string>()
  const values: string[] = []
  for (const r of records) {
    byValue.set(norm(r.value), r.name)
    values.push(r.value)
  }

  const matches = new Map<string, MasterMatchResult>()
  for (const name of itemNames) {
    const regexOverride = resolveRegexOverride(name, regexMap)
    if (regexOverride) {
      matches.set(name, { erpValue: regexOverride, suggestion: null, score: null })
      continue
    }
    const alreadyConfirmed = confirmed?.[norm(name)]
    if (alreadyConfirmed) {
      matches.set(name, { erpValue: alreadyConfirmed, suggestion: null, score: null })
      continue
    }
    const exact = byValue.get(norm(name))
    if (exact) {
      matches.set(name, { erpValue: exact, suggestion: null, score: null })
      continue
    }
    const fuzzy = bestFuzzyMatch(name, values)
    if (fuzzy) {
      matches.set(name, { erpValue: null, suggestion: byValue.get(norm(fuzzy.value)) ?? null, score: fuzzy.score })
    } else {
      matches.set(name, { erpValue: null, suggestion: null, score: null })
    }
  }
  const options = [...new Set(records.map((r) => r.name))].sort((a, b) => a.localeCompare(b))
  return { matches, options }
}

/**
 * ERP Item.custom_department_details (child table) for each matched item —
 * the Master Data → Item table's Department chip/popup source.
 */
export async function fetchItemDepartments(
  client: ErpNextClient,
  itemDocNames: string[],
): Promise<Map<string, ItemDepartment[]>> {
  const out = new Map<string, ItemDepartment[]>()
  await Promise.all(
    [...new Set(itemDocNames)].map(async (docname) => {
      try {
        const doc = await client.getDoc<{
          custom_department_details?: { elbrit_department: string; valid_from: string | null; valid_to: string | null }[]
        }>('Item', docname)
        out.set(
          docname,
          (doc.custom_department_details ?? []).map((d) => ({
            department: d.elbrit_department,
            validFrom: d.valid_from,
            validTo: d.valid_to,
          })),
        )
      } catch {
        out.set(docname, [])
      }
    }),
  )
  return out
}

export type { PushGroup }
