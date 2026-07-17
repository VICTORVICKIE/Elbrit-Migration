'use client'

import { useState } from 'react'
import { useAppStore } from '../../data/appStore'
import { Button } from '../../ui/Button'
import { DialogClose, DialogPopup, DialogRoot, DialogTitle } from '../../ui/Dialog'
import { Field, Input } from '../../ui/Field'
import { Muted } from '../../ui/Text'

/**
 * Maps an EBS code to an ERP customer. Saving fixes every row in the batch
 * with that code (validation re-runs via the store) and stores the mapping
 * globally in Mappings → Secondary mappings (field 'distributor').
 */
export function MapCustomerDialog({
  ebsCode,
  customerName,
  onClose,
}: {
  ebsCode: string
  customerName: string
  onClose: () => void
}) {
  const confirmMasterMatch = useAppStore((s) => s.confirmMasterMatch)
  const rows = useAppStore((s) => s.rows)
  const [erpCustomer, setErpCustomer] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  const affected = rows.filter((r) => r.ebsCode === ebsCode).length

  async function save() {
    setSaving(true)
    await confirmMasterMatch('distributor', ebsCode, erpCustomer.trim(), 'manual', comment.trim())
    setSaving(false)
    onClose()
  }

  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup>
        <DialogTitle>Map EBS customer</DialogTitle>
        <Muted className="mt-0 mb-3 block text-[12.5px]">
          <span className="mono">{ebsCode}</span> · &ldquo;{customerName}&rdquo; — fixes {affected} row
          {affected === 1 ? '' : 's'} in this batch and saves the mapping globally.
        </Muted>
        <Field label="ERP Customer (docname)">
          <Input
            autoFocus
            placeholder="e.g. CUST-00021"
            value={erpCustomer}
            onChange={(e) => setErpCustomer(e.target.value)}
          />
        </Field>
        <Field label="Comment (optional)">
          <Input
            placeholder="e.g. confirmed by ops, see ticket #4021"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
        <div className="mt-4.5 flex justify-end gap-2">
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary" disabled={!erpCustomer.trim() || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Map & fix rows'}
          </Button>
        </div>
      </DialogPopup>
    </DialogRoot>
  )
}
