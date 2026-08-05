/** Shared champion label helpers — display only, never build CDN URLs. */

export function championDisplayName(name: string | null | undefined, championId: number): string {
  return name?.trim() || `Champion #${championId}`;
}

export function championInitials(name: string | null | undefined, championId: number): string {
  const display = championDisplayName(name, championId);
  if (display.startsWith('Champion #')) {
    return '?';
  }
  return display
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
