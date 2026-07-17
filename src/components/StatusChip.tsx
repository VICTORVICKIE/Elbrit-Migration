import { Chip } from '../ui/Chip'
import type { RowState } from '../types'

const LABELS: Record<RowState, string> = {
  new: 'New',
  matched: 'Matched',
  error: 'Error',
  conflict: 'Conflict',
  synced: 'Synced',
  skipped: 'Skipped',
}

const CLASSES: Record<RowState, string> = {
  new: 'text-status-new bg-status-new-bg',
  matched: 'text-status-matched bg-status-matched-bg',
  error: 'text-status-error bg-status-error-bg',
  conflict: 'text-status-conflict bg-status-conflict-bg',
  synced: 'text-status-synced bg-status-synced-bg',
  skipped: 'text-status-skipped bg-status-skipped-bg',
}

export function StatusChip({ state }: { state: RowState }) {
  return <Chip className={CLASSES[state]}>{LABELS[state]}</Chip>
}
