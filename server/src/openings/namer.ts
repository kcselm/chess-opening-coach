export interface OpeningName { eco: string; name: string }

export function pickOpening(
  epdsInOrder: string[], table: Map<string, OpeningName>
): OpeningName | null {
  let match: OpeningName | null = null;
  for (const epd of epdsInOrder) {
    const found = table.get(epd);
    if (found) match = found;
  }
  return match;
}
