'use client'

import { DialogClose, DialogPopup, DialogRoot, DialogTitle } from '../../ui/Dialog'
import { Button } from '../../ui/Button'
import { Muted } from '../../ui/Text'

/** Shows every EBS-code field value found on a matched ERP Customer when more than one is configured. */
export function EbsCodesDialog({
  customerName,
  values,
  onClose,
}: {
  customerName: string
  values: string[]
  onClose: () => void
}) {
  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="w-[420px]">
        <DialogTitle>ERP EBS codes</DialogTitle>
        <Muted className="mt-0 mb-3 block text-[12.5px]">
          <span className="mono">{customerName}</span> — {values.length} EBS codes
        </Muted>
        <div className="table-scroll max-h-90 overflow-y-auto">
          <table className="table-data min-w-0">
            <thead>
              <tr>
                <th>EBS Code</th>
              </tr>
            </thead>
            <tbody>
              {values.map((v) => (
                <tr key={v}>
                  <td className="mono text-[12.5px]">{v}</td>
                </tr>
              ))}
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
