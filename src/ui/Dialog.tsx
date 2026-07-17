import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from './cn'

export const DialogRoot = BaseDialog.Root
export const DialogTrigger = BaseDialog.Trigger
export const DialogClose = BaseDialog.Close

/** Centered modal dialog, e.g. confirmations and small forms. */
export function DialogPopup({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof BaseDialog.Popup>, 'className'> & { className?: string }) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-100 bg-[rgba(16,27,45,0.45)]" />
      <BaseDialog.Popup
        className={cn(
          'fixed top-1/2 left-1/2 z-100 w-[520px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-96px)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl bg-surface p-5.5 shadow-[var(--shadow-panel)]',
          className,
        )}
        {...props}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  )
}

export function DialogTitle({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseDialog.Title>, 'className'> & { className?: string }) {
  return <BaseDialog.Title className={cn('mb-1 text-base font-semibold', className)} {...props} />
}

/** Right-side slide-over panel, e.g. row detail inspectors. */
export function SidePanel({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <BaseDialog.Portal keepMounted>
        <BaseDialog.Popup
          className={cn(
            'fixed top-0 right-0 bottom-0 z-60 w-[380px] overflow-y-auto bg-surface p-5 shadow-[var(--shadow-panel)]',
            'transition-transform duration-150 data-[closed]:translate-x-full data-[starting-style]:translate-x-full',
          )}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
