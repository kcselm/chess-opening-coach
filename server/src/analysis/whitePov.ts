import { scoreToCp } from "@coc/shared";

/** White-POV centipawns for an EPD, given its cached eval row. Negates when Black is to move;
 *  null when the row is absent or carries neither a cp nor a mate score. */
export function whitePovCp(epd: string, row: { scoreCp: number | null; mateIn: number | null } | undefined): number | null {
  if (!row || (row.scoreCp === null && row.mateIn === null)) return null;
  const cp = scoreToCp(row);
  return epd.split(" ")[1] === "w" ? cp : -cp;
}
