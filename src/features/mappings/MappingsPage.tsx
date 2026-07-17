'use client'

import { useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../../data/appStore'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Checkbox } from '../../ui/Checkbox'
import { OutlineChip } from '../../ui/Chip'
import { Field, Input } from '../../ui/Field'
import { TabsList, TabsPanel, TabsRoot, TabsTab } from '../../ui/Tabs'
import { Muted, PageHead } from '../../ui/Text'

const TAB_VALUES = ['secondary', 'regex']

export function MappingsPage() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tab = TAB_VALUES.includes(params.get('tab') ?? '') ? params.get('tab')! : 'secondary'

  return (
    <div>
      <PageHead title="Mappings" subtitle="Global — changes re-validate open batches live" />

      <TabsRoot value={tab} onValueChange={(v) => router.push(`${pathname}?tab=${v}`)}>
        <TabsList>
          <TabsTab value="secondary">Secondary Mapping</TabsTab>
          <TabsTab value="regex">Regex</TabsTab>
        </TabsList>

        <TabsPanel value="secondary">
          <SecondaryMappingTab />
        </TabsPanel>
        <TabsPanel value="regex">
          <RegexMappingTab />
        </TabsPanel>
      </TabsRoot>
    </div>
  )
}

function SecondaryMappingTab() {
  const params = useSearchParams()
  const { masterMap, confirmMasterMatch, removeMasterMap } = useAppStore(
    useShallow((s) => ({
      masterMap: s.masterMap,
      confirmMasterMatch: s.confirmMasterMatch,
      removeMasterMap: s.removeMasterMap,
    })),
  )

  const field = params.get('field') ?? 'distributor'
  const [sheetValue, setSheetValue] = useState(params.get('sheetValue') ?? '')
  const [erpValue, setErpValue] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const sortedMasterMap = useMemo(
    () => [...masterMap].sort((a, b) => a.field.localeCompare(b.field) || a.sheetValue.localeCompare(b.sheetValue)),
    [masterMap],
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: sortedMasterMap.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
  })

  async function add() {
    setSaving(true)
    await confirmMasterMatch(field, sheetValue.trim(), erpValue.trim(), 'manual', comment.trim())
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
        <Field label="Sheet value" className="!mb-0 min-w-40 flex-1">
          <Input className="!h-9" value={sheetValue} onChange={(e) => setSheetValue(e.target.value)} />
        </Field>
        <Field label="ERP value" className="!mb-0 min-w-40 flex-1">
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
              <th>Sheet value</th>
              <th>ERP value</th>
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
                    const m = sortedMasterMap[vi.index]
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
            {sortedMasterMap.length === 0 && (
              <tr><td colSpan={5} className="py-7 text-center text-text-muted">No mappings yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/**
 * Regex → ERP Item overrides for Product master data. When an enabled
 * pattern matches a sheet product name, it resolves straight to that ERP
 * Item docname — takes precedence over exact/fuzzy item matching (see
 * validateRow.ts's resolveRegexOverride and erpActions.ts's matchItemsByName).
 */
function RegexMappingTab() {
  const { regexMap, upsertRegexMap, removeRegexMap, uid } = useAppStore(
    useShallow((s) => ({
      regexMap: s.regexMap,
      upsertRegexMap: s.upsertRegexMap,
      removeRegexMap: s.removeRegexMap,
      uid: s.uid,
    })),
  )

  const [pattern, setPattern] = useState('')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPattern, setEditPattern] = useState('')
  const [editValue, setEditValue] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

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

  function startEdit(r: (typeof regexMap)[number]) {
    setEditingId(r.id)
    setEditPattern(r.pattern)
    setEditValue(r.value)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditPattern('')
    setEditValue('')
  }

  async function saveEdit(r: (typeof regexMap)[number]) {
    setSavingEdit(true)
    await upsertRegexMap({ ...r, pattern: editPattern.trim(), value: editValue.trim() })
    setSavingEdit(false)
    cancelEdit()
  }

  async function toggleEnabled(r: (typeof regexMap)[number], checked: boolean) {
    setTogglingId(r.id)
    await upsertRegexMap({ ...r, enabled: checked })
    setTogglingId(null)
  }

  async function remove(id: string) {
    setDeletingId(id)
    await removeRegexMap(id)
    setDeletingId(null)
  }

  return (
    <Card>
      <Muted className="block px-3.5 pt-3 text-[12.5px]">
        Capture groups supported in ERP Equivalent — <span className="mono">$1</span>–<span className="mono">$9</span>,{' '}
        <span className="mono">$&amp;</span> (whole match), <span className="mono">$&lt;name&gt;</span> (named group).
      </Muted>
      <div className="flex flex-wrap items-end gap-2 p-3 px-3.5">
        <Field label="EBS Pattern" className="!mb-0 min-w-40 flex-1">
          <Input
            className="mono !h-9"
            placeholder="e.g. ^BRUFEN-(\d+)MG$"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />
        </Field>
        <Field label="ERP Equivalent" className="!mb-0 min-w-40 flex-1">
          <Input
            className="mono !h-9"
            placeholder="e.g. ITEM-BRUFEN-$1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <Button
          className="!h-9"
          variant="primary"
          disabled={!pattern.trim() || !value.trim() || saving}
          onClick={() => void add()}
        >
          {saving ? 'Saving…' : 'Add'}
        </Button>
      </div>
      <div className="table-scroll">
        <table className="table-data">
          <thead>
            <tr>
              <th>EBS Pattern</th>
              <th>ERP Equivalent</th>
              <th>Enabled</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...regexMap]
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map((r) =>
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
                      <Checkbox
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
                      <Checkbox
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
            {regexMap.length === 0 && (
              <tr><td colSpan={4} className="py-7 text-center text-text-muted">No regex rules yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
