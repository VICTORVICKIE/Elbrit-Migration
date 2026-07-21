'use client'

import type { CustomerProfile } from '../../types'
import { DialogClose, DialogPopup, DialogRoot, DialogTitle } from '../../ui/Dialog'
import { Button } from '../../ui/Button'
import { Muted } from '../../ui/Text'

/** Shows every Role Profile linked to an ERP Customer (Customer.custom_role_profile), one row per profile. */
export function RoleProfileDialog({
  customerName,
  profiles,
  onClose,
}: {
  customerName: string
  profiles: CustomerProfile[]
  onClose: () => void
}) {
  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="w-[640px]">
        <DialogTitle>ERP Role Profile</DialogTitle>
        <Muted className="mt-0 mb-3 block text-[12.5px]">
          <span className="mono">{customerName}</span> — {profiles.length} role profile{profiles.length === 1 ? '' : 's'}
        </Muted>
        <div className="table-scroll max-h-90 overflow-y-auto">
          <table className="table-data min-w-0">
            <thead>
              <tr>
                <th>Role Profile</th>
                <th>Department</th>
                <th>HQ</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.roleProfile}>
                  <td className="text-[12.5px]">{p.roleProfile}</td>
                  <td className="text-[12.5px]">{p.department}</td>
                  <td className="text-[12.5px]">{p.hq || '—'}</td>
                </tr>
              ))}
              {profiles.length === 0 && (
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
