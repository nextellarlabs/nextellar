/**
 * csvParser.ts
 *
 * Streams a CSV buffer row by row, yielding parsed objects keyed by the
 * header row. Handles quoted fields, trailing whitespace, and empty lines.
 *
 * Deliberately dependency-free so it works within the ESM/NodeNext tsconfig
 * without any additional packages.
 */

export interface CsvRow {
  /** 0-based index of the data row (excludes header) */
  index: number;
  /** Parsed key-value pairs from the CSV line */
  fields: Record<string, string>;
  /** Original raw line string for diagnostics */
  raw: string;
}

/** Maximum bytes accepted before the parser rejects the input. */
const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Parse a single CSV line respecting double-quoted fields (RFC 4180 subset).
 * Returns an array of unquoted field values.
 *
 * A trailing comma produces a trailing empty-string field, e.g.
 * "a,b," → ["a", "b", ""]
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      // Line ended right after a comma — trailing empty field
      if (line.length > 0 && line[line.length - 1] === ",") {
        fields.push("");
      }
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let value = "";
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            // Escaped double-quote
            value += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          value += line[i];
          i++;
        }
      }
      fields.push(value);
      // Skip comma separator (if present)
      if (i < line.length && line[i] === ",") i++;
    } else {
      // Unquoted field: read until comma or end-of-line
      const start = i;
      while (i < line.length && line[i] !== ",") i++;
      fields.push(line.slice(start, i).trim());
      if (i < line.length && line[i] === ",") i++;
    }
  }

  return fields;
}

export interface ParseCsvResult {
  rows: CsvRow[];
  headers: string[];
  totalLines: number;
  skippedLines: number;
}

/**
 * Parse a complete CSV buffer (string or Buffer).
 *
 * @throws {Error} if the input exceeds MAX_CSV_BYTES or has no header row.
 */
export function parseCsvBuffer(input: string | Buffer): ParseCsvResult {
  const raw = typeof input === "string" ? input : input.toString("utf8");

  if (Buffer.byteLength(raw, "utf8") > MAX_CSV_BYTES) {
    throw new Error(
      `CSV input exceeds maximum allowed size of ${MAX_CSV_BYTES} bytes`,
    );
  }

  // Split on any line ending style
  const lines = raw.split(/\r?\n/);
  const totalLines = lines.length;
  let skippedLines = 0;

  // Find the first non-empty line as the header
  let headerLineIdx = -1;
  let headers: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length > 0) {
      headers = parseCsvLine(trimmed).map((h) => h.toLowerCase().trim());
      headerLineIdx = i;
      break;
    }
    skippedLines++;
  }

  if (headerLineIdx === -1 || headers.length === 0) {
    throw new Error("CSV input contains no header row");
  }

  const rows: CsvRow[] = [];
  let dataIndex = 0;

  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines
    if (trimmed.length === 0) {
      skippedLines++;
      continue;
    }

    const values = parseCsvLine(trimmed);
    const fields: Record<string, string> = {};

    for (let col = 0; col < headers.length; col++) {
      fields[headers[col]] = (values[col] ?? "").trim();
    }

    rows.push({ index: dataIndex, fields, raw: line });
    dataIndex++;
  }

  return { rows, headers, totalLines, skippedLines };
}
