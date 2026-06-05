import { parseFile, type IAudioMetadata } from "music-metadata";

export interface ExtractedMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  genreTag: string | null;
  rawYear: number | null;
  durationS: number | null;
  picture: { data: Buffer; format: string } | null;
}

/** Subset of the common tags we read for a year — declared locally so we don't
 *  depend on the exact optional-field surface of the music-metadata types. */
interface YearTags {
  year?: number;
  originalyear?: number;
  originaldate?: string;
  date?: string;
}

export async function extractMetadata(filePath: string): Promise<ExtractedMetadata> {
  const meta: IAudioMetadata = await parseFile(filePath, { duration: true });
  const { common, format } = meta;
  const picture = common.picture?.[0];

  return {
    title: cleanString(common.title),
    artist: cleanString(common.artist),
    album: cleanString(common.album),
    genreTag: cleanString(common.genre?.[0]),
    rawYear: coalesceYear(common),
    durationS: typeof format.duration === "number" ? Math.round(format.duration) : null,
    picture: picture ? { data: Buffer.from(picture.data), format: picture.format } : null,
  };
}

/** Prefer an explicit original-release year when the tags carry one; otherwise
 *  fall back to the album year. The curator confirms the real value later. */
function coalesceYear(common: YearTags): number | null {
  const candidates: Array<number | null> = [
    typeof common.originalyear === "number" ? common.originalyear : null,
    yearFromDate(common.originaldate),
    typeof common.year === "number" ? common.year : null,
    yearFromDate(common.date),
  ];

  for (const candidate of candidates) {
    if (candidate !== null && candidate > 1850 && candidate <= 2100) {
      return candidate;
    }
  }

  return null;
}

function yearFromDate(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function cleanString(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
