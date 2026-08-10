export type ScreeningResult = {
  destination: string;
  status: "clean" | "hit" | "error";
  matchedEntry?: string;
  matchedList?: string;
  timestamp: Date;
};

export type AuditLogEntry = ScreeningResult & {
  id: string;
};

export interface SanctionsListSource {
  check(destination: string): Promise<{ hit: boolean; entry?: string; list?: string }>;
  available(): Promise<boolean>;
}

const auditLog: AuditLogEntry[] = [];
let auditCounter = 0;

let sanctionsList: string[] = [];

let sourceError: Error | null = null;

const defaultSource: SanctionsListSource = {
  async check(destination: string) {
    if (sourceError) throw sourceError;
    const normalized = destination.toUpperCase();
    const match = sanctionsList.find(
      (entry) => entry.toUpperCase() === normalized,
    );
    if (match) {
      return { hit: true, entry: match, list: "OFAC_SDN" };
    }
    return { hit: false };
  },
  async available() {
    return sourceError === null;
  },
};

export function getDefaultSource(): SanctionsListSource {
  return defaultSource;
}

export async function screenDestination(
  destination: string,
  source: SanctionsListSource = defaultSource,
): Promise<ScreeningResult> {
  const entryId = `audit-${++auditCounter}`;
  const now = new Date();

  try {
    const available = await source.available();
    if (!available) {
      const result: ScreeningResult = {
        destination,
        status: "error",
        timestamp: now,
      };
      auditLog.push({ ...result, id: entryId });
      return result;
    }

    const checkResult = await source.check(destination);

    if (checkResult.hit) {
      const result: ScreeningResult = {
        destination,
        status: "hit",
        matchedEntry: checkResult.entry,
        matchedList: checkResult.list,
        timestamp: now,
      };
      auditLog.push({ ...result, id: entryId });
      return result;
    }

    const result: ScreeningResult = {
      destination,
      status: "clean",
      timestamp: now,
    };
    auditLog.push({ ...result, id: entryId });
    return result;
  } catch {
    const result: ScreeningResult = {
      destination,
      status: "error",
      timestamp: now,
    };
    auditLog.push({ ...result, id: entryId });
    return result;
  }
}

export function getAuditLog(): readonly AuditLogEntry[] {
  return [...auditLog];
}

export function resetAuditLog(): void {
  auditLog.length = 0;
  auditCounter = 0;
}

export function __setSanctionsList(entries: string[]): void {
  sanctionsList = [...entries];
}

export function __addSanctionsEntry(entry: string): void {
  sanctionsList.push(entry);
}

export function __getSanctionsList(): string[] {
  return [...sanctionsList];
}

export function __setSourceError(error: Error | null): void {
  sourceError = error;
}

export function __resetAll(): void {
  resetAuditLog();
  sanctionsList = [];
  sourceError = null;
}
