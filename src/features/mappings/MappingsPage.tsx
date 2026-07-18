'use client'

import { useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as XLSX from 'xlsx'
import { useShallow } from 'zustand/react/shallow'
import type { RegexMapEntry } from '../../types'
import { useAppStore } from '../../data/appStore'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Chip, OutlineChip } from '../../ui/Chip'
import { cn } from '../../ui/cn'
import { Field, Input } from '../../ui/Field'
import { Switch } from '../../ui/Switch'
import { TabsList, TabsPanel, TabsRoot, TabsTab } from '../../ui/Tabs'
import { Muted, PageHead } from '../../ui/Text'

const TAB_VALUES = ['regex', 'customers']

export function MappingsPage() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tab = TAB_VALUES.includes(params.get('tab') ?? '') ? params.get('tab')! : 'regex'

  return (
    <div>
      <PageHead title="Global mappings" subtitle="Item and customer mappings apply across all divisions and data types." />

      <TabsRoot value={tab} onValueChange={(v) => router.push(`${pathname}?tab=${v}`)}>
        <TabsList>
          <TabsTab value="regex">Item replace rules</TabsTab>
          <TabsTab value="customers">EBS ↔ ERP customers</TabsTab>
        </TabsList>

        <TabsPanel value="regex">
          <RegexMappingTab />
        </TabsPanel>
        <TabsPanel value="customers">
          <CustomerMappingTab />
        </TabsPanel>
      </TabsRoot>
    </div>
  )
}

