export function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function parseClock(value?: string): number {
  if (!value || value === 'NOT_IMPLEMENTED') return 0;
  const parts = value.split(':').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 0;
  return Math.round((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0));
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
}
