export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function formatDayInZone(iso: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(iso))
  const year = parts.find((part) => part.type === 'year')?.value || '0000'
  const month = parts.find((part) => part.type === 'month')?.value || '01'
  const day = parts.find((part) => part.type === 'day')?.value || '01'
  return `${year}-${month}-${day}`
}

export function enumerateDays(startAt: string, endAt: string, timezone: string): string[] {
  const days = new Set<string>()
  const cursor = new Date(startAt)
  const end = new Date(endAt)
  cursor.setUTCHours(0, 0, 0, 0)
  while (cursor <= end) {
    days.add(formatDayInZone(cursor.toISOString(), timezone))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  days.add(formatDayInZone(end.toISOString(), timezone))
  return [...days].sort()
}
