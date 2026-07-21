'use client'

import type { ItemDepartment } from '../../types'
import { DialogClose, DialogPopup, DialogRoot, DialogTitle } from '../../ui/Dialog'
import { Button } from '../../ui/Button'
import { Muted } from '../../ui/Text'

/** Shows every row of an ERP Item's custom_department_details child table. */
export function ItemDepartmentsDialog({
  itemName,
  departments,
  onClose,
}: {
  itemName: string
  departments: ItemDepartment[]
  onClose: () => void
}) {
  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="w-[560px]">
        <DialogTitle>ERP Departments</DialogTitle>
        <Muted className="mt-0 mb-3 block text-[12.5px]">
          <span className="mono">{itemName}</span> — {departments.length} department{departments.length === 1 ? '' : 's'}
        </Muted>
        <div className="table-scroll max-h-90 overflow-y-auto">
          <table className="table-data min-w-0">
            <thead>
              <tr>
                <th>Department</th>
                <th>Valid From</th>
                <th>Valid To</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d, i) => (
                <tr key={`${d.department}-${i}`}>
                  <td className="text-[12.5px]">{d.department}</td>
                  <td className="text-[12.5px]">{d.validFrom ?? '—'}</td>
                  <td className="text-[12.5px]">{d.validTo ?? '—'}</td>
                </tr>
              ))}
              {departments.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-7 text-center text-text-muted">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4.5 flex justify-end">
          <DialogClose render={<Button />}>Close</DialogClose>
        </div>
      </DialogPopup>
    </DialogRoot>
  )
}
