import {
  screenDestination,
  getAuditLog,
  resetAuditLog,
  __resetAll,
  __setSanctionsList,
  __addSanctionsEntry,
  __setSourceError,
  __getSanctionsList,
  getDefaultSource,
  type SanctionsListSource,
  type ScreeningResult,
} from "../../lib/sanctionsScreening.js";

const SANCTIONED_ADDR = "GCANMZYBQSBY4U6UY7V7ZA5P7LG5V6Q6V5PZ5Q6V7A5P7LG5V6Q6V5P";
const CLEAN_ADDR = "GA7OPG4E2Z5Q6V7A5P7LG5V6Q6V5PZ5Q6V7A5P7LG5V6Q6V5PZ5";

describe("sanctionsScreening", () => {
  beforeEach(() => {
    __resetAll();
  });

  describe("screenDestination", () => {
    it("returns clean for a non-listed destination", async () => {
      __setSanctionsList([SANCTIONED_ADDR]);

      const result = await screenDestination(CLEAN_ADDR);

      expect(result.status).toBe("clean");
      expect(result.destination).toBe(CLEAN_ADDR);
      expect(result.matchedEntry).toBeUndefined();
      expect(result.matchedList).toBeUndefined();
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it("returns hit for a listed destination", async () => {
      __setSanctionsList([SANCTIONED_ADDR]);

      const result = await screenDestination(SANCTIONED_ADDR);

      expect(result.status).toBe("hit");
      expect(result.destination).toBe(SANCTIONED_ADDR);
      expect(result.matchedEntry).toBe(SANCTIONED_ADDR);
      expect(result.matchedList).toBe("OFAC_SDN");
    });

    it("is case-insensitive when matching", async () => {
      __setSanctionsList([SANCTIONED_ADDR]);

      const mixedCase = SANCTIONED_ADDR.toLowerCase();
      const result = await screenDestination(mixedCase);

      expect(result.status).toBe("hit");
      expect(result.matchedEntry).toBe(SANCTIONED_ADDR);
    });

    it("returns error when the source is unavailable", async () => {
      __setSourceError(new Error("Source unavailable"));

      const result = await screenDestination(CLEAN_ADDR);

      expect(result.status).toBe("error");
      expect(result.destination).toBe(CLEAN_ADDR);
    });

    it("returns error when the source throws during check", async () => {
      const failingSource: SanctionsListSource = {
        async check() {
          throw new Error("Network error");
        },
        async available() {
          return true;
        },
      };

      const result = await screenDestination(CLEAN_ADDR, failingSource);

      expect(result.status).toBe("error");
    });

    it("handles an empty sanctions list", async () => {
      __setSanctionsList([]);

      const result = await screenDestination(SANCTIONED_ADDR);

      expect(result.status).toBe("clean");
    });

    it("matches against multiple entries", async () => {
      __setSanctionsList([
        "GAAAA111111111111111111111111111111111111111111111111111111111",
        SANCTIONED_ADDR,
        "GBBBB222222222222222222222222222222222222222222222222222222222",
      ]);

      const result = await screenDestination(SANCTIONED_ADDR);

      expect(result.status).toBe("hit");
      expect(result.matchedEntry).toBe(SANCTIONED_ADDR);
    });
  });

  describe("audit log", () => {
    it("records every screening result", async () => {
      __setSanctionsList([SANCTIONED_ADDR]);

      await screenDestination(CLEAN_ADDR);
      await screenDestination(SANCTIONED_ADDR);

      const log = getAuditLog();
      expect(log).toHaveLength(2);
      expect(log[0].status).toBe("clean");
      expect(log[0].destination).toBe(CLEAN_ADDR);
      expect(log[1].status).toBe("hit");
      expect(log[1].destination).toBe(SANCTIONED_ADDR);
      expect(log[1].matchedEntry).toBe(SANCTIONED_ADDR);
    });

    it("assigns unique audit IDs", async () => {
      await screenDestination(CLEAN_ADDR);
      await screenDestination(CLEAN_ADDR);

      const log = getAuditLog();
      expect(log[0].id).not.toBe(log[1].id);
    });

    it("records error status in audit log", async () => {
      __setSourceError(new Error("Down"));

      await screenDestination(CLEAN_ADDR);

      const log = getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].status).toBe("error");
      expect(log[0].destination).toBe(CLEAN_ADDR);
    });

    it("resetAuditLog clears the audit trail", async () => {
      await screenDestination(CLEAN_ADDR);
      expect(getAuditLog()).toHaveLength(1);

      resetAuditLog();
      expect(getAuditLog()).toHaveLength(0);
    });
  });

  describe("test helpers", () => {
    it("__setSanctionsList sets the list", () => {
      __setSanctionsList([SANCTIONED_ADDR]);
      expect(__getSanctionsList()).toEqual([SANCTIONED_ADDR]);
    });

    it("__addSanctionsEntry appends to the list", () => {
      __setSanctionsList([SANCTIONED_ADDR]);
      __addSanctionsEntry("GABCDEF123456789012345678901234567890123456789012345678901234567");
      expect(__getSanctionsList()).toHaveLength(2);
    });

    it("__resetAll clears everything", async () => {
      __setSanctionsList([SANCTIONED_ADDR]);
      await screenDestination(CLEAN_ADDR);
      expect(getAuditLog()).toHaveLength(1);
      expect(__getSanctionsList()).toHaveLength(1);

      __resetAll();
      expect(getAuditLog()).toHaveLength(0);
      expect(__getSanctionsList()).toHaveLength(0);
    });

    it("__setSourceError(null) restores availability", async () => {
      __setSourceError(new Error("Down"));
      await screenDestination(CLEAN_ADDR);
      expect((await screenDestination(CLEAN_ADDR)).status).toBe("error");

      __setSourceError(null);
      const result = await screenDestination(CLEAN_ADDR);
      expect(result.status).toBe("clean");
    });
  });

  describe("pluggable source", () => {
    it("uses a custom source when provided", async () => {
      const customSource: SanctionsListSource = {
        async check(destination: string) {
          if (destination === "blocked-addr") {
            return { hit: true, entry: "blocked-addr", list: "CUSTOM" };
          }
          return { hit: false };
        },
        async available() {
          return true;
        },
      };

      const blocked = await screenDestination("blocked-addr", customSource);
      expect(blocked.status).toBe("hit");
      expect(blocked.matchedList).toBe("CUSTOM");

      const allowed = await screenDestination("safe-addr", customSource);
      expect(allowed.status).toBe("clean");
    });

    it("rejects when custom source is unavailable", async () => {
      const unavailableSource: SanctionsListSource = {
        async check() {
          return { hit: false };
        },
        async available() {
          return false;
        },
      };

      const result = await screenDestination(CLEAN_ADDR, unavailableSource);
      expect(result.status).toBe("error");
    });

    it("getDefaultSource returns the default source", () => {
      const source = getDefaultSource();
      expect(source).toBeDefined();
      expect(typeof source.check).toBe("function");
      expect(typeof source.available).toBe("function");
    });
  });
});
