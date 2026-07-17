export function normalizeItemName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}