/** EBS customer code → ERP Customer docname overrides — the `masterMap` 'distributor' field. */
function CustomerMappingTab() {
  const { masterMap, confirmMasterMatch, removeMasterMap } = useAppStore(
    useShallow((s) => ({
      masterMap: s.masterMap,
      confirmMasterMatch: s.confirmMasterMatch,
      removeMasterMap: s.removeMasterMap,
    })),
  )

  const [sheetValue, setSheetValue] = useState('')
  const [erpValue, setErpValue] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const customerMap = useMemo(
    () =>
      masterMap
        .filter((m) => m.field === 'distributor')
        .sort((a, b) => a.sheetValue.localeCompare(b.sheetValue)),
    [masterMap],
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's returned functions are intentionally unmemoized
  const rowVirtualizer = useVirtualizer({
    count: customerMap.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
  })

  async function add() {
    setSaving(true)
    await confirmMasterMatch('distributor', sheetValue.trim(), erpValue.trim(), 'manual', comment.trim())
    setSaving(false)
    setSheetValue('')
    setErpValue('')
    setComment('')
  }

  async function remove(id: string) {
    setDeletingId(id)
    await removeMasterMap(id)
    setDeletingId(null)
  }

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-2 p-3 px-3.5">
        <Field label="EBS customer code" className="!mb-0 min-w-40 flex-1">
          <Input className="!h-9" value={sheetValue} onChange={(e) => setSheetValue(e.target.value)} />
        </Field>
        <Field label="ERP customer" className="!mb-0 min-w-40 flex-1">
          <Input className="!h-9" value={erpValue} onChange={(e) => setErpValue(e.target.value)} />
        </Field>
        <Field label="Comment" className="!mb-0 min-w-40 flex-1">
          <Input
            className="!h-9"
            placeholder="why this mapping exists"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
        <Button
          className="!h-9"
          variant="primary"
          disabled={!sheetValue.trim() || !erpValue.trim() || saving}
          onClick={() => void add()}
        >
          {saving ? 'Saving…' : 'Add'}
        </Button>
      </div>
      <div ref={scrollRef} className="table-scroll max-h-[70vh] overflow-y-auto">
        <table className="table-data">
          <thead>
            <tr>
              <th>EBS customer code</th>
              <th>ERP customer</th>
              <th>Source</th>
              <th>Comment</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const virtualItems = rowVirtualizer.getVirtualItems()
              const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
              const paddingBottom =
                virtualItems.length > 0
                  ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
                  : 0
              return (
                <>
                  {paddingTop > 0 && (
                    <tr>
                      <td colSpan={5} style={{ height: paddingTop, padding: 0, border: 'none' }} />
                    </tr>
                  )}
                  {virtualItems.map((vi) => {
                    const m = customerMap[vi.index]
                    return (
                      <tr key={m.id} data-index={vi.index} ref={rowVirtualizer.measureElement}>
                        <td className="text-[12.5px]">{m.displaySheetValue}</td>
                        <td className="mono text-xs">{m.erpValue}</td>
                        <td><OutlineChip>{m.source}</OutlineChip></td>
                        <td className="text-xs text-text-faint">{m.comment}</td>
                        <td>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={deletingId === m.id}
                            onClick={() => void remove(m.id)}
                          >
                            {deletingId === m.id ? 'Deleting…' : 'Delete'}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                  {paddingBottom > 0 && (
                    <tr>
                      <td colSpan={5} style={{ height: paddingBottom, padding: 0, border: 'none' }} />
                    </tr>
                  )}
                </>
              )
            })()}
            {customerMap.length === 0 && (
              <tr><td colSpan={5} className="py-7 text-center text-text-muted">No mappings yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/**
 * Item replace rules for Product master data. When an enabled pattern
 * matches a sheet product name, it resolves straight to that ERP Item
 * docname — takes precedence over exact/fuzzy item matching (see
 * validateRow.ts's resolveRegexOverride and erpActions.ts's matchItemsByName).
 *
 * A single `pattern` field covers both: a plain string is already a valid
 * substring match, so there's no separate "static" rule type to maintain —
 * a full match is just a regex with nothing fancy in it.
 */
function RegexMappingTab() {
  const params = useSearchParams()
  const { regexMap, upsertRegexMap, removeRegexMap, uid } = useAppStore(
    useShallow((s) => ({
      regexMap: s.regexMap,
      upsertRegexMap: s.upsertRegexMap,
      removeRegexMap: s.removeRegexMap,
      uid: s.uid,
    })),
  )

  const [pattern, setPattern] = useState(params.get('pattern') ?? '')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPattern, setEditPattern] = useState('')
  const [editValue, setEditValue] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [testInput, setTestInput] = useState('')

  const sortedRegexMap = useMemo(
    () => [...regexMap].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [regexMap],
  )

  const testMatch = useMemo(() => {
    if (!testInput.trim()) return null
    for (const r of sortedRegexMap) {
      if (!r.enabled || !r.pattern) continue
      let m: RegExpMatchArray | null
      try {
        m = testInput.match(new RegExp(r.pattern, 'i'))
      } catch {
        continue
      }
      if (m) return { rule: r, result: substituteCaptures(r.value, m) }
    }
    return null
  }, [testInput, sortedRegexMap])

  async function add() {
    setSaving(true)
    await upsertRegexMap({
      id: `regex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pattern: pattern.trim(),
      value: value.trim(),
      enabled: true,
      createdBy: uid,
      createdAt: new Date().toISOString(),
    })
    setSaving(false)
    setPattern('')
    setValue('')
  }

  function startEdit(r: RegexMapEntry) {
    setEditingId(r.id)
    setEditPattern(r.pattern)
    setEditValue(r.value)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditPattern('')
    setEditValue('')
  }

  async function saveEdit(r: RegexMapEntry) {
    setSavingEdit(true)
    await upsertRegexMap({ ...r, pattern: editPattern.trim(), value: editValue.trim() })
    setSavingEdit(false)
    cancelEdit()
  }

  async function toggleEnabled(r: RegexMapEntry, checked: boolean) {
    setTogglingId(r.id)
    await upsertRegexMap({ ...r, enabled: checked })
    setTogglingId(null)
  }

  async function remove(id: string) {
    setDeletingId(id)
    await removeRegexMap(id)
    setDeletingId(null)
  }

  function downloadExcel() {
    const rows = sortedRegexMap.map((r) => ({
      'Match · Sheet item': r.pattern,
      'Replace with · ERP item': r.value,
      Enabled: r.enabled ? 'Yes' : 'No',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Item replace rules')
    XLSX.writeFile(wb, 'item-replace-rules.xlsx')
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 px-3.5">
        <Muted className="text-[12.5px]">
          Rules apply top to bottom, case-insensitive. Capture groups supported in the ERP item —{' '}
          <span className="mono">$1</span>–<span className="mono">$9</span>, <span className="mono">$&amp;</span>{' '}
          (whole match), <span className="mono">$&lt;name&gt;</span> (named group).
        </Muted>
        <Button size="sm" onClick={downloadExcel} disabled={sortedRegexMap.length === 0}>
          Download Excel
        </Button>
      </div>
      <div className="table-scroll">
        <table className="table-data">
          <thead>
            <tr>
              <th>Match · Sheet item</th>
              <th>Replace with · ERP item</th>
              <th>Enabled</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedRegexMap.map((r) =>
              editingId === r.id ? (
                <tr key={r.id}>
                  <td>
                    <Input
                      className="mono !h-8 text-[12.5px]"
                      value={editPattern}
                      onChange={(e) => setEditPattern(e.target.value)}
                    />
                  </td>
                  <td>
                    <Input
                      className="mono !h-8 text-xs"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                  </td>
                  <td>
                    <Switch
                      checked={r.enabled}
                      disabled={togglingId === r.id}
                      onCheckedChange={(checked) => void toggleEnabled(r, checked)}
                    />
                  </td>
                  <td className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!editPattern.trim() || !editValue.trim() || savingEdit}
                      onClick={() => void saveEdit(r)}
                    >
                      {savingEdit ? 'Saving…' : 'Save'}
                    </Button>
                    <Button size="sm" disabled={savingEdit} onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td className="mono text-[12.5px]">{r.pattern}</td>
                  <td className="mono text-xs">{r.value}</td>
                  <td>
                    <Switch
                      checked={r.enabled}
                      disabled={togglingId === r.id}
                      onCheckedChange={(checked) => void toggleEnabled(r, checked)}
                    />
                  </td>
                  <td className="flex gap-1.5">
                    <Button size="sm" onClick={() => startEdit(r)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={deletingId === r.id}
                      onClick={() => void remove(r.id)}
                    >
                      {deletingId === r.id ? 'Deleting…' : 'Delete'}
                    </Button>
                  </td>
                </tr>
              ),
            )}
            <tr>
              <td>
                <Input
                  className="mono !h-8 text-[12.5px]"
                  placeholder="Match pattern, e.g. D3 60000 ?IU"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                />
              </td>
              <td>
                <Input
                  className="mono !h-8 text-xs"
                  placeholder="ERP item name"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </td>
              <td></td>
              <td>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!pattern.trim() || !value.trim() || saving}
                  onClick={() => void add()}
                >
                  {saving ? 'Saving…' : 'Add rule'}
                </Button>
              </td>
            </tr>
            {sortedRegexMap.length === 0 && (
              <tr><td colSpan={4} className="py-7 text-center text-text-muted">No rules yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border p-3.5">
        <p className="mb-1 text-[13px] font-medium">Test rules</p>
        <Muted className="mb-2 block text-[12.5px]">
          Paste a sheet item name to see which rule fires and the resulting ERP item.
        </Muted>
        <Input
          className="!h-9"
          placeholder="e.g. Elbivit D3 60000IU Caps"
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
        />
        {testInput.trim() && (
          <div
            className={cn(
              'mt-2 flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-[12.5px]',
              testMatch ? 'bg-status-synced-bg' : 'bg-bg',
            )}
          >
            {testMatch ? (
              <>
                <Chip className="bg-status-synced-bg text-status-synced">MATCH</Chip>
                <span>
                  → <span className="font-semibold">{testMatch.result}</span>{' '}
                  <Muted className="mono text-xs">regex: {testMatch.rule.pattern}</Muted>
                </span>
              </>
            ) : (
              <Muted>No rule matches this item.</Muted>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

/** Substitutes `$1`.."$99", `$&` (whole match) and `$<name>` (named group) — mirrors validateRow.ts's substituteCaptures. */
function substituteCaptures(template: string, match: RegExpMatchArray): string {
  return template.replace(/\$(\$|&|<[^>]+>|\d{1,2})/g, (_full, spec: string) => {
    if (spec === '$') return '$'
    if (spec === '&') return match[0]
    if (spec.startsWith('<')) return match.groups?.[spec.slice(1, -1)] ?? ''
    return match[Number(spec)] ?? ''
  })
}
