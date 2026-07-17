import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

const inputBase =
  'w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 focus:outline-2 focus:outline-accent-soft focus:border-accent'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputBase, className)} {...props} />
}

export function Field({
  label,
  className,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { label: ReactNode }) {
  return (
    <label className={cn('mb-3 block', className)} {...props}>
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      {children}
    </label>
  )
}
